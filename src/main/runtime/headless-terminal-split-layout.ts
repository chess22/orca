import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode } from '../../shared/types'

/**
 * Insert a newly split-off leaf into a terminal tab's persisted layout tree.
 *
 * Why: a headless ("Orca server") split only updated the live session snapshot,
 * never the persisted workspace-session layout, so a later snapshot rebuild
 * re-derived from the stale single-leaf layout and collapsed the split. This
 * builds the durable post-split layout so the split survives rebuilds.
 */
export function buildHeadlessTerminalSplitLayout(
  existing: TerminalLayoutSnapshot | undefined,
  args: {
    leafId: string
    ptyId: string
    splitFromLeafId: string
    direction: 'horizontal' | 'vertical'
    /** Requested share for the NEW leaf (0–1); the tree stores the first-child share. */
    newLeafRatio?: number
  }
): TerminalLayoutSnapshot {
  const existingRoot: TerminalPaneLayoutNode = existing?.root ?? {
    type: 'leaf',
    leafId: args.splitFromLeafId
  }
  const firstRatio =
    args.newLeafRatio !== undefined && args.newLeafRatio > 0 && args.newLeafRatio < 1
      ? Math.round((1 - args.newLeafRatio) * 1000) / 1000
      : undefined
  const insertSplit = (node: TerminalPaneLayoutNode): TerminalPaneLayoutNode => {
    if (node.type === 'leaf') {
      if (node.leafId !== args.splitFromLeafId) {
        return node
      }
      return {
        type: 'split',
        direction: args.direction,
        first: node,
        second: { type: 'leaf', leafId: args.leafId },
        ...(firstRatio !== undefined ? { ratio: firstRatio } : {})
      }
    }
    return { ...node, first: insertSplit(node.first), second: insertSplit(node.second) }
  }
  return {
    ...existing,
    root: insertSplit(existingRoot),
    activeLeafId: args.leafId,
    expandedLeafId: existing?.expandedLeafId ?? null,
    ptyIdsByLeafId: {
      ...existing?.ptyIdsByLeafId,
      [args.leafId]: args.ptyId
    }
  }
}

/** Count the leaves in a layout tree (a split has ≥2; a single pane has 1). */
export function countTerminalLayoutLeaves(node: TerminalPaneLayoutNode | null | undefined): number {
  if (!node) {
    return 0
  }
  if (node.type === 'leaf') {
    return 1
  }
  return countTerminalLayoutLeaves(node.first) + countTerminalLayoutLeaves(node.second)
}
