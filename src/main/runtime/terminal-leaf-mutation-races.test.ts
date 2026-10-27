import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { OrcaRuntimeService } from './orca-runtime'
import { TerminalLeafMutationLane } from '../terminal-leaf-mutation-lane'
import { withBoundPane } from './bind-first-pane.test-fixture'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'

const WORKTREE = 'repo-1::/tmp/worktree'
const TAB = 'tab-1'
const LEAF = '11111111-1111-4111-8111-111111111111'
const PTY = 'pty-1'
const HANDLE = 'term_test'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => (resolve = next))
  return { promise, resolve }
}

function harness(options: { ptyIssuedHandle?: boolean; syncGraph?: boolean } = {}) {
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
  runtime.registerPty(PTY, WORKTREE, null, {
    tabId: TAB,
    leafId: LEAF,
    incarnationId: 'inc-1',
    ...(options.ptyIssuedHandle === false ? {} : { terminalHandle: HANDLE })
  })
  if (options.syncGraph !== false) {
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: TAB,
          worktreeId: WORKTREE,
          title: 'Terminal',
          activeLeafId: LEAF,
          layout: null
        }
      ],
      leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
    })
  }
  return Object.assign(runtime, { persistedSession: () => session })
}

async function pendingRespawn() {
  const runtime = harness()
  const provider = deferred<{
    outcome: 'respawned'
    mutationId: string
    ptyId: string
    incarnationId: string
  }>()
  const respawnIfMatch = vi.fn(() => provider.promise)
  runtime.setPtyController({
    write: () => true,
    kill: () => false,
    getSize: () => ({ cols: 80, rows: 24 }),
    getForegroundProcess: async () => null,
    respawnIfMatch
  } as never)
  const shown = await runtime.showTerminal(HANDLE)
  const respawn = runtime.respawnTerminalIfMatch({
    mutationId: 'mutation-1',
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
  await vi.waitFor(() => expect(respawnIfMatch).toHaveBeenCalled())
  return { runtime, provider, respawn, respawnIfMatch }
}

describe('terminal leaf mutation serialization', () => {
  it.each([
    { stopConfirmed: true, reason: 'graph_changed_after_respawn_replacement_stopped' },
    { stopConfirmed: false, reason: 'graph_changed_after_respawn_stop_unverified' }
  ])(
    'recovers a published replacement after a graph race (stop confirmed: $stopConfirmed)',
    async ({ stopConfirmed, reason }) => {
      const runtime = harness()
      const provider = deferred<{
        outcome: 'respawned'
        mutationId: string
        ptyId: string
        incarnationId: string
      }>()
      const respawnIfMatch = vi.fn(() => provider.promise)
      const stopIncarnationIfMatch = vi.fn(async () => stopConfirmed)
      runtime.setPtyController({
        write: () => true,
        kill: () => false,
        getSize: () => ({ cols: 80, rows: 24 }),
        getForegroundProcess: async () => null,
        respawnIfMatch,
        stopIncarnationIfMatch
      } as never)
      const shown = await runtime.showTerminal(HANDLE)
      const respawn = runtime.respawnTerminalIfMatch({
        mutationId: `mutation-graph-race-${String(stopConfirmed)}`,
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
      await vi.waitFor(() => expect(respawnIfMatch).toHaveBeenCalledOnce())
      expect(runtime.markRendererReloading(1)).not.toBeNull()
      provider.resolve({
        outcome: 'respawned',
        mutationId: `mutation-graph-race-${String(stopConfirmed)}`,
        ptyId: PTY,
        incarnationId: 'inc-2'
      })

      await expect(respawn).resolves.toMatchObject({ outcome: 'indeterminate', reason })
      expect(stopIncarnationIfMatch).toHaveBeenCalledExactlyOnceWith(PTY, 'inc-2')
      if (stopConfirmed) {
        const pty = (
          runtime as unknown as { ptysById: Map<string, { connected: boolean }> }
        ).ptysById.get(PTY)
        expect(pty?.connected).toBe(false)
      } else {
        await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
          incarnationId: 'inc-2',
          connected: true
        })
      }
    }
  )

  it('retires an early replacement exit after conditional registration', async () => {
    const runtime = harness()
    const respawnIfMatch = vi.fn(async () => {
      void runtime.onPtyExit(PTY, 0, 'inc-2', { providerExitObserved: true })
      return {
        outcome: 'partial' as const,
        mutationId: 'mutation-early-exit',
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
        mutationId: 'mutation-early-exit',
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
    await vi.waitFor(async () => {
      await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({
        incarnationId: 'inc-2',
        connected: false,
        writable: false
      })
    })
  })

  it('keeps an explicit close stop ahead of a replacement on the same leaf', async () => {
    const runtime = harness()
    const stopped = deferred<boolean>()
    const respawned = deferred<{
      outcome: 'respawned'
      mutationId: string
      ptyId: string
      incarnationId: string
    }>()
    const stopAndWait = vi.fn(() => stopped.promise)
    const respawnIfMatch = vi.fn(() => respawned.promise)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      stopAndWait,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } as never)
    const shown = await runtime.showTerminal(HANDLE)
    const close = runtime.closeTerminal(HANDLE)
    await vi.waitFor(() => expect(stopAndWait).toHaveBeenCalledWith(PTY, expect.anything()))
    const respawn = runtime.respawnTerminalIfMatch({
      mutationId: 'mutation-after-close',
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
    await Promise.resolve()
    expect(respawnIfMatch).not.toHaveBeenCalled()
    stopped.resolve(true)
    await close
    await vi.waitFor(() => expect(respawnIfMatch).toHaveBeenCalledOnce())
    respawned.resolve({
      outcome: 'respawned',
      mutationId: 'mutation-after-close',
      ptyId: PTY,
      incarnationId: 'inc-2'
    })
    await respawn
    expect(stopAndWait.mock.invocationCallOrder[0]).toBeLessThan(
      respawnIfMatch.mock.invocationCallOrder[0]!
    )
  })

  it('refuses a queued close after the same leaf is replaced', async () => {
    const { runtime, provider, respawn, respawnIfMatch } = await pendingRespawn()
    const kill = vi.fn(() => false)
    const stopAndWait = vi.fn(async () => true)
    runtime.setPtyController({
      write: () => true,
      kill,
      stopAndWait,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } as never)
    const close = runtime.closeTerminal(HANDLE)
    provider.resolve({
      outcome: 'respawned',
      mutationId: 'mutation-1',
      ptyId: PTY,
      incarnationId: 'inc-2'
    })
    await respawn

    await expect(close).rejects.toThrow('terminal_handle_stale')
    expect(stopAndWait).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('refuses a queued close after the same pty incarnation is reassigned', async () => {
    const runtime = harness({ syncGraph: false })
    const kill = vi.fn(() => false)
    const stopAndWait = vi.fn(async () => true)
    runtime.setPtyController({
      write: () => true,
      kill,
      stopAndWait,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null
    } as never)
    const entered = deferred<void>()
    const release = deferred<void>()
    const holder = runtime.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: WORKTREE, tabId: TAB, leafId: LEAF }],
      async () => {
        entered.resolve()
        await release.promise
        runtime.registerPty(PTY, 'repo-2::/tmp/reassigned', null, {
          tabId: 'tab-2',
          leafId: '22222222-2222-4222-8222-222222222222',
          incarnationId: 'inc-1'
        })
      }
    )
    await entered.promise

    expect(runtime['captureTerminalCloseIdentity'](HANDLE)?.kind).toBe('pty')
    const close = runtime.closeTerminal(HANDLE)
    const closeRejected = expect(close).rejects.toThrow('terminal_handle_stale')
    await Promise.resolve()
    expect(stopAndWait).not.toHaveBeenCalled()

    release.resolve()
    await holder
    expect(runtime['captureTerminalCloseIdentity'](HANDLE)).toMatchObject({
      kind: 'pty',
      worktreeId: 'repo-2::/tmp/reassigned'
    })
    await closeRejected
    expect(stopAndWait).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('refuses a stale respawn after the same pty incarnation moves to another worktree', async () => {
    const runtime = harness()
    const respawnIfMatch = vi.fn()
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch
    } as never)
    const shown = await runtime.showTerminal(HANDLE)
    const entered = deferred<void>()
    const release = deferred<void>()
    const holder = runtime.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: WORKTREE, tabId: TAB, leafId: LEAF }],
      async () => {
        entered.resolve()
        await release.promise
        runtime.registerPty(PTY, 'repo-2::/tmp/reassigned', null, {
          tabId: TAB,
          leafId: LEAF,
          incarnationId: 'inc-1'
        })
      }
    )
    await entered.promise
    const respawn = runtime.respawnTerminalIfMatch({
      mutationId: 'mutation-stale-worktree',
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
    await Promise.resolve()
    expect(respawnIfMatch).not.toHaveBeenCalled()

    release.resolve()
    await holder
    await expect(respawn).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'terminal_identity_changed'
    })
    expect(respawnIfMatch).not.toHaveBeenCalled()
  })

  it('allows nested ownership of the same leaf without releasing the outer lane', async () => {
    const lane = new TerminalLeafMutationLane()
    const key = {
      executionHostId: 'local' as const,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: LEAF
    }
    const order: string[] = []
    await lane.run([key], async () => {
      order.push('outer-start')
      await lane.run([key], () => order.push('inner'))
      order.push('outer-end')
    })
    expect(order).toEqual(['outer-start', 'inner', 'outer-end'])
  })

  it('refuses nested key expansion instead of deadlocking behind an inverse waiter', async () => {
    const lane = new TerminalLeafMutationLane()
    const keyA = {
      executionHostId: 'local' as const,
      worktreeId: WORKTREE,
      tabId: TAB,
      leafId: '11111111-1111-4111-8111-111111111112'
    }
    const keyB = { ...keyA, leafId: '11111111-1111-4111-8111-111111111113' }
    const entered = deferred<void>()
    const continueOuter = deferred<void>()
    const outer = lane.run([keyB], async () => {
      entered.resolve()
      await continueOuter.promise
      await expect(lane.run([keyA, keyB], async () => undefined)).rejects.toThrow(
        'terminal_leaf_mutation_nested_key_expansion'
      )
    })
    await entered.promise
    const inverse = lane.run([keyA, keyB], async () => undefined)
    continueOuter.resolve()
    await outer
    await inverse
  })

  it('serializes the same leaf across an execution-host partition change', async () => {
    const lane = new TerminalLeafMutationLane()
    const held = deferred<void>()
    let outerEntered = false
    let nextEntered = false
    const outer = lane.run(
      [
        {
          executionHostId: 'ssh:old-host',
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF
        }
      ],
      async () => {
        outerEntered = true
        await held.promise
      }
    )
    await vi.waitFor(() => expect(outerEntered).toBe(true))

    const next = lane.run(
      [
        {
          executionHostId: 'runtime:new-host',
          worktreeId: WORKTREE,
          tabId: TAB,
          leafId: LEAF
        }
      ],
      () => {
        nextEntered = true
      }
    )
    await Promise.resolve()
    expect(nextEntered).toBe(false)

    held.resolve()
    await outer
    await next
    expect(nextEntered).toBe(true)
  })

  it('makes a graph rebind wait for conditional respawn registration', async () => {
    const { runtime, provider, respawn } = await pendingRespawn()
    let finished = false
    const graph = runtime
      .syncWindowGraphSerialized(1, {
        tabs: [
          { tabId: TAB, worktreeId: WORKTREE, title: 'Terminal', activeLeafId: LEAF, layout: null }
        ],
        leaves: [
          { tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: 'pty-other' }
        ]
      })
      .then(() => {
        finished = true
      })
    await Promise.resolve()
    expect(finished).toBe(false)
    provider.resolve({
      outcome: 'respawned',
      mutationId: 'mutation-1',
      ptyId: PTY,
      incarnationId: 'inc-2'
    })
    await expect(respawn).resolves.toMatchObject({ outcome: 'respawned' })
    await graph
    expect(finished).toBe(true)
  })

  it('makes a same-leaf persisted mutation wait for conditional respawn', async () => {
    const { runtime, provider, respawn } = await pendingRespawn()
    let persisted = false
    const binding = runtime.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: WORKTREE, tabId: TAB, leafId: LEAF }],
      () => {
        persisted = true
      }
    )
    await Promise.resolve()
    expect(persisted).toBe(false)
    provider.resolve({
      outcome: 'respawned',
      mutationId: 'mutation-1',
      ptyId: PTY,
      incarnationId: 'inc-2'
    })
    await respawn
    await binding
    expect(persisted).toBe(true)
  })

  it('allows an unrelated leaf to proceed while conditional respawn awaits its provider', async () => {
    const { runtime, provider, respawn } = await pendingRespawn()
    let ran = false
    await runtime.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: WORKTREE, tabId: 'tab-2', leafId: 'leaf-2' }],
      () => {
        ran = true
      }
    )
    expect(ran).toBe(true)
    provider.resolve({
      outcome: 'respawned',
      mutationId: 'mutation-1',
      ptyId: PTY,
      incarnationId: 'inc-2'
    })
    await respawn
  })

  it('shows only the exact current incarnation root process id', async () => {
    const runtime = harness()
    const listProcesses = vi.fn(async () => [
      { id: PTY, incarnationId: 'inc-1', rootProcessId: 4242, cwd: '/tmp/worktree', title: 'shell' }
    ])
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      listProcesses
    } as never)
    await expect(runtime.showTerminal(HANDLE)).resolves.toMatchObject({ rootProcessId: 4242 })
    listProcesses.mockResolvedValueOnce([
      {
        id: PTY,
        incarnationId: 'inc-other',
        rootProcessId: 5151,
        cwd: '/tmp/worktree',
        title: 'shell'
      }
    ])
    expect((await runtime.showTerminal(HANDLE)).rootProcessId).toBeUndefined()
  })

  it('shows the exact root process id through a leaf-issued handle', async () => {
    const runtime = harness({ ptyIssuedHandle: false })
    const { handle } = runtime.resolveTerminalPane(`${TAB}:${LEAF}`, WORKTREE)
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getForegroundProcess: async () => null,
      listProcesses: async () => [
        {
          id: PTY,
          incarnationId: 'inc-1',
          rootProcessId: 4242,
          cwd: '/tmp/worktree',
          title: 'shell'
        }
      ]
    } as never)

    await expect(runtime.showTerminal(handle)).resolves.toMatchObject({ rootProcessId: 4242 })
  })
})
