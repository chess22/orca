import '../daemon/xterm-env-polyfill'
import { Terminal } from '@xterm/headless'
import {
  installTerminalCapabilityReplyHandlers,
  type CapabilityReplyDisposable
} from '../../shared/terminal-capability-replies'

// Why: a mounted renderer pane answers DA1/DSR/OSC terminal-capability queries
// (see headless-emulator.ts's "no onData wiring" comment for why the daemon's
// own state-tracking emulator must not). A daemon PTY with no renderer pane
// ever opened for it — CLI-created background terminals, or any pane a
// restarted window hasn't remounted yet — has no responder at all, so an
// interactive TUI that blocks on one of these replies (Ink commonly queries
// cursor position for layout) hangs forever with no retry/timeout. This gives
// those PTYs a best-effort fallback responder, gated by callers on
// !hasRendererSerializer(ptyId) so a live renderer stays the sole answerer.
type ResponderEntry = {
  terminal: Terminal
  capabilityReplies: CapabilityReplyDisposable
}

export class HeadlessCapabilityQueryResponder {
  private entries = new Map<string, ResponderEntry>()

  constructor(private readonly sendInput: (ptyId: string, data: string) => void) {}

  feed(ptyId: string, data: string, size: { cols: number; rows: number }): Promise<void> {
    const entry = this.getOrCreate(ptyId, size)
    return new Promise((resolve) => entry.terminal.write(data, resolve))
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const entry = this.entries.get(ptyId)
    if (!entry) {
      return
    }
    entry.terminal.resize(Math.max(1, cols), Math.max(1, rows))
  }

  dispose(ptyId: string): void {
    const entry = this.entries.get(ptyId)
    if (!entry) {
      return
    }
    this.entries.delete(ptyId)
    entry.capabilityReplies.dispose()
    entry.terminal.dispose()
  }

  disposeAll(): void {
    for (const ptyId of this.entries.keys()) {
      this.dispose(ptyId)
    }
  }

  private getOrCreate(ptyId: string, size: { cols: number; rows: number }): ResponderEntry {
    const existing = this.entries.get(ptyId)
    if (existing) {
      return existing
    }
    const terminal = new Terminal({
      cols: Math.max(1, size.cols),
      rows: Math.max(1, size.rows),
      allowProposedApi: true,
      logLevel: 'off'
    })
    // Why: xterm's own InputHandler answers DSR/CPR internally once onData is
    // wired — this is exactly the wiring headless-emulator.ts's state-tracking
    // mirror deliberately omits, and exactly what a fallback responder needs.
    terminal.onData((data) => this.sendInput(ptyId, data))
    const capabilityReplies = installTerminalCapabilityReplyHandlers({
      terminal,
      parser: terminal.parser,
      sendInput: (data) => this.sendInput(ptyId, data),
      isReplaying: () => false
    })
    const entry: ResponderEntry = { terminal, capabilityReplies }
    this.entries.set(ptyId, entry)
    return entry
  }
}
