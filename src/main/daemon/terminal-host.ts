import { beginTerminalHostFencedTermination } from './terminal-host-fenced-termination'
import type { PtyFencedTerminationRequest } from '../../shared/pty-fenced-termination'
import type { Session } from './session'
import type { PtyProcessInspectionOptions } from '../providers/pty-process-inspection'
import type { SessionInfo, TakePendingOutputResult, TerminalSnapshot } from './types'
import type { CreateOrAttachResult } from './terminal-host-create-contract'
import type { TerminalHostOptions } from './terminal-host-options'
import { disposeTerminalHostSessions } from './terminal-host-disposal'
import { getAliveTerminalHostSession } from './terminal-host-session-access'
import { TerminalSessionTeardown } from './terminal-session-teardown'
import { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import { TerminalHostAgentSessionGenerations } from './terminal-host-agent-session-generations'
import { resolveTerminalHostSessionCwd } from './terminal-host-session-cwd'
import { TerminalHostTombstones } from './terminal-host-tombstones'
import {
  listLiveTerminalHostSessions,
  hasLiveTerminalHostSessions
} from './terminal-host-session-listing'
import { randomUUID } from 'node:crypto'
import { inspectTerminalHostSession } from './terminal-host-process-inspection'
import type { TerminalHostProcessInspection } from './terminal-host-process-inspection'
import {
  confirmTerminalHostForegroundProcess,
  confirmTerminalHostShellForeground,
  getSettledTerminalHostSnapshot,
  getTerminalHostAppliedSize,
  getTerminalHostPartialEscapeTail,
  getTerminalHostSnapshot,
  takeTerminalHostPendingOutput
} from './terminal-host-session-inspection-operations'
import type { TerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'
import {
  reapUnpublishedConditionalReplacement,
  replayConditionalRespawn,
  respawnTerminalHostIfMatch,
  type ConditionalRespawnIdentity
} from './terminal-host-conditional-respawn'
import {
  assertTerminalHostCreateAllowed,
  createReservedTerminalHostSession,
  reserveTerminalHostSession
} from './terminal-host-session-creation'
import {
  killReservedTerminalHostSession,
  killTerminalHostSession
} from './terminal-host-session-termination'

export type { CreateOrAttachOptions, CreateOrAttachResult } from './terminal-host-create-contract'

export type { TerminalHostOptions } from './terminal-host-options'

const DEFAULT_MAX_TOMBSTONES = 1000

export class TerminalHost {
  private sessions = new Map<string, Session>()
  // Serializes creates for one id across async spawn validation.
  private pendingCreations = new Map<string, Promise<void>>()
  private sessionTeardown = new TerminalSessionTeardown(this.sessions)
  private killedTombstones: TerminalHostTombstones
  private readonly spawnOptions: Pick<TerminalHostOptions, 'spawnSubprocess' | 'spawnGate'>
  private onSessionReaped: TerminalHostOptions['onSessionReaped']
  private reportReadinessEvent: TerminalHostOptions['reportReadinessEvent']
  private onFinalCheckpoint: TerminalHostOptions['onFinalCheckpoint']
  private creationFenced = false
  private disposePromise: Promise<void> | null = null
  private readonly agentSessionOwners = new ClaimedAgentPtyOwnerRegistry()
  private readonly agentSessionGenerations = new TerminalHostAgentSessionGenerations()
  private readonly authorityGeneration = randomUUID()
  private observationEpoch = 0
  private readonly retiredIncarnations = new Map<
    string,
    { incarnationId: string; code: number; expiresAt: number }
  >()
  private readonly conditionalRespawns = new Map<
    string,
    {
      fingerprint: string
      promise: Promise<TerminalConditionalRespawnResult>
    }
  >()
  private readonly suppressedReapNotifications = new Set<string>()
  private readonly deferredReapNotifications = new Set<string>()

  constructor(opts: TerminalHostOptions) {
    this.spawnOptions = opts
    this.onSessionReaped = opts.onSessionReaped
    this.reportReadinessEvent = opts.reportReadinessEvent
    this.onFinalCheckpoint = opts.onFinalCheckpoint
    this.killedTombstones = new TerminalHostTombstones(opts.maxTombstones ?? DEFAULT_MAX_TOMBSTONES)
  }

  private helperHost() {
    return {
      sessions: this.sessions,
      pendingCreations: this.pendingCreations,
      sessionTeardown: this.sessionTeardown,
      killedTombstones: this.killedTombstones,
      spawnOptions: this.spawnOptions,
      reportReadinessEvent: this.reportReadinessEvent,
      isCreationFenced: () => this.creationFenced,
      agentSessionOwners: this.agentSessionOwners,
      agentSessionGenerations: this.agentSessionGenerations,
      retiredIncarnations: this.retiredIncarnations,
      conditionalRespawns: this.conditionalRespawns,
      suppressedReapNotifications: this.suppressedReapNotifications,
      deferredReapNotifications: this.deferredReapNotifications,
      onSessionReaped: this.onSessionReaped,
      conditionalRespawnReplay: this.conditionalRespawnReplay.bind(this),
      withSessionCreationReservation: this.withSessionCreationReservation.bind(this),
      killReserved: this.killReserved.bind(this),
      createOrAttachReserved: this.createOrAttachReserved.bind(this),
      reapUnpublishedConditionalReplacement: this.reapUnpublishedConditionalReplacement.bind(this),
      reapSession: this.reapSession.bind(this)
    }
  }

  async createOrAttach(opts: InternalCreateOrAttachOptions): Promise<CreateOrAttachResult> {
    this.assertCreateOrAttachAllowed(opts)
    return await this.withSessionCreationReservation(opts, () => this.createOrAttachReserved(opts))
  }

  respawnIfMatch(
    opts: ConditionalRespawnIdentity & { onReplacementPublished: (attachToken: symbol) => void }
  ): Promise<TerminalConditionalRespawnResult> {
    return respawnTerminalHostIfMatch(this.helperHost(), opts)
  }

  conditionalRespawnReplay(
    opts: ConditionalRespawnIdentity
  ): Promise<TerminalConditionalRespawnResult> | null {
    return replayConditionalRespawn(this.helperHost(), opts)
  }

  private reapUnpublishedConditionalReplacement(
    opts: ConditionalRespawnIdentity,
    replacementIncarnationId: string,
    reason: string
  ): Promise<TerminalConditionalRespawnResult> {
    return reapUnpublishedConditionalReplacement(
      this.helperHost(),
      opts,
      replacementIncarnationId,
      reason
    )
  }

  private async withSessionCreationReservation<T>(
    opts: InternalCreateOrAttachOptions,
    run: () => Promise<T>
  ): Promise<T> {
    // SAFETY: the helper interface is the private state owned by this class.
    return await reserveTerminalHostSession(this.helperHost(), opts, run)
  }

  private async createOrAttachReserved(
    opts: InternalCreateOrAttachOptions
  ): Promise<CreateOrAttachResult> {
    // SAFETY: the helper interface is the private state owned by this class.
    return await createReservedTerminalHostSession(this.helperHost(), opts)
  }

  private assertCreateOrAttachAllowed(opts: InternalCreateOrAttachOptions): void {
    assertTerminalHostCreateAllowed(this.helperHost(), opts)
  }

  write(sessionId: string, data: string): void {
    getAliveTerminalHostSession(this.sessions, sessionId).write(data)
  }

  closeStartupQueryAuthority(sessionId: string): number {
    return getAliveTerminalHostSession(this.sessions, sessionId).closeStartupQueryAuthority()
  }

  resize(sessionId: string, cols: number, rows: number): void {
    getAliveTerminalHostSession(this.sessions, sessionId).resize(cols, rows)
  }

  // Producer flow-control hints tolerate sessions that have already exited.
  pauseProducer(sessionId: string, source?: 'stream', onStreamStall?: () => void): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.isAlive) {
      return
    }
    session.pauseProducer(source, onStreamStall)
  }

  resumeProducer(sessionId: string, source?: 'stream'): void {
    this.sessions.get(sessionId)?.resumeProducer(source)
  }

  async kill(sessionId: string, opts: { immediate?: boolean } = {}): Promise<void> {
    // SAFETY: the helper interface is the private state owned by this class.
    await killTerminalHostSession(this.helperHost(), sessionId, opts)
  }

  private killReserved(sessionId: string, opts: { immediate?: boolean } = {}): Promise<void> {
    return killReservedTerminalHostSession(this.helperHost(), sessionId, opts)
  }

  beginFencedTermination(request: PtyFencedTerminationRequest) {
    return beginTerminalHostFencedTermination(request, {
      sessions: this.sessions,
      pendingCreations: this.pendingCreations,
      owners: this.agentSessionOwners,
      kill: (id, options) => this.kill(id, options)
    })
  }

  // Reap the emulator so dead sessions do not retain scrollback for the daemon’s lifetime.
  private reapSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.isAlive) {
      return
    }
    session.dispose()
    this.sessions.delete(sessionId)
    if (!this.suppressedReapNotifications.has(sessionId)) {
      this.onSessionReaped?.(sessionId)
    } else {
      this.deferredReapNotifications.add(sessionId)
    }
  }

  signal(sessionId: string, sig: string): void {
    getAliveTerminalHostSession(this.sessions, sessionId).signal(sig)
  }

  detach(sessionId: string, token: symbol): void {
    this.detachClients([{ sessionId, token }])
  }

  detachClients(attachments: readonly { sessionId: string; token: symbol }[]): void {
    for (const { sessionId, token } of attachments) {
      this.sessions.get(sessionId)?.detachClient(token)
    }
  }

  async getCwd(sessionId: string): Promise<string | null> {
    return await resolveTerminalHostSessionCwd(
      getAliveTerminalHostSession(this.sessions, sessionId)
    )
  }

  getForegroundProcess(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session || !session.isAlive) {
      return null
    }
    return session.getForegroundProcess()
  }

  inspectProcess(
    sessionId: string,
    options?: PtyProcessInspectionOptions
  ): Promise<TerminalHostProcessInspection> {
    return inspectTerminalHostSession(
      this.sessions,
      this.retiredIncarnations,
      sessionId,
      options,
      this.authorityGeneration,
      () => ++this.observationEpoch
    )
  }

  async confirmForegroundProcess(sessionId: string): Promise<string | null> {
    return confirmTerminalHostForegroundProcess(this.sessions.get(sessionId))
  }

  async confirmShellForeground(sessionId: string): Promise<boolean> {
    return confirmTerminalHostShellForeground(this.sessions.get(sessionId), () =>
      this.sessions.get(sessionId)
    )
  }

  clearScrollback(sessionId: string): void {
    getAliveTerminalHostSession(this.sessions, sessionId).clearScrollback()
  }

  resetInputModes(sessionId: string): void {
    getAliveTerminalHostSession(this.sessions, sessionId).resetInputModes()
  }

  // Checkpoint reads tolerate sessions that have just exited.
  getSnapshot(sessionId: string, opts: { scrollbackRows?: number } = {}): TerminalSnapshot | null {
    return getTerminalHostSnapshot(this.sessions.get(sessionId), opts)
  }

  async getSettledSnapshot(
    sessionId: string,
    opts: { scrollbackRows?: number } = {}
  ): Promise<TerminalSnapshot | null> {
    return getSettledTerminalHostSnapshot(this.sessions.get(sessionId), opts)
  }

  // Seed scan-authority handoff with the incomplete escape at the current stream position.
  getPartialEscapeTailAnsi(sessionId: string): string {
    return getTerminalHostPartialEscapeTail(this.sessions.get(sessionId))
  }

  // Let the renderer detect dropped or coerced resizes from the applied dimensions.
  getAppliedSize(sessionId: string): { cols: number; rows: number } | null {
    return getTerminalHostAppliedSize(this.sessions.get(sessionId))
  }

  takePendingOutput(
    sessionId: string,
    includeSnapshot: boolean,
    opts: { teardownSnapshot?: boolean } = {}
  ): TakePendingOutputResult | null {
    return takeTerminalHostPendingOutput(this.sessions.get(sessionId), includeSnapshot, opts)
  }

  isKilled(sessionId: string): boolean {
    return this.killedTombstones.has(sessionId)
  }

  listSessions(): SessionInfo[] {
    return listLiveTerminalHostSessions(this.sessions, this.agentSessionOwners)
  }

  hasLiveSessions(): boolean {
    return hasLiveTerminalHostSessions(this.sessions)
  }

  dispose(): Promise<void> {
    this.creationFenced = true
    if (this.disposePromise) {
      return this.disposePromise
    }
    const disposePromise = this.disposeSessions()
    this.disposePromise = disposePromise
    void disposePromise.catch(() => {
      // Keep failed native owners retryable on the next shutdown request.
      if (this.disposePromise === disposePromise) {
        this.disposePromise = null
      }
    })
    return disposePromise
  }

  private disposeSessions(): Promise<void> {
    return disposeTerminalHostSessions({
      pendingCreations: this.pendingCreations,
      sessionTeardown: this.sessionTeardown,
      sessions: this.sessions,
      onFinalCheckpoint: this.onFinalCheckpoint,
      killedTombstones: this.killedTombstones
    })
  }
}
