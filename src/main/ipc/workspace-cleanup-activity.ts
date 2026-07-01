import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { Repo, Worktree } from '../../shared/types'

type StatPath = (targetPath: string) => Promise<{ mtimeMs: number }>

export async function resolveWorkspaceCleanupActivityWorktree(
  repo: Repo,
  worktree: Worktree,
  statPath: StatPath = statLocalPath
): Promise<Worktree> {
  const activityAt = await resolveWorkspaceCleanupActivityAt(repo, worktree, statPath)
  if (activityAt <= worktree.lastActivityAt) {
    return worktree
  }
  return { ...worktree, lastActivityAt: activityAt }
}

async function statLocalPath(targetPath: string): Promise<{ mtimeMs: number }> {
  const stats = await lstat(targetPath)
  return { mtimeMs: Number(stats.mtimeMs) }
}

async function resolveWorkspaceCleanupActivityAt(
  repo: Repo,
  worktree: Worktree,
  statPath: StatPath
): Promise<number> {
  const persistedActivityAt = Number.isFinite(worktree.lastActivityAt) ? worktree.lastActivityAt : 0
  const createdAt = Number.isFinite(worktree.createdAt) ? (worktree.createdAt ?? 0) : 0
  if (repo.connectionId) {
    return Math.max(persistedActivityAt, createdAt)
  }

  const filesystemActivityAt = await getNewestLocalWorktreeStatMtime(worktree.path, statPath)
  return Math.max(persistedActivityAt, createdAt, filesystemActivityAt)
}

async function getNewestLocalWorktreeStatMtime(
  worktreePath: string,
  statPath: StatPath
): Promise<number> {
  const mtimes = await Promise.all([
    readMtime(worktreePath, statPath),
    readMtime(path.join(worktreePath, '.git'), statPath)
  ])
  return Math.max(0, ...mtimes)
}

async function readMtime(targetPath: string, statPath: StatPath): Promise<number> {
  try {
    const stats = await statPath(targetPath)
    return Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0
  } catch {
    return 0
  }
}
