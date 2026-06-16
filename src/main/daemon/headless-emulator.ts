import './xterm-env-polyfill'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { extractLastOscTitle } from '../../shared/agent-detection'
import { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'
import { parseFileUriPath } from './osc7-file-uri'
import type { TerminalSnapshot, TerminalModes } from './types'

export type HeadlessEmulatorOptions = {
  cols: number
  rows: number
  scrollback?: number
  /** Phase-5 model query responder sink (terminal-query-authority.md).
   *  When set, xterm-core auto-replies generated while parsing a write
   *  flagged `forwardQueryReplies` are forwarded here; all other emissions
   *  (seeds, hydration, snapshot replay, unsolicited core pushes) are
   *  discarded. The daemon Session must NEVER pass this — its emulator
   *  stays write-only forever (contract invariant: the daemon never
   *  answers). */
  onQueryReply?: (reply: string) => void
}

export type HeadlessEmulatorWriteOptions = {
  /** Reply ownership captured at ingestion for this exact chunk. Default
   *  false is the main-side replay guard (twin of the renderer's
   *  replay-guard.ts): seed/hydration/snapshot writes never forward. */
  forwardQueryReplies?: boolean
}

export type HeadlessSnapshotOptions = {
  scrollbackRows?: number
}

type TerminalWithSynchronousWrite = Terminal & {
  _core?: {
    writeSync?: (data: string) => void
    // Why: kitty keyboard flags are not on the public IModes; read the core
    // service state the CSI =/>/< u handlers mutate.
    coreService?: {
      kittyKeyboard?: { flags?: number }
    }
  }
}

const DEFAULT_SCROLLBACK = 5000
// Keep in sync with the renderer twin in terminal-conpty-device-attributes.ts
// (main must not import renderer modules).
const CONPTY_DA1_RESPONSE = '\x1b[?61;4c'
const OSC_SCAN_TAIL_LIMIT = 4096

export class HeadlessEmulator {
  private terminal: Terminal
  private serializer: SerializeAddon
  private cwd: string | null = null
  private lastTitle: string | null = null
  private oscScanTail = ''
  private mouseModes = new TerminalMouseModeMirror()
  private disposed = false
  private onQueryReply: ((reply: string) => void) | null
  private conptyDa1OverrideInstalled = false
  // Why: replies must be scoped to the exact write that carried the query.
  // The window opens around the parse of a forward-flagged chunk and closes
  // with it, so seeds/snapshots and unsolicited core emissions (e.g. native
  // 997 pushes from option mutations) can never leak to the PTY.
  private queryReplyForwardingDepth = 0

  constructor(opts: HeadlessEmulatorOptions) {
    this.terminal = new Terminal({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: opts.scrollback ?? DEFAULT_SCROLLBACK,
      allowProposedApi: true,
      logLevel: 'off',
      // Why: parity with the renderer's buildDefaultTerminalOptions — parse
      // CSI =/>/< u pushes so CSI ? u answers with the flags the hidden app
      // actually pushed. Write-only daemon use is unaffected: keyboard state
      // never alters serialization (terminal-query-authority.md §kitty).
      vtExtensions: { kittyKeyboard: true }
    })

    this.serializer = new SerializeAddon()
    this.terminal.loadAddon(this.serializer)

    // Why onData is gated behind onQueryReply: by default this emulator is
    // pure state tracking and MUST NOT respond to terminal query sequences
    // (DA1/DA2, DSR, OSC 10/11/12, DECRPM). The daemon emulator parses data
    // in-process synchronously before `handleSubprocessData` forwards it to
    // the renderer over IPC, so any reply it emitted would land on the
    // shell's stdin ahead of the renderer's xterm reply and win the race —
    // a double-reply with default-xterm values (OSC 11 default-black was
    // the visible casualty). Only main's runtime per-PTY emulators pass a
    // sink, and even then replies flow only for chunks the hidden-delivery
    // gate DROPPED, where the renderer never sees the bytes and main is the
    // single answerer. See docs/reference/terminal-query-authority.md.
    this.onQueryReply = opts.onQueryReply ?? null
    if (this.onQueryReply) {
      this.terminal.onData((reply) => this.emitQueryReply(reply))
    }
  }

  /** Main-side twin of the renderer's terminal-conpty-device-attributes.ts:
   *  ConPTY 1.22+ blocks at spawn waiting for a DA1 reply, and the override
   *  variant (`CSI ?61;4c`) must win. Returning true consumes the query so
   *  xterm core's default `?1;2c` cannot double-reply (custom CSI handlers
   *  run before core's; false falls through). The reply still routes through
   *  the forwarding window, so replayed/seeded bytes never answer. */
  installConptyPrimaryDeviceAttributesOverride(): void {
    // Why idempotent: the spawn mark can land after daemon stream data
    // already created the emulator, so the override is installed both at
    // creation and retrofitted at mark time — never stacked.
    if (this.conptyDa1OverrideInstalled) {
      return
    }
    this.conptyDa1OverrideInstalled = true
    this.terminal.parser.registerCsiHandler({ final: 'c' }, (params) => {
      const isPrimaryQuery = params.length === 0 || (params.length === 1 && params[0] === 0)
      if (!isPrimaryQuery) {
        return false
      }
      this.emitQueryReply(CONPTY_DA1_RESPONSE)
      return true
    })
  }

  private emitQueryReply(reply: string): void {
    if (this.queryReplyForwardingDepth > 0 && this.onQueryReply) {
      this.onQueryReply(reply)
    }
  }

  /** Severs the reply sink at PTY teardown. Queued writeChain links may
   *  still parse after dispose is requested, and daemon respawns reuse
   *  session ids — a late reply must never reach a successor PTY. */
  disableQueryReplyForwarding(): void {
    this.onQueryReply = null
  }

  write(data: string, opts: HeadlessEmulatorWriteOptions = {}): Promise<void> {
    if (this.disposed) {
      return Promise.resolve()
    }

    const forwardQueryReplies = opts.forwardQueryReplies === true
    if (this.tryWriteSync(data, { forwardQueryReplies })) {
      return Promise.resolve()
    }
    this.scanInputForOscState(data)
    // Why the sentinel: xterm parses queued writes asynchronously, so opening
    // the window at enqueue time would leak it over earlier queued unflagged
    // chunks (seed/hydration bytes parsing while depth > 0). Write callbacks
    // fire in FIFO parse order, so a zero-byte write whose callback opens the
    // window brackets the parse of exactly this chunk; the data callback
    // closes it.
    if (forwardQueryReplies) {
      this.terminal.write('', () => {
        this.queryReplyForwardingDepth += 1
      })
    }
    return new Promise<void>((resolve) => {
      this.terminal.write(data, () => {
        if (forwardQueryReplies) {
          this.queryReplyForwardingDepth -= 1
        }
        // Why: snapshots combine serialized xterm state with mirrored mouse
        // modes. Commit the mirror only after xterm has parsed the same bytes.
        this.mouseModes.scan(data)
        resolve()
      })
    })
  }

  /** Synchronous write used by cold-restore log replay, where a snapshot is
   *  taken immediately after the last record and queued async writes would
   *  serialize a half-applied stream. Returns false when xterm's synchronous
   *  write path is unavailable — callers must then abandon the replay. */
  writeSync(data: string): boolean {
    if (this.disposed) {
      return false
    }
    return this.tryWriteSync(data)
  }

  private tryWriteSync(data: string, opts: HeadlessEmulatorWriteOptions = {}): boolean {
    const writeSync = (this.terminal as TerminalWithSynchronousWrite)._core?.writeSync
    if (typeof writeSync !== 'function') {
      return false
    }
    this.scanInputForOscState(data)
    const forwardQueryReplies = opts.forwardQueryReplies === true
    if (forwardQueryReplies) {
      this.queryReplyForwardingDepth += 1
    }
    // Why: hidden renderer restore snapshots are requested immediately after
    // PTY bursts; queued headless writes can snapshot half-cleared TUI rows.
    try {
      writeSync.call((this.terminal as TerminalWithSynchronousWrite)._core, data)
    } finally {
      if (forwardQueryReplies) {
        this.queryReplyForwardingDepth -= 1
      }
    }
    this.mouseModes.scan(data)
    return true
  }

  private scanInputForOscState(data: string): void {
    const oscInput = this.oscScanTail + data
    this.oscScanTail = this.extractOscScanTail(oscInput)
    this.scanOsc7(oscInput)
    const lastTitle = extractLastOscTitle(oscInput)
    if (lastTitle !== null) {
      this.lastTitle = lastTitle
    }
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) {
      return
    }
    this.terminal.resize(cols, rows)
  }

  getSnapshot(opts: HeadlessSnapshotOptions = {}): TerminalSnapshot {
    const modes = this.getModes()
    const snapshotAnsi = this.normalizeSnapshotAnsiForModes(
      this.serializer.serialize({ scrollback: opts.scrollbackRows }),
      modes
    )
    return {
      snapshotAnsi,
      scrollbackAnsi: '',
      rehydrateSequences: this.buildRehydrateSequences(modes),
      cwd: this.cwd,
      modes,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      scrollbackLines: this.terminal.buffer.normal.length - this.terminal.rows,
      lastTitle: this.lastTitle ?? undefined
    }
  }

  get isAlternateScreen(): boolean {
    return this.terminal.buffer.active.type === 'alternate'
  }

  getVisibleLines(): string[] {
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    for (let row = buffer.viewportY; row < buffer.viewportY + this.terminal.rows; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return lines
  }

  getCwd(): string | null {
    return this.cwd
  }

  setCwd(cwd: string | null): void {
    this.cwd = cwd
  }

  setLastTitle(title: string): void {
    this.lastTitle = title
  }

  clearScrollback(): void {
    this.terminal.clear()
  }

  dispose(): void {
    this.disposed = true
    this.terminal.dispose()
  }

  private scanOsc7(data: string): void {
    // OSC-7 format: ESC ] 7 ; <uri> BEL  or  ESC ] 7 ; <uri> ST
    // BEL = \x07, ST = ESC \
    // oxlint-disable-next-line no-control-regex -- terminal escape sequences require control chars
    const osc7Re = /\x1b\]7;([^\x07\x1b]*?)(?:\x07|\x1b\\)/g
    let match: RegExpExecArray | null
    while ((match = osc7Re.exec(data)) !== null) {
      this.parseOsc7Uri(match[1])
    }
  }

  private extractOscScanTail(input: string): string {
    const lastOsc = input.lastIndexOf('\x1b]')
    const lastEscape = input.endsWith('\x1b') ? input.length - 1 : -1
    const start = Math.max(lastOsc, lastEscape)
    if (start === -1) {
      return ''
    }
    const suffix = input.slice(start)
    if (suffix.includes('\x07') || suffix.includes('\x1b\\')) {
      return ''
    }
    return suffix.slice(-OSC_SCAN_TAIL_LIMIT)
  }

  private normalizeSnapshotAnsiForModes(snapshotAnsi: string, modes: TerminalModes): string {
    if (!modes.alternateScreen) {
      return snapshotAnsi
    }
    const alternateScreenMarker = '\x1b[?1049h'
    const start = snapshotAnsi.lastIndexOf(alternateScreenMarker)
    if (start === -1) {
      return snapshotAnsi
    }
    // Why: rehydrateSequences already enters the alternate screen and restores
    // mouse modes. Dropping SerializeAddon's duplicate ?1049h keeps mobile's
    // "slice from last alt-screen marker" replay from discarding those modes.
    return snapshotAnsi.slice(start + alternateScreenMarker.length)
  }

  private parseOsc7Uri(uri: string): void {
    const parsed = parseFileUriPath(uri)
    if (parsed) {
      this.cwd = parsed
    }
  }

  private getModes(): TerminalModes {
    const buffer = this.terminal.buffer.active
    const mouseTrackingMode = this.mouseModes.mouseTrackingMode
    return {
      bracketedPaste: this.terminal.modes.bracketedPasteMode,
      mouseTracking: mouseTrackingMode !== 'none',
      mouseTrackingMode,
      sgrMouseMode: this.mouseModes.sgrMouseMode,
      sgrMousePixelsMode: this.mouseModes.sgrMousePixelsMode,
      applicationCursor:
        buffer.type === 'normal' ? this.terminal.modes.applicationCursorKeysMode : false,
      alternateScreen: buffer.type === 'alternate',
      kittyKeyboardFlags: this.getKittyKeyboardFlags()
    }
  }

  private getKittyKeyboardFlags(): number {
    const flags = (this.terminal as TerminalWithSynchronousWrite)._core?.coreService?.kittyKeyboard
      ?.flags
    return typeof flags === 'number' ? flags : 0
  }

  private buildRehydrateSequences(modes: TerminalModes): string {
    // Why no kitty flags here: rehydrateSequences feeds renderer xterms, and
    // POST_REPLAY_REATTACH_RESET's deliberate kitty reset (stale CSI-u Ctrl+C
    // hazard) must stay authoritative. modes.kittyKeyboardFlags exists for
    // emulator re-seed parity only; a re-seeded emulator answers ?0u and
    // protocol-conformant programs re-push.
    const seqs: string[] = []
    if (modes.alternateScreen) {
      seqs.push('\x1b[?1049h')
    }
    if (modes.bracketedPaste) {
      seqs.push('\x1b[?2004h')
    }
    if (modes.applicationCursor) {
      seqs.push('\x1b[?1h')
    }
    // Why: mobile alt-screen scroll gestures need xterm's mouse mode restored
    // from cold snapshots; OpenCode/OpenTUI enables scrollable panes this way.
    switch (modes.mouseTracking ? (modes.mouseTrackingMode ?? 'vt200') : 'none') {
      case 'x10':
        seqs.push('\x1b[?9h')
        break
      case 'vt200':
        seqs.push('\x1b[?1000h')
        break
      case 'drag':
        seqs.push('\x1b[?1002h')
        break
      case 'any':
        seqs.push('\x1b[?1003h')
        break
      case 'none':
        break
    }
    // Why: xterm tracks the mouse protocol and SGR encoding as independent
    // modes, so snapshots must preserve the encoding even when reporting is off.
    if (modes.sgrMousePixelsMode) {
      seqs.push('\x1b[?1016h')
    } else if (modes.sgrMouseMode) {
      seqs.push('\x1b[?1006h')
    }
    return seqs.join('')
  }
}
