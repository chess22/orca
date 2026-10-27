import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { parseTerminalSurfaceCloseTarget } from '../../shared/terminal-surface-close-target'
import { isFrozenOrcadSourceSessionPartition } from '../ssh/orcad-retained-source'
import { markAgentLaunchesClosedByUser } from '../agent-launch/agent-launch-pane-attachment'
import { windowViewPatchForMain, windowViewSaveForMain } from '../persistence/window-save-view'
import { reportWindowSaveDrift } from '../persistence/window-save-divergence'
import { windowSaveKeepingMainSleepRecords } from '../persistence/window-save-sleep-records'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { normalizeExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { workspaceSessionTerminalReplayMutationKeys } from '../persistence/loading-store/workspace-session-terminal-binding-replay'
import type { TerminalLeafMutationKey } from '../terminal-leaf-mutation-lane'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../shared/workspace-session-state-types'

export function registerSessionHandlers(store: Store, runtime: OrcaRuntimeService): void {
  const sameMutationKeys = (
    left: readonly TerminalLeafMutationKey[],
    right: readonly TerminalLeafMutationKey[]
  ): boolean => {
    const canonical = (keys: readonly TerminalLeafMutationKey[]) =>
      [
        ...new Set(keys.map((key) => JSON.stringify([key.worktreeId, key.tabId, key.leafId])))
      ].sort()
    const a = canonical(left)
    const b = canonical(right)
    return a.length === b.length && a.every((key, index) => key === b[index])
  }
  // Renderer saves must not mutate a fenced source host partition.
  const isFenced = (hostId?: string | null): boolean =>
    isFrozenOrcadSourceSessionPartition(store, hostId)

  // Optional hostId preserves local-partition behavior for older renderers.
  ipcMain.handle('session:get', (_event, hostId?: string | null) => {
    return store.getWorkspaceSession(hostId)
  })

  // Repo catalogs omit folder-only SSH hosts; enumerate session partitions directly (#12723).
  ipcMain.handle('session:list-host-ids', () => {
    return store.getWorkspaceSessionHostIds()
  })

  // Main owns layout membership; merge the window's view and facts, then report layout drift.
  const sessionForMain = (args: WorkspaceSessionState, hostId: string | null | undefined) => {
    const stored = store.getWorkspaceSession(hostId)
    return windowViewSaveForMain(stored, args, hostId, (session, partition) =>
      runtime.shutdownReconnectFactsFor(session, partition)
    )
  }
  const patchForMain = (args: WorkspaceSessionPatch, hostId: string | null | undefined) => {
    const stored = store.getWorkspaceSession(hostId)
    return windowViewPatchForMain(stored, args, hostId, (session, partition) =>
      runtime.shutdownReconnectFactsFor(session, partition)
    )
  }

  ipcMain.handle(
    'session:set',
    async (_event, args: WorkspaceSessionState, hostId?: string | null) => {
      if (!isFenced(hostId)) {
        const executionHostId = normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID
        for (;;) {
          const prior = store.getWorkspaceSession(hostId)
          const next = ORCA_LAYOUT_OWNER_IS_MAIN
            ? sessionForMain(args, hostId)
            : windowSaveKeepingMainSleepRecords(prior, args, 'set')
          const keys = workspaceSessionTerminalReplayMutationKeys(executionHostId, next, prior)
          let retry = false
          await store.runTerminalLeafMutations(keys, () => {
            const current = store.getWorkspaceSession(hostId)
            const currentNext = ORCA_LAYOUT_OWNER_IS_MAIN
              ? sessionForMain(args, hostId)
              : windowSaveKeepingMainSleepRecords(current, args, 'set')
            const currentKeys = workspaceSessionTerminalReplayMutationKeys(
              executionHostId,
              currentNext,
              current
            )
            if (!sameMutationKeys(keys, currentKeys)) {
              retry = true
              return
            }
            reportWindowSaveDrift(current, args, hostId, 'session:set')
            store.setWorkspaceSession(currentNext, hostId)
          })
          if (!retry) {
            return
          }
        }
      }
    }
  )

  ipcMain.handle(
    'session:patch',
    async (_event, args: WorkspaceSessionPatch, hostId?: string | null) => {
      if (!isFenced(hostId)) {
        const executionHostId = normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID
        for (;;) {
          const prior = store.getWorkspaceSession(hostId)
          const patch = ORCA_LAYOUT_OWNER_IS_MAIN
            ? patchForMain(args, hostId)
            : windowSaveKeepingMainSleepRecords(prior, args, 'patch')
          const candidate = { ...prior, ...patch }
          const keys = workspaceSessionTerminalReplayMutationKeys(executionHostId, candidate, prior)
          let retry = false
          await store.runTerminalLeafMutations(keys, () => {
            const current = store.getWorkspaceSession(hostId)
            const currentPatch = ORCA_LAYOUT_OWNER_IS_MAIN
              ? patchForMain(args, hostId)
              : windowSaveKeepingMainSleepRecords(current, args, 'patch')
            const currentCandidate = { ...current, ...currentPatch }
            const currentKeys = workspaceSessionTerminalReplayMutationKeys(
              executionHostId,
              currentCandidate,
              current
            )
            if (!sameMutationKeys(keys, currentKeys)) {
              retry = true
              return
            }
            reportWindowSaveDrift(current, { ...current, ...args }, hostId, 'session:patch')
            store.patchWorkspaceSession(currentPatch, hostId)
          })
          if (!retry) {
            return
          }
        }
      }
    }
  )

  // Window saves cannot shrink main-owned membership; closes must commit explicitly.
  ipcMain.handle(
    'session:close-terminal-surface',
    (_event, args: { worktreeId?: unknown; target?: unknown; reason?: unknown } | undefined) => {
      const target = parseTerminalSurfaceCloseTarget(args?.target)
      if (typeof args?.worktreeId !== 'string' || !target) {
        throw new Error('invalid_terminal_surface')
      }
      // Only main may close tabs for process exit.
      const reason = args.reason === 'cleanup' ? 'cleanup' : 'user'
      if (reason === 'user') {
        markAgentLaunchesClosedByUser(args.worktreeId, target)
      }
      return runtime.closeTerminalSurfaceFromRenderer({
        worktreeId: args.worktreeId,
        target,
        reason
      })
    }
  )

  ipcMain.handle('session:flush', () => {
    // Lifecycle success requires durable writes; Store.flush only logs failures.
    return store.flushPendingOrThrowAsync()
  })

  ipcMain.on(
    'session:read-terminal-scrollback-sync',
    (event, args: { ref?: unknown } | undefined) => {
      event.returnValue =
        typeof args?.ref === 'string' ? store.readTerminalScrollbackSnapshot(args.ref) : null
    }
  )
}
