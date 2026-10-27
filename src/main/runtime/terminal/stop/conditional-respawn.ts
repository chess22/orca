import type {
  TerminalConditionalRespawnRequest,
  TerminalConditionalRespawnResult
} from '../../../../shared/terminal-conditional-respawn'
import { toSshExecutionHostId } from '../../../../shared/execution-host'
import { OrcaRuntimeWithConditionalRespawnSupport } from './conditional-respawn-support'

export abstract class OrcaRuntimeWithConditionalRespawn extends OrcaRuntimeWithConditionalRespawnSupport {
  async respawnTerminalIfMatch(
    request: TerminalConditionalRespawnRequest
  ): Promise<TerminalConditionalRespawnResult> {
    const initial = this.resolveConditionalRespawnCurrent(request)
    if (!initial?.leaf.ptyId) {
      return {
        outcome: 'precondition_failed',
        mutationId: request.mutationId,
        reason: 'terminal_not_live'
      }
    }
    const mutationIdentity = this.captureConditionalRespawnMutationIdentity(initial.leaf.ptyId)
    if (!mutationIdentity) {
      return {
        outcome: 'precondition_failed',
        mutationId: request.mutationId,
        reason: 'terminal_not_live'
      }
    }
    return this.runTerminalLeafMutations(mutationIdentity.keys, async () => {
      if (
        this.captureConditionalRespawnMutationIdentity(request.expected.ptyId)?.fingerprint !==
        mutationIdentity.fingerprint
      ) {
        return {
          outcome: 'precondition_failed',
          mutationId: request.mutationId,
          reason: 'terminal_identity_changed'
        }
      }
      const observedGraphEpoch = this.captureReadyGraphEpoch()
      const persistedBindingMatches = (): boolean => {
        const session = this.getWorkspaceSessionForWorktree(request.expected.worktreeId)
        return (
          session?.terminalLayoutsByTabId?.[request.expected.tabId]?.ptyIdsByLeafId?.[
            request.expected.leafId
          ] === request.expected.ptyId &&
          session.terminalPtyIncarnationsByPaneKey?.[
            `${request.expected.tabId}:${request.expected.leafId}`
          ] === request.expected.incarnationId
        )
      }
      const current = this.resolveConditionalRespawnCurrent(request)
      if (
        !current ||
        current.leaf.ptyId !== request.expected.ptyId ||
        current.pty.worktreeId !== request.expected.worktreeId ||
        current.pty.incarnationId !== request.expected.incarnationId ||
        current.record.worktreeId !== request.expected.worktreeId ||
        current.record.tabId !== request.expected.tabId ||
        current.record.leafId !== request.expected.leafId ||
        current.record.ptyGeneration !== request.expected.ptyGeneration ||
        current.leaf.ptyGeneration !== request.expected.ptyGeneration ||
        !persistedBindingMatches()
      ) {
        return {
          outcome: 'precondition_failed',
          mutationId: request.mutationId,
          reason: 'terminal_identity_changed'
        }
      }
      if (!this.ptyController?.respawnIfMatch) {
        return { outcome: 'unsupported', mutationId: request.mutationId, reason: 'provider' }
      }
      const currentSize = this.ptyController.getSize?.(request.expected.ptyId) ?? null
      const cols = request.replacement.cols ?? currentSize?.cols
      const rows = request.replacement.rows ?? currentSize?.rows
      if (cols === undefined || rows === undefined) {
        return {
          outcome: 'failed_before_mutation',
          mutationId: request.mutationId,
          reason: 'terminal_size_unavailable'
        }
      }
      const registration = this.beginPtyRegistration(request.expected.ptyId)
      let result: TerminalConditionalRespawnResult
      try {
        result = await this.ptyController.respawnIfMatch(
          request.expected.ptyId,
          request.expected.incarnationId,
          request.mutationId,
          { ...request.replacement, cols, rows }
        )
      } catch (error) {
        this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
        throw error
      }
      const replacementIdentity =
        result.outcome === 'respawned' ||
        (result.outcome === 'partial' && result.replacementStarted)
          ? { ptyId: result.ptyId, incarnationId: result.incarnationId }
          : null
      if (
        replacementIdentity &&
        (replacementIdentity.ptyId !== request.expected.ptyId ||
          !replacementIdentity.incarnationId ||
          replacementIdentity.incarnationId === request.expected.incarnationId)
      ) {
        this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
        return {
          outcome: 'indeterminate',
          mutationId: request.mutationId,
          reason: 'response_identity_changed'
        }
      }
      try {
        this.assertStableReadyGraph(observedGraphEpoch)
        const postProvider = this.resolveConditionalRespawnCurrent(request)
        if (
          !postProvider ||
          postProvider.pty.worktreeId !== request.expected.worktreeId ||
          postProvider.leaf.worktreeId !== request.expected.worktreeId ||
          postProvider.leaf.tabId !== request.expected.tabId ||
          postProvider.leaf.leafId !== request.expected.leafId ||
          postProvider.leaf.ptyId !== request.expected.ptyId ||
          postProvider.leaf.ptyGeneration !== request.expected.ptyGeneration ||
          !persistedBindingMatches()
        ) {
          throw new Error('terminal_identity_changed')
        }
      } catch {
        const publishedIncarnation =
          result.outcome === 'respawned'
            ? result.incarnationId
            : result.outcome === 'partial' &&
                result.replacementStarted &&
                result.replacementPublished
              ? result.incarnationId
              : null
        if (publishedIncarnation) {
          return await this.recoverUncommittedConditionalReplacement({
            request,
            registration,
            current,
            replacementIncarnationId: publishedIncarnation,
            reason: 'graph_changed_after_respawn'
          })
        }
        this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
        if (result.outcome === 'partial' && result.oldStopped) {
          await this.onPtyExit(request.expected.ptyId, 0, request.expected.incarnationId, {
            providerExitObserved: true
          })
        }
        return result
      }
      const replacementIncarnationId =
        result.outcome === 'respawned'
          ? result.incarnationId
          : result.outcome === 'partial' &&
              result.replacementStarted &&
              result.replacementPublished &&
              result.incarnationId
            ? result.incarnationId
            : null
      if (
        result.outcome === 'partial' &&
        result.replacementStarted &&
        !result.replacementPublished
      ) {
        this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
        await this.onPtyExit(request.expected.ptyId, 0, request.expected.incarnationId, {
          providerExitObserved: true
        })
        return result
      }
      if (!replacementIncarnationId) {
        this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
        return result
      }
      let persisted = false
      try {
        persisted =
          (await this.store?.persistPtyBinding?.(
            {
              worktreeId: request.expected.worktreeId,
              tabId: request.expected.tabId,
              leafId: request.expected.leafId,
              ptyId: request.expected.ptyId,
              incarnationId: replacementIncarnationId,
              expectedBinding: {
                ptyId: request.expected.ptyId,
                incarnationId: request.expected.incarnationId
              },
              mayCreate: false
            },
            current.pty.connectionId ? toSshExecutionHostId(current.pty.connectionId) : undefined
          )) === true
      } catch (error) {
        console.error('[runtime] failed to persist conditional terminal replacement:', error)
      }
      if (!persisted) {
        return await this.recoverUncommittedConditionalReplacement({
          request,
          registration,
          current,
          replacementIncarnationId,
          reason: 'replacement_binding_not_persisted'
        })
      }
      const exitedBeforeRegistration = registration.exitedIncarnations.has(replacementIncarnationId)
      if (exitedBeforeRegistration) {
        this.cancelPendingPtyRegistration(request.expected.ptyId, undefined, registration)
      } else if (
        !this.narrowPtyRegistration(request.expected.ptyId, registration, replacementIncarnationId)
      ) {
        return {
          outcome: 'indeterminate',
          mutationId: request.mutationId,
          reason: 'response_identity_changed'
        }
      }
      const replacementPtyId =
        result.outcome === 'respawned' ? result.ptyId : request.expected.ptyId
      this.registerPty(
        replacementPtyId,
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
      if (exitedBeforeRegistration) {
        await this.onPtyExit(replacementPtyId, 0, replacementIncarnationId, {
          providerExitObserved: true
        })
      }
      return result
    })
  }
}
