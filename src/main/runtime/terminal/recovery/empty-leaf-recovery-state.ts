import type { TerminalEmptyLeafRecoveryRequest } from '../../../../shared/terminal-empty-leaf-recovery'

export type RuntimeEmptyLeafRecoveryState = {
  layoutEpoch: number
  terminal: string
  worktreeId: string
  tabId: string
  leafId: string
  ptyId: string
  ptyGeneration: number
  retiredIncarnationId: string
  persistedBindingVersion: number
  tombstoneId: string
  leafEmpty: boolean
  liveIncarnationId: string | null | undefined
  agentOwnerCount: number | null
  recoveryOwnerId: string | null
}

export function runtimeGapRefusal(
  request: TerminalEmptyLeafRecoveryRequest,
  state: RuntimeEmptyLeafRecoveryState | null
): string | null {
  const surfaceRefusal = runtimeSurfaceRefusal(request, state)
  if (surfaceRefusal || !state) {
    return surfaceRefusal
  }
  if (state.liveIncarnationId === undefined) {
    return 'liveness_unverifiable'
  }
  if (state.liveIncarnationId !== null) {
    return 'terminal_live'
  }
  if (state.agentOwnerCount === null) {
    return 'agent_owner_unverifiable'
  }
  if (state.agentOwnerCount !== 0) {
    return 'agent_owned'
  }
  if (state.recoveryOwnerId !== null) {
    return 'recovery_owned'
  }
  return null
}

export function runtimeReplacementRefusal(
  request: TerminalEmptyLeafRecoveryRequest,
  state: RuntimeEmptyLeafRecoveryState | null
): string | null {
  const surfaceRefusal = runtimeSurfaceRefusal(request, state)
  if (surfaceRefusal || !state) {
    return surfaceRefusal
  }
  // The provider owns the replacement until the persisted binding is committed and
  // registerPty publishes it. Seeing it as live in runtime state before publication
  // would itself mean another path raced this recovery.
  if (state.liveIncarnationId !== null) {
    return state.liveIncarnationId === undefined ? 'liveness_unverifiable' : 'terminal_live'
  }
  if (state.agentOwnerCount === null) {
    return 'agent_owner_unverifiable'
  }
  if (state.agentOwnerCount !== 0) {
    return 'agent_owned'
  }
  if (state.recoveryOwnerId !== null && state.recoveryOwnerId !== request.recoveryId) {
    return 'recovery_owned'
  }
  return null
}

function runtimeSurfaceRefusal(
  request: TerminalEmptyLeafRecoveryRequest,
  state: RuntimeEmptyLeafRecoveryState | null
): string | null {
  if (!state) {
    return 'empty_leaf_unverifiable'
  }
  return state.layoutEpoch !== request.expected.layoutEpoch ||
    state.terminal !== request.terminal ||
    state.worktreeId !== request.expected.worktreeId ||
    state.tabId !== request.expected.tabId ||
    state.leafId !== request.expected.leafId ||
    state.ptyId !== request.expected.ptyId ||
    state.ptyGeneration !== request.expected.ptyGeneration ||
    state.retiredIncarnationId !== request.expected.retiredIncarnationId ||
    state.persistedBindingVersion !== request.expected.persistedBindingVersion ||
    state.tombstoneId !== request.expected.tombstoneId ||
    !state.leafEmpty
    ? 'empty_leaf_identity_changed'
    : null
}
