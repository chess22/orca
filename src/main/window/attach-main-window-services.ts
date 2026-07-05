/* eslint-disable max-lines -- Why: this file is the central main-window IPC wiring point; splitting it during the mobile release compatibility rebase would increase release risk. */
import { randomUUID } from 'node:crypto'

import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type {
  CreateWorktreeResult,
  UpdateCheckOptions,
  WorktreeStartupLaunch
} from '../../shared/types'
import { registerRepoHandlers } from '../ipc/repos'
import { registerWorktreeHandlers } from '../ipc/worktrees'
import { registerWorkspaceCleanupHandlers } from '../ipc/workspace-cleanup'
import { getLocalPtyProvider, registerPtyHandlers } from '../ipc/pty'
import { registerDaemonManagementHandlers } from '../ipc/pty-management'
import { registerSshHandlers } from '../ipc/ssh'
import { registerRemoteWorkspaceHandlers } from '../ipc/remote-workspace'
import { browserManager } from '../browser/browser-manager'
import { hasSystemMediaAccess, requestSystemMediaAccess } from '../browser/browser-media-access'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  checkForUpdatesFromMenu,
  downloadUpdate,
  getUpdateStatus,
  quitAndInstall,
  setupAutoUpdater,
  dismissNudge
} from '../updater'
import { scheduleHistoryGc } from '../terminal-history'
import { hydrateLocalPtyRegistryAtBoot } from '../memory/hydrate-local-pty-registry'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import { getKnownWorktreeIdsForHistoryGc } from './history-gc-worktree-ids'
import type {
  RuntimeMarkdownReadTabResult,
  RuntimeMarkdownSaveTabResult
} from '../../shared/mobile-markdown-document'
import type { RuntimeMobileSessionTabMove } from '../../shared/runtime-types'
import { isNativeFileDropPayload, type NativeFileDropPayload } from '../../shared/native-file-drop'
import { requestMobileMarkdownFromRenderer } from './mobile-markdown-request-relay'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import { runWorktreeChangeInvalidators } from '../ipc/worktree-change-invalidators'
import {
  getBroadcastWindowFacade,
  getOrcaWindowCount,
  isOrcaWindowWebContents,
  registerOrcaWindow
} from './orca-window-registry'
import {
  scheduleWorktreeBaseDirectoryWatcherSync,
  setWorktreeBaseDirectoryWatcherSyncContext
} from '../ipc/worktree-base-directory-watcher'
import { logStartupMilestone } from '../startup/startup-diagnostics'

const UPDATER_SETUP_FALLBACK_MS = 15_000

// Why: updater setup is deferred past first paint, but a manual check (app
// menu or updater:check IPC) can arrive inside that window — it must run
// against a configured updater (listeners, autoDownload=false, window ref),
// so those entry points force the pending setup first.
let pendingAutoUpdaterSetup: (() => void) | null = null
let updaterSetupDone = false

export function ensureAutoUpdaterConfigured(): void {
  pendingAutoUpdaterSetup?.()
}

/** Test-only: reset the module-level once-guards so each unit test observes a
 *  fresh registration pass. */
export function resetAttachMainWindowServicesForTesting(): void {
  globalWindowServicesRegistered = false
  updaterSetupDone = false
  pendingAutoUpdaterSetup = null
}

// Why: multi-window — the process-global IPC surface (repos, worktrees, PTY
// management, SSH, updater setup) must register exactly once; per-window state
// (runtime notifier, permission handlers, PTY renderer lifecycle) attaches on
// every window. The broadcast facade fans window-directed sends to all windows.
let globalWindowServicesRegistered = false

export function attachMainWindowServices(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService,
  getSelectedCodexHomePath?: (target?: CodexAccountSelectionTarget) => string | null,
  prepareClaudeAuth?: (
    target?: ClaudeAccountSelectionTarget
  ) => Promise<ClaudeRuntimeAuthPreparation>,
  options?: {
    awaitLocalPtyStartup?: () => Promise<void>
    onBeforeRendererReload?: (args: { webContentsId: number; ignoreCache: boolean }) => void
    // Why: lets the PTY orphan sweep skip the one crash-recovery reload (#5787).
    isRecoveryReloadInFlight?: (webContentsId: number) => boolean
    onBeforeUpdateQuit?: () => void | Promise<void>
  }
): void {
  const broadcastWindow = getBroadcastWindowFacade()
  // Why: idempotent safety net — openOrcaWindow registers first in production,
  // but every window that reaches service attachment must be in the registry
  // or sender-validated global handlers would reject its renderer.
  registerOrcaWindow(mainWindow)
  // Why: registerPtyHandlers is re-entrant (it re-registers global handlers and
  // attaches per-webContents lifecycle listeners), so it runs for every window.
  registerPtyHandlers(
    mainWindow,
    runtime,
    getSelectedCodexHomePath,
    () => store.getSettings(),
    prepareClaudeAuth,
    store,
    {
      awaitLocalPtyStartup: options?.awaitLocalPtyStartup,
      isRecoveryReloadInFlight: options?.isRecoveryReloadInFlight
    }
  )
  if (!globalWindowServicesRegistered) {
    globalWindowServicesRegistered = true
    registerAppReloadHandler(options?.onBeforeRendererReload)
    registerRepoHandlers(broadcastWindow, store)
    registerWorktreeHandlers(broadcastWindow, store, runtime)
    // Why: repo/settings mutations resync watchers through this attached context.
    setWorktreeBaseDirectoryWatcherSyncContext(store, broadcastWindow)
    scheduleWorktreeBaseDirectoryWatcherSync(store, broadcastWindow)
    registerWorkspaceCleanupHandlers(store, { runtime, getLocalPtyProvider })
    // Why: the Manage Sessions settings panel (docs/daemon-staleness-ux.md §Phase 1)
    // uses a narrow `pty:management:*` IPC surface that reads the live
    // DaemonPtyRouter via getDaemonProvider().
    registerDaemonManagementHandlers()
    // Why: do not enumerate repo paths from background GC. `git worktree list`
    // can re-touch protected folders on macOS and trigger folder-access prompts.
    scheduleHistoryGc(async () => {
      return getKnownWorktreeIdsForHistoryGc(store)
    })
    registerSshHandlers(store, () => getBroadcastWindowFacade(), runtime)
    registerRemoteWorkspaceHandlers(store, () => getBroadcastWindowFacade())
    registerFileDropRelay()
  }
  // Why: warm-reattach gap.
  // Daemon-hosted PTYs survive renderer restarts on purpose, so on a fresh
  // Orca launch the daemon's `listSessions()` returns sessions that
  // `pty:spawn` hasn't re-registered yet. Without this hydration, the
  // memory snapshot omits those PTYs and the renderer mislabels their
  // workspaces as `· REMOTE` while showing `—` for CPU/Memory.
  // `hydrateLocalPtyRegistryAtBoot` is idempotent (no-op after the first
  // call), so calling it on every macOS dock re-activation — when this
  // function re-runs as the main window is recreated — does not redo the
  // git I/O or daemon RPC.
  void hydrateLocalPtyRegistryAtBoot(store)
  const localPtyStartupReady = options?.awaitLocalPtyStartup?.()
  if (localPtyStartupReady) {
    void localPtyStartupReady
      .then(() => hydrateLocalPtyRegistryAtBoot(store))
      .catch((error) => {
        console.warn(
          '[memory] Deferred pty-registry hydration skipped:',
          error instanceof Error ? error.message : String(error)
        )
      })
  }
  // Why: setupAutoUpdater's first getAutoUpdater() call synchronously
  // require()s electron-updater in packaged builds — seconds on a cold
  // Windows disk under Defender scanning (part of issue #7225's pre-paint
  // stall) — so defer it past first paint. The timer fallback keeps update
  // checks alive for renderers that crash-loop before ever painting.
  // Why: the flag is module-scoped — a second window must not re-run updater
  // setup and stack duplicate autoUpdater listeners.
  const setupAutoUpdaterDeferred = (): void => {
    if (updaterSetupDone || mainWindow.isDestroyed()) {
      return
    }
    updaterSetupDone = true
    setupAutoUpdater(mainWindow, {
      getLastUpdateCheckAt: () => store.getUI().lastUpdateCheckAt,
      onBeforeQuit: async () => {
        try {
          await options?.onBeforeUpdateQuit?.()
        } finally {
          store.flush()
        }
      },
      setLastUpdateCheckAt: (timestamp) => {
        store.updateUI({ lastUpdateCheckAt: timestamp })
      },
      getPendingUpdateNudgeId: () => store.getUI().pendingUpdateNudgeId ?? null,
      getDismissedUpdateNudgeId: () => store.getUI().dismissedUpdateNudgeId ?? null,
      setPendingUpdateNudgeId: (id) => {
        // Why: the nudge lifecycle is owned by the main process. When applying a
        // new campaign, persist the pending id AND clear the version dismissal
        // together so relaunches cannot resurrect the old hidden-card state
        // between nudge apply and renderer sync. When clearing (id is null),
        // only touch pendingUpdateNudgeId — clearing dismissedUpdateVersion here
        // would silently un-dismiss an update if the flow ever changes.
        if (id) {
          store.updateUI({ pendingUpdateNudgeId: id, dismissedUpdateVersion: null })
        } else {
          store.updateUI({ pendingUpdateNudgeId: null })
        }
      },
      setDismissedUpdateNudgeId: (id) => {
        store.updateUI({ dismissedUpdateNudgeId: id })
      }
    })
    logStartupMilestone('updater-setup-done')
  }
  pendingAutoUpdaterSetup = setupAutoUpdaterDeferred
  mainWindow.once('ready-to-show', () => setImmediate(setupAutoUpdaterDeferred))
  const updaterSetupFallback = setTimeout(setupAutoUpdaterDeferred, UPDATER_SETUP_FALLBACK_MS)
  updaterSetupFallback.unref?.()
  registerRuntimeWindowLifecycle(mainWindow, runtime)

  const allowedPermissions = new Set(['media', 'fullscreen', 'pointerLock'])
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        void requestSystemMediaAccess(details).then(callback, (error: unknown) => {
          console.error('[permissions] Failed to request media access:', error)
          callback(false)
        })
        return
      }
      callback(allowedPermissions.has(permission))
    }
  )
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) => {
      if (permission !== 'media') {
        return allowedPermissions.has(permission)
      }
      return hasSystemMediaAccess(details?.mediaType)
    }
  )

  mainWindow.on('closed', () => {
    // Why: browser webviews are renderer-owned guest surfaces. Clearing
    // main-owned guest registrations when the LAST window closes prevents
    // stale tab→webContents ids from leaking across relaunch/hot-reload;
    // surviving windows keep their live guest registrations.
    if (getOrcaWindowCount() === 0) {
      browserManager.unregisterAll()
    }
  })
}

function registerAppReloadHandler(
  onBeforeRendererReload?: (args: { webContentsId: number; ignoreCache: boolean }) => void
): void {
  // Why: multi-window — registered once, reloads whichever Orca window asked.
  ipcMain.removeHandler('app:reload')
  ipcMain.handle('app:reload', (event) => {
    if (!isOrcaWindowWebContents(event?.sender)) {
      return
    }
    onBeforeRendererReload?.({ webContentsId: event.sender.id, ignoreCache: false })
    event.sender.reload()
  })
}

function registerRuntimeWindowLifecycle(
  mainWindow: BrowserWindow,
  runtime: OrcaRuntimeService
): void {
  runtime.attachWindow(mainWindow.id)
  const send = (channel: string, ...args: unknown[]): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  }
  const notifier = {
    worktreesChanged: (repoId, renamed) => {
      // Why: clear detected-worktree scan caches before renderer listeners
      // handle this event, preventing stale TTL reads after mutations.
      runWorktreeChangeInvalidators(repoId)
      send('worktrees:changed', renamed ? { repoId, renamed } : { repoId })
    },
    worktreeBaseStatus: (event) => send('worktree:baseStatus', event),
    worktreeRemoteBranchConflict: (event) => send('worktree:remoteBranchConflict', event),
    reposChanged: () => send('repos:changed'),
    activateWorktree: (
      repoId,
      worktreeId,
      setup?: CreateWorktreeResult['setup'],
      startup?: WorktreeStartupLaunch,
      defaultTabs?: CreateWorktreeResult['defaultTabs']
    ) => {
      send('ui:activateWorktree', {
        repoId,
        worktreeId,
        ...(setup ? { setup } : {}),
        ...(startup ? { startup } : {}),
        ...(defaultTabs ? { defaultTabs } : {})
      })
    },
    createTerminal: (worktreeId, opts) =>
      send('ui:createTerminal', {
        worktreeId,
        command: opts.command,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        title: opts.title,
        ...(opts.presentation ? { presentation: opts.presentation } : {})
      }),
    revealTerminalSession: (worktreeId, opts) =>
      new Promise((resolve, reject) => {
        const requestId = randomUUID()
        const timer = setTimeout(() => {
          ipcMain.removeListener('terminal:tabCreateReply', handler)
          reject(new Error('Terminal reveal timed out'))
        }, 10_000)
        const handler = (
          event: Electron.IpcMainEvent,
          reply: { requestId: string; tabId?: string; title?: string; error?: string }
        ): void => {
          // Why: requestId is renderer-supplied; only the targeted main window
          // may satisfy the reveal and provide the tab handle.
          if (event.sender !== mainWindow.webContents || reply.requestId !== requestId) {
            return
          }
          clearTimeout(timer)
          ipcMain.removeListener('terminal:tabCreateReply', handler)
          if (reply.error) {
            reject(new Error(reply.error))
            return
          }
          resolve({ tabId: reply.tabId!, title: reply.title })
        }
        ipcMain.on('terminal:tabCreateReply', handler)
        send('ui:createTerminal', {
          requestId,
          worktreeId,
          ptyId: opts.ptyId,
          title: opts.title ?? undefined,
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
          ...(opts.launchConfig ? { launchConfig: opts.launchConfig } : {}),
          ...(opts.launchToken ? { launchToken: opts.launchToken } : {}),
          ...(opts.launchAgent ? { launchAgent: opts.launchAgent } : {}),
          activate: opts.activate !== false,
          ...(opts.presentation ? { presentation: opts.presentation } : {}),
          // Why: pre-minted tabId from main keeps the renderer's tab id aligned
          // with the paneKey baked into the PTY env at spawn time, so hook
          // events route to the right slot.
          ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}),
          ...(opts.leafId !== undefined ? { leafId: opts.leafId } : {}),
          ...(opts.splitFromLeafId !== undefined ? { splitFromLeafId: opts.splitFromLeafId } : {}),
          ...(opts.splitDirection !== undefined ? { splitDirection: opts.splitDirection } : {}),
          ...(opts.splitTelemetrySource !== undefined
            ? { splitTelemetrySource: opts.splitTelemetrySource }
            : {})
        })
      }),
    splitTerminal: (tabId, paneRuntimeId, opts) => {
      send('ui:splitTerminal', {
        tabId,
        paneRuntimeId,
        direction: opts.direction,
        command: opts.command,
        telemetrySource: opts.telemetrySource
      })
    },
    renameTerminal: (tabId, title) => send('ui:renameTerminal', { tabId, title }),
    focusTerminal: (tabId, worktreeId, leafId) =>
      send('ui:focusTerminal', { tabId, worktreeId, leafId }),
    focusEditorTab: (tabId, worktreeId) => send('ui:focusEditorTab', { tabId, worktreeId }),
    closeSessionTab: (tabId, worktreeId) => send('ui:closeSessionTab', { tabId, worktreeId }),
    moveSessionTab: (worktreeId: string, move: RuntimeMobileSessionTabMove) =>
      send('ui:moveSessionTab', { worktreeId, ...move }),
    openFile: (worktreeId, filePath, relativePath, runtimeEnvironmentId?) =>
      send('ui:openFileFromMobile', {
        worktreeId,
        filePath,
        relativePath,
        runtimeEnvironmentId
      }),
    openDiff: (worktreeId, filePath, relativePath, staged, runtimeEnvironmentId?) =>
      send('ui:openDiffFromMobile', {
        worktreeId,
        filePath,
        relativePath,
        staged,
        runtimeEnvironmentId
      }),
    readMobileMarkdownTab: (worktreeId, tabId) =>
      requestMobileMarkdownFromRenderer(mainWindow, {
        operation: 'read',
        worktreeId,
        tabId
      }) as Promise<RuntimeMarkdownReadTabResult>,
    saveMobileMarkdownTab: (worktreeId, tabId, baseVersion, content) =>
      requestMobileMarkdownFromRenderer(mainWindow, {
        operation: 'save',
        worktreeId,
        tabId,
        baseVersion,
        content
      }) as Promise<RuntimeMarkdownSaveTabResult>,
    closeTerminal: (tabId, paneRuntimeId) => send('ui:closeTerminal', { tabId, paneRuntimeId }),
    sleepWorktree: (worktreeId) => send('ui:sleepWorktree', { worktreeId }),
    terminalFitOverrideChanged: (ptyId, mode, cols, rows) =>
      send('runtime:terminalFitOverrideChanged', { ptyId, mode, cols, rows }),
    terminalDriverChanged: (ptyId, driver) =>
      send('runtime:terminalDriverChanged', { ptyId, driver }),
    browserDriverChanged: (browserPageId, driver) =>
      send('runtime:browserDriverChanged', { browserPageId, driver })
  } satisfies Parameters<OrcaRuntimeService['setNotifier']>[0]
  // Why: multi-window — each window registers its own notifier keyed by its
  // BrowserWindow id; the runtime routes/broadcasts across them.
  runtime.setNotifier(notifier, mainWindow.id)
  // Why: the runtime must fail closed while the renderer graph is being torn
  // down or rebuilt, otherwise future CLI calls could act on stale terminal
  // mappings during reload transitions.
  mainWindow.webContents.on('did-start-loading', () => {
    runtime.markRendererReloading(mainWindow.id)
  })
  mainWindow.on('closed', () => {
    runtime.markGraphUnavailable(mainWindow.id)
    // Why: the notifier closes over the BrowserWindow for mobile/CLI UI
    // relays; drop this window's entry so the runtime does not retain
    // destroyed window graphs.
    runtime.setNotifier(null, mainWindow.id)
  })
}

function registerFileDropRelay(): void {
  const channel = 'terminal:file-dropped-from-preload'
  ipcMain.removeAllListeners(channel)
  const relayFileDrop = (event: Electron.IpcMainEvent, args: NativeFileDropPayload): void => {
    // Why: multi-window — relay back to the window whose preload observed the
    // drop; foreign/guest senders are rejected.
    if (!isOrcaWindowWebContents(event?.sender)) {
      return
    }
    if (!isNativeFileDropPayload(args)) {
      return
    }

    // Why: relay exactly one IPC event per drop gesture so the renderer
    // receives the full batch of paths without timer-based reconstruction.
    event.sender.send('terminal:file-drop', args)
  }
  ipcMain.on(channel, relayFileDrop)
}

export function registerUpdaterHandlers(_store: Store): void {
  ipcMain.removeHandler('updater:getStatus')
  ipcMain.removeHandler('updater:getVersion')
  ipcMain.removeHandler('updater:check')
  ipcMain.removeHandler('updater:download')
  ipcMain.removeHandler('updater:quitAndInstall')
  ipcMain.removeHandler('updater:dismissNudge')

  ipcMain.handle('updater:getStatus', () => getUpdateStatus())
  ipcMain.handle('updater:getVersion', () => app.getVersion())
  ipcMain.handle('updater:check', (_event, options?: UpdateCheckOptions) => {
    ensureAutoUpdaterConfigured()
    return checkForUpdatesFromMenu(options)
  })
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:quitAndInstall', () => quitAndInstall())
  ipcMain.handle('updater:dismissNudge', () => dismissNudge())
}
