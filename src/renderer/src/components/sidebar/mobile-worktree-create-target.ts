export type MobileWorktreeCreateTargetWorktree = {
  repoId?: string | null
}

export function chooseMobileWorktreeCreateTarget(args: {
  activeRepoId: string | null
  activeWorktreeId: string | null
  eligibleRepoIds: ReadonlySet<string>
  worktreeById: ReadonlyMap<string, MobileWorktreeCreateTargetWorktree>
}): string | null {
  if (args.activeRepoId && args.eligibleRepoIds.has(args.activeRepoId)) {
    return args.activeRepoId
  }

  const activeWorktreeRepoId = args.activeWorktreeId
    ? args.worktreeById.get(args.activeWorktreeId)?.repoId
    : null
  if (activeWorktreeRepoId && args.eligibleRepoIds.has(activeWorktreeRepoId)) {
    return activeWorktreeRepoId
  }

  return null
}

export function shouldShowMobileWorktreeCreateFab(eligibleRepoCount: number): boolean {
  return eligibleRepoCount > 0
}
