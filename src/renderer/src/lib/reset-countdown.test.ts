import { describe, expect, it } from 'vitest'
import { formatResetCountdown, formatResetDuration } from './reset-countdown'

const HOUR = 60 * 60_000
const MINUTE = 60_000

describe('formatResetDuration', () => {
  it('returns "now" for zero or negative durations', () => {
    expect(formatResetDuration(0)).toBe('now')
    expect(formatResetDuration(-1)).toBe('now')
  })

  it('returns "<1m" for sub-minute positive durations, not "0m"', () => {
    // Why: the 30s tick makes the final minute before reset reachable; "0m"
    // would read as already-reset.
    expect(formatResetDuration(1)).toBe('<1m')
    expect(formatResetDuration(30_000)).toBe('<1m')
    expect(formatResetDuration(59_999)).toBe('<1m')
  })

  it('returns whole minutes under an hour', () => {
    expect(formatResetDuration(45 * MINUTE)).toBe('45m')
    expect(formatResetDuration(MINUTE)).toBe('1m')
  })

  it('floors partial minutes', () => {
    expect(formatResetDuration(90_000)).toBe('1m')
  })

  it('shows hours and minutes — the issue #5399 session case', () => {
    // Session window with 3h 31m left should read "3h 31m", not a fixed "5h".
    expect(formatResetDuration(3 * HOUR + 31 * MINUTE)).toBe('3h 31m')
    expect(formatResetDuration(HOUR + 20 * MINUTE)).toBe('1h 20m')
  })

  it('omits minutes on a whole hour', () => {
    expect(formatResetDuration(5 * HOUR)).toBe('5h')
  })

  it('shows days and hours past 24h (weekly windows)', () => {
    expect(formatResetDuration(2 * 24 * HOUR + 4 * HOUR)).toBe('2d 4h')
    expect(formatResetDuration(3 * 24 * HOUR)).toBe('3d')
  })
})

describe('formatResetCountdown', () => {
  it('prefixes "Resets in" for positive durations', () => {
    expect(formatResetCountdown(3 * HOUR + 31 * MINUTE)).toBe('Resets in 3h 31m')
  })

  it('reads "Resets in <1m" in the final minute', () => {
    expect(formatResetCountdown(30_000)).toBe('Resets in <1m')
  })

  it('reads "Resets now" once elapsed', () => {
    expect(formatResetCountdown(0)).toBe('Resets now')
    expect(formatResetCountdown(-1)).toBe('Resets now')
  })
})
