import type { IDisposable, IParser, Terminal } from '@xterm/xterm'
export {
  DEFAULT_DA1_RESPONSE,
  CONPTY_DA1_RESPONSE,
  sendTerminalOscColorQueryReplies,
  installTerminalCapabilityReplyHandlers
} from '../../../../shared/terminal-capability-replies'

function getTerminalScreenElement(
  terminal: Pick<Terminal, 'element'>
): Pick<HTMLElement, 'getBoundingClientRect'> | null {
  if (typeof terminal.element?.querySelector !== 'function') {
    return null
  }
  return terminal.element.querySelector('.xterm-screen') ?? null
}

function measureCellPixels(
  terminal: Pick<Terminal, 'cols' | 'rows' | 'element'>
): { width: number; height: number } | null {
  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return null
  }
  const rect = getTerminalScreenElement(terminal)?.getBoundingClientRect()
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    return null
  }
  return {
    width: Math.max(1, Math.round(rect.width / terminal.cols)),
    height: Math.max(1, Math.round(rect.height / terminal.rows))
  }
}

export function createTerminalPixelSizeQueryResponder(
  terminal: Pick<Terminal, 'cols' | 'rows' | 'element'>,
  sendInput: (data: string) => boolean | void
): (data: string) => void {
  let pending = ''
  const respond = (reportsWindowPixels: boolean): void => {
    const cell = measureCellPixels(terminal)
    if (!cell) {
      return
    }
    const width = cell.width * (reportsWindowPixels ? terminal.cols : 1)
    const height = cell.height * (reportsWindowPixels ? terminal.rows : 1)
    sendInput(`\x1b[${reportsWindowPixels ? 4 : 6};${height};${width}t`)
  }
  return (data) => {
    const input = pending + data
    pending = input.endsWith('\x1b') || input.endsWith('\x1b[') ? input.slice(-2) : ''
    let offset = 0
    while (offset < input.length) {
      const queryIndex = input.indexOf('\x1b[', offset)
      if (queryIndex === -1) {
        break
      }
      const query = input.slice(queryIndex, queryIndex + 5)
      if (query === '\x1b[14t') {
        respond(true)
        offset = queryIndex + 5
        continue
      }
      if (query === '\x1b[16t') {
        respond(false)
        offset = queryIndex + 5
        continue
      }
      offset = queryIndex + 2
    }
  }
}

// Why: kept for the file's original call-site type — installTerminalCapabilityReplyHandlers
// (re-exported above) accepts the narrower shared CapabilityReplyParser/Terminal shapes,
// but callers in this directory still pass real xterm.js IParser/Terminal instances.
export type { IDisposable, IParser, Terminal }
