import { getProviderForPty } from '../provider/registry'
import type {
  TerminalEmptyLeafRecoveryRequest,
  TerminalEmptyLeafRecoveryResult
} from '../../../../shared/terminal-empty-leaf-recovery'

export async function recoverPtyEmptyLeafIfMatch(
  request: TerminalEmptyLeafRecoveryRequest
): Promise<TerminalEmptyLeafRecoveryResult> {
  let provider
  try {
    provider = getProviderForPty(request.expected.ptyId)
  } catch {
    return {
      outcome: 'failed_before_mutation',
      recoveryId: request.recoveryId,
      reason: 'provider_owner_unavailable'
    }
  }
  if (!provider.recoverEmptyLeafIfMatch) {
    return {
      outcome: 'failed_before_mutation',
      recoveryId: request.recoveryId,
      reason: 'provider_unsupported'
    }
  }
  return await provider.recoverEmptyLeafIfMatch(request)
}

export async function completePtyEmptyLeafRecovery(
  recoveryId: string,
  ptyId: string,
  incarnationId: string,
  commit: boolean
): Promise<boolean> {
  try {
    return (
      (await getProviderForPty(ptyId).completeEmptyLeafRecovery?.(
        recoveryId,
        ptyId,
        incarnationId,
        commit
      )) === true
    )
  } catch {
    return false
  }
}
