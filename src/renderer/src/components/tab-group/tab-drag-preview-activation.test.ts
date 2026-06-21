import { describe, expect, it } from 'vitest'
import type { TabDragItemData, TabPaneDropData } from './useTabDragSplit'
import { resolveDragPreviewTabId, resolveSourceGroupRestoreOnDrop } from './tab-drag-preview-target'

function makeDragData(overrides: Partial<TabDragItemData> = {}): TabDragItemData {
  return {
    kind: 'tab',
    worktreeId: 'wt-1',
    groupId: 'group-1',
    unifiedTabId: 'tab-2',
    visibleTabId: 'terminal-2',
    tabType: 'terminal',
    label: 'Tab 2',
    ...overrides
  }
}

function makeOverTab(overrides: Partial<TabDragItemData> = {}): TabDragItemData {
  return makeDragData({
    unifiedTabId: 'tab-3',
    visibleTabId: 'terminal-3',
    label: 'Tab 3',
    ...overrides
  })
}

function makePaneDrop(overrides: Partial<TabPaneDropData> = {}): TabPaneDropData {
  return {
    kind: 'pane-body',
    worktreeId: 'wt-1',
    groupId: 'group-1',
    ...overrides
  }
}

describe('resolveDragPreviewTabId', () => {
  const preDragActiveTabIdByGroup = {
    'group-1': 'tab-1',
    'group-2': 'tab-4'
  }

  it('keeps the pre-drag active tab when nothing is hovered', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: null,
        preDragActiveTabIdByGroup
      })
    ).toEqual({ groupId: 'group-1', tabId: 'tab-1' })
  })

  it('keeps the pre-drag active tab when dragging over another tab', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: makeOverTab(),
        preDragActiveTabIdByGroup
      })
    ).toEqual({ groupId: 'group-1', tabId: 'tab-1' })
  })

  it('restores the pre-drag active tab when hovering the source pane body', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: makePaneDrop(),
        preDragActiveTabIdByGroup
      })
    ).toEqual({ groupId: 'group-1', tabId: 'tab-1' })
  })

  it('keeps the last hovered tab when moving onto the source pane body', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: makePaneDrop(),
        preDragActiveTabIdByGroup,
        lastHoveredTabPreview: { groupId: 'group-1', tabId: 'tab-3' }
      })
    ).toEqual({ groupId: 'group-1', tabId: 'tab-3' })
  })

  it('previews the source tab when not hovering a drop target', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: null,
        preDragActiveTabIdByGroup
      })
    ).toEqual({ groupId: 'group-1', tabId: 'tab-1' })
  })

  it('previews another group active tab when hovering that pane body', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: makePaneDrop({ groupId: 'group-2' }),
        preDragActiveTabIdByGroup
      })
    ).toEqual({ groupId: 'group-2', tabId: 'tab-4' })
  })

  it('ignores hovering the dragged tab itself', () => {
    expect(
      resolveDragPreviewTabId({
        activeDrag: makeDragData(),
        overData: makeDragData(),
        preDragActiveTabIdByGroup
      })
    ).toEqual({ groupId: 'group-1', tabId: 'tab-1' })
  })
})

describe('resolveSourceGroupRestoreOnDrop', () => {
  it('skips source restore for same-group splits that keep preview activation', () => {
    expect(
      resolveSourceGroupRestoreOnDrop(
        {
          kind: 'tab',
          worktreeId: 'wt-1',
          groupId: 'group-1',
          unifiedTabId: 'tab-2',
          visibleTabId: 'tab-2',
          tabType: 'terminal',
          label: 'Tab 2'
        },
        'group-1',
        false
      )
    ).toBeUndefined()
  })

  it('restores source group only for cross-group drops', () => {
    const activeData = {
      kind: 'tab' as const,
      worktreeId: 'wt-1',
      groupId: 'group-1',
      unifiedTabId: 'tab-2',
      visibleTabId: 'tab-2',
      tabType: 'terminal' as const,
      label: 'Tab 2'
    }
    expect(resolveSourceGroupRestoreOnDrop(activeData, 'group-2', false)).toBe(activeData)
  })
})
