import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import {
  closeLegacyRelayPane,
  isLegacyRelayBridgedPty
} from '../../../ssh/legacy-relay/legacy-relay-bridge-registry'
import type { PtyRetirementEvidence } from '../../../pty-exit-proof'
import { PtyRetirementWithoutProof } from '../../../pty-exit-proof'
import type { PtyRuntimeControllerDeps } from './controller-deps'

/** Unproved synthetic exit stays unverifiable; rejected incarnation proof publishes nothing for a same-ID respawn. */
export function publishSyntheticExit(
  deps: Pick<PtyRuntimeControllerDeps, 'rememberSyntheticKillExit' | 'sendPtyExitToRenderer'> & {
    runtime?: Pick<OrcaRuntimeService, 'onPtyExit' | 'markPtyLivenessUnverifiable'>
  },
  ptyId: string,
  code: number,
  incarnationId: string | undefined | null,
  evidence: PtyRetirementEvidence
): void {
  if (incarnationId === null) {
    return
  }
  if (evidence instanceof PtyRetirementWithoutProof) {
    deps.runtime?.markPtyLivenessUnverifiable?.(ptyId, evidence.unverifiableReason)
  }
  deps.runtime?.onPtyExit(ptyId, code, incarnationId)
  deps.rememberSyntheticKillExit(ptyId, incarnationId)
  deps.sendPtyExitToRenderer({ id: ptyId, code, ...(incarnationId ? { incarnationId } : {}) })
}

/** Routes an older relay's terminal stop through the bridge that owns it. */
export function stopLegacyRelayBridgedPty(
  ptyId: string,
  connectionId: string | null,
  reversible = false
): Promise<unknown> | null {
  if (!connectionId || !isLegacyRelayBridgedPty(ptyId)) {
    return null
  }
  return reversible
    ? Promise.reject(new Error('legacy_relay_bridged_pty_cannot_sleep'))
    : closeLegacyRelayPane(ptyId)
}
