export type HistoryOnlyColdRestoreMount = {
  worktreeId: string
  tabIds: string[]
}

export function collectHistoryOnlyColdRestoreMounts(args: {
  tabsByWorktree: Record<string, readonly { id: string }[]>
  activeWorktreeId: string | null
  activeTabId: string | null
  repoIdByWorktreeId: ReadonlyMap<string, string>
  connectionIdByRepoId: ReadonlyMap<string, string>
  connectedSshTargetIds: ReadonlySet<string>
}): HistoryOnlyColdRestoreMount[] {
  const mounts: HistoryOnlyColdRestoreMount[] = []
  for (const [worktreeId, tabs] of Object.entries(args.tabsByWorktree)) {
    if (!worktreeId || tabs.length === 0) {
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
    const tabIds = tabs
      .map((tab) => tab.id)
      .filter(
        (tabId) =>
          Boolean(tabId) && (worktreeId !== args.activeWorktreeId || tabId !== args.activeTabId)
      )
    mounts.push({ worktreeId, tabIds: [...new Set(tabIds)] })
  }
  return mounts.filter((mount) => mount.tabIds.length > 0)
}
