import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import {
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { cloneWorkspaceSessionState } from '../../../persistence/restoring-sessions/session-owner-fields'
import { rollbackWorkspaceSessionAfterFailedAsyncWrite } from '../../../persistence/restoring-sessions/workspace-session-write-rollback'
import type { TerminalLeafMutationKey } from '../../../terminal-leaf-mutation-lane'
import { OrcaRuntimeWithResolveTerminalSplitSourceAuthority } from '../launch/terminal-split-source-authority'

export type TerminalStopIdentity = {
  ptyId: string
  worktreeId: string
  incarnationId: string | null
  connectionId: string | null
  connected: boolean
  recordedSurfaceFingerprint: string
  mobileSurfaceFingerprint: string
  leaves: readonly {
    worktreeId: string
    tabId: string
    leafId: string
    ptyGeneration: number
  }[]
  persistedBindings: readonly {
    executionHostId: ExecutionHostId
    worktreeId: string
    tabId: string
    leafId: string
    incarnationId: string | null
  }[]
  mutationKeys: readonly TerminalLeafMutationKey[]
  mutationKeysFingerprint: string
}

function fingerprintSorted<T>(values: readonly T[]): string {
  return JSON.stringify(
    [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
}

export abstract class OrcaRuntimeWithTerminalStopIdentity extends OrcaRuntimeWithResolveTerminalSplitSourceAuthority {
  /** Durably replaces a host partition's session with `edit`'s result: null skips, an Error refuses. */
  protected async commitWorkspaceSessionEdit(
    hostId: ExecutionHostId,
    edit: (session: WorkspaceSessionState) => WorkspaceSessionState | Error | null
  ): Promise<void> {
    if (
      !this.store?.getWorkspaceSession ||
      !this.store.setWorkspaceSession ||
      !this.store.runDurableMutation
    ) {
      throw new Error('workspace_session_unavailable')
    }
    const refusal = await this.store.runDurableMutation<Error | undefined>(() => {
      const session = cloneWorkspaceSessionState(this.store!.getWorkspaceSession!(hostId))
      const next = edit(session)
      if (next instanceof Error) {
        return { value: next, persist: false }
      }
      if (!next) {
        return { value: undefined, persist: false }
      }
      this.store!.setWorkspaceSession!(next, hostId)
      const staged = cloneWorkspaceSessionState(this.store!.getWorkspaceSession!(hostId))
      return {
        value: undefined,
        rollback: () => {
          const current = this.store!.getWorkspaceSession!(hostId)
          const rolledBack = rollbackWorkspaceSessionAfterFailedAsyncWrite(session, staged, current)
          if (rolledBack !== current) {
            this.store!.setWorkspaceSession!(rolledBack, hostId)
          }
        }
      }
    })
    if (refusal) {
      throw refusal
    }
  }

  protected captureTerminalStopIdentity(ptyId: string): TerminalStopIdentity | null {
    const pty = this.ptysById.get(ptyId)
    if (!pty) {
      return null
    }
    const leaves = this.getLeavesForPty(ptyId)
      .map((leaf) => ({
        worktreeId: leaf.worktreeId,
        tabId: leaf.tabId,
        leafId: leaf.leafId,
        ptyGeneration: leaf.ptyGeneration
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const recorded = this.paneOfPty(pty)
    const recordedSurfaceFingerprint = JSON.stringify({
      tabId: recorded.tabId ?? null,
      paneKey: recorded.paneKey ?? null
    })
    const mobileSurfaceFingerprint = fingerprintSorted(
      [...this.mobileSessionTabsByWorktree].flatMap(([worktreeId, snapshot]) =>
        snapshot.tabs.flatMap((tab) => {
          if (tab.type !== 'terminal') {
            return []
          }
          const layoutPtyId = tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] ?? null
          if (tab.ptyId !== ptyId && layoutPtyId !== ptyId) {
            return []
          }
          return [
            {
              worktreeId,
              tabId: tab.parentTabId,
              leafId: tab.leafId,
              ptyId: tab.ptyId ?? null,
              layoutPtyId
            }
          ]
        })
      )
    )
    const persistedBindings: TerminalStopIdentity['persistedBindings'][number][] = []
    if (this.store?.getWorkspaceSessionHostIds && this.store.getWorkspaceSession) {
      for (const executionHostId of this.store.getWorkspaceSessionHostIds()) {
        const session = this.store.getWorkspaceSession(executionHostId)
        const worktreeByTab = new Map<string, string>()
        for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
          for (const tab of tabs) {
            worktreeByTab.set(tab.id, worktreeId)
          }
        }
        for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
          const worktreeId = worktreeByTab.get(tabId)
          if (!worktreeId) {
            continue
          }
          for (const [leafId, boundPtyId] of Object.entries(layout.ptyIdsByLeafId ?? {})) {
            if (boundPtyId === ptyId) {
              persistedBindings.push({
                executionHostId,
                worktreeId,
                tabId,
                leafId,
                incarnationId:
                  session.terminalPtyIncarnationsByPaneKey?.[`${tabId}:${leafId}`] ?? null
              })
            }
          }
        }
      }
    }
    persistedBindings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const mutationKeys: TerminalLeafMutationKey[] = persistedBindings.map(
      ({ executionHostId, worktreeId, tabId, leafId }) => ({
        executionHostId,
        worktreeId,
        tabId,
        leafId
      })
    )
    mutationKeys.push(
      ...leaves.flatMap((leaf) => {
        const hostIds = this.getWorkspaceSessionHostIdsForTab(leaf.worktreeId, leaf.tabId)
        const fallback: ExecutionHostId = pty.connectionId
          ? toSshExecutionHostId(pty.connectionId)
          : LOCAL_EXECUTION_HOST_ID
        return (hostIds.length > 0 ? hostIds : [fallback]).map((executionHostId) => ({
          executionHostId,
          worktreeId: leaf.worktreeId,
          tabId: leaf.tabId,
          leafId: leaf.leafId
        }))
      })
    )
    if (pty.connectionId && this.store?.getSshPtyRetirementMutationKeys) {
      mutationKeys.push(...this.store.getSshPtyRetirementMutationKeys(pty.connectionId, ptyId))
    }
    if (mutationKeys.length === 0) {
      const parsed = parsePaneKey(recorded.paneKey ?? '')
      if (recorded.tabId && parsed?.leafId) {
        mutationKeys.push({
          executionHostId: pty.connectionId
            ? toSshExecutionHostId(pty.connectionId)
            : LOCAL_EXECUTION_HOST_ID,
          worktreeId: pty.worktreeId,
          tabId: recorded.tabId,
          leafId: parsed.leafId
        })
      }
    }
    return {
      ptyId,
      worktreeId: pty.worktreeId,
      incarnationId: pty.incarnationId,
      connectionId: pty.connectionId,
      connected: pty.connected,
      recordedSurfaceFingerprint,
      mobileSurfaceFingerprint,
      leaves,
      persistedBindings,
      mutationKeys,
      mutationKeysFingerprint: fingerprintSorted(mutationKeys)
    }
  }

  protected terminalStopIdentityMatches(expected: TerminalStopIdentity): boolean {
    const current = this.captureTerminalStopIdentity(expected.ptyId)
    return (
      current !== null &&
      current.worktreeId === expected.worktreeId &&
      current.incarnationId === expected.incarnationId &&
      current.connectionId === expected.connectionId &&
      current.connected === expected.connected &&
      current.recordedSurfaceFingerprint === expected.recordedSurfaceFingerprint &&
      current.mobileSurfaceFingerprint === expected.mobileSurfaceFingerprint &&
      JSON.stringify(current.leaves) === JSON.stringify(expected.leaves) &&
      JSON.stringify(current.persistedBindings) === JSON.stringify(expected.persistedBindings) &&
      current.mutationKeysFingerprint === expected.mutationKeysFingerprint
    )
  }

  protected runTerminalStopMutation<T>(
    identity: TerminalStopIdentity,
    operation: () => Promise<T> | T
  ): Promise<T> {
    return this.store?.runTerminalLeafMutations
      ? this.store.runTerminalLeafMutations(identity.mutationKeys, operation)
      : Promise.resolve().then(operation)
  }
}
