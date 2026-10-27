import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { TerminalLeafMutationLane } from '../terminal-leaf-mutation-lane'
import { withBoundPane } from './bind-first-pane.test-fixture'
import { OrcaRuntimeService } from './orca-runtime'
import { terminalEmptyLeafTombstoneId } from '../../shared/terminal-empty-leaf-recovery'
import type { RuntimePtyController } from './runtime-pty-controller-contract'

const WORKTREE = 'repo-1::/tmp/worktree'
const TAB = 'tab-1'
const LEAF = '11111111-1111-4111-8111-111111111111'
const STALE_TAB = 'tab-stale-move-source'
const STALE_LEAF = '22222222-2222-4222-8222-222222222222'
const PTY = 'pty-1'
const HANDLE = 'term_test'

function harness(
  persistReplacement: 'success' | 'refuse' | 'throw' | 'rollback-throw' = 'success',
  replacementStop: 'confirmed' | 'unverified' | 'throw' = 'confirmed'
) {
  const lane = new TerminalLeafMutationLane()
  let session: WorkspaceSessionState = withBoundPane(getDefaultWorkspaceSession(), {
    worktreeId: WORKTREE,
    tabId: TAB,
    leafId: LEAF,
    ptyId: PTY,
    incarnationId: 'inc-1'
  })
  const store: ConstructorParameters<typeof OrcaRuntimeService>[0] = Object.assign(
    Object.create(null),
    {
      getRepos: () => [
        { id: 'repo-1', path: '/tmp/worktree', displayName: 'Repo', badgeColor: '#000', addedAt: 1 }
      ],
      getRepo: () => undefined,
      getAllWorktreeMeta: () => ({}),
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
        if (
          persistReplacement === 'throw' ||
          (persistReplacement === 'rollback-throw' &&
            binding.expectedBinding?.incarnationId === 'inc-2')
        ) {
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
  )
  const runtime = new OrcaRuntimeService(store)
  let providerAlive = true
  const stopIncarnationIfMatch = vi.fn(async (ptyId: string, incarnationId: string) => {
    expect(ptyId).toBe(PTY)
    expect(incarnationId).toBe('inc-2')
    if (replacementStop === 'unverified') {
      return false
    }
    if (replacementStop === 'throw') {
      throw new Error('stop response lost')
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
    replacePersistedIncarnation: (incarnationId: string) => {
      session = withBoundPane(session, {
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        incarnationId
      })
    },
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
  } satisfies RuntimePtyController)
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
      incarnationId: 'inc-1',
      rootProcessId: 4242
    },
    replacement: {}
  })
}

async function prepareEmptyLeafRecovery(runtime: ReturnType<typeof harness>) {
  const shown = await runtime.showTerminal(HANDLE)
  const ptysById: Map<
    string,
    {
      connected: boolean
      incarnationId: string | null
      agentSessionOwnershipKnown?: boolean
    }
  > = Reflect.get(runtime, 'ptysById')
  const leaves: Map<string, { connected: boolean; writable: boolean; ptyGeneration: number }> =
    Reflect.get(runtime, 'leaves')
  const getLeafKey: (tabId: string, leafId: string) => string = Reflect.get(runtime, 'getLeafKey')
  const captureReadyGraphEpoch: () => number = Reflect.get(runtime, 'captureReadyGraphEpoch')
  const pty = ptysById.get(PTY)!
  const leaf = leaves.get(getLeafKey.call(runtime, TAB, LEAF))!
  pty.connected = false
  pty.agentSessionOwnershipKnown = true
  leaf.connected = false
  leaf.writable = false
  return {
    request: {
      originalMutationId: 'mutation-1',
      recoveryId: 'recovery-1',
      terminal: HANDLE,
      expected: {
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        ptyGeneration: shown.ptyGeneration!,
        retiredIncarnationId: 'inc-1',
        layoutEpoch: captureReadyGraphEpoch.call(runtime),
        persistedBindingVersion: shown.ptyGeneration!,
        tombstoneId: terminalEmptyLeafTombstoneId(PTY, 'inc-1')
      },
      replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 80, rows: 24 }
    }
  }
}

describe('conditional terminal respawn durability', () => {
  it('recovers a real retained empty leaf once and replays the runtime result', async () => {
    const runtime = harness()
    const { request } = await prepareEmptyLeafRecovery(runtime)
    const recoverEmptyLeafIfMatch = vi.fn(async () => ({
      outcome: 'recovered' as const,
      recoveryId: 'recovery-1',
      ptyId: PTY,
      incarnationId: 'inc-2',
      processId: 202
    }))
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      recoverEmptyLeafIfMatch,
      completeEmptyLeafRecovery: async () => true
    } satisfies RuntimePtyController)

    const [first, replay] = await Promise.all([
      runtime.recoverTerminalEmptyLeafIfMatch(request),
      runtime.recoverTerminalEmptyLeafIfMatch(request)
    ])

    expect(first).toMatchObject({ outcome: 'recovered', incarnationId: 'inc-2' })
    expect(replay).toMatchObject({ outcome: 'recovered', incarnationId: 'inc-2', replayed: true })
    expect(recoverEmptyLeafIfMatch).toHaveBeenCalledOnce()
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
      ptyId: PTY,
      incarnationId: 'inc-2',
      connected: true
    })
  })

  it('rolls the persisted binding and runtime registration back when daemon commit fails', async () => {
    const runtime = harness()
    const { request } = await prepareEmptyLeafRecovery(runtime)
    const completeEmptyLeafRecovery = vi
      .fn<
        (
          recoveryId: string,
          ptyId: string,
          incarnationId: string,
          commit: boolean
        ) => Promise<boolean>
      >()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      recoverEmptyLeafIfMatch: async () => ({
        outcome: 'recovered',
        recoveryId: request.recoveryId,
        ptyId: PTY,
        incarnationId: 'inc-2',
        processId: 202
      }),
      completeEmptyLeafRecovery,
      stopIncarnationIfMatch: runtime.stopIncarnationIfMatch
    } satisfies RuntimePtyController)

    await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_published_replacement_stopped',
      incarnationId: 'inc-2'
    })
    expect(runtime.persistedSession().terminalPtyIncarnationsByPaneKey?.[`${TAB}:${LEAF}`]).toBe(
      'inc-1'
    )
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
      incarnationId: 'inc-1',
      connected: false,
      writable: false
    })
    expect(runtime.stopIncarnationIfMatch).toHaveBeenCalledExactlyOnceWith(PTY, 'inc-2')
  })

  it('reports an indeterminate commit failure when a binding race defeats rollback CAS', async () => {
    const runtime = harness()
    const { request } = await prepareEmptyLeafRecovery(runtime)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      recoverEmptyLeafIfMatch: async () => ({
        outcome: 'recovered',
        recoveryId: request.recoveryId,
        ptyId: PTY,
        incarnationId: 'inc-2',
        processId: 202
      }),
      completeEmptyLeafRecovery: async (
        _recoveryId: string,
        _ptyId: string,
        _incarnationId: string,
        commit: boolean
      ) => {
        if (commit) {
          runtime.replacePersistedIncarnation('inc-raced')
        }
        return !commit
      },
      stopIncarnationIfMatch: runtime.stopIncarnationIfMatch
    } satisfies RuntimePtyController)

    await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_published_binding_rollback_unverified',
      incarnationId: 'inc-2'
    })
    expect(runtime.persistedSession().terminalPtyIncarnationsByPaneKey?.[`${TAB}:${LEAF}`]).toBe(
      'inc-raced'
    )
  })

  it.each([
    ['false', 'confirmed'],
    ['reject', 'confirmed'],
    ['false', 'unverified'],
    ['reject', 'throw']
  ] as const)(
    'reports daemon abort %s with exact-stop %s as indeterminate after containment attempt',
    async (abortFailure, stopMode) => {
      const runtime = harness('success', stopMode)
      const { request } = await prepareEmptyLeafRecovery(runtime)
      const completeEmptyLeafRecovery = vi
        .fn<
          (
            recoveryId: string,
            ptyId: string,
            incarnationId: string,
            commit: boolean
          ) => Promise<boolean>
        >()
        .mockResolvedValueOnce(false)
      if (abortFailure === 'false') {
        completeEmptyLeafRecovery.mockResolvedValueOnce(false)
      } else {
        completeEmptyLeafRecovery.mockRejectedValueOnce(new Error('abort response lost'))
      }
      runtime.setPtyController({
        write: () => true,
        kill: () => false,
        getForegroundProcess: async () => null,
        recoverEmptyLeafIfMatch: async () => ({
          outcome: 'recovered',
          recoveryId: request.recoveryId,
          ptyId: PTY,
          incarnationId: 'inc-2',
          processId: 202
        }),
        completeEmptyLeafRecovery,
        stopIncarnationIfMatch: runtime.stopIncarnationIfMatch
      } satisfies RuntimePtyController)

      await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
        outcome: 'indeterminate',
        reason: 'replacement_not_published_abort_unverified'
      })
      expect(runtime.stopIncarnationIfMatch).toHaveBeenCalledExactlyOnceWith(PTY, 'inc-2')
    }
  )

  it('retries only daemon abort after commit and abort response loss', async () => {
    const runtime = harness()
    const { request } = await prepareEmptyLeafRecovery(runtime)
    const recoverEmptyLeafIfMatch = vi.fn(async () => ({
      outcome: 'recovered' as const,
      recoveryId: request.recoveryId,
      ptyId: PTY,
      incarnationId: 'inc-2',
      processId: 202
    }))
    const completeEmptyLeafRecovery = vi
      .fn<
        (
          recoveryId: string,
          ptyId: string,
          incarnationId: string,
          commit: boolean
        ) => Promise<boolean>
      >()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('abort response lost'))
      .mockResolvedValueOnce(true)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      recoverEmptyLeafIfMatch,
      completeEmptyLeafRecovery,
      stopIncarnationIfMatch: runtime.stopIncarnationIfMatch
    } satisfies RuntimePtyController)

    await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_published_abort_unverified'
    })
    await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_published_replacement_stopped',
      replayed: true
    })
    expect(recoverEmptyLeafIfMatch).toHaveBeenCalledOnce()
    expect(completeEmptyLeafRecovery).toHaveBeenCalledTimes(3)
    expect(runtime.stopIncarnationIfMatch).toHaveBeenCalledOnce()
  })

  it('contains a replacement when initial persistence rejects', async () => {
    const runtime = harness('throw')
    const { request } = await prepareEmptyLeafRecovery(runtime)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      recoverEmptyLeafIfMatch: async () => ({
        outcome: 'recovered',
        recoveryId: request.recoveryId,
        ptyId: PTY,
        incarnationId: 'inc-2',
        processId: 202
      }),
      completeEmptyLeafRecovery: async () => true,
      stopIncarnationIfMatch: runtime.stopIncarnationIfMatch
    } satisfies RuntimePtyController)

    await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_persisted_binding_rollback_unverified'
    })
    expect(runtime.stopIncarnationIfMatch).toHaveBeenCalledExactlyOnceWith(PTY, 'inc-2')
    expect(runtime.providerAlive()).toBe(false)
  })

  it.each([
    ['reverse-CAS rejection', 'rollback-throw', 'confirmed'],
    ['exact-stop rejection', 'success', 'throw']
  ] as const)('contains production %s as indeterminate', async (_case, persistMode, stopMode) => {
    const runtime = harness(persistMode, stopMode)
    const { request } = await prepareEmptyLeafRecovery(runtime)
    const completeEmptyLeafRecovery = vi
      .fn<
        (
          recoveryId: string,
          ptyId: string,
          incarnationId: string,
          commit: boolean
        ) => Promise<boolean>
      >()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      recoverEmptyLeafIfMatch: async () => ({
        outcome: 'recovered',
        recoveryId: request.recoveryId,
        ptyId: PTY,
        incarnationId: 'inc-2',
        processId: 202
      }),
      completeEmptyLeafRecovery,
      stopIncarnationIfMatch: runtime.stopIncarnationIfMatch
    } satisfies RuntimePtyController)

    await expect(runtime.recoverTerminalEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason:
        persistMode === 'rollback-throw'
          ? 'replacement_not_published_binding_rollback_unverified'
          : 'replacement_not_published_stop_unverified'
    })
  })

  it('replays an exact runtime request without calling the provider twice', async () => {
    const runtime = harness()
    const respawnIfMatch = vi.fn(async () => ({
      outcome: 'respawned' as const,
      mutationId: 'mutation-runtime-replay',
      ptyId: PTY,
      incarnationId: 'inc-2'
    }))
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } satisfies RuntimePtyController)
    const shown = await runtime.showTerminal(HANDLE)
    const request = {
      mutationId: 'mutation-runtime-replay',
      terminal: HANDLE,
      expected: {
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        ptyGeneration: shown.ptyGeneration!,
        incarnationId: 'inc-1',
        rootProcessId: 4242
      },
      replacement: { command: 'relay' }
    }

    const first = await runtime.respawnTerminalIfMatch(request)
    await expect(runtime.respawnTerminalIfMatch(request)).resolves.toEqual({
      ...first,
      replayed: true
    })
    expect(respawnIfMatch).toHaveBeenCalledOnce()
  })

  it('refuses a changed runtime request that reuses a recorded mutation id', async () => {
    const runtime = harness()
    const respawnIfMatch = vi.fn(async () => ({
      outcome: 'respawned' as const,
      mutationId: 'mutation-runtime-reused',
      ptyId: PTY,
      incarnationId: 'inc-2'
    }))
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } satisfies RuntimePtyController)
    const shown = await runtime.showTerminal(HANDLE)
    const original = {
      mutationId: 'mutation-runtime-reused',
      terminal: HANDLE,
      expected: {
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        ptyGeneration: shown.ptyGeneration!,
        incarnationId: 'inc-1',
        rootProcessId: 4242
      },
      replacement: { command: 'relay' }
    }

    await runtime.respawnTerminalIfMatch(original)
    await expect(
      runtime.respawnTerminalIfMatch({
        ...original,
        replacement: { command: 'different-command' }
      })
    ).resolves.toEqual({
      outcome: 'precondition_failed',
      mutationId: 'mutation-runtime-reused',
      reason: 'mutation_id_reused'
    })
    expect(respawnIfMatch).toHaveBeenCalledOnce()
  })

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
    } satisfies RuntimePtyController)
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
          incarnationId: 'inc-1',
          rootProcessId: 4242
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
