import { SessionNotFoundError } from './daemon-errors'
import type { Session } from './session'

export function getAliveTerminalHostSession(
  sessions: ReadonlyMap<string, Session>,
  sessionId: string
): Session {
  const session = sessions.get(sessionId)
  if (!session || !session.isAlive) {
    throw new SessionNotFoundError(sessionId)
  }
  return session
}

export function getTerminalHostForegroundProcess(
  sessions: ReadonlyMap<string, Session>,
  sessionId: string
): string | null {
  const session = sessions.get(sessionId)
  return session?.isAlive ? session.getForegroundProcess() : null
}

export function detachTerminalHostClients(
  sessions: ReadonlyMap<string, Session>,
  attachments: readonly { sessionId: string; token: symbol }[]
): void {
  for (const { sessionId, token } of attachments) {
    sessions.get(sessionId)?.detachClient(token)
  }
}

export function getInspectableTerminalHostSession(
  sessions: ReadonlyMap<string, Session>,
  retired: ReadonlyMap<string, { incarnationId: string; expiresAt: number }>,
  sessionId: string,
  expectedIncarnationId?: string
): Session | null {
  const session = sessions.get(sessionId)
  if (
    (!session || !session.isAlive) &&
    !(
      (retired.get(sessionId)?.expiresAt ?? 0) > Date.now() &&
      expectedIncarnationId === retired.get(sessionId)?.incarnationId
    )
  ) {
    throw new SessionNotFoundError(sessionId)
  }
  return session ?? null
}

export function reapTerminalHostSession(args: {
  sessions: Map<string, Session>
  suppressedNotifications: ReadonlySet<string>
  deferredNotifications: Set<string>
  onSessionReaped?: (sessionId: string) => void
  sessionId: string
}): void {
  const session = args.sessions.get(args.sessionId)
  if (!session || session.isAlive) {
    return
  }
  session.dispose()
  args.sessions.delete(args.sessionId)
  if (args.suppressedNotifications.has(args.sessionId)) {
    args.deferredNotifications.add(args.sessionId)
  } else {
    args.onSessionReaped?.(args.sessionId)
  }
}
