import { afterEach, describe, expect, it } from 'vitest'
import {
  gateHistoryOnlyColdRestore,
  isHistoryOnlyColdRestoreWorktree,
  releaseHistoryOnlyColdRestore,
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
})
