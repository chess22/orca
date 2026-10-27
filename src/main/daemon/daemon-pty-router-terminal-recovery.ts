import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { DaemonSessionOwnerResolver } from './daemon-session-owner-resolution'
import type {
  TerminalConditionalRespawnResult,
  TerminalRespawnReplacement
} from '../../shared/terminal-conditional-respawn'
import type {
  TerminalEmptyLeafRecoveryRequest,
  TerminalEmptyLeafRecoveryResult
} from '../../shared/terminal-empty-leaf-recovery'

type RouterRecoveryContext = {
  sessionAdapters: Map<string, DaemonPtyAdapter>
  ownerResolver: DaemonSessionOwnerResolver<DaemonPtyAdapter>
}

export async function respawnRoutedTerminalIfMatch(
  context: RouterRecoveryContext,
  id: string,
  expectedIncarnationId: string,
  expectedRootProcessId: number,
  mutationId: string,
  replacement: TerminalRespawnReplacement
): Promise<TerminalConditionalRespawnResult> {
  const verified = context.ownerResolver.getVerifiedRoute(id)
  const adapter = context.sessionAdapters.get(id)
  if (!adapter || verified !== adapter || !adapter.respawnIfMatch) {
    return { outcome: 'unsupported', mutationId, reason: 'daemon_owner_unavailable' }
  }
  const expiry = setTimeout(() => {
    if (context.sessionAdapters.get(id) === adapter && !adapter.hasPty(id)) {
      context.sessionAdapters.delete(id)
    }
  }, 5 * 60_000)
  expiry.unref()
  return await adapter.respawnIfMatch(
    id,
    expectedIncarnationId,
    expectedRootProcessId,
    mutationId,
    replacement
  )
}

export async function recoverRoutedEmptyLeafIfMatch(
  context: RouterRecoveryContext,
  request: TerminalEmptyLeafRecoveryRequest
): Promise<TerminalEmptyLeafRecoveryResult> {
  const adapter = context.sessionAdapters.get(request.expected.ptyId)
  if (!adapter?.recoverEmptyLeafIfMatch) {
    return {
      outcome: 'failed_before_mutation',
      recoveryId: request.recoveryId,
      reason: 'provider_unsupported'
    }
  }
  return await adapter.recoverEmptyLeafIfMatch(request)
}

export async function completeRoutedEmptyLeafRecovery(
  context: RouterRecoveryContext,
  recoveryId: string,
  ptyId: string,
  incarnationId: string,
  commit: boolean
): Promise<boolean> {
  const adapter =
    context.sessionAdapters.get(ptyId) ?? context.ownerResolver.getVerifiedRoute(ptyId)
  return (
    (await adapter?.completeEmptyLeafRecovery?.(recoveryId, ptyId, incarnationId, commit)) === true
  )
}
