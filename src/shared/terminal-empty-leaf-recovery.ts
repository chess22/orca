export type TerminalEmptyLeafRecoveryRequest = {
  originalMutationId: string
  recoveryId: string
  terminal: string
  expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    ptyGeneration: number
    retiredIncarnationId: string
    layoutEpoch: number
    persistedBindingVersion: number
    tombstoneId: string
  }
  replacement: {
    command: string
    cwd: string
    cols: number
    rows: number
    env?: Record<string, string>
    envToDelete?: string[]
  }
}

export type TerminalEmptyLeafRecoveryResult =
  | {
      outcome: 'recovered'
      recoveryId: string
      ptyId: string
      incarnationId: string
      processId?: number | null
      replayed?: true
    }
  | {
      outcome: 'precondition_failed' | 'failed_before_mutation'
      recoveryId: string
      reason: string
      replayed?: true
    }
  | {
      outcome: 'partial' | 'indeterminate'
      recoveryId: string
      reason: string
      replacementStarted: boolean
      replacementPublished: boolean
      ptyId?: string
      incarnationId?: string
      replayed?: true
    }

export function terminalEmptyLeafTombstoneId(ptyId: string, retiredIncarnationId: string): string {
  return JSON.stringify([ptyId, retiredIncarnationId])
}

export function terminalEmptyLeafRecoveryFingerprint(
  request: TerminalEmptyLeafRecoveryRequest
): string {
  return JSON.stringify([
    request.originalMutationId,
    request.terminal,
    request.expected.worktreeId,
    request.expected.tabId,
    request.expected.leafId,
    request.expected.ptyId,
    request.expected.ptyGeneration,
    request.expected.retiredIncarnationId,
    request.expected.layoutEpoch,
    request.expected.persistedBindingVersion,
    request.expected.tombstoneId,
    request.replacement.command,
    request.replacement.cwd,
    request.replacement.cols,
    request.replacement.rows,
    request.replacement.env
      ? Object.entries(request.replacement.env).sort(([a], [b]) => a.localeCompare(b))
      : null,
    request.replacement.envToDelete ? [...request.replacement.envToDelete].sort() : null
  ])
}

export function invalidTerminalEmptyLeafRecoveryRequest(
  request: TerminalEmptyLeafRecoveryRequest
): string | null {
  if (
    !request.recoveryId ||
    !request.originalMutationId ||
    request.recoveryId === request.originalMutationId
  ) {
    return 'recovery_identity_invalid'
  }
  if (
    !request.terminal ||
    !request.expected.worktreeId ||
    !request.expected.tabId ||
    !request.expected.leafId ||
    !request.expected.ptyId ||
    !request.expected.retiredIncarnationId ||
    !request.expected.tombstoneId
  ) {
    return 'recovery_identity_incomplete'
  }
  if (
    !Number.isSafeInteger(request.expected.ptyGeneration) ||
    request.expected.ptyGeneration < 0 ||
    !Number.isSafeInteger(request.expected.layoutEpoch) ||
    request.expected.layoutEpoch < 0 ||
    !Number.isSafeInteger(request.expected.persistedBindingVersion) ||
    request.expected.persistedBindingVersion < 0
  ) {
    return 'recovery_fence_invalid'
  }
  if (
    !request.replacement.command ||
    !request.replacement.cwd ||
    !Number.isSafeInteger(request.replacement.cols) ||
    request.replacement.cols < 1 ||
    !Number.isSafeInteger(request.replacement.rows) ||
    request.replacement.rows < 1
  ) {
    return 'replacement_incomplete'
  }
  return null
}

export function isTerminalEmptyLeafRecoveryResult(
  value: unknown
): value is TerminalEmptyLeafRecoveryResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const result = value as Partial<TerminalEmptyLeafRecoveryResult>
  if (typeof result.recoveryId !== 'string' || typeof result.outcome !== 'string') {
    return false
  }
  if (result.outcome === 'recovered') {
    return typeof result.ptyId === 'string' && typeof result.incarnationId === 'string'
  }
  if (result.outcome === 'precondition_failed' || result.outcome === 'failed_before_mutation') {
    return typeof result.reason === 'string'
  }
  return (
    (result.outcome === 'partial' || result.outcome === 'indeterminate') &&
    typeof result.reason === 'string' &&
    typeof result.replacementStarted === 'boolean' &&
    typeof result.replacementPublished === 'boolean'
  )
}
