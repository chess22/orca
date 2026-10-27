import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { TerminalLeafMutationLane } from '../../../terminal-leaf-mutation-lane'

const WORKTREE = 'repo::/tmp/exact-stop'
const PTY = `${WORKTREE}@@terminal`
const TAB = '10000000-0000-4000-8000-000000000001'
const LEAF = '10000000-0000-4000-8000-000000000002'
const INCARNATION = '10000000-0000-4000-8000-000000000003'

class ExactStopRuntime extends OrcaRuntimeService {
  override resolveWorktreeSelector(selector: string) {
    return super.resolveWorktreeSelector(selector)
  }

  override getResolvedWorktreeMap() {
    return super.getResolvedWorktreeMap()
  }

  async overlappingInventory(): Promise<unknown> {
    return this.refreshPtyWorktreeRecordsWithControllerInventory(
      [...(await this.getResolvedWorktreeMap()).values()],
      null,
      undefined,
      null
    )
  }
}

function folderWorktree() {
  const git = {
    path: '/tmp/exact-stop',
    head: 'abc',
    branch: 'main',
    isBare: false,
    isMainWorktree: false
  }
  return {
    ...git,
    git,
    id: WORKTREE,
    repoId: 'repo',
    displayName: 'exact-stop',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    parentWorktreeId: null,
    childWorktreeIds: [],
    lineage: null
  }
}

describe('terminal.stopExact post-stop verification', () => {
  it.each(['general', 'exact'] as const)(
    'preclaims the SSH retirement leaf for a %s stop without expanding to an unrelated leaf',
    async (kind) => {
      const lane = new TerminalLeafMutationLane()
      const targetKey = {
        executionHostId: 'ssh:ssh-1' as const,
        worktreeId: WORKTREE,
        tabId: TAB,
        leafId: LEAF
      }
      const session = {
        tabsByWorktree: {
          [WORKTREE]: [{ id: TAB }],
          unrelated: [{ id: 'tab-unrelated' }]
        },
        terminalLayoutsByTabId: {
          [TAB]: { ptyIdsByLeafId: { [LEAF]: PTY } },
          'tab-unrelated': {
            ptyIdsByLeafId: {
              '20000000-0000-4000-8000-000000000002': 'ssh-unrelated-pty'
            }
          }
        },
        terminalPtyIncarnationsByPaneKey: { [`${TAB}:${LEAF}`]: INCARNATION }
      }
      const store = {
        runTerminalLeafMutations: lane.run.bind(lane),
        getSshPtyRetirementMutationKeys: () => [targetKey],
        getWorkspaceSessionHostIds: () => ['ssh:ssh-1'],
        getWorkspaceSession: () => session
      }
      const runtime = new ExactStopRuntime(store as never)
      const worktree = { ...folderWorktree(), hostId: 'ssh:ssh-1' as const }
      vi.spyOn(runtime, 'resolveWorktreeSelector').mockResolvedValue(worktree)
      vi.spyOn(runtime, 'getResolvedWorktreeMap').mockResolvedValue(new Map([[WORKTREE, worktree]]))
      let stopped = false
      const nestedRetirement = vi.fn(() =>
        store.runTerminalLeafMutations([targetKey], () => {
          runtime.onPtyExit(PTY, 0, INCARNATION, { providerExitObserved: true })
          stopped = true
          return true
        })
      )
      runtime.setPtyController({
        write: () => true,
        kill: () => true,
        stopAndWait: nestedRetirement,
        getForegroundProcess: async () => null,
        hasPty: () => !stopped,
        listProcesses: async () =>
          stopped
            ? []
            : [{ id: PTY, incarnationId: INCARNATION, cwd: worktree.path, title: 'terminal' }]
      })
      runtime.registerPty(PTY, WORKTREE, 'ssh-1', {
        tabId: TAB,
        leafId: LEAF,
        incarnationId: INCARNATION
      })
      runtime.syncWindowGraph(1, {
        tabs: [
          { tabId: TAB, worktreeId: WORKTREE, title: 'terminal', activeLeafId: LEAF, layout: null }
        ],
        leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
      })

      await (kind === 'general'
        ? expect(runtime.stopTerminalsForWorktree(`id:${WORKTREE}`)).resolves.toEqual({
            stopped: 1
          })
        : expect(
            runtime.stopExactTerminalsForWorktree(`id:${WORKTREE}`, [PTY], {
              keepHistory: true,
              targetOnly: true
            })
          ).resolves.toMatchObject({ stoppedPtyIds: [PTY], postStopVerified: true }))
      expect(nestedRetirement).toHaveBeenCalledOnce()
    }
  )

  it('does not stop a same-id replacement after a general stop waits for the leaf lane', async () => {
    let runtime!: ExactStopRuntime
    const store = {
      runTerminalLeafMutations: async (_keys: unknown, operation: () => Promise<unknown>) => {
        runtime.registerPty(PTY, WORKTREE, null, {
          tabId: TAB,
          leafId: LEAF,
          incarnationId: 'replacement-incarnation'
        })
        return await operation()
      }
    }
    runtime = new ExactStopRuntime(store as never)
    const worktree = folderWorktree()
    vi.spyOn(runtime, 'resolveWorktreeSelector').mockResolvedValue(worktree)
    const stopAndWait = vi.fn(async () => true)
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      stopAndWait,
      getForegroundProcess: async () => null
    })
    runtime.registerPty(PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: INCARNATION
    })
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB, worktreeId: WORKTREE, title: 'terminal', activeLeafId: LEAF, layout: null }
      ],
      leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
    })

    await expect(runtime.stopTerminalsForWorktree(`id:${WORKTREE}`)).resolves.toEqual({
      stopped: 0
    })
    expect(stopAndWait).not.toHaveBeenCalled()
  })

  it('does not stop a same-id replacement that appears while exact stop waits for the leaf lane', async () => {
    let runtime!: ExactStopRuntime
    const store = {
      runTerminalLeafMutations: async (_keys: unknown, operation: () => Promise<unknown>) => {
        runtime.registerPty(PTY, WORKTREE, null, {
          tabId: TAB,
          leafId: LEAF,
          incarnationId: 'replacement-incarnation'
        })
        return await operation()
      }
    }
    runtime = new ExactStopRuntime(store as never)
    const worktree = folderWorktree()
    vi.spyOn(runtime, 'resolveWorktreeSelector').mockResolvedValue(worktree)
    vi.spyOn(runtime, 'getResolvedWorktreeMap').mockResolvedValue(new Map([[WORKTREE, worktree]]))
    const stopAndWait = vi.fn(async () => true)
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      stopAndWait,
      getForegroundProcess: async () => null,
      hasPty: () => true,
      listProcesses: async () => [
        { id: PTY, incarnationId: INCARNATION, cwd: worktree.path, title: 'terminal' }
      ]
    })
    runtime.registerPty(PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: INCARNATION
    })
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB, worktreeId: WORKTREE, title: 'terminal', activeLeafId: LEAF, layout: null }
      ],
      leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
    })

    await expect(
      runtime.stopExactTerminalsForWorktree(`id:${WORKTREE}`, [PTY], {
        keepHistory: true,
        targetOnly: true
      })
    ).rejects.toThrow('terminal_exact_stop_pty_identity_changed')
    expect(stopAndWait).not.toHaveBeenCalled()
  })

  it('does not stop a same-incarnation pty reassigned to another worktree while waiting', async () => {
    const reassignedWorktree = 'repo::/tmp/reassigned'
    let runtime!: ExactStopRuntime
    const store = {
      runTerminalLeafMutations: async (_keys: unknown, operation: () => Promise<unknown>) => {
        runtime.registerPty(PTY, reassignedWorktree, null, {
          tabId: TAB,
          leafId: LEAF,
          incarnationId: INCARNATION
        })
        return await operation()
      }
    }
    runtime = new ExactStopRuntime(store as never)
    const worktree = folderWorktree()
    vi.spyOn(runtime, 'resolveWorktreeSelector').mockResolvedValue(worktree)
    vi.spyOn(runtime, 'getResolvedWorktreeMap').mockResolvedValue(new Map([[WORKTREE, worktree]]))
    const stopAndWait = vi.fn(async () => true)
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      stopAndWait,
      getForegroundProcess: async () => null,
      hasPty: () => true,
      listProcesses: async () => [
        { id: PTY, incarnationId: INCARNATION, cwd: worktree.path, title: 'terminal' }
      ]
    })
    runtime.registerPty(PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: INCARNATION
    })
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB, worktreeId: WORKTREE, title: 'terminal', activeLeafId: LEAF, layout: null }
      ],
      leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
    })

    await expect(
      runtime.stopExactTerminalsForWorktree(`id:${WORKTREE}`, [PTY], {
        keepHistory: true,
        targetOnly: true
      })
    ).rejects.toThrow('terminal_exact_stop_pty_identity_changed')
    expect(stopAndWait).not.toHaveBeenCalled()
  })

  it('verifies a confirmed stop even when an overlapping inventory voids its first check', async () => {
    const runtime = new ExactStopRuntime()
    const worktree = folderWorktree()
    vi.spyOn(runtime, 'resolveWorktreeSelector').mockResolvedValue(worktree)
    vi.spyOn(runtime, 'getResolvedWorktreeMap').mockResolvedValue(new Map([[WORKTREE, worktree]]))
    let stopped = false
    let overlapped: Promise<unknown> | null = null
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      stopAndWait: async () => {
        runtime.onPtyExit(PTY, 0, INCARNATION, { providerExitObserved: true })
        stopped = true
        return true
      },
      getForegroundProcess: async () => null,
      hasPty: () => !stopped,
      listProcesses: async () => {
        if (!stopped) {
          return [{ id: PTY, incarnationId: INCARNATION, cwd: worktree.path, title: 'terminal' }]
        }
        // Why: the exit's own session republish starts a newer inventory mid-check, as on a loaded host.
        overlapped ??= runtime.overlappingInventory()
        return []
      }
    })
    runtime.registerPty(PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: INCARNATION
    })
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB, worktreeId: WORKTREE, title: 'terminal', activeLeafId: LEAF, layout: null }
      ],
      leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId: PTY }]
    })

    const result = await runtime.stopExactTerminalsForWorktree(`id:${WORKTREE}`, [PTY], {
      keepHistory: true,
      targetOnly: true
    })
    await overlapped

    expect(overlapped).not.toBeNull()
    expect(result).toMatchObject({ stoppedPtyIds: [PTY], postStopVerified: true })
  })
})
