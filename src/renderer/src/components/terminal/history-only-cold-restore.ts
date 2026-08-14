const historyOnlyWorktreeIds = new Set<string>()

export type HistoryOnlyColdRestoreMount = {
  worktreeId: string
  tabIds: string[]
}

export function collectHistoryOnlyColdRestoreMounts(args: {
  tabsByWorktree: Record<string, readonly { id: string }[]>
  activeWorktreeId: string | null
  repoIdByWorktreeId: ReadonlyMap<string, string>
  connectionIdByRepoId: ReadonlyMap<string, string>
  connectedSshTargetIds: ReadonlySet<string>
}): HistoryOnlyColdRestoreMount[] {
  const mounts: HistoryOnlyColdRestoreMount[] = []
  for (const [worktreeId, tabs] of Object.entries(args.tabsByWorktree)) {
    if (!worktreeId || worktreeId === args.activeWorktreeId || tabs.length === 0) {
      continue
    }
    const repoId = args.repoIdByWorktreeId.get(worktreeId)
    if (!repoId) {
      continue
    }
    const connectionId = args.connectionIdByRepoId.get(repoId)
    if (connectionId && !args.connectedSshTargetIds.has(connectionId)) {
      continue
    }
    mounts.push({ worktreeId, tabIds: [...new Set(tabs.map((tab) => tab.id).filter(Boolean))] })
  }
  return mounts.filter((mount) => mount.tabIds.length > 0)
}

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
