import { afterEach, describe, expect, it } from 'vitest'
import {
  gateHistoryOnlyColdRestore,
  isHistoryOnlyColdRestoreWorktree,
  releaseHistoryOnlyColdRestore,
  retainHistoryOnlyColdRestoreWorktrees,
  resetHistoryOnlyColdRestoreForTests,
  shouldConnectColdRestorePanePty
} from './history-only-cold-restore'
import { ORIGINAL_ARCHIVE_HISTORY_FIXTURE } from './history-only-cold-restore.fixture'

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

  it('removes gated archive worktrees from terminal parking verdicts', () => {
    gateHistoryOnlyColdRestore(['worktree:archive'])
    const parked = new Set(['worktree:archive', 'worktree:normal'])

    retainHistoryOnlyColdRestoreWorktrees(parked)

    expect([...parked]).toEqual(['worktree:normal'])
  })

  it('keeps the 111-tab/205-pane archive, including 42 active panes, on the no-connect path', () => {
    const fixture = ORIGINAL_ARCHIVE_HISTORY_FIXTURE
    const worktreeIds = fixture.legacyPaneCountsByWorktree.map((_, index) => `worktree:${index}`)
    const tabCount = fixture.legacyPaneCountsByWorktree.reduce(
      (count, paneCounts) => count + paneCounts.length,
      0
    )
    const paneCount = fixture.legacyPaneCountsByWorktree
      .flat()
      .reduce((count, panes) => count + panes, 0)
    const activePaneCount = fixture.legacyPaneCountsByWorktree[fixture.activeWorktreeIndex].reduce(
      (count, panes) => count + panes,
      0
    )
    gateHistoryOnlyColdRestore(worktreeIds)

    expect(tabCount).toBe(111)
    expect(paneCount).toBe(205)
    expect(activePaneCount).toBe(42)
    expect(
      worktreeIds.flatMap((worktreeId, index) =>
        fixture.legacyPaneCountsByWorktree[index].flatMap((paneCount) =>
          Array.from({ length: paneCount }, () => shouldConnectColdRestorePanePty(worktreeId))
        )
      )
    ).toEqual(Array.from({ length: 205 }, () => false))
  })

  it('preserves the archived slot-2 topology for the later window restore stage', () => {
    const slot2 = ORIGINAL_ARCHIVE_HISTORY_FIXTURE.slot2PaneCountsByWorktree
    expect(slot2.flat()).toHaveLength(3)
    expect(slot2.flat().reduce((count, panes) => count + panes, 0)).toBe(6)
  })
})
