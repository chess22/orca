import {
  sendTerminalOscColorQueryReplies as sendTerminalOscColorQueryRepliesForColors,
  terminalOscColorQueryReplies,
  terminalOscColorQuerySlotsForBody,
  type TerminalOscColorQueryReplyColors,
  type TerminalOscColorQuerySlot
} from './terminal-osc-color-reply'

export const DEFAULT_DA1_RESPONSE = '\x1b[?1;2c'
export const CONPTY_DA1_RESPONSE = '\x1b[?61;4c'

// Why: portable across the renderer's DOM-backed `@xterm/xterm` Terminal and
// the main process's headless `@xterm/headless` Terminal — both satisfy this
// shape without pulling either package's types into shared code.
export type CapabilityReplyDisposable = { dispose(): void }
export type CapabilityReplyParser = {
  registerCsiHandler(
    id: { final: string },
    handler: (params: (number | number[])[]) => boolean
  ): CapabilityReplyDisposable
  registerOscHandler(ident: number, handler: (data: string) => boolean): CapabilityReplyDisposable
}
export type CapabilityReplyTerminal = {
  options: { theme?: TerminalOscColorQueryReplyColors }
}

type TerminalCapabilityRepliesDeps = {
  terminal: CapabilityReplyTerminal
  parser: CapabilityReplyParser
  sendInput: (data: string) => boolean | void
  isReplaying: () => boolean
  da1Response?: string
  // Why: renderer callers wrap handlers with guardParserHandler (crash-breadcrumb
  // telemetry that only exists in the renderer); this module stays main-process-safe
  // by taking that behavior as an injected hook instead of importing it directly.
  wrapHandler?: <Args extends unknown[]>(
    name: string,
    handler: (...args: Args) => boolean
  ) => (...args: Args) => boolean
}

function isPrimaryDeviceAttributesQuery(params: (number | number[])[]): boolean {
  return params.length === 0 || (params.length === 1 && params[0] === 0)
}

function disposeAll(disposables: CapabilityReplyDisposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose()
  }
}

export function sendTerminalOscColorQueryReplies(
  data: string,
  terminal: CapabilityReplyTerminal,
  sendInput: (data: string) => boolean | void
): boolean {
  return sendTerminalOscColorQueryRepliesForColors(data, terminal.options.theme ?? {}, sendInput)
}

function sendTerminalOscColorQueryRepliesForSlots(
  slots: readonly TerminalOscColorQuerySlot[],
  terminal: CapabilityReplyTerminal,
  sendInput: (data: string) => boolean | void
): boolean {
  const replies = terminalOscColorQueryReplies(terminal.options.theme ?? {}, slots)
  if (!replies) {
    return false
  }
  for (const reply of replies) {
    sendInput(reply)
  }
  return true
}

export function installTerminalCapabilityReplyHandlers(
  deps: TerminalCapabilityRepliesDeps
): CapabilityReplyDisposable {
  const wrap =
    deps.wrapHandler ??
    (<Args extends unknown[]>(_name: string, handler: (...args: Args) => boolean) => handler)
  const disposables = [
    deps.parser.registerCsiHandler(
      { final: 'c' },
      wrap('csi-da1', (params) => {
        if (!isPrimaryDeviceAttributesQuery(params)) {
          return false
        }
        // Why: restored scrollback may contain old DA1 queries; answering those
        // into the fresh shell recreates the stray-input leak this handler fixes.
        if (!deps.isReplaying()) {
          deps.sendInput(deps.da1Response ?? DEFAULT_DA1_RESPONSE)
        }
        return true
      })
    ),
    deps.parser.registerOscHandler(
      10,
      wrap('osc-10-color-query', (data) => {
        const slots = terminalOscColorQuerySlotsForBody(10, data.trim())
        if (!slots) {
          return false
        }
        if (deps.isReplaying()) {
          return true
        }
        return sendTerminalOscColorQueryRepliesForSlots(slots, deps.terminal, deps.sendInput)
      })
    ),
    deps.parser.registerOscHandler(
      11,
      wrap('osc-11-color-query', (data) => {
        const slots = terminalOscColorQuerySlotsForBody(11, data.trim())
        if (!slots) {
          return false
        }
        if (deps.isReplaying()) {
          return true
        }
        return sendTerminalOscColorQueryRepliesForSlots(slots, deps.terminal, deps.sendInput)
      })
    )
  ]

  return {
    dispose: () => disposeAll(disposables)
  }
}
