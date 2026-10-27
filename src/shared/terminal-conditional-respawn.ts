export type TerminalRespawnReplacement = {
  cols?: number
  rows?: number
  cwd?: string
  command?: string
  env?: Record<string, string>
  envToDelete?: string[]
}

export type TerminalConditionalRespawnRequest = {
  mutationId: string
  terminal: string
  expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    ptyGeneration: number
    incarnationId: string
  }
  replacement: TerminalRespawnReplacement
}

export type TerminalConditionalRespawnResult =
  | {
      outcome: 'respawned'
      mutationId: string
      ptyId: string
      incarnationId: string
      processId?: number | null
      replayed?: true
    }
  | {
      outcome: 'precondition_failed' | 'unsupported' | 'failed_before_mutation'
      mutationId: string
      reason: string
      replayed?: true
    }
  | {
      outcome: 'partial'
      mutationId: string
      reason: string
      oldStopped: boolean
      replacementStarted: boolean
      replacementPublished: boolean
      ptyId?: string
      incarnationId?: string
      replayed?: true
    }
  | {
      outcome: 'indeterminate'
      mutationId: string
      reason: string
      oldStopped?: boolean
      replacementStarted?: boolean
      incarnationId?: string
      replayed?: true
    }

export function isTerminalConditionalRespawnResult(
  value: unknown
): value is TerminalConditionalRespawnResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  // SAFETY: object-ness is checked above; every field is independently narrowed below.
  const record = value as Record<string, unknown>
  if (typeof record.mutationId !== 'string' || typeof record.outcome !== 'string') {
    return false
  }
  if (record.replayed !== undefined && record.replayed !== true) {
    return false
  }
  if (record.outcome === 'respawned') {
    return (
      typeof record.ptyId === 'string' &&
      typeof record.incarnationId === 'string' &&
      (record.processId === undefined ||
        record.processId === null ||
        typeof record.processId === 'number')
    )
  }
  if (
    record.outcome === 'precondition_failed' ||
    record.outcome === 'unsupported' ||
    record.outcome === 'failed_before_mutation'
  ) {
    return typeof record.reason === 'string'
  }
  if (record.outcome === 'partial') {
    if (
      typeof record.reason === 'string' &&
      typeof record.oldStopped === 'boolean' &&
      typeof record.replacementStarted === 'boolean' &&
      typeof record.replacementPublished === 'boolean'
    ) {
      if (record.replacementPublished && !record.replacementStarted) {
        return false
      }
      return record.replacementStarted
        ? typeof record.ptyId === 'string' &&
            record.ptyId.length > 0 &&
            typeof record.incarnationId === 'string' &&
            record.incarnationId.length > 0
        : record.ptyId === undefined && record.incarnationId === undefined
    }
    return false
  }
  return (
    record.outcome === 'indeterminate' &&
    typeof record.reason === 'string' &&
    (record.oldStopped === undefined || typeof record.oldStopped === 'boolean') &&
    (record.replacementStarted === undefined || typeof record.replacementStarted === 'boolean') &&
    (record.incarnationId === undefined || typeof record.incarnationId === 'string')
  )
}
