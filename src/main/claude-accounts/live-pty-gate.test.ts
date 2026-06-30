import { afterEach, describe, expect, it } from 'vitest'
import {
  beginClaudeAuthSwitch,
  endClaudeAuthSwitch,
  isClaudeAuthSwitchInProgress,
  markClaudePtyExited,
  markClaudePtySpawned,
  onClaudePtyExited
} from './live-pty-gate'

describe('Claude live PTY gate', () => {
  afterEach(() => {
    markClaudePtyExited('live-claude-pty')
    endClaudeAuthSwitch()
  })

  it('allows switching while Claude PTYs are live', () => {
    markClaudePtySpawned('live-claude-pty')

    beginClaudeAuthSwitch()

    expect(isClaudeAuthSwitchInProgress()).toBe(true)
  })

  it('still rejects overlapping account switches', () => {
    beginClaudeAuthSwitch()

    expect(() => beginClaudeAuthSwitch()).toThrow('already in progress')
  })

  it('notifies listeners only for tracked Claude PTY exits', () => {
    let calls = 0
    const unsubscribe = onClaudePtyExited(() => {
      calls += 1
    })

    markClaudePtyExited('missing-pty')
    expect(calls).toBe(0)

    markClaudePtySpawned('live-claude-pty')
    markClaudePtyExited('live-claude-pty')
    expect(calls).toBe(1)

    unsubscribe()
    markClaudePtySpawned('live-claude-pty')
    markClaudePtyExited('live-claude-pty')
    expect(calls).toBe(1)
  })
})
