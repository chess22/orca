import type {
  TerminalEmptyLeafRecoveryRequest,
  TerminalEmptyLeafRecoveryResult
} from '../../shared/terminal-empty-leaf-recovery'
import {
  invalidTerminalEmptyLeafRecoveryRequest,
  terminalEmptyLeafRecoveryFingerprint
} from '../../shared/terminal-empty-leaf-recovery'

export type TerminalRecoveryProviderGap = {
  ptyId: string
  retiredIncarnationId: string
  tombstoneId: string
  liveIncarnationId: string | null | undefined
  agentOwnerCount: number | null
  recoveryOwnerId: string | null
}

type RecoveryRecord = {
  fingerprint: string
  result: Promise<TerminalEmptyLeafRecoveryResult>
}

export type TerminalEmptyLeafRecoveryProviderPorts = {
  runWithPtyReservation<T>(ptyId: string, operation: () => Promise<T>): Promise<T>
  inspectGap(ptyId: string): Promise<TerminalRecoveryProviderGap | null>
  spawnReplacement(request: TerminalEmptyLeafRecoveryRequest): Promise<{
    ptyId: string
    incarnationId: string
    processId?: number | null
  }>
}

const MAX_RECOVERY_RECORDS = 256

export class TerminalEmptyLeafRecoveryProvider {
  private readonly records = new Map<string, RecoveryRecord>()

  constructor(private readonly ports: TerminalEmptyLeafRecoveryProviderPorts) {}

  recover(request: TerminalEmptyLeafRecoveryRequest): Promise<TerminalEmptyLeafRecoveryResult> {
    const fingerprint = terminalEmptyLeafRecoveryFingerprint(request)
    const recorded = this.records.get(request.recoveryId)
    if (recorded) {
      if (recorded.fingerprint !== fingerprint) {
        return Promise.resolve({
          outcome: 'precondition_failed',
          recoveryId: request.recoveryId,
          reason: 'recovery_id_reused'
        })
      }
      return recorded.result.then((result) => ({ ...result, replayed: true }))
    }
    if (this.records.size >= MAX_RECOVERY_RECORDS) {
      return Promise.resolve({
        outcome: 'failed_before_mutation',
        recoveryId: request.recoveryId,
        reason: 'recovery_ledger_full'
      })
    }
    const result = Promise.resolve().then(() => this.recoverOnce(request))
    this.records.set(request.recoveryId, { fingerprint, result })
    return result
  }

  private async recoverOnce(
    request: TerminalEmptyLeafRecoveryRequest
  ): Promise<TerminalEmptyLeafRecoveryResult> {
    const invalid = invalidTerminalEmptyLeafRecoveryRequest(request)
    if (invalid) {
      return { outcome: 'failed_before_mutation', recoveryId: request.recoveryId, reason: invalid }
    }
    return await this.ports.runWithPtyReservation(request.expected.ptyId, async () => {
      const gap = await this.ports.inspectGap(request.expected.ptyId)
      const refusal = providerGapRefusal(request, gap)
      if (refusal) {
        return {
          outcome: 'precondition_failed' as const,
          recoveryId: request.recoveryId,
          reason: refusal
        }
      }
      try {
        const replacement = await this.ports.spawnReplacement(request)
        if (
          replacement.ptyId !== request.expected.ptyId ||
          !replacement.incarnationId ||
          replacement.incarnationId === request.expected.retiredIncarnationId
        ) {
          return {
            outcome: 'indeterminate' as const,
            recoveryId: request.recoveryId,
            reason: 'replacement_identity_changed',
            replacementStarted: true,
            replacementPublished: false
          }
        }
        return {
          outcome: 'recovered' as const,
          recoveryId: request.recoveryId,
          ptyId: replacement.ptyId,
          incarnationId: replacement.incarnationId,
          ...(replacement.processId !== undefined ? { processId: replacement.processId } : {})
        }
      } catch {
        return {
          outcome: 'indeterminate' as const,
          recoveryId: request.recoveryId,
          reason: 'replacement_start_unverified',
          replacementStarted: true,
          replacementPublished: false
        }
      }
    })
  }
}

function providerGapRefusal(
  request: TerminalEmptyLeafRecoveryRequest,
  gap: TerminalRecoveryProviderGap | null
): string | null {
  if (!gap) {
    return 'retirement_unverifiable'
  }
  if (
    gap.ptyId !== request.expected.ptyId ||
    gap.retiredIncarnationId !== request.expected.retiredIncarnationId ||
    gap.tombstoneId !== request.expected.tombstoneId
  ) {
    return 'tombstone_changed'
  }
  if (gap.liveIncarnationId === undefined) {
    return 'liveness_unverifiable'
  }
  if (gap.liveIncarnationId !== null) {
    return 'terminal_live'
  }
  if (gap.agentOwnerCount === null) {
    return 'agent_owner_unverifiable'
  }
  if (gap.agentOwnerCount !== 0) {
    return 'agent_owned'
  }
  if (gap.recoveryOwnerId !== null) {
    return 'recovery_owned'
  }
  return null
}
