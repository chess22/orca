import type { Session } from './session'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { CreateOrAttachResult } from './terminal-host-create-contract'
import type { TerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'
import {
  invalidTerminalEmptyLeafRecoveryRequest,
  terminalEmptyLeafRecoveryFingerprint,
  terminalEmptyLeafTombstoneId,
  type TerminalEmptyLeafRecoveryRequest,
  type TerminalEmptyLeafRecoveryResult
} from '../../shared/terminal-empty-leaf-recovery'

export type TerminalEmptyLeafRecoveryRecord = {
  fingerprint: string
  result: Promise<TerminalEmptyLeafRecoveryResult>
}

export type TerminalEmptyLeafRecoveryLedger = Map<string, TerminalEmptyLeafRecoveryRecord>

export type EmptyLeafRecoveryHost = {
  sessions: Map<string, Session>
  retiredIncarnations: Map<string, { incarnationId: string; code: number; expiresAt: number }>
  agentSessionOwners: { listForPty(id: string): unknown[] }
  conditionalRespawns: Map<
    string,
    {
      fingerprint: string
      promise: Promise<TerminalConditionalRespawnResult>
      identity: {
        sessionId: string
        expectedIncarnationId: string
        expectedRootProcessId: number
        command: string | undefined
        cwd: string | undefined
        cols: number
        rows: number
        clientId: string | null
        env: Record<string, string> | undefined
        envToDelete: string[] | undefined
      }
    }
  >
  emptyLeafRecoveries: TerminalEmptyLeafRecoveryLedger
  withSessionCreationReservation<T>(
    opts: InternalCreateOrAttachOptions,
    run: () => Promise<T>
  ): Promise<T>
  createOrAttachReserved(opts: InternalCreateOrAttachOptions): Promise<CreateOrAttachResult>
}

const MAX_RECOVERY_RESULTS = 256

function environmentIdentity(
  env: Record<string, string> | undefined,
  envToDelete: string[] | undefined
): string {
  return JSON.stringify([
    env ? Object.entries(env).sort(([left], [right]) => left.localeCompare(right)) : null,
    envToDelete ? [...envToDelete].sort() : null
  ])
}

export function recoverTerminalHostEmptyLeafIfMatch(
  owner: EmptyLeafRecoveryHost,
  request: TerminalEmptyLeafRecoveryRequest,
  opts: InternalCreateOrAttachOptions & { onReplacementPublished: (attachToken: symbol) => void }
): Promise<TerminalEmptyLeafRecoveryResult> {
  const fingerprint = terminalEmptyLeafRecoveryFingerprint(request)
  const recorded = owner.emptyLeafRecoveries.get(request.recoveryId)
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
  if (owner.emptyLeafRecoveries.size >= MAX_RECOVERY_RESULTS) {
    return Promise.resolve({
      outcome: 'failed_before_mutation',
      recoveryId: request.recoveryId,
      reason: 'recovery_ledger_full'
    })
  }
  const result = Promise.resolve().then(async () => {
    const invalid = invalidTerminalEmptyLeafRecoveryRequest(request)
    if (invalid) {
      return {
        outcome: 'failed_before_mutation' as const,
        recoveryId: request.recoveryId,
        reason: invalid
      }
    }
    if (
      opts.sessionId !== request.expected.ptyId ||
      opts.command !== request.replacement.command ||
      opts.cwd !== request.replacement.cwd ||
      opts.cols !== request.replacement.cols ||
      opts.rows !== request.replacement.rows ||
      environmentIdentity(opts.env, opts.envToDelete) !==
        environmentIdentity(request.replacement.env, request.replacement.envToDelete)
    ) {
      return refusal(request, 'replacement_identity_changed')
    }
    return await owner.withSessionCreationReservation(opts, async () => {
      const original = owner.conditionalRespawns.get(request.originalMutationId)
      if (!original) {
        return refusal(request, 'original_mutation_unverified')
      }
      if (
        original.identity.sessionId !== request.expected.ptyId ||
        original.identity.expectedIncarnationId !== request.expected.retiredIncarnationId ||
        original.identity.command !== request.replacement.command ||
        original.identity.cwd !== request.replacement.cwd ||
        original.identity.cols !== request.replacement.cols ||
        original.identity.rows !== request.replacement.rows ||
        original.identity.clientId !== (opts.spawnAdmission?.clientId ?? null) ||
        environmentIdentity(original.identity.env, original.identity.envToDelete) !==
          environmentIdentity(request.replacement.env, request.replacement.envToDelete)
      ) {
        return refusal(request, 'original_mutation_identity_changed')
      }
      const originalResult = await original.promise
      const confirmedGap =
        originalResult.outcome === 'partial' &&
        originalResult.oldStopped &&
        !originalResult.replacementStarted
      const inspectableSpawnAmbiguity =
        originalResult.outcome === 'indeterminate' &&
        originalResult.oldStopped === true &&
        originalResult.replacementStarted !== false &&
        originalResult.incarnationId === undefined
      if (!confirmedGap && !inspectableSpawnAmbiguity) {
        return refusal(request, 'original_mutation_not_recoverable')
      }
      if (owner.sessions.has(request.expected.ptyId)) {
        return refusal(request, 'terminal_live')
      }
      const retired = owner.retiredIncarnations.get(request.expected.ptyId)
      if (
        retired?.incarnationId !== request.expected.retiredIncarnationId ||
        retired.expiresAt <= Date.now()
      ) {
        return refusal(request, retired ? 'retired_incarnation_changed' : 'retirement_unverifiable')
      }
      if (
        request.expected.tombstoneId !==
        terminalEmptyLeafTombstoneId(request.expected.ptyId, retired.incarnationId)
      ) {
        return refusal(request, 'tombstone_changed')
      }
      if (owner.agentSessionOwners.listForPty(request.expected.ptyId).length !== 0) {
        return refusal(request, 'agent_owned')
      }
      try {
        const replacement = await owner.createOrAttachReserved(opts)
        try {
          opts.onReplacementPublished(replacement.attachToken)
        } catch (error) {
          return {
            outcome: 'indeterminate' as const,
            recoveryId: request.recoveryId,
            reason: error instanceof Error ? error.message : String(error),
            replacementStarted: true,
            replacementPublished: false,
            ptyId: request.expected.ptyId,
            incarnationId: replacement.incarnationId
          }
        }
        return {
          outcome: 'recovered' as const,
          recoveryId: request.recoveryId,
          ptyId: request.expected.ptyId,
          incarnationId: replacement.incarnationId,
          processId: replacement.pid
        }
      } catch (error) {
        const live = owner.sessions.get(request.expected.ptyId)
        const retiredAfterSpawn = owner.retiredIncarnations.get(request.expected.ptyId)
        const replacementIncarnationId =
          live?.incarnationId ??
          (retiredAfterSpawn?.incarnationId !== request.expected.retiredIncarnationId
            ? retiredAfterSpawn?.incarnationId
            : undefined)
        return {
          outcome: 'indeterminate' as const,
          recoveryId: request.recoveryId,
          reason: error instanceof Error ? error.message : String(error),
          replacementStarted: true,
          replacementPublished: false,
          ...(replacementIncarnationId
            ? { ptyId: request.expected.ptyId, incarnationId: replacementIncarnationId }
            : {})
        }
      }
    })
  })
  owner.emptyLeafRecoveries.set(request.recoveryId, { fingerprint, result })
  return result
}

function refusal(
  request: TerminalEmptyLeafRecoveryRequest,
  reason: string
): TerminalEmptyLeafRecoveryResult {
  return { outcome: 'precondition_failed', recoveryId: request.recoveryId, reason }
}
