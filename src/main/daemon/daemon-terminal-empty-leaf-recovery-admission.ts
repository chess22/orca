import type { CreateOrAttachOptions } from './terminal-host'
import type { DaemonTerminalAdmissionOptions } from './daemon-terminal-admission'
import type { RecoverEmptyLeafIfMatchRequest } from './types'
import { TerminalAttachCanceledError } from './types'
import { resolveSpawnAdmissionDeadline } from './daemon-terminal-conditional-respawn-admission'

export type PreparedEmptyLeafRecovery = {
  clientId: string
  ptyId: string
  incarnationId: string
  attachToken: symbol
}

export type CompletedEmptyLeafRecovery = {
  clientId: string
  ptyId: string
  incarnationId: string
  commit: boolean
}

type EmptyLeafRecoveryAdmissionOwner = {
  options: DaemonTerminalAdmissionOptions
  preparedRecoveries: Map<string, PreparedEmptyLeafRecovery>
  completedRecoveries: Map<string, CompletedEmptyLeafRecovery>
  incrementInFlight(): void
  decrementInFlight(): void
  createStreamClient(
    clientId: string,
    sessionId: () => string
  ): CreateOrAttachOptions['streamClient']
}

export async function admitEmptyLeafRecovery(
  owner: EmptyLeafRecoveryAdmissionOwner,
  clientId: string,
  request: RecoverEmptyLeafIfMatchRequest
): Promise<unknown> {
  const client = owner.options.connections.get(clientId)
  if (!owner.options.isAcceptingWork() || owner.options.endpoint.hasLostOwnership()) {
    return {
      outcome: 'failed_before_mutation',
      recoveryId: request.payload.recoveryId,
      reason: 'daemon_unavailable'
    }
  }
  if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
    return {
      outcome: 'failed_before_mutation',
      recoveryId: request.payload.recoveryId,
      reason: 'client_unverified'
    }
  }
  const payload = request.payload
  owner.incrementInFlight()
  try {
    return await owner.options.host.recoverEmptyLeafIfMatch(payload, {
      sessionId: payload.expected.ptyId,
      cols: payload.replacement.cols,
      rows: payload.replacement.rows,
      cwd: payload.replacement.cwd,
      command: payload.replacement.command,
      env: payload.replacement.env,
      envToDelete: payload.replacement.envToDelete,
      spawnAdmission: {
        clientId,
        declaredIntent: null,
        deadlineAt: resolveSpawnAdmissionDeadline(undefined)
      },
      streamClient: owner.createStreamClient(clientId, () => payload.expected.ptyId),
      onReplacementPublished: (attachToken) => {
        if (
          owner.options.connections.get(clientId) !== client ||
          !client.authenticatedPairEstablished ||
          client.streamSocket === null
        ) {
          throw new TerminalAttachCanceledError(payload.expected.ptyId)
        }
        const session = owner.options.host
          .listSessions()
          .find((candidate) => candidate.sessionId === payload.expected.ptyId)
        if (!session?.incarnationId) {
          throw new Error('replacement_identity_unavailable')
        }
        owner.preparedRecoveries.set(payload.recoveryId, {
          clientId,
          ptyId: payload.expected.ptyId,
          incarnationId: session.incarnationId,
          attachToken
        })
      }
    })
  } finally {
    owner.decrementInFlight()
    owner.options.reevaluateIdleShutdown()
  }
}

export function completeEmptyLeafRecoveryAdmission(
  owner: EmptyLeafRecoveryAdmissionOwner,
  clientId: string,
  payload: { recoveryId: string; ptyId: string; incarnationId: string },
  commit: boolean
): { completed: boolean } {
  const client = owner.options.connections.get(clientId)
  if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
    return { completed: false }
  }
  const completed = owner.completedRecoveries.get(payload.recoveryId)
  if (completed) {
    return {
      completed:
        completed.clientId === clientId &&
        completed.ptyId === payload.ptyId &&
        completed.incarnationId === payload.incarnationId &&
        completed.commit === commit
    }
  }
  const prepared = owner.preparedRecoveries.get(payload.recoveryId)
  if (
    !prepared ||
    prepared.clientId !== clientId ||
    prepared.ptyId !== payload.ptyId ||
    prepared.incarnationId !== payload.incarnationId
  ) {
    return { completed: false }
  }
  owner.preparedRecoveries.delete(payload.recoveryId)
  if (commit) {
    owner.options.attachments.attach(payload.ptyId, clientId, prepared.attachToken)
    owner.options.streamDataBatcher.refreshSessionDroppability(payload.ptyId)
  } else {
    owner.options.host.detach(payload.ptyId, prepared.attachToken)
  }
  if (owner.completedRecoveries.size >= 256) {
    const oldestRecoveryId = owner.completedRecoveries.keys().next().value
    if (oldestRecoveryId !== undefined) {
      owner.completedRecoveries.delete(oldestRecoveryId)
    }
  }
  owner.completedRecoveries.set(payload.recoveryId, {
    clientId,
    ptyId: payload.ptyId,
    incarnationId: payload.incarnationId,
    commit
  })
  return { completed: true }
}
