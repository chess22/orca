import { describe, expect, it } from 'vitest'
import { shouldClearPendingSshReset } from './ssh-target-action-state'

describe('shouldClearPendingSshReset', () => {
  it('clears idle reset confirmation while a target is connecting', () => {
    expect(
      shouldClearPendingSshReset({
        pendingTargetId: 'target-1',
        pendingResetIsBusy: false,
        connectionStatus: 'connecting'
      })
    ).toBe(true)
  })

  it('keeps reset confirmation while reset is already running', () => {
    expect(
      shouldClearPendingSshReset({
        pendingTargetId: 'target-1',
        pendingResetIsBusy: true,
        connectionStatus: 'reconnecting'
      })
    ).toBe(false)
  })

  it('keeps reset confirmation for non-connecting target states', () => {
    expect(
      shouldClearPendingSshReset({
        pendingTargetId: 'target-1',
        pendingResetIsBusy: false,
        connectionStatus: 'connected'
      })
    ).toBe(false)
  })

  it('ignores missing pending reset targets', () => {
    expect(
      shouldClearPendingSshReset({
        pendingTargetId: null,
        pendingResetIsBusy: false,
        connectionStatus: 'connecting'
      })
    ).toBe(false)
  })
})
