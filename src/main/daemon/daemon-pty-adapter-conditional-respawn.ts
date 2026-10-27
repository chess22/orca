import { emitPtyListeners, createPtyExitPayload } from './daemon-pty-listener-emission'
import type { PendingDaemonSpawnOperation } from './daemon-pty-runtime-state'
import type { ListSessionsResult } from './types'
import type {
  TerminalConditionalRespawnResult,
  TerminalRespawnReplacement
} from '../../shared/terminal-conditional-respawn'
import { isTerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'
import type { IPtyProvider } from '../providers/pty-provider-contract'

type ConditionalRespawnOwner = {
  protocolVersion: number
  uncertainConditionalRespawns: Map<
    string,
    { fingerprint: string; operation: PendingDaemonSpawnOperation }
  >
  withHistorySpawnLock<T>(id: string, run: () => Promise<T>): Promise<T>
  ensureConnected(): Promise<void>
  client: { request<T>(method: string, payload: unknown): Promise<T> }
  pendingSpawnOperationsBySessionId: Map<string, Set<PendingDaemonSpawnOperation>>
  sessionIncarnations: Map<string, string>
  activeSessionIds: Set<string>
  clearExitedSessionState(id: string, code: number, incarnationId?: string): void
  exitListeners: Parameters<IPtyProvider['onExit']>[0][]
}

export const MAX_RETAINED_CONDITIONAL_RESPAWN_EXITS = 64

export function recordConditionalRespawnExit(
  operation: PendingDaemonSpawnOperation,
  sessionId: string,
  event: { code: number; incarnationId?: string }
): boolean {
  if (operation.conditionalRespawnOldIncarnationId === undefined) {
    return false
  }
  const exits = operation.exitsBySessionId.get(sessionId) ?? []
  if (exits.length >= MAX_RETAINED_CONDITIONAL_RESPAWN_EXITS) {
    operation.conditionalRespawnExitCaptureOverflowed = true
    return true
  }
  exits.push(event.incarnationId ? { code: event.code, incarnationId: event.incarnationId } : event)
  operation.exitsBySessionId.set(sessionId, exits)
  return true
}

export async function respawnDaemonPtyIfMatch(
  owner: ConditionalRespawnOwner,
  conditionalRespawnProtocolVersion: number,
  id: string,
  expectedIncarnationId: string,
  mutationId: string,
  replacement: TerminalRespawnReplacement
): Promise<TerminalConditionalRespawnResult> {
  if (owner.protocolVersion < conditionalRespawnProtocolVersion) {
    return { outcome: 'unsupported', mutationId, reason: 'daemon_protocol' }
  }
  const fingerprint = JSON.stringify([id, expectedIncarnationId, replacement])
  const retained = owner.uncertainConditionalRespawns.get(mutationId)
  if (retained && retained.fingerprint !== fingerprint) {
    return { outcome: 'precondition_failed', mutationId, reason: 'mutation_id_reused' }
  }
  if (!retained && owner.uncertainConditionalRespawns.size >= 256) {
    return { outcome: 'failed_before_mutation', mutationId, reason: 'mutation_ledger_full' }
  }
  try {
    return await owner.withHistorySpawnLock(id, async () => {
      await owner.ensureConnected()
      const operation: PendingDaemonSpawnOperation = retained?.operation ?? {
        exitsBySessionId: new Map(),
        ignoredExitIncarnationIds: new Set<string>(),
        ignoreNextExit: false,
        conditionalRespawnOldIncarnationId: expectedIncarnationId
      }
      const operations = owner.pendingSpawnOperationsBySessionId.get(id) ?? new Set()
      operations.add(operation)
      owner.pendingSpawnOperationsBySessionId.set(id, operations)
      let retainForReplay = false
      try {
        let response: unknown
        try {
          response = await owner.client.request<unknown>('respawnIfMatch', {
            sessionId: id,
            expectedIncarnationId,
            mutationId,
            ...replacement
          })
        } catch {
          retainForReplay = true
          owner.uncertainConditionalRespawns.set(mutationId, {
            fingerprint,
            operation
          })
          return { outcome: 'indeterminate', mutationId, reason: 'response_lost' }
        }
        owner.uncertainConditionalRespawns.delete(mutationId)
        const result = response
        if (!isTerminalConditionalRespawnResult(result)) {
          return { outcome: 'indeterminate', mutationId, reason: 'invalid_response' }
        }
        if (result.mutationId !== mutationId) {
          return { outcome: 'indeterminate', mutationId, reason: 'response_identity_changed' }
        }
        if (
          (result.outcome === 'respawned' ||
            (result.outcome === 'partial' && result.replacementStarted)) &&
          (result.ptyId !== id || result.incarnationId === expectedIncarnationId)
        ) {
          return { outcome: 'indeterminate', mutationId, reason: 'response_identity_changed' }
        }
        const replacementIncarnationId =
          result.outcome === 'respawned' ||
          (result.outcome === 'partial' && result.replacementStarted)
            ? result.incarnationId
            : undefined
        if (retained && operation.conditionalRespawnExitCaptureOverflowed) {
          retainForReplay = true
          owner.uncertainConditionalRespawns.set(mutationId, { fingerprint, operation })
          return {
            outcome: 'indeterminate',
            mutationId,
            reason: 'response_lost_exit_capture_overflow',
            ...(result.outcome === 'respawned'
              ? {
                  oldStopped: true,
                  replacementStarted: true,
                  incarnationId: result.incarnationId
                }
              : {})
          }
        }
        if (retained && result.outcome === 'respawned') {
          let inventory: ListSessionsResult
          try {
            inventory = await owner.client.request<ListSessionsResult>('listSessions', undefined)
          } catch {
            retainForReplay = true
            owner.uncertainConditionalRespawns.set(mutationId, {
              fingerprint,
              operation
            })
            return { outcome: 'indeterminate', mutationId, reason: 'response_lost' }
          }
          const replacementIsLive = inventory.sessions.some(
            (session) =>
              session.sessionId === id &&
              session.isAlive &&
              session.incarnationId === result.incarnationId
          )
          if (!replacementIsLive) {
            owner.uncertainConditionalRespawns.delete(mutationId)
            owner.sessionIncarnations.set(id, result.incarnationId)
            owner.clearExitedSessionState(id, -1, result.incarnationId)
            emitPtyListeners(owner.exitListeners, (listener) =>
              listener(createPtyExitPayload(id, { code: -1, incarnationId: result.incarnationId }))
            )
            return {
              outcome: 'partial',
              mutationId,
              reason: 'replacement_exited_before_publication',
              oldStopped: true,
              replacementStarted: true,
              replacementPublished: true,
              ptyId: id,
              incarnationId: result.incarnationId
            }
          }
        }
        const replacementExit = replacementIncarnationId
          ? (operation.exitsBySessionId.get(id) ?? []).find(
              (event) => event.incarnationId === replacementIncarnationId
            )
          : undefined
        if (replacementIncarnationId && replacementExit) {
          owner.sessionIncarnations.set(id, replacementIncarnationId)
          owner.clearExitedSessionState(id, replacementExit.code, replacementIncarnationId)
          emitPtyListeners(owner.exitListeners, (listener) =>
            listener(
              createPtyExitPayload(id, {
                code: replacementExit.code,
                incarnationId: replacementIncarnationId
              })
            )
          )
          if (result.outcome === 'partial' && !result.replacementPublished) {
            return result
          }
          return {
            outcome: 'partial',
            mutationId,
            reason: 'replacement_exited_before_publication',
            oldStopped: true,
            replacementStarted: true,
            replacementPublished: true,
            ptyId: id,
            incarnationId: replacementIncarnationId
          }
        }
        if (result.outcome === 'respawned') {
          if (result.ptyId !== id || result.incarnationId === expectedIncarnationId) {
            return { outcome: 'indeterminate', mutationId, reason: 'response_identity_changed' }
          }
          owner.sessionIncarnations.set(id, result.incarnationId)
          owner.activeSessionIds.add(id)
        }
        owner.uncertainConditionalRespawns.delete(mutationId)
        return result
      } finally {
        if (!retainForReplay) {
          operations.delete(operation)
          if (operations.size === 0) {
            owner.pendingSpawnOperationsBySessionId.delete(id)
          }
        }
      }
    })
  } catch {
    return { outcome: 'indeterminate', mutationId, reason: 'response_lost' }
  }
}
