import { getProviderForPty } from '../provider/registry'
import type {
  TerminalConditionalRespawnResult,
  TerminalRespawnReplacement
} from '../../../../shared/terminal-conditional-respawn'

export async function respawnPtyIfMatch(
  ptyId: string,
  expectedIncarnationId: string,
  mutationId: string,
  replacement: TerminalRespawnReplacement
): Promise<TerminalConditionalRespawnResult> {
  let provider
  try {
    provider = getProviderForPty(ptyId)
  } catch {
    return { outcome: 'unsupported', mutationId, reason: 'provider_owner_unavailable' }
  }
  if (!provider.respawnIfMatch) {
    return { outcome: 'unsupported', mutationId, reason: 'provider' }
  }
  try {
    return await provider.respawnIfMatch(ptyId, expectedIncarnationId, mutationId, replacement)
  } catch {
    return { outcome: 'indeterminate', mutationId, reason: 'provider_response_lost' }
  }
}
