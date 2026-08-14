import { afterEach, describe, expect, it } from 'vitest'
import {
  collectHistoryOnlyColdRestoreMounts,
  gateHistoryOnlyColdRestore,
  isHistoryOnlyColdRestoreWorktree,
  releaseHistoryOnlyColdRestore,
  retainHistoryOnlyColdRestoreWorktrees,
  resetHistoryOnlyColdRestoreForTests
} from './history-only-cold-restore'

describe('history-only cold restore gate', () => {
  afterEach(resetHistoryOnlyColdRestoreForTests)

  it('blocks only explicitly restored worktrees until ownership is released', () => {
    gateHistoryOnlyColdRestore(['worktree:a', '', 'worktree:b'])

    expect(isHistoryOnlyColdRestoreWorktree('worktree:a')).toBe(true)
    expect(isHistoryOnlyColdRestoreWorktree('worktree:b')).toBe(true)
    expect(isHistoryOnlyColdRestoreWorktree('worktree:c')).toBe(false)

    releaseHistoryOnlyColdRestore('worktree:a')
    expect(isHistoryOnlyColdRestoreWorktree('worktree:a')).toBe(false)
    expect(isHistoryOnlyColdRestoreWorktree('worktree:b')).toBe(true)
  })

  it('collects unique hidden tabs while excluding deleted and disconnected SSH worktrees', () => {
    expect(
      collectHistoryOnlyColdRestoreMounts({
        tabsByWorktree: {
          active: [{ id: 'active-tab' }],
          local: [{ id: 'tab-a' }, { id: 'tab-a' }, { id: 'tab-b' }],
          deleted: [{ id: 'tab-deleted' }],
          ssh: [{ id: 'tab-ssh' }]
        },
        activeWorktreeId: 'active',
        repoIdByWorktreeId: new Map([
          ['active', 'repo-local'],
          ['local', 'repo-local'],
          ['ssh', 'repo-ssh']
        ]),
        connectionIdByRepoId: new Map([['repo-ssh', 'ssh-target']]),
        connectedSshTargetIds: new Set()
      })
    ).toEqual([{ worktreeId: 'local', tabIds: ['tab-a', 'tab-b'] }])
  })

  it('removes gated archive worktrees from terminal parking verdicts', () => {
    gateHistoryOnlyColdRestore(['worktree:archive'])
    const parked = new Set(['worktree:archive', 'worktree:normal'])

    retainHistoryOnlyColdRestoreWorktrees(parked)

    expect([...parked]).toEqual(['worktree:normal'])
  })
})
