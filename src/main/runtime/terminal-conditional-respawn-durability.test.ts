import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { TerminalLeafMutationLane } from '../terminal-leaf-mutation-lane'
import { withBoundPane } from './bind-first-pane.test-fixture'
import { OrcaRuntimeService } from './orca-runtime'

const WORKTREE = 'repo-1::/tmp/worktree'
const TAB = 'tab-1'
const LEAF = '11111111-1111-4111-8111-111111111111'
const STALE_TAB = 'tab-stale-move-source'
const STALE_LEAF = '22222222-2222-4222-8222-222222222222'
const PTY = 'pty-1'
const HANDLE = 'term_test'

function harness(
  persistReplacement: 'success' | 'refuse' | 'throw' = 'success',
  replacementStop: 'confirmed' | 'unverified' = 'confirmed'
) {
  const lane = new TerminalLeafMutationLane()
  let session: WorkspaceSessionState = withBoundPane(getDefaultWorkspaceSession(), {
    worktreeId: WORKTREE,
    tabId: TAB,
    leafId: LEAF,
    ptyId: PTY,
    incarnationId: 'inc-1'
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
    persistPtyBinding: async (binding: {
      worktreeId: string
      tabId: string
      leafId: string
      ptyId: string
      incarnationId?: string
      expectedBinding?: { ptyId: string; incarnationId?: string }
    }) => {
      if (persistReplacement === 'throw') {
        throw new Error('disk refused')
      }
      if (persistReplacement === 'refuse') {
        return false
      }
      const paneKey = `${binding.tabId}:${binding.leafId}`
      const currentPtyId =
        session.terminalLayoutsByTabId[binding.tabId]?.ptyIdsByLeafId?.[binding.leafId]
      const currentIncarnationId = session.terminalPtyIncarnationsByPaneKey?.[paneKey]
      if (
        binding.expectedBinding &&
        (currentPtyId !== binding.expectedBinding.ptyId ||
          currentIncarnationId !== binding.expectedBinding.incarnationId)
      ) {
        return false
      }
      session = withBoundPane(session, binding)
      return true
    },
    getSettings: () => ({
      workspaceDir: '/tmp',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: '',
      branchPrefixCustom: ''
    }),
    runTerminalLeafMutations: lane.run.bind(lane)
  }
  const runtime = new OrcaRuntimeService(store as never)
  let providerAlive = true
  const stopIncarnationIfMatch = vi.fn(async (ptyId: string, incarnationId: string) => {
    expect(ptyId).toBe(PTY)
    expect(incarnationId).toBe('inc-2')
    if (replacementStop === 'unverified') {
      return false
    }
    providerAlive = false
    return true
  })
  runtime.registerPty(PTY, WORKTREE, null, {
    tabId: TAB,
    leafId: LEAF,
    incarnationId: 'inc-1',
    terminalHandle: HANDLE
  })
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [
      { tabId: TAB, worktreeId: WORKTREE, title: 'Terminal', activeLeafId: LEAF, layout: null }
    ],
    leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
  })
  return Object.assign(runtime, {
    persistedSession: () => session,
    providerAlive: () => providerAlive,
    stopIncarnationIfMatch
  })
}

function addStaleMovedSurface(runtime: ReturnType<typeof harness>): void {
  runtime.syncWindowGraph(1, {
    tabs: [
      { tabId: TAB, worktreeId: WORKTREE, title: 'Terminal', activeLeafId: LEAF, layout: null },
      {
        tabId: STALE_TAB,
        worktreeId: WORKTREE,
        title: 'Stale move source',
        activeLeafId: STALE_LEAF,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: STALE_TAB,
        worktreeId: WORKTREE,
        leafId: STALE_LEAF,
        paneRuntimeId: 2,
        ptyId: PTY
      },
      { tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }
    ]
  })
}

async function conditionalRespawn(
  runtime: ReturnType<typeof harness>,
  result:
    | {
        outcome: 'respawned'
        mutationId: string
        ptyId: string
        incarnationId: string
      }
    | {
        outcome: 'partial'
        mutationId: string
        reason: 'replacement_not_published'
        oldStopped: true
        replacementStarted: true
        replacementPublished: false
        ptyId: string
        incarnationId: string
      }
) {
  runtime.setPtyController({
    write: () => true,
    kill: () => false,
    getSize: () => ({ cols: 80, rows: 24 }),
    getForegroundProcess: async () => null,
    stopIncarnationIfMatch: runtime.stopIncarnationIfMatch,
    respawnIfMatch: vi.fn(async () => result)
  } as never)
  const shown = await runtime.showTerminal(HANDLE)
  return runtime.respawnTerminalIfMatch({
    mutationId: result.mutationId,
    terminal: HANDLE,
    expected: {
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF,
      ptyId: PTY,
      ptyGeneration: shown.ptyGeneration!,
      incarnationId: 'inc-1'
    },
    replacement: {}
  })
}

describe('conditional terminal respawn durability', () => {
  it('persists the replacement incarnation before reporting respawn success', async () => {
    const runtime = harness()
    await expect(
      conditionalRespawn(runtime, {
        outcome: 'respawned',
        mutationId: 'mutation-persisted-replacement',
        ptyId: PTY,
        incarnationId: 'inc-2'
      })
    ).resolves.toMatchObject({ outcome: 'respawned', incarnationId: 'inc-2' })

    const persisted = runtime.persistedSession()
    expect(persisted.terminalLayoutsByTabId[TAB]?.ptyIdsByLeafId?.[LEAF]).toBe(PTY)
    expect(persisted.terminalPtyIncarnationsByPaneKey?.[`${TAB}:${LEAF}`]).toBe('inc-2')
  })

  it.each(['refuse', 'throw'] as const)(
    'fails closed when replacement persistence returns %s',
    async (persistReplacement) => {
      const runtime = harness(persistReplacement)
      await expect(
        conditionalRespawn(runtime, {
          outcome: 'respawned',
          mutationId: `mutation-persist-${persistReplacement}`,
          ptyId: PTY,
          incarnationId: 'inc-2'
        })
      ).resolves.toMatchObject({
        outcome: 'indeterminate',
        reason: 'replacement_binding_not_persisted_replacement_stopped',
        replacementStarted: true,
        incarnationId: 'inc-2'
      })
      expect(runtime.stopIncarnationIfMatch).toHaveBeenCalledExactlyOnceWith(PTY, 'inc-2')
      expect(runtime.providerAlive()).toBe(false)
      await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
        connected: false,
        writable: false
      })
      expect(
        runtime.persistedSession().terminalPtyIncarnationsByPaneKey?.[`${TAB}:${LEAF}`]
      ).not.toBe('inc-2')
    }
  )

  it('keeps an unverified live replacement recoverable in runtime state', async () => {
    const runtime = harness('refuse', 'unverified')
    await expect(
      conditionalRespawn(runtime, {
        outcome: 'respawned',
        mutationId: 'mutation-persist-stop-unverified',
        ptyId: PTY,
        incarnationId: 'inc-2'
      })
    ).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_binding_not_persisted_stop_unverified',
      replacementStarted: true,
      incarnationId: 'inc-2'
    })
    expect(runtime.providerAlive()).toBe(true)
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
      incarnationId: 'inc-2',
      connected: true,
      writable: true
    })
  })

  it('does not register an unpublished partial replacement', async () => {
    const runtime = harness()
    await expect(
      conditionalRespawn(runtime, {
        outcome: 'partial',
        mutationId: 'mutation-unpublished-replacement',
        reason: 'replacement_not_published',
        oldStopped: true,
        replacementStarted: true,
        replacementPublished: false,
        ptyId: PTY,
        incarnationId: 'inc-2'
      })
    ).resolves.toMatchObject({
      outcome: 'partial',
      replacementPublished: false,
      incarnationId: 'inc-2'
    })
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
      incarnationId: 'inc-1',
      connected: false,
      writable: false
    })
    expect(
      runtime.persistedSession().terminalPtyIncarnationsByPaneKey?.[`${TAB}:${LEAF}`]
    ).toBeUndefined()
  })

  it('holds every stale moved surface while a provider exit callback records the replacement exit', async () => {
    const runtime = harness()
    addStaleMovedSurface(runtime)
    const respawnIfMatch = vi.fn(async () => {
      await runtime.onPtyExit(PTY, 0, 'inc-2', { providerExitObserved: true })
      return {
        outcome: 'partial' as const,
        mutationId: 'mutation-stale-move-provider-exit',
        reason: 'replacement_exited_before_publication',
        oldStopped: true,
        replacementStarted: true,
        replacementPublished: true,
        ptyId: PTY,
        incarnationId: 'inc-2'
      }
    })
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } as never)
    const shown = await runtime.showTerminal(HANDLE)

    await expect(
      runtime.respawnTerminalIfMatch({
        mutationId: 'mutation-stale-move-provider-exit',
        terminal: HANDLE,
        expected: {
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF,
          ptyId: PTY,
          ptyGeneration: shown.ptyGeneration!,
          incarnationId: 'inc-1'
        },
        replacement: {}
      })
    ).resolves.toMatchObject({ outcome: 'partial', incarnationId: 'inc-2' })
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
      incarnationId: 'inc-2',
      connected: false,
      writable: false
    })
  })

  it('retires an unpublished partial across duplicate stale move surfaces without lane expansion', async () => {
    const runtime = harness()
    addStaleMovedSurface(runtime)

    await expect(
      conditionalRespawn(runtime, {
        outcome: 'partial',
        mutationId: 'mutation-stale-move-unpublished',
        reason: 'replacement_not_published',
        oldStopped: true,
        replacementStarted: true,
        replacementPublished: false,
        ptyId: PTY,
        incarnationId: 'inc-2'
      })
    ).resolves.toMatchObject({
      outcome: 'partial',
      replacementPublished: false,
      incarnationId: 'inc-2'
    })
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
      incarnationId: 'inc-1',
      connected: false,
      writable: false
    })
  })
})
