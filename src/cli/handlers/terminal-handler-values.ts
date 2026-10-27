import { getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

// Long terminal waits must outlive the ordinary transport timeout.
export const DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS = 5 * 60 * 1000

export function getRequiredNonNegativeIntegerFlag(
  flags: Map<string, string | boolean>,
  name: string
): number {
  const raw = getRequiredStringFlag(flags, name)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RuntimeClientError('invalid_argument', `--${name} must be a non-negative integer`)
  }
  return value
}
