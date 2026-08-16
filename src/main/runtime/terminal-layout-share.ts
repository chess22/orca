import type { TerminalPaneLayoutNode } from '../../shared/types'

export type TerminalLeafShare = {
  /** Fraction of the tab's pane-area width this leaf occupies (0–1). */
  widthRatio: number
  /** Fraction of the tab's pane-area height this leaf occupies (0–1). */
  heightRatio: number
}

// Why: split direction follows the renderer's flex axis — 'vertical' lays
// panes out side-by-side (divides width), 'horizontal' stacks them (divides
// height). See wrapInSplit in pane-tree-ops.ts.
export function computeTerminalLeafShare(
  node: TerminalPaneLayoutNode | null | undefined,
  leafId: string
): TerminalLeafShare | null {
  if (!node) {
    return null
  }
  if (node.type === 'leaf') {
    return node.leafId === leafId ? { widthRatio: 1, heightRatio: 1 } : null
  }
  const firstShare = node.ratio ?? 0.5
  const first = computeTerminalLeafShare(node.first, leafId)
  const child = first ?? computeTerminalLeafShare(node.second, leafId)
  if (!child) {
    return null
  }
  const factor = first ? firstShare : 1 - firstShare
  return node.direction === 'vertical'
    ? { widthRatio: child.widthRatio * factor, heightRatio: child.heightRatio }
    : { widthRatio: child.widthRatio, heightRatio: child.heightRatio * factor }
}
