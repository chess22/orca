import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { WorkspaceSessionPatch, WorkspaceSessionState } from '../../shared/types'
import { getOrcaWindowSlot } from '../window/orca-window-registry'

/** Multi-window: each window reads/writes its own session partition so two
 *  windows never restore (and double-attach) the same terminals. Slot 1 maps
 *  to the legacy partitions; unknown senders fall back to slot 1 semantics. */
function resolveSenderWindowSlot(sender: Electron.WebContents): number | null {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window) {
    return null
  }
  return getOrcaWindowSlot(window.id)
}

export function registerSessionHandlers(store: Store): void {
  // Why: hostId is an optional second arg so an older renderer that invokes
  // these channels without it keeps reading/writing the 'local' partition
  // exactly as before. Channel names stay stable.
  ipcMain.handle('session:get', (event, hostId?: string | null) => {
    return store.getWorkspaceSession(hostId, resolveSenderWindowSlot(event.sender))
  })

  ipcMain.handle('session:set', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, resolveSenderWindowSlot(event.sender))
  })

  ipcMain.handle('session:patch', (event, args: WorkspaceSessionPatch, hostId?: string | null) => {
    store.patchWorkspaceSession(args, hostId, resolveSenderWindowSlot(event.sender))
  })

  // Synchronous variant for the renderer's beforeunload handler.
  // sendSync blocks the renderer until this returns, guaranteeing the
  // data (including terminal scrollback buffers) is persisted to disk
  // before the window closes — regardless of before-quit ordering.
  ipcMain.on('session:set-sync', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, resolveSenderWindowSlot(event.sender))
    store.flush()
    event.returnValue = true
  })

  ipcMain.on(
    'session:read-terminal-scrollback-sync',
    (event, args: { ref?: unknown } | undefined) => {
      event.returnValue =
        typeof args?.ref === 'string' ? store.readTerminalScrollbackSnapshot(args.ref) : null
    }
  )
}
