/**
 * Formats the time remaining until a usage window resets.
 *
 * Shared by the expanded usage popover and the collapsed status-bar badge so
 * both render the same live countdown (e.g. "3h 31m", "45m", "2d 4h") instead
 * of a fixed window-length label.
 */
export function formatResetDuration(ms: number): string {
  if (ms <= 0) {
    return 'now'
  }
  const totalMins = Math.floor(ms / 60_000)
  // Why: sub-minute durations floor to 0, and "0m" reads as already-reset; show
  // "<1m" so the final minute before reset stays distinct from "now" (ms <= 0).
  if (totalMins === 0) {
    return '<1m'
  }
  if (totalMins < 60) {
    return `${totalMins}m`
  }
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export function formatResetCountdown(ms: number): string {
  const duration = formatResetDuration(ms)
  return duration === 'now' ? 'Resets now' : `Resets in ${duration}`
}
