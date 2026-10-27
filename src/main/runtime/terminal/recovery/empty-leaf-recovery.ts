import type {
  TerminalEmptyLeafRecoveryRequest,
  TerminalEmptyLeafRecoveryResult
} from '../../../../shared/terminal-empty-leaf-recovery'
import {
  invalidTerminalEmptyLeafRecoveryRequest,
  terminalEmptyLeafRecoveryFingerprint
} from '../../../../shared/terminal-empty-leaf-recovery'
import {
  runtimeGapRefusal,
  runtimeReplacementRefusal,
  type RuntimeEmptyLeafRecoveryState
} from './empty-leaf-recovery-state'

export type { RuntimeEmptyLeafRecoveryState } from './empty-leaf-recovery-state'

export type RuntimeEmptyLeafRecoveryPorts = {
  runWithLeafReservation<T>(
    request: TerminalEmptyLeafRecoveryRequest,
    operation: () => Promise<T>
  ): Promise<T>
  inspectState(request: TerminalEmptyLeafRecoveryRequest): RuntimeEmptyLeafRecoveryState | null
  recoverProvider(
    request: TerminalEmptyLeafRecoveryRequest
  ): Promise<TerminalEmptyLeafRecoveryResult>
  persistReplacement(args: {
    request: TerminalEmptyLeafRecoveryRequest
    incarnationId: string
  }): Promise<boolean>
  publishReplacement(args: {
    request: TerminalEmptyLeafRecoveryRequest
    incarnationId: string
  }): Promise<void> | void
  rollbackPersistedReplacement(
    request: TerminalEmptyLeafRecoveryRequest,
    incarnationId: string
  ): Promise<boolean>
  abortUnpublishedReplacement(
    request: TerminalEmptyLeafRecoveryRequest,
    incarnationId: string
  ): Promise<boolean>
  stopUnpublishedReplacement(
    request: TerminalEmptyLeafRecoveryRequest,
    incarnationId: string
  ): Promise<boolean>
}

type PendingCleanup = {
  request: TerminalEmptyLeafRecoveryRequest
  replacement: Extract<TerminalEmptyLeafRecoveryResult, { outcome: 'recovered' }>
  reason: string
  persisted: boolean
  rollbackVerified: boolean
  abortVerified: boolean
  stopVerified: boolean
}

type RecoveryRecord = {
  fingerprint: string
  result?: Promise<TerminalEmptyLeafRecoveryResult>
  cleanup?: PendingCleanup
  cleanupInFlight?: Promise<TerminalEmptyLeafRecoveryResult>
}

const MAX_RECOVERY_RECORDS = 256

export class RuntimeEmptyLeafRecovery {
  private readonly records = new Map<string, RecoveryRecord>()

  constructor(private readonly ports: RuntimeEmptyLeafRecoveryPorts) {}

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
      if (recorded.cleanup) {
        return this.retryCleanup(recorded).then((result) => ({ ...result, replayed: true }))
      }
      if (recorded.result) {
        return recorded.result.then((result) => ({ ...result, replayed: true }))
      }
      return this.start(recorded, request)
    }
    if (this.records.size >= MAX_RECOVERY_RECORDS) {
      return Promise.resolve({
        outcome: 'failed_before_mutation',
        recoveryId: request.recoveryId,
        reason: 'recovery_ledger_full'
      })
    }
    const record: RecoveryRecord = { fingerprint }
    this.records.set(request.recoveryId, record)
    return this.start(record, request)
  }

  private start(
    record: RecoveryRecord,
    request: TerminalEmptyLeafRecoveryRequest
  ): Promise<TerminalEmptyLeafRecoveryResult> {
    const result = Promise.resolve().then(() => this.recoverOnce(record, request))
    record.result = result
    void result.then(
      (value) => {
        if (
          value.outcome === 'indeterminate' &&
          value.reason === 'provider_response_lost' &&
          record.result === result
        ) {
          record.result = undefined
        }
      },
      () => {
        if (record.result === result) {
          record.result = undefined
        }
      }
    )
    return result
  }

  private async recoverOnce(
    record: RecoveryRecord,
    request: TerminalEmptyLeafRecoveryRequest
  ): Promise<TerminalEmptyLeafRecoveryResult> {
    const invalid = invalidTerminalEmptyLeafRecoveryRequest(request)
    if (invalid) {
      return { outcome: 'failed_before_mutation', recoveryId: request.recoveryId, reason: invalid }
    }
    return await this.ports.runWithLeafReservation(request, async () => {
      const refusal = runtimeGapRefusal(request, this.ports.inspectState(request))
      if (refusal) {
        return {
          outcome: 'precondition_failed' as const,
          recoveryId: request.recoveryId,
          reason: refusal
        }
      }
      const providerResult = await this.ports.recoverProvider(request)
      if (providerResult.outcome !== 'recovered') {
        return providerResult
      }
      const drift = runtimeReplacementRefusal(request, this.ports.inspectState(request))
      if (drift) {
        return await this.cleanupUnpublished(record, {
          request,
          replacement: providerResult,
          reason: 'runtime_state_changed',
          persisted: false,
          rollbackVerified: true,
          abortVerified: false,
          stopVerified: false
        })
      }
      let persisted = false
      try {
        persisted = await this.ports.persistReplacement({
          request,
          incarnationId: providerResult.incarnationId
        })
      } catch {
        return await this.cleanupUnpublished(record, {
          request,
          replacement: providerResult,
          reason: 'replacement_not_persisted',
          persisted: true,
          rollbackVerified: false,
          abortVerified: false,
          stopVerified: false
        })
      }
      if (!persisted) {
        return await this.cleanupUnpublished(record, {
          request,
          replacement: providerResult,
          reason: 'replacement_not_persisted',
          persisted: false,
          rollbackVerified: true,
          abortVerified: false,
          stopVerified: false
        })
      }
      try {
        await this.ports.publishReplacement({
          request,
          incarnationId: providerResult.incarnationId
        })
      } catch {
        return await this.cleanupUnpublished(record, {
          request,
          replacement: providerResult,
          reason: 'replacement_not_published',
          persisted: true,
          rollbackVerified: false,
          abortVerified: false,
          stopVerified: false
        })
      }
      return providerResult
    })
  }

  private async cleanupUnpublished(
    record: RecoveryRecord,
    cleanup: PendingCleanup
  ): Promise<TerminalEmptyLeafRecoveryResult> {
    if (cleanup.persisted && !cleanup.rollbackVerified) {
      try {
        cleanup.rollbackVerified =
          cleanup.rollbackVerified ||
          (await this.ports.rollbackPersistedReplacement(
            cleanup.request,
            cleanup.replacement.incarnationId
          ))
      } catch {}
    }
    if (!cleanup.abortVerified) {
      try {
        cleanup.abortVerified =
          cleanup.abortVerified ||
          (await this.ports.abortUnpublishedReplacement(
            cleanup.request,
            cleanup.replacement.incarnationId
          ))
      } catch {}
    }
    if (!cleanup.stopVerified) {
      try {
        cleanup.stopVerified =
          cleanup.stopVerified ||
          (await this.ports.stopUnpublishedReplacement(
            cleanup.request,
            cleanup.replacement.incarnationId
          ))
      } catch {}
    }
    const complete = cleanup.rollbackVerified && cleanup.abortVerified && cleanup.stopVerified
    record.cleanup = complete ? undefined : cleanup
    return {
      outcome: complete ? 'partial' : 'indeterminate',
      recoveryId: cleanup.request.recoveryId,
      reason: !cleanup.rollbackVerified
        ? `${cleanup.reason}_binding_rollback_unverified`
        : !cleanup.abortVerified
          ? `${cleanup.reason}_abort_unverified`
          : cleanup.stopVerified
            ? `${cleanup.reason}_replacement_stopped`
            : `${cleanup.reason}_stop_unverified`,
      replacementStarted: true,
      replacementPublished: false,
      ptyId: cleanup.request.expected.ptyId,
      incarnationId: cleanup.replacement.incarnationId
    }
  }

  private retryCleanup(record: RecoveryRecord): Promise<TerminalEmptyLeafRecoveryResult> {
    if (record.cleanupInFlight) {
      return record.cleanupInFlight
    }
    const cleanup = record.cleanup
    if (!cleanup) {
      return record.result ?? Promise.reject(new Error('recovery_cleanup_missing'))
    }
    const result = this.cleanupUnpublished(record, cleanup)
    record.cleanupInFlight = result
    record.result = result
    const clearInFlight = (): void => {
      if (record.cleanupInFlight === result) {
        record.cleanupInFlight = undefined
      }
    }
    void result.then(clearInFlight, clearInFlight)
    return result
  }
}
