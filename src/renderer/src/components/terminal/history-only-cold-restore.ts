const historyOnlyWorktreeIds = new Set<string>()

/**
 * Keeps archived terminal restoration separate from agent ownership. The panes
 * may mount and replay their saved history, but Claude/Codex resume commands
 * remain blocked until an explicit ownership migration releases the gate.
 */
export function gateHistoryOnlyColdRestore(worktreeIds: Iterable<string>): void {
  for (const worktreeId of worktreeIds) {
    if (worktreeId) {
      historyOnlyWorktreeIds.add(worktreeId)
    }
  }
}

export function isHistoryOnlyColdRestoreWorktree(worktreeId: string | undefined): boolean {
  return Boolean(worktreeId && historyOnlyWorktreeIds.has(worktreeId))
}

export function releaseHistoryOnlyColdRestore(worktreeId: string): void {
  historyOnlyWorktreeIds.delete(worktreeId)
}

export function resetHistoryOnlyColdRestoreForTests(): void {
  historyOnlyWorktreeIds.clear()
}
