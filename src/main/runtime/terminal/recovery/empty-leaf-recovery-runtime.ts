import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../../../shared/execution-host'
import {
  terminalEmptyLeafTombstoneId,
  type TerminalEmptyLeafRecoveryRequest,
  type TerminalEmptyLeafRecoveryResult
} from '../../../../shared/terminal-empty-leaf-recovery'
import { OrcaRuntimeWithConditionalRespawnSupport } from '../stop/conditional-respawn-support'
import { RuntimeEmptyLeafRecovery } from './empty-leaf-recovery'

export abstract class OrcaRuntimeWithEmptyLeafRecovery extends OrcaRuntimeWithConditionalRespawnSupport {
  private readonly emptyLeafRecovery = new RuntimeEmptyLeafRecovery({
    runWithLeafReservation: (request, operation) => {
      const pty = this.ptysById.get(request.expected.ptyId)
      return this.runTerminalLeafMutations(
        [
          {
            executionHostId: pty?.connectionId
              ? toSshExecutionHostId(pty.connectionId)
              : LOCAL_EXECUTION_HOST_ID,
            worktreeId: request.expected.worktreeId,
            tabId: request.expected.tabId,
            leafId: request.expected.leafId
          }
        ],
        operation
      )
    },
    inspectState: (request) => this.inspectEmptyLeafRecoveryState(request),
    recoverProvider: async (request) => {
      if (!this.ptyController?.recoverEmptyLeafIfMatch) {
        return {
          outcome: 'failed_before_mutation',
          recoveryId: request.recoveryId,
          reason: 'provider_unsupported'
        }
      }
      return await this.ptyController.recoverEmptyLeafIfMatch(request)
    },
    persistReplacement: async ({ request, incarnationId }) => {
      const pty = this.ptysById.get(request.expected.ptyId)
      return (
        (await this.store?.persistPtyBinding?.(
          {
            worktreeId: request.expected.worktreeId,
            tabId: request.expected.tabId,
            leafId: request.expected.leafId,
            ptyId: request.expected.ptyId,
            incarnationId,
            expectedBinding: {
              ptyId: request.expected.ptyId,
              incarnationId: request.expected.retiredIncarnationId
            },
            mayCreate: false
          },
          pty?.connectionId ? toSshExecutionHostId(pty.connectionId) : undefined
        )) === true
      )
    },
    publishReplacement: async ({ request, incarnationId }) => {
      const pty = this.ptysById.get(request.expected.ptyId)
      if (!pty) {
        throw new Error('empty_leaf_identity_changed')
      }
      this.registerPty(
        request.expected.ptyId,
        request.expected.worktreeId,
        pty.connectionId,
        {
          tabId: request.expected.tabId,
          leafId: request.expected.leafId,
          incarnationId,
          terminalHandle: request.terminal
        },
        pty.isWsl ?? undefined
      )
      if (
        (await this.ptyController?.completeEmptyLeafRecovery?.(
          request.recoveryId,
          request.expected.ptyId,
          incarnationId,
          true
        )) !== true
      ) {
        throw new Error('replacement_commit_failed')
      }
    },
    rollbackPersistedReplacement: async (request, incarnationId) => {
      const pty = this.ptysById.get(request.expected.ptyId)
      const rolledBack =
        (await this.store?.persistPtyBinding?.(
          {
            worktreeId: request.expected.worktreeId,
            tabId: request.expected.tabId,
            leafId: request.expected.leafId,
            ptyId: request.expected.ptyId,
            incarnationId: request.expected.retiredIncarnationId,
            expectedBinding: { ptyId: request.expected.ptyId, incarnationId },
            mayCreate: false
          },
          pty?.connectionId ? toSshExecutionHostId(pty.connectionId) : undefined
        )) === true
      if (!rolledBack || !pty) {
        return false
      }
      this.registerPty(
        request.expected.ptyId,
        request.expected.worktreeId,
        pty.connectionId,
        {
          tabId: request.expected.tabId,
          leafId: request.expected.leafId,
          incarnationId: request.expected.retiredIncarnationId,
          terminalHandle: request.terminal
        },
        pty.isWsl ?? undefined
      )
      const restoredPty = this.ptysById.get(request.expected.ptyId)
      const restoredLeaf = this.leaves.get(
        this.getLeafKey(request.expected.tabId, request.expected.leafId)
      )
      if (!restoredPty || !restoredLeaf) {
        return false
      }
      restoredPty.connected = false
      restoredPty.agentSessionOwners = []
      restoredPty.agentSessionOwnershipKnown = true
      restoredLeaf.connected = false
      restoredLeaf.writable = false
      return true
    },
    abortUnpublishedReplacement: async (request, incarnationId) =>
      (await this.ptyController?.completeEmptyLeafRecovery?.(
        request.recoveryId,
        request.expected.ptyId,
        incarnationId,
        false
      )) === true,
    stopUnpublishedReplacement: async (request, incarnationId) =>
      (await this.ptyController?.stopIncarnationIfMatch?.(
        request.expected.ptyId,
        incarnationId
      )) === true
  })

  recoverTerminalEmptyLeafIfMatch(
    request: TerminalEmptyLeafRecoveryRequest
  ): Promise<TerminalEmptyLeafRecoveryResult> {
    return this.emptyLeafRecovery.recover(request)
  }

  protected inspectEmptyLeafRecoveryState(request: TerminalEmptyLeafRecoveryRequest) {
    const record = this.handles.get(request.terminal)
    const leaf = this.leaves.get(this.getLeafKey(request.expected.tabId, request.expected.leafId))
    const pty = this.ptysById.get(request.expected.ptyId)
    const session = this.getWorkspaceSessionForWorktree(request.expected.worktreeId)
    const persistedPtyId =
      session?.terminalLayoutsByTabId?.[request.expected.tabId]?.ptyIdsByLeafId?.[
        request.expected.leafId
      ]
    const persistedIncarnation =
      session?.terminalPtyIncarnationsByPaneKey?.[
        `${request.expected.tabId}:${request.expected.leafId}`
      ]
    if (
      !record ||
      !leaf ||
      !pty ||
      record.worktreeId !== request.expected.worktreeId ||
      record.tabId !== request.expected.tabId ||
      record.leafId !== request.expected.leafId ||
      record.ptyId !== request.expected.ptyId ||
      record.ptyGeneration !== request.expected.ptyGeneration ||
      persistedPtyId !== request.expected.ptyId ||
      persistedIncarnation !== request.expected.retiredIncarnationId
    ) {
      return null
    }
    return {
      layoutEpoch: this.captureReadyGraphEpoch(),
      terminal: request.terminal,
      worktreeId: leaf.worktreeId,
      tabId: leaf.tabId,
      leafId: leaf.leafId,
      ptyId: leaf.ptyId ?? '',
      ptyGeneration: leaf.ptyGeneration,
      retiredIncarnationId: pty.incarnationId ?? '',
      persistedBindingVersion: leaf.ptyGeneration,
      tombstoneId: terminalEmptyLeafTombstoneId(request.expected.ptyId, pty.incarnationId ?? ''),
      leafEmpty: !leaf.connected && !leaf.writable && pty.connected === false,
      liveIncarnationId: pty.connected ? pty.incarnationId : null,
      agentOwnerCount: pty.agentSessionOwnershipKnown ? pty.agentSessionOwners.length : null,
      recoveryOwnerId: null
    }
  }
}
