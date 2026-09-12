import { sessionIdFromArguments } from '../../shared/session-deep-link'

export class SessionDeepLinkState {
  private pendingSessionId: string | null = null

  capture(argv: readonly string[]): boolean {
    const sessionId = sessionIdFromArguments(argv)
    if (!sessionId) {
      return false
    }
    this.pendingSessionId = sessionId
    return true
  }

  consume(): string | null {
    const sessionId = this.pendingSessionId
    this.pendingSessionId = null
    return sessionId
  }

  restore(sessionId: string): void {
    this.pendingSessionId = sessionId
  }
}
