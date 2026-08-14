import { describe, expect, it } from 'vitest'
import { collectHistoryOnlyColdRestoreMounts } from './history-only-cold-restore'

describe('history-only cold restore mounts', () => {
  const collectMounts = (
    tabsByWorktree: Record<string, { id: string }[]>,
    activeWorktreeId: string | null = 'active',
    activeTabId: string | null = 'active-tab'
  ) =>
    collectHistoryOnlyColdRestoreMounts({
      tabsByWorktree,
      activeWorktreeId,
      activeTabId,
      repoIdByWorktreeId: new Map([
        ['active', 'repo-local'],
        ['local', 'repo-local'],
        ['ssh', 'repo-ssh']
      ]),
      connectionIdByRepoId: new Map([['repo-ssh', 'ssh-target']]),
      connectedSshTargetIds: new Set()
    })

  it('excludes the active tab while mounting every other unique tab in its worktree', () => {
    expect(
      collectMounts({
        active: [
          { id: 'active-tab' },
          { id: 'background-tab' },
          { id: 'background-tab' },
          { id: 'other-tab' }
        ]
      })
    ).toEqual([{ worktreeId: 'active', tabIds: ['background-tab', 'other-tab'] }])
  })

  it('does not mount an active worktree containing only the active tab', () => {
    expect(collectMounts({ active: [{ id: 'active-tab' }] })).toEqual([])
  })

  it('keeps collecting other worktrees while excluding deleted and disconnected SSH worktrees', () => {
    expect(
      collectMounts({
        active: [{ id: 'active-tab' }],
        local: [{ id: 'tab-a' }, { id: 'tab-a' }, { id: 'tab-b' }],
        deleted: [{ id: 'tab-deleted' }],
        ssh: [{ id: 'tab-ssh' }]
      })
    ).toEqual([{ worktreeId: 'local', tabIds: ['tab-a', 'tab-b'] }])
  })
})
