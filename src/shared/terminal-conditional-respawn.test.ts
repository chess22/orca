import { describe, expect, it } from 'vitest'
import { isTerminalConditionalRespawnResult } from './terminal-conditional-respawn'

describe('terminal conditional respawn result', () => {
  it('requires publication state for partial replacement results', () => {
    expect(
      isTerminalConditionalRespawnResult({
        outcome: 'partial',
        mutationId: 'mutation',
        reason: 'attachment_owner_changed',
        oldStopped: true,
        replacementStarted: true,
        ptyId: 'pty',
        incarnationId: 'incarnation'
      })
    ).toBe(false)
  })

  it('rejects a published replacement that never started', () => {
    expect(
      isTerminalConditionalRespawnResult({
        outcome: 'partial',
        mutationId: 'mutation',
        reason: 'spawn_failed',
        oldStopped: true,
        replacementStarted: false,
        replacementPublished: true
      })
    ).toBe(false)
  })

  it.each([
    {
      outcome: 'respawned',
      mutationId: 'mutation',
      ptyId: 'pty',
      incarnationId: 'incarnation',
      replayed: false
    },
    {
      outcome: 'failed_before_mutation',
      mutationId: 'mutation',
      reason: 'failed',
      replayed: 'yes'
    },
    {
      outcome: 'partial',
      mutationId: 'mutation',
      reason: 'partial',
      oldStopped: true,
      replacementStarted: false,
      replacementPublished: false,
      replayed: 1
    },
    {
      outcome: 'indeterminate',
      mutationId: 'mutation',
      reason: 'unknown',
      replayed: false
    }
  ])('rejects an invalid replay marker for $outcome', (result) => {
    expect(isTerminalConditionalRespawnResult(result)).toBe(false)
  })

  it('validates an optional indeterminate incarnation id', () => {
    expect(
      isTerminalConditionalRespawnResult({
        outcome: 'indeterminate',
        mutationId: 'mutation',
        reason: 'response_lost',
        incarnationId: 42
      })
    ).toBe(false)
    expect(
      isTerminalConditionalRespawnResult({
        outcome: 'indeterminate',
        mutationId: 'mutation',
        reason: 'response_lost',
        incarnationId: 'incarnation',
        replayed: true
      })
    ).toBe(true)
  })
})
