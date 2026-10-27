import type { Session } from './session'
import { getAliveTerminalHostSession } from './terminal-host-session-access'
import type { TerminalHostTombstones } from './terminal-host-tombstones'
import type { TerminalSessionTeardown } from './terminal-session-teardown'

type SessionTerminationHost = {
  sessions: Map<string, Session>
  pendingCreations: Map<string, Promise<void>>
  sessionTeardown: TerminalSessionTeardown
  killedTombstones: TerminalHostTombstones
  killReserved(sessionId: string, opts: { immediate?: boolean }): Promise<void>
}

export async function killTerminalHostSession(
  owner: SessionTerminationHost,
  sessionId: string,
  opts: { immediate?: boolean }
): Promise<void> {
  const expectedIncarnationId = owner.sessions.get(sessionId)?.incarnationId
  for (
    let pending = owner.pendingCreations.get(sessionId);
    pending;
    pending = owner.pendingCreations.get(sessionId)
  ) {
    await pending.catch(() => {})
  }
  if (
    expectedIncarnationId !== undefined &&
    owner.sessions.get(sessionId)?.incarnationId !== expectedIncarnationId
  ) {
    return
  }
  await owner.killReserved(sessionId, opts)
}

export function killReservedTerminalHostSession(
  owner: Pick<SessionTerminationHost, 'sessions' | 'sessionTeardown' | 'killedTombstones'>,
  sessionId: string,
  opts: { immediate?: boolean }
): Promise<void> {
  const pending = owner.sessionTeardown.get(sessionId)
  if (pending) {
    return Promise.resolve(
      opts.immediate ? owner.sessionTeardown.requestImmediate(sessionId) : pending
    )
  }
  const session = getAliveTerminalHostSession(owner.sessions, sessionId)
  const killed = owner.sessionTeardown.killSession(sessionId, session, opts.immediate === true)
  owner.killedTombstones.record(sessionId)
  return Promise.resolve(killed)
}
