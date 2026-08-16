import { describe, expect, it } from 'vitest'
import { formatTerminalShow } from './format'

const shown = {
  handle: 'term_1',
  ptyId: 'pty-1',
  worktreeId: 'wt-1',
  worktreePath: '/repo',
  branch: 'main',
  tabId: 'tab-1',
  leafId: 'leaf-1',
  title: 'Shell',
  connected: true,
  writable: true,
  lastOutputAt: null,
  preview: '',
  paneRuntimeId: 1,
  rendererGraphEpoch: 1
}

describe('formatTerminalShow pane geometry', () => {
  it('prints pane pixel size and layout share when geometry is known', () => {
    const output = formatTerminalShow({
      terminal: {
        ...shown,
        pane: { widthPx: 640, heightPx: 480, widthRatio: 0.333, heightRatio: 1 }
      }
    })
    expect(output).toContain('pane: 640x480 px, width 33.3% / height 100% of tab')
  })

  it('omits the pane line when geometry is unavailable', () => {
    expect(formatTerminalShow({ terminal: shown })).not.toContain('pane:')
  })
})
