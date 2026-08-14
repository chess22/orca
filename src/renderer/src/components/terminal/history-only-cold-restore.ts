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

export function shouldConnectColdRestorePanePty(worktreeId: string | undefined): boolean {
  return !isHistoryOnlyColdRestoreWorktree(worktreeId)
}

export function releaseHistoryOnlyColdRestore(worktreeId: string): void {
  historyOnlyWorktreeIds.delete(worktreeId)
}

/** History-only archive panes must stay mounted; parking would destroy the
 * freshly materialized PTYs and leave their UI history transient. */
export function retainHistoryOnlyColdRestoreWorktrees(worktreeIds: Set<string>): void {
  for (const worktreeId of historyOnlyWorktreeIds) {
    worktreeIds.delete(worktreeId)
  }
}

export function resetHistoryOnlyColdRestoreForTests(): void {
  historyOnlyWorktreeIds.clear()
}
