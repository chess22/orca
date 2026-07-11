import { describe, expect, it } from 'vitest'
import { computeTerminalLeafShare, resolveNewPaneRatioFromSizePx } from './terminal-layout-share'
import type { TerminalPaneLayoutNode } from '../../shared/types'

const leaf = (leafId: string): TerminalPaneLayoutNode => ({ type: 'leaf', leafId })

describe('computeTerminalLeafShare', () => {
  it('returns full share for a single leaf', () => {
    expect(computeTerminalLeafShare(leaf('a'), 'a')).toEqual({ widthRatio: 1, heightRatio: 1 })
  })

  it('returns null when the leaf is absent', () => {
    expect(computeTerminalLeafShare(leaf('a'), 'b')).toBeNull()
    expect(computeTerminalLeafShare(null, 'a')).toBeNull()
  })

  it('divides width on vertical splits using the stored ratio', () => {
    const root: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.7,
      first: leaf('a'),
      second: leaf('b')
    }
    expect(computeTerminalLeafShare(root, 'a')).toEqual({ widthRatio: 0.7, heightRatio: 1 })
    expect(computeTerminalLeafShare(root, 'b')).toEqual({
      widthRatio: expect.closeTo(0.3),
      heightRatio: 1
    })
  })

  it('defaults to an equal split when ratio is absent', () => {
    const root: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: leaf('a'),
      second: leaf('b')
    }
    expect(computeTerminalLeafShare(root, 'b')).toEqual({ widthRatio: 1, heightRatio: 0.5 })
  })

  it('multiplies shares across nested splits on the same axis', () => {
    const root: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: leaf('a'),
      second: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.4,
        first: leaf('b'),
        second: leaf('c')
      }
    }
    expect(computeTerminalLeafShare(root, 'b')).toEqual({
      widthRatio: expect.closeTo(0.2),
      heightRatio: 1
    })
    expect(computeTerminalLeafShare(root, 'c')).toEqual({
      widthRatio: expect.closeTo(0.3),
      heightRatio: 1
    })
  })

  it('tracks each axis independently in mixed-direction trees', () => {
    const root: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.6,
      first: leaf('a'),
      second: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.25,
        first: leaf('b'),
        second: leaf('c')
      }
    }
    expect(computeTerminalLeafShare(root, 'a')).toEqual({ widthRatio: 0.6, heightRatio: 1 })
    expect(computeTerminalLeafShare(root, 'b')).toEqual({
      widthRatio: expect.closeTo(0.4),
      heightRatio: 0.25
    })
    expect(computeTerminalLeafShare(root, 'c')).toEqual({
      widthRatio: expect.closeTo(0.4),
      heightRatio: 0.75
    })
  })
})

describe('resolveNewPaneRatioFromSizePx', () => {
  it('returns undefined when sizePx or the total axis size is missing', () => {
    expect(resolveNewPaneRatioFromSizePx(undefined, 400)).toBeUndefined()
    expect(resolveNewPaneRatioFromSizePx(100, undefined)).toBeUndefined()
    expect(resolveNewPaneRatioFromSizePx(0, 400)).toBeUndefined()
    expect(resolveNewPaneRatioFromSizePx(100, 0)).toBeUndefined()
  })

  it('computes the new pane share from px against the source leaf size', () => {
    expect(resolveNewPaneRatioFromSizePx(100, 400)).toBeCloseTo(0.25)
  })

  it('clamps out-of-range requests to the minimum usable sliver', () => {
    expect(resolveNewPaneRatioFromSizePx(390, 400)).toBeCloseTo(0.95)
    expect(resolveNewPaneRatioFromSizePx(10, 400)).toBeCloseTo(0.05)
  })
})
