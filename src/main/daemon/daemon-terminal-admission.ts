import type { BackgroundTransientFactRelay } from './daemon-background-transient-facts'
import type { DaemonClientConnections } from './daemon-client-connections'
import type { DaemonEndpointLifecycle } from './daemon-endpoint-lifecycle'
import { DAEMON_ENDPOINT_LOST_MESSAGE } from './daemon-endpoint-ownership'
import type { DaemonFileLog } from './daemon-file-log'
import type {
  DaemonPtySpawnPreparations,
  PendingPtySpawnPreparation
} from './daemon-pty-spawn-preparations'
import type { DaemonSessionAttachments } from './daemon-session-attachments'
import type { DaemonStreamDataBatcher } from './daemon-stream-data-batcher'
import type { TerminalHistorySeedTransferRegistry } from './terminal-history-seed-transfer-registry'
import type { CreateOrAttachOptions, CreateOrAttachResult, TerminalHost } from './terminal-host'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { isSpawnIntent } from '../../shared/host-spawn-admission'
import { parsePtyStartupIngressIntent } from '../../shared/pty-startup-ingress'
import {
  isAgentSessionExecutionClaim,
  isAgentSessionSurfaceBinding
} from '../../shared/agent-session-host-authority'
import {
  type DaemonRequest,
  type RecoverEmptyLeafIfMatchRequest,
  type RespawnIfMatchRequest,
  TerminalAttachCanceledError
} from './types'
import {
  admitConditionalTerminalRespawn,
  resolveSpawnAdmissionDeadline
} from './daemon-terminal-conditional-respawn-admission'
import {
  admitEmptyLeafRecovery,
  completeEmptyLeafRecoveryAdmission,
  type CompletedEmptyLeafRecovery,
  type PreparedEmptyLeafRecovery
} from './daemon-terminal-empty-leaf-recovery-admission'
import { createDaemonTerminalStreamClient } from './daemon-terminal-stream-client'

type CreateOrAttachRequest = Extract<DaemonRequest, { type: 'createOrAttach' }>

export type DaemonTerminalAdmissionOptions = {
  host: TerminalHost
  connections: DaemonClientConnections
  endpoint: DaemonEndpointLifecycle
  preparations: DaemonPtySpawnPreparations
  attachments: DaemonSessionAttachments
  historySeedTransfers: TerminalHistorySeedTransferRegistry
  transientFactRelay: BackgroundTransientFactRelay
  streamDataBatcher: DaemonStreamDataBatcher
  log: DaemonFileLog
  isAcceptingWork: () => boolean
  requestEndpointRetirement: () => void
  reevaluateIdleShutdown: () => void
}

export class DaemonTerminalAdmission {
  private createOrAttachInFlight = 0
  private readonly preparedEmptyLeafRecoveries = new Map<string, PreparedEmptyLeafRecovery>()
  private readonly completedEmptyLeafRecoveries = new Map<string, CompletedEmptyLeafRecovery>()
  private readonly conditionalRespawnExitFences = new Map<
    string,
    Map<string, { deferred: (() => void)[] }>
  >()

  constructor(private readonly options: DaemonTerminalAdmissionOptions) {}

  get inFlight(): number {
    return this.createOrAttachInFlight
  }

  async createOrAttach(clientId: string, request: CreateOrAttachRequest): Promise<unknown> {
    const client = this.options.connections.get(clientId)
    if (!this.options.isAcceptingWork()) {
      throw new Error('Daemon temporarily unavailable; reconnect')
    }
    if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
      throw new Error('Daemon client connection is incomplete; reconnect')
    }
    const payload = request.payload
    const attachOnly = payload.attachOnly === true
    if (!attachOnly && this.options.endpoint.hasLostOwnership()) {
      this.options.requestEndpointRetirement()
      throw new Error(DAEMON_ENDPOINT_LOST_MESSAGE)
    }
    this.createOrAttachInFlight++
    let routedSessionId = payload.sessionId
    let result: CreateOrAttachResult
    let spawnPreparation: PendingPtySpawnPreparation | null = null
    try {
      if (
        payload.agentSessionEnsure !== undefined &&
        (!isAgentSessionExecutionClaim(payload.agentSessionEnsure.claim) ||
          !isAgentSessionSurfaceBinding(payload.agentSessionEnsure.surface))
      ) {
        throw new Error('agent_session_identity_required')
      }
      spawnPreparation = this.options.preparations.register(
        payload.sessionId,
        clientId,
        request.id,
        payload.cancelAfterMs
      )
      if (!attachOnly) {
        await this.options.preparations.prepareUnlessCanceled(payload.sessionId, spawnPreparation)
      }
      if (payload.historySeed !== undefined && payload.historySeedTransferId !== undefined) {
        throw new Error('Multiple terminal history seed sources')
      }
      const historySeedChunks =
        payload.historySeedTransferId !== undefined
          ? this.options.historySeedTransfers.take(clientId, payload.historySeedTransferId)
          : payload.historySeed !== undefined
            ? [payload.historySeed]
            : undefined
      result = await this.options.host.createOrAttach({
        sessionId: payload.sessionId,
        cols: payload.cols,
        rows: payload.rows,
        cwd: payload.cwd,
        env: payload.env,
        envToDelete: payload.envToDelete,
        command: payload.command,
        startupCommandDelivery: payload.startupCommandDelivery,
        ...(attachOnly ? { attachOnly: true } : {}),
        ...(isTuiAgent(payload.launchAgent) ? { launchAgent: payload.launchAgent } : {}),
        shellOverride: payload.shellOverride,
        terminalShellArgs: payload.terminalShellArgs,
        terminalWindowsWslDistro: payload.terminalWindowsWslDistro,
        terminalWindowsPowerShellImplementation: payload.terminalWindowsPowerShellImplementation,
        shellReadySupported: payload.shellReadySupported,
        historySeedChunks,
        startupIngress: parsePtyStartupIngressIntent(payload.startupIngress),
        ...(payload.shellReadyTimeoutMs !== undefined
          ? { shellReadyTimeoutMs: payload.shellReadyTimeoutMs }
          : {}),
        ...(payload.agentSessionEnsure ? { agentSessionEnsure: payload.agentSessionEnsure } : {}),
        spawnAdmission: {
          clientId,
          declaredIntent: isSpawnIntent(payload.spawnIntent) ? payload.spawnIntent : null,
          deadlineAt: resolveSpawnAdmissionDeadline(payload.cancelAfterMs)
        },
        isCanceled: () => spawnPreparation?.canceled === true,
        cancelSignal: spawnPreparation.controller.signal,
        onSessionResolved: (sessionId) => {
          routedSessionId = sessionId
        },
        streamClient: this.createStreamClient(clientId, () => routedSessionId)
      })
    } finally {
      if (spawnPreparation) {
        this.options.preparations.finish(payload.sessionId, spawnPreparation)
      }
      this.createOrAttachInFlight--
      this.options.reevaluateIdleShutdown()
    }

    routedSessionId = result.agentSessionEnsure?.owner.ptyId ?? payload.sessionId
    if (
      this.options.connections.get(clientId) !== client ||
      !client.authenticatedPairEstablished ||
      client.streamSocket === null
    ) {
      this.options.host.detach(routedSessionId, result.attachToken)
      throw new TerminalAttachCanceledError(routedSessionId)
    }
    this.options.attachments.attach(routedSessionId, clientId, result.attachToken)
    this.options.streamDataBatcher.refreshSessionDroppability(routedSessionId)
    if (this.options.transientFactRelay.isBackgrounded(routedSessionId)) {
      this.options.streamDataBatcher.enqueueControlEvent(clientId, routedSessionId, {
        type: 'event',
        event: 'sessionBackgroundMarker',
        sessionId: routedSessionId,
        payload: { background: true }
      })
    }
    this.options.log.log(result.isNew ? 'session-created' : 'session-attached', {
      sessionId: routedSessionId,
      pid: result.pid
    })
    return {
      isNew: result.isNew,
      snapshot: result.snapshot,
      pid: result.pid,
      shellState: result.shellState,
      incarnationId: result.incarnationId,
      ...(result.launchAgent ? { launchAgent: result.launchAgent } : {}),
      wslDistro: result.wslDistro,
      ...(result.historySeeded !== undefined ? { historySeeded: result.historySeeded } : {}),
      ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {}),
      ...(result.cwdReadableByDaemon !== undefined
        ? { cwdReadableByDaemon: result.cwdReadableByDaemon }
        : {})
    }
  }

  async respawnIfMatch(clientId: string, request: RespawnIfMatchRequest): Promise<unknown> {
    // SAFETY: the helper receives this admission boundary's private state as one authority unit.
    return await admitConditionalTerminalRespawn(
      {
        options: this.options,
        incrementInFlight: () => this.createOrAttachInFlight++,
        decrementInFlight: () => this.createOrAttachInFlight--,
        createStreamClient: this.createStreamClient.bind(this),
        beginConditionalRespawnExitFence: this.beginConditionalRespawnExitFence.bind(this)
      },
      clientId,
      request
    )
  }

  async recoverEmptyLeafIfMatch(
    clientId: string,
    request: RecoverEmptyLeafIfMatchRequest
  ): Promise<unknown> {
    return await admitEmptyLeafRecovery(this.emptyLeafRecoveryAdmissionOwner(), clientId, request)
  }

  completeEmptyLeafRecovery(
    clientId: string,
    payload: { recoveryId: string; ptyId: string; incarnationId: string },
    commit: boolean
  ): { completed: boolean } {
    return completeEmptyLeafRecoveryAdmission(
      this.emptyLeafRecoveryAdmissionOwner(),
      clientId,
      payload,
      commit
    )
  }

  private emptyLeafRecoveryAdmissionOwner() {
    return {
      options: this.options,
      preparedRecoveries: this.preparedEmptyLeafRecoveries,
      completedRecoveries: this.completedEmptyLeafRecoveries,
      incrementInFlight: () => this.createOrAttachInFlight++,
      decrementInFlight: () => this.createOrAttachInFlight--,
      createStreamClient: this.createStreamClient.bind(this)
    }
  }

  private createStreamClient(
    clientId: string,
    sessionId: () => string
  ): CreateOrAttachOptions['streamClient'] {
    return createDaemonTerminalStreamClient(
      this.options,
      this.conditionalRespawnExitFences,
      clientId,
      sessionId
    )
  }

  private beginConditionalRespawnExitFence(
    sessionId: string,
    incarnationId: string
  ): (replacementPublished: boolean) => void {
    const fences =
      this.conditionalRespawnExitFences.get(sessionId) ??
      new Map<string, { deferred: (() => void)[] }>()
    const fence = { deferred: [] as (() => void)[] }
    fences.set(incarnationId, fence)
    this.conditionalRespawnExitFences.set(sessionId, fences)
    return (replacementPublished) => {
      if (fences.get(incarnationId) !== fence) {
        return
      }
      fences.delete(incarnationId)
      if (fences.size === 0) {
        this.conditionalRespawnExitFences.delete(sessionId)
      }
      if (!replacementPublished) {
        for (const deliver of fence.deferred) {
          deliver()
        }
      }
    }
  }
}
