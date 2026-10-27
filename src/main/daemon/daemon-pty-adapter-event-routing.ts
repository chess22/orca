import type { IPtyProvider, PtyBackgroundStreamEvent } from '../providers/pty-provider-contract'
import { createPtyExitPayload, emitPtyListeners } from './daemon-pty-listener-emission'
import { recordConditionalRespawnExit } from './daemon-pty-adapter-conditional-respawn'
import type { PendingDaemonSpawnOperation } from './daemon-pty-runtime-state'
import { supportsMode2031UnsubscribeFact, type DaemonEvent } from './types'

type EventRoutingContext = {
  protocolVersion: number
  dataListeners: Parameters<IPtyProvider['onData']>[0][]
  exitListeners: Parameters<IPtyProvider['onExit']>[0][]
  sessionIncarnations: Map<string, string>
  pendingSpawnOperationsBySessionId: Map<string, Set<PendingDaemonSpawnOperation>>
  pendingClaimSpawnOperations: Set<PendingDaemonSpawnOperation>
  markSessionDirty(id: string): void
  emitBackgroundStreamEvent(event: PtyBackgroundStreamEvent): void
  clearExitedSessionState(id: string, code: number, incarnationId?: string): void
}

export function routeDaemonPtyEvent(raw: unknown, context: EventRoutingContext): void {
  const event = raw as DaemonEvent
  if (event.type !== 'event') {
    return
  }

  if (event.event === 'data') {
    context.markSessionDirty(event.sessionId)
    emitPtyListeners(context.dataListeners, (listener) =>
      listener({
        id: event.sessionId,
        data: event.payload.data,
        ...((event.payload.rawLength ?? event.payload.sequenceChars) === undefined
          ? {}
          : { sequenceChars: event.payload.rawLength ?? event.payload.sequenceChars }),
        ...(event.payload.transformed ? { transformed: true } : {}),
        ...(event.payload.seq === undefined ? {} : { seq: event.payload.seq })
      })
    )
    return
  }
  if (event.event === 'sessionBackgroundMarker') {
    context.emitBackgroundStreamEvent({
      id: event.sessionId,
      kind: 'backgroundMarker',
      background: event.payload.background,
      ...(event.payload.scanSeedAnsi !== undefined
        ? { scanSeedAnsi: event.payload.scanSeedAnsi }
        : {}),
      ...(event.payload.mode2031PendingSubscribe ? { mode2031PendingSubscribe: true as const } : {})
    })
    return
  }
  if (event.event === 'dataGap') {
    context.emitBackgroundStreamEvent({
      id: event.sessionId,
      kind: 'dataGap',
      droppedChars: event.payload.droppedChars,
      ...(event.payload.sequenceChars === undefined
        ? {}
        : { sequenceChars: event.payload.sequenceChars })
    })
    return
  }
  if (event.event === 'transientFact') {
    if (
      event.payload.kind === '2031-subscribe' &&
      !supportsMode2031UnsubscribeFact(context.protocolVersion)
    ) {
      return
    }
    context.emitBackgroundStreamEvent({
      id: event.sessionId,
      kind: 'transientFact',
      fact: event.payload
    })
    return
  }
  if (event.event !== 'exit') {
    return
  }

  const currentIncarnationId = context.sessionIncarnations.get(event.sessionId)
  const pendingOperations = new Set([
    ...(context.pendingSpawnOperationsBySessionId.get(event.sessionId) ?? []),
    ...context.pendingClaimSpawnOperations
  ])
  if (
    event.payload.incarnationId !== undefined &&
    [...pendingOperations].some(
      (operation) => operation.conditionalRespawnOldIncarnationId === event.payload.incarnationId
    )
  ) {
    return
  }
  for (const operation of pendingOperations) {
    if (operation.ignoreNextExit) {
      operation.ignoreNextExit = false
      continue
    }
    if (recordConditionalRespawnExit(operation, event.sessionId, event.payload)) {
      continue
    }
    const exits = operation.exitsBySessionId.get(event.sessionId) ?? []
    exits.push(
      event.payload.incarnationId
        ? { code: event.payload.code, incarnationId: event.payload.incarnationId }
        : { code: event.payload.code }
    )
    operation.exitsBySessionId.set(event.sessionId, exits)
  }
  if (currentIncarnationId !== undefined && event.payload.incarnationId !== currentIncarnationId) {
    return
  }
  context.clearExitedSessionState(event.sessionId, event.payload.code, event.payload.incarnationId)
  emitPtyListeners(context.exitListeners, (listener) =>
    listener(createPtyExitPayload(event.sessionId, event.payload))
  )
}
