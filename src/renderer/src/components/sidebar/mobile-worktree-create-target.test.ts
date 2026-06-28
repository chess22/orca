import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  chooseMobileWorktreeCreateTarget,
  shouldShowMobileWorktreeCreateFab
} from './mobile-worktree-create-target'

function readWorktreeListSource(): string {
  return readFileSync(fileURLToPath(new URL('./WorktreeList.tsx', import.meta.url)), 'utf8')
}

describe('chooseMobileWorktreeCreateTarget', () => {
  it('prefers the active repo when it is in the sidebar repo model', () => {
    expect(
      chooseMobileWorktreeCreateTarget({
        activeRepoId: 'repo-2',
        activeWorktreeId: 'wt-1',
        eligibleRepoIds: new Set(['repo-1', 'repo-2']),
        worktreeById: new Map([['wt-1', { repoId: 'repo-1' }]])
      })
    ).toBe('repo-2')
  })

  it('falls back to the active worktree owner without relying on mounted rows', () => {
    expect(
      chooseMobileWorktreeCreateTarget({
        activeRepoId: null,
        activeWorktreeId: 'offscreen-worktree',
        eligibleRepoIds: new Set(['repo-offscreen']),
        worktreeById: new Map([['offscreen-worktree', { repoId: 'repo-offscreen' }]])
      })
    ).toBe('repo-offscreen')
  })

  it('returns no preselected repo when context is missing or filtered away', () => {
    expect(
      chooseMobileWorktreeCreateTarget({
        activeRepoId: 'filtered-repo',
        activeWorktreeId: 'wt-filtered',
        eligibleRepoIds: new Set(['visible-repo']),
        worktreeById: new Map([['wt-filtered', { repoId: 'filtered-repo' }]])
      })
    ).toBeNull()
  })
})

describe('shouldShowMobileWorktreeCreateFab', () => {
  it('hides the FAB when there are no repo-backed create targets', () => {
    expect(shouldShowMobileWorktreeCreateFab(0)).toBe(false)
  })

  it('shows the FAB when at least one repo-backed create target is available', () => {
    expect(shouldShowMobileWorktreeCreateFab(1)).toBe(true)
  })
})

describe('mobile worktree add FAB markup contract', () => {
  it('renders the FAB as a touch-only overlay with bottom scroll room', () => {
    const source = readWorktreeListSource()

    expect(source).toContain('data-mobile-worktree-add-fab=""')
    expect(source).toContain('data-contextual-tour-target="workspace-create-control"')
    expect(source).toContain('worktree-mobile-create-fab')
    expect(source).toContain('bottom-[calc(1rem+env(safe-area-inset-bottom))]')
    expect(source).toContain('worktree-mobile-create-scroll-padding')
  })

  it('hides only the repo header create button on touch pointers', () => {
    const source = readWorktreeListSource()

    expect(source).toContain(
      "const REPO_HEADER_CREATE_TOUCH_HIDE_CLASS = 'worktree-create-touch-hidden'"
    )
    expect(source).toContain(
      'REPO_HEADER_ACTION_BUTTON_CLASS,\n                                  REPO_HEADER_CREATE_TOUCH_HIDE_CLASS'
    )
    expect(source).toContain('Project actions')
    expect(source).toContain('handleCreateFolderWorkspace(row.projectGroup)')
  })
})
