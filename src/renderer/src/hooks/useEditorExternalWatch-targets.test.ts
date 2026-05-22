import { describe, expect, it, vi } from 'vitest'
import {
  getEditorExternalWatchTargets,
  type EditorExternalWatchTargetState
} from './useEditorExternalWatch'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: vi.fn()
  }
}))
vi.mock('@/components/editor/editor-autosave', () => ({
  notifyEditorExternalFileChange: vi.fn(),
  getOpenFilesForExternalFileChange: vi.fn(() => [])
}))

describe('getEditorExternalWatchTargets', () => {
  const repo = {
    id: 'repo-1',
    path: '/repo',
    kind: 'git',
    connectionId: null
  } as EditorExternalWatchTargetState['repos'][number]
  const worktree = {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/repo'
  } as EditorExternalWatchTargetState['worktreesByRepo'][string][number]

  const makeState = (isDirty: boolean): EditorExternalWatchTargetState => ({
    openFiles: [
      {
        id: 'file-1',
        worktreeId: 'wt-1',
        filePath: '/repo/notes.md',
        relativePath: 'notes.md',
        language: 'markdown',
        mode: 'edit',
        isDirty
      }
    ],
    worktreesByRepo: { 'repo-1': [worktree] },
    repos: [repo],
    activeWorktreeId: null,
    settings: null
  })

  it('preserves the snapshot when open-file metadata changes without changing watched roots', () => {
    const first = getEditorExternalWatchTargets(makeState(false))
    const second = getEditorExternalWatchTargets(makeState(true))

    expect(second).toBe(first)
    expect(second.targets).toEqual([
      {
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        connectionId: undefined,
        runtimeEnvironmentId: undefined
      }
    ])
  })
})
