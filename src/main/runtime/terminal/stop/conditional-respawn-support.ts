import type {
  TerminalConditionalRespawnRequest,
  TerminalConditionalRespawnResult
} from '../../../../shared/terminal-conditional-respawn'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLeafMutationKey } from '../../../terminal-leaf-mutation-lane'
import type {
  PtyRegistrationClaim,
  RuntimeLeafRecord,
  RuntimePtyWorktreeRecord
} from '../../runtime-terminal-state-records'
import type { TerminalHandleRecord } from '../../runtime-terminal-contracts'
import { OrcaRuntimeWithSleepResolvedWorktreeTerminals } from './worktree-terminal-sleep'

export type ConditionalRespawnCurrent = {
  record: TerminalHandleRecord
  leaf: RuntimeLeafRecord
  pty: RuntimePtyWorktreeRecord
}

export abstract class OrcaRuntimeWithConditionalRespawnSupport extends OrcaRuntimeWithSleepResolvedWorktreeTerminals {
  protected resolveConditionalRespawnCurrent(
    request: TerminalConditionalRespawnRequest
  ): ConditionalRespawnCurrent | null {
    try {
      const direct = this.getLivePtyForHandle(request.terminal)
      if (direct) {
        const leaf = this.leaves.get(
          this.getLeafKey(request.expected.tabId, request.expected.leafId)
        )
        return leaf?.ptyId === direct.pty.ptyId
          ? { record: direct.record, leaf, pty: direct.pty }
          : null
      }
      const { record, leaf } = this.getLiveLeafForHandle(request.terminal)
      const pty = leaf.ptyId ? this.ptysById.get(leaf.ptyId) : undefined
      return pty ? { record, leaf, pty } : null
    } catch {
      return null
    }
  }

  /** Every known surface an exit for this PTY may retire while respawn owns its mutation lane. */
  protected captureConditionalRespawnMutationIdentity(ptyId: string): {
    keys: readonly TerminalLeafMutationKey[]
    fingerprint: string
  } | null {
    const stopIdentity = this.captureTerminalStopIdentity(ptyId)
    if (!stopIdentity) {
      return null
    }
    const keys: TerminalLeafMutationKey[] = [...stopIdentity.mutationKeys]
    const executionHostId = stopIdentity.connectionId
      ? toSshExecutionHostId(stopIdentity.connectionId)
      : LOCAL_EXECUTION_HOST_ID
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      for (const tab of snapshot.tabs) {
        if (
          tab.type === 'terminal' &&
          (tab.ptyId === ptyId || tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] === ptyId)
        ) {
          keys.push({
            executionHostId:
              this.tryGetWorkspaceSessionHostIdForWorktree(worktreeId) ?? executionHostId,
            worktreeId,
            tabId: tab.parentTabId,
            leafId: tab.leafId
          })
        }
      }
    }
    const pty = this.ptysById.get(ptyId)
    const recorded = this.paneOfPty(pty)
    const recordedLeaf = parsePaneKey(recorded.paneKey ?? '')
    if (pty && recorded.tabId && recordedLeaf) {
      keys.push({
        executionHostId:
          this.tryGetWorkspaceSessionHostIdForWorktree(pty.worktreeId) ?? executionHostId,
        worktreeId: pty.worktreeId,
        tabId: recorded.tabId,
        leafId: recordedLeaf.leafId
      })
    }
    const unique = new Map<string, TerminalLeafMutationKey>()
    for (const key of keys) {
      const logical = JSON.stringify([key.worktreeId, key.tabId, key.leafId])
      if (!unique.has(logical)) {
        unique.set(logical, key)
      }
    }
    const ordered = [...unique.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, key]) => key)
    return {
      keys: ordered,
      fingerprint: JSON.stringify({
        worktreeId: stopIdentity.worktreeId,
        incarnationId: stopIdentity.incarnationId,
        connectionId: stopIdentity.connectionId,
        connected: stopIdentity.connected,
        recordedSurfaceFingerprint: stopIdentity.recordedSurfaceFingerprint,
        mobileSurfaceFingerprint: stopIdentity.mobileSurfaceFingerprint,
        leaves: stopIdentity.leaves,
        persistedBindings: stopIdentity.persistedBindings,
        surfaces: ordered.map(({ worktreeId, tabId, leafId }) => [worktreeId, tabId, leafId]),
        mutationKeysFingerprint: stopIdentity.mutationKeysFingerprint
      })
    }
  }

  protected async recoverUncommittedConditionalReplacement(args: {
    request: TerminalConditionalRespawnRequest
    registration: PtyRegistrationClaim
    current: ConditionalRespawnCurrent
    replacementIncarnationId: string
    reason: string
  }): Promise<TerminalConditionalRespawnResult> {
    const { request, registration, current, replacementIncarnationId, reason } = args
    let replacementStopConfirmed = registration.exitedIncarnations.has(replacementIncarnationId)
    if (!replacementStopConfirmed) {
      try {
        replacementStopConfirmed =
          (await this.ptyController?.stopIncarnationIfMatch?.(
            request.expected.ptyId,
            replacementIncarnationId
          )) === true
      } catch {
        replacementStopConfirmed = false
      }
    }
    if (replacementStopConfirmed) {
      this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
      await this.onPtyExit(request.expected.ptyId, 0, request.expected.incarnationId, {
        providerExitObserved: true
      })
      return {
        outcome: 'indeterminate',
        mutationId: request.mutationId,
        reason: `${reason}_replacement_stopped`,
        oldStopped: true,
        replacementStarted: true,
        incarnationId: replacementIncarnationId
      }
    }
    if (
      !this.narrowPtyRegistration(request.expected.ptyId, registration, replacementIncarnationId)
    ) {
      return {
        outcome: 'indeterminate',
        mutationId: request.mutationId,
        reason: `${reason}_stop_unverified`,
        oldStopped: true,
        replacementStarted: true,
        incarnationId: replacementIncarnationId
      }
    }
    this.registerPty(
      request.expected.ptyId,
      current.record.worktreeId,
      current.pty.connectionId,
      {
        tabId: current.record.tabId,
        leafId: current.record.leafId,
        incarnationId: replacementIncarnationId,
        terminalHandle: request.terminal
      },
      current.pty.isWsl ?? undefined
    )
    this.markPtyLivenessUnverifiable(
      request.expected.ptyId,
      `${reason.replaceAll('_', ' ')} and its stop could not be verified`
    )
    return {
      outcome: 'indeterminate',
      mutationId: request.mutationId,
      reason: `${reason}_stop_unverified`,
      oldStopped: true,
      replacementStarted: true,
      incarnationId: replacementIncarnationId
    }
  }
}
