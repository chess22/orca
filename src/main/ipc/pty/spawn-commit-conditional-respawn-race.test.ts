import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../shared/constants'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { withBoundPane } from '../../runtime/bind-first-pane.test-fixture'
import { TerminalLeafMutationLane } from '../../terminal-leaf-mutation-lane'
import { commitPtySpawn } from './spawn-commit-assembly'

vi.mock('../../../shared/terminal-recovery-rollout', () => ({
  TERMINAL_RECOVERY_MUTATIONS_ENABLED: true,
  TERMINAL_RECOVERY_DISABLED_REASON: 'source_baseline_disabled'
}))

const WORKTREE = 'repo-1::/tmp/worktree'
const TAB = 'tab-1'
const LEAF = '11111111-1111-4111-8111-111111111111'
const OLD_PTY = 'spawn-race-old-pty'
const NEW_PTY = 'spawn-race-new-pty'
const OLD_HANDLE = 'term_spawn_race_old'
const NEW_HANDLE = 'term_spawn_race_new'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => (resolve = next))
  return { promise, resolve }
}

describe('spawn commit and conditional respawn serialization', () => {
  it('publishes the new spawn before a queued old-PTY respawn can validate', async () => {
    const lane = new TerminalLeafMutationLane()
    const persistEntered = deferred<void>()
    const continuePersist = deferred<void>()
    let session: WorkspaceSessionState = withBoundPane(getDefaultWorkspaceSession(), {
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: OLD_PTY,
      incarnationId: 'inc-old'
    })
    const store = {
      getRepos: () => [
        { id: 'repo-1', path: '/tmp/worktree', displayName: 'Repo', badgeColor: '#000', addedAt: 1 }
      ],
      getRepo: () => undefined,
      getAllWorktreeMeta: () => [],
      getWorkspaceSession: () => session,
      getWorkspaceSessionHostIds: () => ['local'],
      setWorkspaceSession: (next: WorkspaceSessionState) => {
        session = next
      },
      getSettings: () => ({
        workspaceDir: '/tmp',
        nestWorkspaces: false,
        refreshLocalBaseRefOnWorktreeCreate: false,
        branchPrefix: '',
        branchPrefixCustom: ''
      }),
      runTerminalLeafMutations: lane.run.bind(lane),
      persistPtyBinding: async (
        input: (() => Record<string, unknown> | null) | Record<string, unknown>,
        _hostId?: string,
        laneBinding?: { worktreeId: string; tabId: string; leafId: string }
      ) => {
        const key = laneBinding ?? (typeof input === 'function' ? null : input)
        if (!key) {
          throw new Error('missing lane binding')
        }
        return lane.run(
          [
            {
              executionHostId: 'local',
              worktreeId: String(key.worktreeId),
              tabId: String(key.tabId),
              leafId: String(key.leafId)
            }
          ],
          async () => {
            persistEntered.resolve()
            await continuePersist.promise
            const binding = typeof input === 'function' ? input() : input
            if (!binding) {
              return false
            }
            session = withBoundPane(session, {
              worktreeId: String(binding.worktreeId),
              tabId: String(binding.tabId),
              leafId: String(binding.leafId),
              ptyId: String(binding.ptyId),
              incarnationId: String(binding.incarnationId)
            })
            return true
          }
        )
      }
    }
    const runtime = new OrcaRuntimeService(store as never)
    runtime.registerPty(OLD_PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: 'inc-old',
      terminalHandle: OLD_HANDLE
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB, worktreeId: WORKTREE, title: 'Terminal', activeLeafId: LEAF, layout: null }
      ],
      leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: OLD_PTY }]
    })
    const respawnIfMatch = vi.fn(async () => ({
      outcome: 'respawned' as const,
      mutationId: 'old-respawn',
      ptyId: OLD_PTY,
      incarnationId: 'inc-old-next'
    }))
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } as never)
    const shown = await runtime.showTerminal(OLD_HANDLE)
    const result = { id: NEW_PTY, incarnationId: 'inc-new' }
    const commit = commitPtySpawn({
      state: {
        deps: { runtime, sendPtySpawnedToRenderer: vi.fn() },
        args: {
          cols: 80,
          rows: 24,
          connectionId: null,
          worktreeId: WORKTREE,
          tabId: TAB,
          launchAgent: undefined,
          resumeProviderSession: undefined,
          onResumeOutcome: undefined,
          telemetry: undefined
        },
        result,
        provider: { shutdown: vi.fn(async () => undefined) },
        cwd: '/tmp/worktree',
        metadataLeafId: LEAF,
        pendingRegistrationPtyId: NEW_PTY,
        paneSpawnReservationKey: null,
        paneSpawnReservation: null,
        effectiveSessionAppId: undefined,
        stablePaneOwner: null,
        sessionSizeBeforeAttach: undefined,
        isDaemonHostSpawn: false,
        codexResumeHomeSelected: false,
        selectedCodexHomePath: null,
        codexSelectionTarget: { runtime: 'host' },
        codexHomeLaunchStartedAt: undefined,
        codexHomeLaunchStartedSequence: undefined,
        reattachedCodexHomeRoutes: new Map(),
        launchCommand: undefined,
        preSpawnHiddenMarkId: null,
        replacedPaneOwner: {
          ptyId: OLD_PTY,
          pane: {
            worktreeId: WORKTREE,
            tabId: TAB,
            leafId: LEAF,
            hostId: undefined
          }
        }
      },
      nativeWindowsConptySpawn: false,
      seedPaneKey: `${TAB}:${LEAF}`,
      paneBinding: {
        store,
        binding: {
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF,
          ptyId: NEW_PTY,
          incarnationId: 'inc-new'
        },
        refusal: 'terminal_pane_owner_changed',
        failureLog: 'spawn race test'
      },
      registration: {
        store,
        worktreeId: WORKTREE,
        shellOverride: undefined,
        rendererLaunchAuthority: null
      },
      preAllocatedHandle: NEW_HANDLE,
      paneKey: `${TAB}:${LEAF}`,
      memorySessionId: null,
      resumeArgvDropped: false,
      codexLaunchEnv: undefined,
      initiallyHidden: false,
      hiddenDelivery: 'renderer-scoped',
      earlyExit: 'drain',
      joinPayload: { reservation: result, reply: result }
    } as never)
    await persistEntered.promise

    const respawn = runtime.respawnTerminalIfMatch({
      mutationId: 'old-respawn',
      terminal: OLD_HANDLE,
      expected: {
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: OLD_PTY,
        ptyGeneration: shown.ptyGeneration!,
        incarnationId: 'inc-old',
        rootProcessId: 4242
      },
      replacement: {}
    })
    await Promise.resolve()
    expect(respawnIfMatch).not.toHaveBeenCalled()

    continuePersist.resolve()
    await expect(commit).resolves.toMatchObject(result)
    await expect(respawn).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'terminal_identity_changed'
    })
    expect(respawnIfMatch).not.toHaveBeenCalled()
    await expect(runtime.showTerminal(NEW_HANDLE)).resolves.toMatchObject({
      ptyId: NEW_PTY,
      incarnationId: 'inc-new'
    })
  })
})
