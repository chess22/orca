import { pruneRetiredPtyIncarnations } from '../../shared/retired-pty-incarnations'
import { TerminalAttachCanceledError } from './daemon-errors'
import type { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import type { Session } from './session'
import { waitForTerminalAttachOperation } from './terminal-attach-cancellation'
import type { TerminalHostAgentSessionGenerations } from './terminal-host-agent-session-generations'
import { createOrAttachClaimedAgentSession } from './terminal-host-agent-session-claim'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { CreateOrAttachResult } from './terminal-host-create-contract'
import { createOrAttachTerminalSession } from './terminal-host-session-create'
import type { TerminalHostOptions } from './terminal-host-options'
import type { TerminalHostTombstones } from './terminal-host-tombstones'
import type { TerminalSessionTeardown } from './terminal-session-teardown'

type SessionCreationHost = {
  sessions: Map<string, Session>
  pendingCreations: Map<string, Promise<void>>
  sessionTeardown: TerminalSessionTeardown
  killedTombstones: TerminalHostTombstones
  spawnOptions: Pick<TerminalHostOptions, 'spawnSubprocess' | 'spawnGate'>
  reportReadinessEvent: TerminalHostOptions['reportReadinessEvent']
  isCreationFenced(): boolean
  agentSessionOwners: ClaimedAgentPtyOwnerRegistry
  agentSessionGenerations: TerminalHostAgentSessionGenerations
  retiredIncarnations: Map<string, { incarnationId: string; code: number; expiresAt: number }>
  reapSession(sessionId: string): void
}

// A confirmed post-stop gap is recovered by a separate RPC round trip. Keep the
// exact retired-incarnation fence long enough for inspection and an idempotent retry.
const REMOTE_FOREGROUND_TOMBSTONE_RETENTION_MS = 5 * 60_000

export async function reserveTerminalHostSession<T>(
  owner: SessionCreationHost,
  opts: InternalCreateOrAttachOptions,
  run: () => Promise<T>
): Promise<T> {
  for (
    let inFlight = owner.pendingCreations.get(opts.sessionId);
    inFlight !== undefined;
    inFlight = owner.pendingCreations.get(opts.sessionId)
  ) {
    await waitForTerminalAttachOperation(inFlight, opts.cancelSignal, opts.sessionId)
    assertTerminalHostCreateAllowed(owner, opts)
  }
  assertTerminalHostCreateAllowed(owner, opts)

  let settleCreation: () => void = () => {}
  owner.pendingCreations.set(
    opts.sessionId,
    new Promise<void>((resolve) => {
      settleCreation = resolve
    })
  )
  try {
    return await run()
  } finally {
    owner.pendingCreations.delete(opts.sessionId)
    settleCreation()
  }
}

export async function createReservedTerminalHostSession(
  owner: SessionCreationHost,
  opts: InternalCreateOrAttachOptions
): Promise<CreateOrAttachResult> {
  return await createOrAttachClaimedAgentSession({
    options: opts,
    owners: owner.agentSessionOwners,
    isLive: (binding) =>
      owner.agentSessionGenerations.isCurrent(
        binding,
        Boolean(
          owner.sessions.get(binding.ptyId)?.isAlive &&
          !owner.sessions.get(binding.ptyId)?.isTerminating
        )
      ),
    createOrAttach: async (options) => {
      assertTerminalHostCreateAllowed(owner, options)
      if (options.agentSessionGeneration && owner.sessions.get(options.sessionId)?.isAlive) {
        throw new Error('agent_session_claim_unavailable')
      }
      return await createOrAttachTerminalSession(options, {
        sessions: owner.sessions,
        assertCreateAllowed: () => assertTerminalHostCreateAllowed(owner, options),
        sessionTeardown: owner.sessionTeardown,
        killedTombstones: owner.killedTombstones,
        spawnSubprocess: owner.spawnOptions.spawnSubprocess,
        spawnGate: owner.spawnOptions.spawnGate,
        onDeadSessionRemoved: (sessionId) => owner.agentSessionGenerations.forget(sessionId),
        onSessionCreated: (sessionId, generation, isAlive) =>
          owner.agentSessionGenerations.remember(sessionId, generation, isAlive),
        ...(owner.reportReadinessEvent ? { reportReadinessEvent: owner.reportReadinessEvent } : {}),
        onSessionExit: (sessionId, generation) =>
          recordTerminalHostSessionExit(owner, sessionId, generation)
      })
    }
  })
}

export function recordTerminalHostSessionExit(
  owner: SessionCreationHost,
  sessionId: string,
  generation: string | undefined
): void {
  const session = owner.sessions.get(sessionId)
  if (session) {
    pruneRetiredPtyIncarnations(owner.retiredIncarnations)
    owner.retiredIncarnations.set(sessionId, {
      incarnationId: session.incarnationId,
      code: session.exitCode ?? 0,
      expiresAt: Date.now() + REMOTE_FOREGROUND_TOMBSTONE_RETENTION_MS
    })
  }
  owner.agentSessionOwners.release(sessionId, generation)
  owner.agentSessionGenerations.forget(sessionId, generation)
  owner.reapSession(sessionId)
}

export function assertTerminalHostCreateAllowed(
  owner: Pick<SessionCreationHost, 'isCreationFenced'>,
  opts: InternalCreateOrAttachOptions
): void {
  if (owner.isCreationFenced()) {
    throw new Error('Terminal host is shutting down')
  }
  if (opts.isCanceled?.()) {
    throw new TerminalAttachCanceledError(opts.sessionId)
  }
}
