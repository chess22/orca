import type { BrowserWindow, WebContents } from 'electron'

/** One entry per live top-level Orca window. Slots are stable identities used
 *  for per-window persistence (bounds, session partition): slot 1 is the
 *  original single window, and freed slots are reused so "the second window"
 *  keeps restoring the same state across reopen cycles. */
type OrcaWindowEntry = {
  window: BrowserWindow
  slot: number
  lastFocusedAt: number
}

const entries = new Map<number, OrcaWindowEntry>()

/** Slot the next registerOrcaWindow call will claim. Exposed so window
 *  creation can restore slot-keyed persisted bounds before construction. */
export function getNextOrcaWindowSlot(): number {
  return smallestFreeSlot()
}

export function registerOrcaWindow(window: BrowserWindow, slot?: number): { slot: number } {
  const existing = entries.get(window.id)
  if (existing) {
    return { slot: existing.slot }
  }
  const resolvedSlot = slot ?? smallestFreeSlot()
  entries.set(window.id, { window, slot: resolvedSlot, lastFocusedAt: Date.now() })
  window.on('focus', () => {
    const entry = entries.get(window.id)
    if (entry) {
      entry.lastFocusedAt = Date.now()
    }
  })
  window.on('closed', () => {
    entries.delete(window.id)
  })
  return { slot: resolvedSlot }
}

function smallestFreeSlot(): number {
  const used = new Set<number>()
  for (const entry of entries.values()) {
    used.add(entry.slot)
  }
  let slot = 1
  while (used.has(slot)) {
    slot += 1
  }
  return slot
}

function liveEntries(): OrcaWindowEntry[] {
  const result: OrcaWindowEntry[] = []
  for (const [id, entry] of entries) {
    if (entry.window.isDestroyed()) {
      entries.delete(id)
      continue
    }
    result.push(entry)
  }
  return result
}

export function getOrcaWindows(): BrowserWindow[] {
  return liveEntries()
    .sort((a, b) => a.slot - b.slot)
    .map((entry) => entry.window)
}

export function getOrcaWindowCount(): number {
  return liveEntries().length
}

/** The lowest-slot live window. Used where exactly one window must own a
 *  process-wide concern (tray restore fallback, automations webContents). */
export function getPrimaryOrcaWindow(): BrowserWindow | null {
  return getOrcaWindows()[0] ?? null
}

/** Focused window if any, else the most recently focused live window. Used to
 *  route user-facing pushes that have no worktree/tab context of their own. */
export function getLastFocusedOrcaWindow(): BrowserWindow | null {
  const live = liveEntries()
  const focused = live.find((entry) => entry.window.isFocused())
  if (focused) {
    return focused.window
  }
  let best: OrcaWindowEntry | null = null
  for (const entry of live) {
    if (!best || entry.lastFocusedAt > best.lastFocusedAt) {
      best = entry
    }
  }
  return best?.window ?? null
}

export function getOrcaWindowById(windowId: number): BrowserWindow | null {
  const entry = entries.get(windowId)
  return entry && !entry.window.isDestroyed() ? entry.window : null
}

export function getOrcaWindowByWebContentsId(webContentsId: number): BrowserWindow | null {
  for (const entry of liveEntries()) {
    if (entry.window.webContents.id === webContentsId) {
      return entry.window
    }
  }
  return null
}

export function getOrcaWindowSlot(windowId: number): number | null {
  return entries.get(windowId)?.slot ?? null
}

/** True when the sender is the top-level webContents of a live Orca window.
 *  Used by once-registered global IPC listeners that must reject webview
 *  guests and any non-Orca surface. */
export function isOrcaWindowWebContents(sender: WebContents | null | undefined): boolean {
  // Why: harness/test callers pass minimal stubs; anything we cannot
  // positively match to a live Orca window is untrusted.
  if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
    return false
  }
  const window = getOrcaWindowByWebContentsId(sender.id)
  return window !== null && window.webContents === sender
}

export function broadcastToOrcaWindows(channel: string, ...args: unknown[]): void {
  for (const window of getOrcaWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args)
    }
  }
}

// Why: many IPC modules take a BrowserWindow only to call webContents.send and
// isDestroyed. This facade satisfies that shape while fanning sends out to
// every live Orca window, so those modules stay window-count agnostic.
const broadcastWindowFacade = {
  isDestroyed: () => getOrcaWindowCount() === 0,
  webContents: {
    send: (channel: string, ...args: unknown[]) => broadcastToOrcaWindows(channel, ...args),
    isDestroyed: () => getOrcaWindowCount() === 0
  }
} as unknown as BrowserWindow

export function getBroadcastWindowFacade(): BrowserWindow {
  return broadcastWindowFacade
}

/** Test-only: clear registered windows so module-level state cannot leak
 *  between unit tests. */
export function resetOrcaWindowRegistryForTesting(): void {
  entries.clear()
}
