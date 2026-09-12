import { describe, expect, it } from 'vitest'
import { SessionDeepLinkState } from './session-deep-link-state'

describe('SessionDeepLinkState', () => {
  it('queues the latest startup or second-instance session intent', () => {
    const state = new SessionDeepLinkState()

    expect(state.capture(['Orca', 'orca://session/session_first'])).toBe(true)
    expect(state.capture(['Orca', 'orca://session/session_second'])).toBe(true)
    expect(state.consume()).toBe('session_second')
    expect(state.consume()).toBeNull()
  })

  it('preserves a pending intent when unrelated routes arrive', () => {
    const state = new SessionDeepLinkState()
    state.capture(['Orca', 'orca://session/session_safe'])

    expect(state.capture(['Orca', 'orca://skills/share/share_existing'])).toBe(false)
    expect(state.consume()).toBe('session_safe')
  })

  it('can restore an intent when startup is not ready to resolve it', () => {
    const state = new SessionDeepLinkState()
    state.restore('session_retry')

    expect(state.consume()).toBe('session_retry')
  })
})
