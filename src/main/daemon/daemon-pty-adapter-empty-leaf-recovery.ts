import {
  isTerminalEmptyLeafRecoveryResult,
  type TerminalEmptyLeafRecoveryRequest,
  type TerminalEmptyLeafRecoveryResult
} from '../../shared/terminal-empty-leaf-recovery'

type RecoveryAdapter = {
  protocolVersion: number
  withHistorySpawnLock<T>(id: string, run: () => Promise<T>): Promise<T>
  ensureConnected(): Promise<void>
  client: { request<T>(method: string, payload: unknown): Promise<T> }
  sessionIncarnations: Map<string, string>
  activeSessionIds: Set<string>
}

type RecoveryCompletionOwner = Pick<
  RecoveryAdapter,
  'client' | 'sessionIncarnations' | 'activeSessionIds'
>

export async function recoverDaemonPtyEmptyLeafIfMatch(
  owner: RecoveryAdapter,
  requiredProtocolVersion: number,
  request: TerminalEmptyLeafRecoveryRequest
): Promise<TerminalEmptyLeafRecoveryResult> {
  if (owner.protocolVersion < requiredProtocolVersion) {
    return {
      outcome: 'failed_before_mutation',
      recoveryId: request.recoveryId,
      reason: 'unsupported'
    }
  }
  try {
    return await owner.withHistorySpawnLock(request.expected.ptyId, async () => {
      await owner.ensureConnected()
      const response = await owner.client.request<unknown>('recoverEmptyLeafIfMatch', request)
      if (
        !isTerminalEmptyLeafRecoveryResult(response) ||
        response.recoveryId !== request.recoveryId
      ) {
        return indeterminate(request, 'response_identity_changed')
      }
      if (response.outcome === 'recovered') {
        if (response.ptyId !== request.expected.ptyId) {
          return {
            ...indeterminate(request, 'response_identity_changed'),
            incarnationId: response.incarnationId
          }
        }
      }
      return response
    })
  } catch {
    return indeterminate(request, 'provider_response_lost')
  }
}

export async function completeDaemonPtyEmptyLeafRecovery(
  owner: RecoveryCompletionOwner,
  recoveryId: string,
  ptyId: string,
  incarnationId: string,
  commit: boolean
): Promise<boolean> {
  try {
    const result = await owner.client.request<{ completed?: boolean }>(
      commit ? 'commitEmptyLeafRecovery' : 'abortEmptyLeafRecovery',
      { recoveryId, ptyId, incarnationId }
    )
    if (result.completed === true && commit) {
      owner.sessionIncarnations.set(ptyId, incarnationId)
      owner.activeSessionIds.add(ptyId)
    }
    return result.completed === true
  } catch {
    return false
  }
}

function indeterminate(
  request: TerminalEmptyLeafRecoveryRequest,
  reason: string
): TerminalEmptyLeafRecoveryResult {
  return {
    outcome: 'indeterminate',
    recoveryId: request.recoveryId,
    reason,
    replacementStarted: true,
    replacementPublished: false
  }
}
