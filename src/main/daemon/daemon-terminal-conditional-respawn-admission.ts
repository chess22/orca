import type { RespawnIfMatchRequest } from './types'
import type { PendingPtySpawnPreparation } from './daemon-pty-spawn-preparations'
import type { CreateOrAttachOptions } from './terminal-host'
import type { DaemonTerminalAdmissionOptions } from './daemon-terminal-admission'

type ConditionalRespawnAdmissionOwner = {
  options: DaemonTerminalAdmissionOptions
  incrementInFlight(): void
  decrementInFlight(): void
  createStreamClient(
    clientId: string,
    sessionId: () => string
  ): CreateOrAttachOptions['streamClient']
  beginConditionalRespawnExitFence(
    sessionId: string,
    incarnationId: string
  ): (replacementPublished: boolean) => void
}

const MAX_SPAWN_ADMISSION_WINDOW_MS = 12_000

export function resolveSpawnAdmissionDeadline(cancelAfterMs: unknown): number {
  const windowMs =
    Number.isSafeInteger(cancelAfterMs) && Number(cancelAfterMs) > 0
      ? Math.min(Number(cancelAfterMs) / 2, MAX_SPAWN_ADMISSION_WINDOW_MS)
      : MAX_SPAWN_ADMISSION_WINDOW_MS
  return Date.now() + windowMs
}

export async function admitConditionalTerminalRespawn(
  owner: ConditionalRespawnAdmissionOwner,
  clientId: string,
  request: RespawnIfMatchRequest
): Promise<unknown> {
  const client = owner.options.connections.get(clientId)
  if (!owner.options.isAcceptingWork() || owner.options.endpoint.hasLostOwnership()) {
    return {
      outcome: 'failed_before_mutation',
      mutationId: request.payload.mutationId,
      reason: 'daemon_unavailable'
    }
  }
  if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
    return {
      outcome: 'failed_before_mutation',
      mutationId: request.payload.mutationId,
      reason: 'client_disconnected'
    }
  }
  const streamSocket = client.streamSocket
  const payload = request.payload
  if (!payload.mutationId || !payload.expectedIncarnationId) {
    return {
      outcome: 'failed_before_mutation',
      mutationId: payload.mutationId,
      reason: 'identity_required'
    }
  }
  const respawnIdentity = {
    mutationId: payload.mutationId,
    expectedIncarnationId: payload.expectedIncarnationId,
    sessionId: payload.sessionId,
    cols: payload.cols,
    rows: payload.rows,
    cwd: payload.cwd,
    env: payload.env,
    envToDelete: payload.envToDelete,
    command: payload.command,
    spawnAdmission: {
      clientId,
      declaredIntent: null,
      deadlineAt: resolveSpawnAdmissionDeadline(payload.cancelAfterMs)
    },
    mutationRefusal: () => {
      if (
        owner.options.connections.get(clientId) !== client ||
        !client.authenticatedPairEstablished ||
        client.streamSocket !== streamSocket
      ) {
        return 'client_disconnected'
      }
      if (owner.options.attachments.clientIdForSession(payload.sessionId) !== clientId) {
        return 'attachment_owner_changed'
      }
      if (!owner.options.isAcceptingWork() || owner.options.endpoint.hasLostOwnership()) {
        return 'daemon_unavailable'
      }
      return null
    },
    beginExitFence: () =>
      owner.beginConditionalRespawnExitFence(payload.sessionId, payload.expectedIncarnationId),
    streamClient: owner.createStreamClient(clientId, () => payload.sessionId)
  }
  const replay = owner.options.host.conditionalRespawnReplay(respawnIdentity)
  if (replay) {
    return await replay
  }
  if (owner.options.attachments.clientIdForSession(payload.sessionId) !== clientId) {
    return {
      outcome: 'precondition_failed',
      mutationId: payload.mutationId,
      reason: 'attachment_owner_changed'
    }
  }
  owner.incrementInFlight()
  let preparation: PendingPtySpawnPreparation | null = null
  try {
    preparation = owner.options.preparations.register(
      payload.sessionId,
      clientId,
      request.id,
      payload.cancelAfterMs
    )
    await owner.options.preparations.prepareUnlessCanceled(payload.sessionId, preparation)
    if (
      owner.options.connections.get(clientId) !== client ||
      !client.authenticatedPairEstablished ||
      client.streamSocket !== streamSocket
    ) {
      return {
        outcome: 'failed_before_mutation',
        mutationId: payload.mutationId,
        reason: 'client_disconnected'
      }
    }
    if (owner.options.attachments.clientIdForSession(payload.sessionId) !== clientId) {
      return {
        outcome: 'precondition_failed',
        mutationId: payload.mutationId,
        reason: 'attachment_owner_changed'
      }
    }
    if (!owner.options.isAcceptingWork() || owner.options.endpoint.hasLostOwnership()) {
      return {
        outcome: 'failed_before_mutation',
        mutationId: payload.mutationId,
        reason: 'daemon_unavailable'
      }
    }
    return await owner.options.host.respawnIfMatch({
      ...respawnIdentity,
      isCanceled: () => preparation?.canceled === true,
      cancelSignal: preparation.controller.signal,
      onReplacementPublished: (attachToken) => {
        const refusal = respawnIdentity.mutationRefusal()
        if (refusal) {
          throw new Error(refusal)
        }
        owner.options.attachments.attach(payload.sessionId, clientId, attachToken)
        owner.options.streamDataBatcher.refreshSessionDroppability(payload.sessionId)
      }
    })
  } finally {
    if (preparation) {
      owner.options.preparations.finish(payload.sessionId, preparation)
    }
    owner.decrementInFlight()
    owner.options.reevaluateIdleShutdown()
  }
}
