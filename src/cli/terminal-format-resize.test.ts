import { describe, expect, it } from 'vitest'
import { formatTerminalResize } from './terminal-format'

describe('formatTerminalResize', () => {
  it('prints the resulting pane geometry', () => {
    expect(
      formatTerminalResize({
        resize: {
          handle: 'term_1',
          tabId: 'tab-1',
          leafId: 'leaf-1',
          pane: { widthPx: 360, heightPx: 480, widthRatio: 0.3, heightRatio: 1 }
        }
      })
    ).toContain('pane: 360x480 px, width 30% / height 100% of tab')
  })
})
