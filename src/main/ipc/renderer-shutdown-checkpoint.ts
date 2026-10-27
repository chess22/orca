import { ipcMain } from 'electron'
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import { applyCommandToSession } from '../persistence/terminal-topology/terminal-pane-admission'
import type { PersistedUIState } from '../../shared/persisted-ui-state-types'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import type { Store } from '../persistence'
import { isFrozenOrcadSourceSessionPartition } from '../ssh/orcad-retained-source'
import { windowViewSaveForMain, type ReconnectFactsFor } from '../persistence/window-save-view'
import { reportWindowSaveDrift } from '../persistence/window-save-divergence'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { workspaceSessionTerminalReplayMutationKeys } from '../persistence/loading-store/workspace-session-terminal-binding-replay'
import type { TerminalLeafMutationKey } from '../terminal-leaf-mutation-lane'

type StageBeforeUnloadSyncArgs = {
  sessions: { state: WorkspaceSessionState; hostId?: ExecutionHostId }[]
  ui: Partial<PersistedUIState>
}

export type QuitResumeRecordsFor = (session: WorkspaceSessionState) => SleepingAgentSessionRecord[]

/** Apply only captured resume-record changes to existing panes so later wakes remain intact. */
function withQuitSleepRecords(
  hostId: string | undefined,
  session: WorkspaceSessionState,
  records: readonly SleepingAgentSessionRecord[]
): WorkspaceSessionState {
  const byWorkspace = Map.groupBy(records, (record) => record.worktreeId)
  let current = session
  for (const [workspace, workspaceRecords] of byWorkspace) {
    const change = applyCommandToSession(
      normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID,
      current,
      {
        type: 'sleep',
        workspace,
        paneKeys: workspaceRecords.map((record) => record.paneKey),
        records: workspaceRecords,
        recordOnly: true
      }
    )
    current = change.session ?? current
  }
  return current
}

export type ShutdownCheckpointResult = { ok: boolean }

/** Matches the will-quit teardown budget so a stalled disk can't strand a restart. */
export const SHUTDOWN_CHECKPOINT_FLUSH_DEADLINE_MS = 20_000

function flushStagedStateWithDeadline(store: Store): Promise<ShutdownCheckpointResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<ShutdownCheckpointResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      console.error('[app] Timed out persisting staged renderer state')
      resolve({ ok: false })
    }, SHUTDOWN_CHECKPOINT_FLUSH_DEADLINE_MS)
  })
  // Retry superseded staged writes without chasing unrelated mutations beyond the shutdown deadline.
  const flush = store
    .flushPendingOrThrowAsync({ signal: controller.signal, drainToStableGeneration: false })
    .then((): ShutdownCheckpointResult => ({ ok: true }))
    .catch((error): ShutdownCheckpointResult => {
      console.error('[app] Failed to persist staged renderer state:', error)
      return { ok: false }
    })
  return Promise.race([flush, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

/** Keep main's layout, merge window view/facts and apply main's quit capture. */
function stagedSessionForMain(
  storedSession: WorkspaceSessionState,
  state: WorkspaceSessionState,
  hostId: ExecutionHostId | undefined,
  quitResumeRecordsFor: QuitResumeRecordsFor,
  reconnectFactsFor: ReconnectFactsFor | undefined
): WorkspaceSessionState {
  const stored = withQuitSleepRecords(hostId, storedSession, quitResumeRecordsFor(storedSession))
  reportWindowSaveDrift(stored, state, hostId, 'shutdown-checkpoint')
  return windowViewSaveForMain(stored, state, hostId, reconnectFactsFor)
}

function mutationKeyIdentity(key: TerminalLeafMutationKey): string {
  return JSON.stringify([key.executionHostId, key.worktreeId, key.tabId, key.leafId])
}

/** Preserve bindings changed while this checkpoint waited to acquire their leaf lanes. */
function withConcurrentTerminalBindings(
  candidate: WorkspaceSessionState,
  observed: WorkspaceSessionState,
  current: WorkspaceSessionState,
  keys: readonly TerminalLeafMutationKey[]
): WorkspaceSessionState {
  let next = candidate
  let layouts = candidate.terminalLayoutsByTabId
  let incarnations = candidate.terminalPtyIncarnationsByPaneKey
  let layoutsChanged = false
  let incarnationsChanged = false

  for (const { tabId, leafId } of keys) {
    const paneKey = `${tabId}:${leafId}`
    const observedPty = observed.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId?.[leafId]
    const currentPty = current.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId?.[leafId]
    if (observedPty !== currentPty && candidate.terminalLayoutsByTabId?.[tabId]) {
      if (!layoutsChanged) {
        layouts = { ...candidate.terminalLayoutsByTabId }
        layoutsChanged = true
      }
      const layout = layouts?.[tabId]
      if (layout) {
        const ptyIdsByLeafId = { ...layout.ptyIdsByLeafId }
        if (currentPty === undefined) {
          delete ptyIdsByLeafId[leafId]
        } else {
          ptyIdsByLeafId[leafId] = currentPty
        }
        layouts![tabId] = { ...layout, ptyIdsByLeafId }
      }
    }

    const observedIncarnation = observed.terminalPtyIncarnationsByPaneKey?.[paneKey]
    const currentIncarnation = current.terminalPtyIncarnationsByPaneKey?.[paneKey]
    if (observedIncarnation !== currentIncarnation) {
      if (!incarnationsChanged) {
        incarnations = { ...candidate.terminalPtyIncarnationsByPaneKey }
        incarnationsChanged = true
      }
      if (currentIncarnation === undefined) {
        delete incarnations![paneKey]
      } else {
        incarnations![paneKey] = currentIncarnation
      }
    }
  }

  if (layoutsChanged) {
    next = { ...next, terminalLayoutsByTabId: layouts }
  }
  if (incarnationsChanged) {
    next = { ...next, terminalPtyIncarnationsByPaneKey: incarnations }
  }
  return next
}

export function registerRendererShutdownCheckpointHandler(
  store: Store,
  quitResumeRecordsFor: QuitResumeRecordsFor = () => [],
  reconnectFactsFor?: ReconnectFactsFor
): void {
  // beforeunload cannot await; sync reply confirms staging while navigation paths separately join durability.
  let pendingCheckpoint: Promise<ShutdownCheckpointResult> = Promise.resolve({ ok: true })

  ipcMain.on('app:stage-before-unload-sync', (event, args: StageBeforeUnloadSyncArgs) => {
    let ok = true
    try {
      const sessions = args.sessions.flatMap(({ state, hostId }) => {
        if (isFrozenOrcadSourceSessionPartition(store, hostId)) {
          return []
        }
        const prior = store.getWorkspaceSession(hostId)
        const executionHostId = normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID
        const keys = workspaceSessionTerminalReplayMutationKeys(executionHostId, state, prior)
        return [
          {
            state,
            hostId,
            prior,
            executionHostId,
            keys
          }
        ]
      })
      let stagedFlush: Promise<ShutdownCheckpointResult> | null = null
      const stage = (): void => {
        for (const { state, hostId, prior, executionHostId, keys } of sessions) {
          const current = store.getWorkspaceSession(hostId)
          const candidate = ORCA_LAYOUT_OWNER_IS_MAIN
            ? stagedSessionForMain(current, state, hostId, quitResumeRecordsFor, reconnectFactsFor)
            : state
          const next = withConcurrentTerminalBindings(candidate, prior, current, keys)
          const held = new Set(keys.map(mutationKeyIdentity))
          const finalKeys = workspaceSessionTerminalReplayMutationKeys(
            executionHostId,
            next,
            current
          )
          if (finalKeys.some((key) => !held.has(mutationKeyIdentity(key)))) {
            throw new Error('renderer_shutdown_checkpoint_leaf_set_changed')
          }
          store.stageWorkspaceSessionBeforeUnload(next, hostId)
        }
        store.updateUI(args.ui)
        stagedFlush = flushStagedStateWithDeadline(store)
      }
      // The synchronous path still stages immediately when uncontended. A concurrent leaf mutation
      // queues the complete snapshot; the async checkpoint tracks its subsequent durable flush.
      pendingCheckpoint = (
        store.runTerminalLeafMutations
          ? store.runTerminalLeafMutations(
              sessions.flatMap(({ keys }) => keys),
              stage
            )
          : Promise.resolve(stage())
      )
        .then(
          () =>
            stagedFlush ??
            Promise.reject(new Error('renderer_shutdown_checkpoint_flush_not_staged'))
        )
        .catch((error): ShutdownCheckpointResult => {
          console.error('[app] Failed to stage renderer state before unload:', error)
          return { ok: false }
        })
    } catch (error) {
      console.error('[app] Failed to stage renderer state before unload:', error)
      ok = false
      pendingCheckpoint = Promise.resolve({ ok: false })
    }
    event.returnValue = { ok }
  })

  ipcMain.handle(
    'app:await-before-unload-checkpoint',
    (): Promise<ShutdownCheckpointResult> => pendingCheckpoint
  )
}
