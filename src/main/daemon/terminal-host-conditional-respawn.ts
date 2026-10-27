import type { Session } from './session'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { CreateOrAttachResult } from './terminal-host-create-contract'
import type { TerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'

export type ConditionalRespawnIdentity = InternalCreateOrAttachOptions & {
  mutationId: string
  expectedIncarnationId: string
  mutationRefusal: () => string | null
  beginExitFence: () => (replacementPublished: boolean) => void
}

type LedgerEntry = { fingerprint: string; promise: Promise<TerminalConditionalRespawnResult> }

type ConditionalRespawnHost = {
  conditionalRespawns: Map<string, LedgerEntry>
  sessions: Map<string, Session>
  agentSessionOwners: { listForPty(id: string): unknown[] }
  suppressedReapNotifications: Set<string>
  deferredReapNotifications: Set<string>
  retiredIncarnations: Map<string, { incarnationId: string; code: number; expiresAt: number }>
  onSessionReaped?: (sessionId: string) => void
  conditionalRespawnReplay(
    opts: ConditionalRespawnIdentity
  ): Promise<TerminalConditionalRespawnResult> | null
  withSessionCreationReservation<T>(
    opts: InternalCreateOrAttachOptions,
    run: () => Promise<T>
  ): Promise<T>
  killReserved(sessionId: string, opts: { immediate?: boolean }): Promise<void>
  createOrAttachReserved(opts: InternalCreateOrAttachOptions): Promise<CreateOrAttachResult>
  reapUnpublishedConditionalReplacement(
    opts: ConditionalRespawnIdentity,
    incarnationId: string,
    reason: string
  ): Promise<TerminalConditionalRespawnResult>
}

const MAX_CONDITIONAL_RESPAWN_RESULTS = 256

export async function respawnTerminalHostIfMatch(
  owner: ConditionalRespawnHost,
  opts: ConditionalRespawnIdentity & { onReplacementPublished: (attachToken: symbol) => void }
): Promise<TerminalConditionalRespawnResult> {
  const replay = owner.conditionalRespawnReplay(opts)
  if (replay) {
    return await replay
  }
  if (owner.conditionalRespawns.size >= MAX_CONDITIONAL_RESPAWN_RESULTS) {
    return {
      outcome: 'failed_before_mutation',
      mutationId: opts.mutationId,
      reason: 'mutation_ledger_full'
    }
  }
  const operation = owner.withSessionCreationReservation(opts, async () => {
    const mutationRefusal = opts.mutationRefusal()
    if (mutationRefusal) {
      return {
        outcome: 'failed_before_mutation' as const,
        mutationId: opts.mutationId,
        reason: mutationRefusal
      }
    }
    const session = owner.sessions.get(opts.sessionId)
    if (!session || !session.isAlive || session.isTerminating) {
      return {
        outcome: 'precondition_failed' as const,
        mutationId: opts.mutationId,
        reason: 'terminal_not_live'
      }
    }
    if (session.incarnationId !== opts.expectedIncarnationId) {
      return {
        outcome: 'precondition_failed' as const,
        mutationId: opts.mutationId,
        reason: 'incarnation_changed'
      }
    }
    if (owner.agentSessionOwners.listForPty(opts.sessionId).length > 0) {
      return {
        outcome: 'precondition_failed' as const,
        mutationId: opts.mutationId,
        reason: 'agent_owned'
      }
    }
    let replacementPublished = false
    const finishExitFence = opts.beginExitFence()
    owner.suppressedReapNotifications.add(opts.sessionId)
    try {
      try {
        await owner.killReserved(opts.sessionId, { immediate: true })
      } catch {
        return {
          outcome: 'indeterminate' as const,
          mutationId: opts.mutationId,
          reason: 'stop_failed'
        }
      }
      if (session.isAlive || owner.sessions.get(opts.sessionId) === session) {
        return {
          outcome: 'indeterminate' as const,
          mutationId: opts.mutationId,
          reason: 'stop_unverified'
        }
      }
      const postStopRefusal = opts.mutationRefusal()
      if (postStopRefusal) {
        return {
          outcome: 'partial' as const,
          mutationId: opts.mutationId,
          reason: postStopRefusal,
          oldStopped: true,
          replacementStarted: false,
          replacementPublished: false
        }
      }
      try {
        const replacement = await owner.createOrAttachReserved(opts)
        const prePublicationRefusal = opts.mutationRefusal()
        if (prePublicationRefusal) {
          return await owner.reapUnpublishedConditionalReplacement(
            opts,
            replacement.incarnationId,
            prePublicationRefusal
          )
        }
        try {
          opts.onReplacementPublished(replacement.attachToken)
        } catch (error) {
          return await owner.reapUnpublishedConditionalReplacement(
            opts,
            replacement.incarnationId,
            error instanceof Error ? error.message : String(error)
          )
        }
        replacementPublished = true
        return {
          outcome: 'respawned' as const,
          mutationId: opts.mutationId,
          ptyId: opts.sessionId,
          incarnationId: replacement.incarnationId,
          processId: replacement.pid
        }
      } catch (error) {
        const liveReplacement = owner.sessions.get(opts.sessionId)
        const replacementStarted = Boolean(liveReplacement?.isAlive)
        if (replacementStarted && liveReplacement) {
          return await owner.reapUnpublishedConditionalReplacement(
            opts,
            liveReplacement.incarnationId,
            error instanceof Error ? error.message : String(error)
          )
        }
        return {
          outcome: 'partial' as const,
          mutationId: opts.mutationId,
          reason: error instanceof Error ? error.message : String(error),
          oldStopped: true,
          replacementStarted: false,
          replacementPublished: false
        }
      }
    } finally {
      owner.suppressedReapNotifications.delete(opts.sessionId)
      finishExitFence(replacementPublished)
      if (owner.deferredReapNotifications.delete(opts.sessionId) && !replacementPublished) {
        owner.onSessionReaped?.(opts.sessionId)
      }
    }
  })
  const entry = { fingerprint: conditionalRespawnFingerprint(owner, opts), promise: operation }
  owner.conditionalRespawns.set(opts.mutationId, entry)
  return await operation
}

export function replayConditionalRespawn(
  owner: ConditionalRespawnHost,
  opts: ConditionalRespawnIdentity
): Promise<TerminalConditionalRespawnResult> | null {
  const replay = owner.conditionalRespawns.get(opts.mutationId)
  if (!replay) {
    return null
  }
  if (replay.fingerprint !== conditionalRespawnFingerprint(owner, opts)) {
    return Promise.resolve({
      outcome: 'precondition_failed' as const,
      mutationId: opts.mutationId,
      reason: 'mutation_id_reused'
    })
  }
  return replay.promise.then((result) => ({ ...result, replayed: true }))
}

function conditionalRespawnFingerprint(
  _owner: ConditionalRespawnHost,
  opts: ConditionalRespawnIdentity
): string {
  return JSON.stringify([
    opts.spawnAdmission?.clientId ?? null,
    opts.sessionId,
    opts.expectedIncarnationId,
    opts.cols,
    opts.rows,
    opts.cwd ?? null,
    opts.command ?? null,
    opts.env ?? null,
    opts.envToDelete ?? null
  ])
}

export async function reapUnpublishedConditionalReplacement(
  owner: ConditionalRespawnHost,
  opts: ConditionalRespawnIdentity,
  replacementIncarnationId: string,
  reason: string
): Promise<TerminalConditionalRespawnResult> {
  const replacement = owner.sessions.get(opts.sessionId)
  if (!replacement) {
    const retired = owner.retiredIncarnations.get(opts.sessionId)
    if (retired?.incarnationId === replacementIncarnationId) {
      return {
        outcome: 'partial',
        mutationId: opts.mutationId,
        reason: 'replacement_exited_before_publication',
        oldStopped: true,
        replacementStarted: true,
        replacementPublished: false,
        ptyId: opts.sessionId,
        incarnationId: replacementIncarnationId
      }
    }
    return {
      outcome: 'indeterminate',
      mutationId: opts.mutationId,
      reason: 'unpublished_replacement_identity_changed',
      oldStopped: true,
      replacementStarted: true,
      incarnationId: replacementIncarnationId
    }
  }
  if (replacement.incarnationId !== replacementIncarnationId) {
    return {
      outcome: 'indeterminate',
      mutationId: opts.mutationId,
      reason: 'unpublished_replacement_identity_changed',
      oldStopped: true,
      replacementStarted: true,
      incarnationId: replacementIncarnationId
    }
  }
  try {
    await owner.killReserved(opts.sessionId, { immediate: true })
  } catch {
    return {
      outcome: 'indeterminate',
      mutationId: opts.mutationId,
      reason: 'unpublished_replacement_stop_unverified',
      oldStopped: true,
      replacementStarted: true,
      incarnationId: replacementIncarnationId
    }
  }
  const current = owner.sessions.get(opts.sessionId)
  if (current?.incarnationId === replacementIncarnationId && current.isAlive) {
    return {
      outcome: 'indeterminate',
      mutationId: opts.mutationId,
      reason: 'unpublished_replacement_stop_unverified',
      oldStopped: true,
      replacementStarted: true,
      incarnationId: replacementIncarnationId
    }
  }
  return {
    outcome: 'partial',
    mutationId: opts.mutationId,
    reason,
    oldStopped: true,
    replacementStarted: true,
    replacementPublished: false,
    ptyId: opts.sessionId,
    incarnationId: replacementIncarnationId
  }
}
