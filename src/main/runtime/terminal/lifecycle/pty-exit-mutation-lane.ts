import { OrcaRuntimeWithOnClientDisconnected } from '../layout/terminal-client-disconnect'
import type { PtyIncarnationId } from '../../../../shared/pty-incarnation'
import type { TerminalExitCause } from '../../../../shared/terminal-exit-cause'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { TerminalLeafMutationKey } from '../../../terminal-leaf-mutation-lane'
import { closedPaneOfExitedPty, type ClosedPaneOfExit } from './closed-pane-of-exited-pty'
import type { RuntimePtyWorktreeRecord } from '../../runtime-terminal-state-records'

type PtyExitSurface = { worktreeId: string; tabId: string; leafId: string }

type PtyExitMutationIdentity = {
  keys: readonly TerminalLeafMutationKey[]
  surfaces: readonly PtyExitSurface[]
  fingerprint: string
}

export abstract class OrcaRuntimeWithPtyExitMutationLane extends OrcaRuntimeWithOnClientDisconnected {
  private capturePtyExitMutationIdentity(ptyId: string): PtyExitMutationIdentity {
    const pty = this.ptysById.get(ptyId)
    const surfaces = new Map<string, PtyExitSurface>()
    const add = (surface: PtyExitSurface): void => {
      surfaces.set(`${surface.worktreeId}\0${surface.tabId}\0${surface.leafId}`, surface)
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      add(leaf)
    }
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      for (const tab of snapshot.tabs) {
        if (
          tab.type === 'terminal' &&
          (tab.ptyId === ptyId || tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] === ptyId)
        ) {
          add({ worktreeId, tabId: tab.parentTabId, leafId: tab.leafId })
        }
      }
    }
    const recorded = this.paneOfPty(pty)
    const recordedLeaf = parsePaneKey(recorded.paneKey ?? '')
    if (pty && recorded.tabId && recordedLeaf) {
      add({ worktreeId: pty.worktreeId, tabId: recorded.tabId, leafId: recordedLeaf.leafId })
    }
    const persisted: unknown[] = []
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
              add({ worktreeId, tabId, leafId })
              persisted.push([
                executionHostId,
                worktreeId,
                tabId,
                leafId,
                session.terminalPtyIncarnationsByPaneKey?.[`${tabId}:${leafId}`] ?? null
              ])
            }
          }
        }
      }
    }
    const keys: TerminalLeafMutationKey[] = [...surfaces.values()].map((surface) => ({
      executionHostId:
        this.tryGetWorkspaceSessionHostIdForWorktree(surface.worktreeId) ?? LOCAL_EXECUTION_HOST_ID,
      ...surface
    }))
    if (pty?.connectionId && this.store?.getSshPtyRetirementMutationKeys) {
      const sshKeys = this.store.getSshPtyRetirementMutationKeys(pty.connectionId, ptyId)
      keys.push(...sshKeys)
      for (const key of sshKeys) {
        add(key)
      }
    }
    const orderedSurfaces = [...surfaces.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    )
    persisted.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    return {
      keys,
      surfaces: orderedSurfaces,
      fingerprint: JSON.stringify({
        incarnationId: pty?.incarnationId ?? null,
        connectionId: pty?.connectionId ?? null,
        worktreeId: pty?.worktreeId ?? null,
        persisted,
        surfaces: orderedSurfaces
      })
    }
  }

  /** The pane main's close already dropped, from its closed-pane record; null while main holds it. */
  protected closedPaneOfExit(
    pty: RuntimePtyWorktreeRecord | undefined,
    exitIncarnationId: PtyIncarnationId | undefined
  ): ClosedPaneOfExit | null {
    if (!ORCA_LAYOUT_OWNER_IS_MAIN || !pty || this.paneOfPty(pty).paneKey) {
      return null
    }
    return closedPaneOfExitedPty(
      this.store,
      this.tryGetWorkspaceSessionHostIdForWorktree(pty.worktreeId),
      pty,
      exitIncarnationId ?? pty.incarnationId
    )
  }

  onPtyExit(
    ptyId: string,
    exitCode: number,
    exitIncarnationId?: PtyIncarnationId,
    options: {
      hostExitConfirmed?: boolean
      cause?: TerminalExitCause
      providerExitObserved?: boolean
      viewShown?: boolean
    } = {}
  ): void | Promise<void> {
    const run = (): Promise<void> => {
      const identity = this.capturePtyExitMutationIdentity(ptyId)
      let retry = false
      const mutation = this.runTerminalLeafMutations(identity.keys, () => {
        const current = this.capturePtyExitMutationIdentity(ptyId)
        if (current.fingerprint !== identity.fingerprint) {
          retry = true
          return
        }
        return this.onPtyExitWithinLeafLane(ptyId, exitCode, exitIncarnationId, {
          ...options,
          persistedSurfaces: identity.surfaces
        })
      })
      return mutation.then(() => (retry ? run() : undefined))
    }
    return run()
  }

  protected abstract onPtyExitWithinLeafLane(
    ptyId: string,
    exitCode: number,
    exitIncarnationId?: PtyIncarnationId,
    options?: {
      hostExitConfirmed?: boolean
      cause?: TerminalExitCause
      providerExitObserved?: boolean
      viewShown?: boolean
      persistedSurfaces?: readonly PtyExitSurface[]
    }
  ): void | Promise<void>
}
