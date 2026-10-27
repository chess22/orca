import {
  closeTestStores,
  testState,
  createStore,
  createStoreWithSshRemotePtyLeases
} from './persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { TEST_LEAF_1, TEST_LEAF_2 } from './persistence-session-fixtures'
import { PtyExitProof } from './pty-exit-proof'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))
const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

vi.mock('./telemetry/client', () => ({
  track: trackMock
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

async function storeWithBoundSshPane(
  unscopedLease = false
): Promise<Awaited<ReturnType<typeof createStore>>> {
  const store = createStoreWithSshRemotePtyLeases([
    {
      targetId: 'ssh-1',
      ptyId: 'remote-pty',
      ...(unscopedLease ? {} : { worktreeId: 'wt1', tabId: 'tab1', leafId: TEST_LEAF_1 }),
      state: 'attached'
    }
  ])
  store.setWorkspaceSession({
    activeRepoId: 'r1',
    activeWorktreeId: 'wt1',
    activeTabId: 'tab1',
    tabsByWorktree: {
      wt1: [
        {
          id: 'tab1',
          worktreeId: 'wt1',
          title: 'Terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1,
          ptyId: 'ssh:ssh-1@@remote-pty'
        }
      ]
    },
    terminalLayoutsByTabId: {
      tab1: {
        root: { type: 'leaf', leafId: TEST_LEAF_1 },
        activeLeafId: TEST_LEAF_1,
        expandedLeafId: null,
        ptyIdsByLeafId: { [TEST_LEAF_1]: 'ssh:ssh-1@@remote-pty' }
      }
    }
  })
  return store
}

describe('Store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })
  it('merges missing prior layout bindings into partial renderer snapshots', async () => {
    const store = createStoreWithSshRemotePtyLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty-1',
        worktreeId: 'wt1',
        tabId: 'tab1',
        leafId: TEST_LEAF_1,
        state: 'detached'
      },
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty-2',
        worktreeId: 'wt1',
        tabId: 'tab1',
        leafId: TEST_LEAF_2,
        state: 'detached'
      }
    ])
    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'remote-pty-1'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: TEST_LEAF_1 },
            second: { type: 'leaf', leafId: TEST_LEAF_2 },
            ratio: 0.5
          },
          activeLeafId: TEST_LEAF_2,
          expandedLeafId: null,
          ptyIdsByLeafId: {
            [TEST_LEAF_1]: 'remote-pty-1',
            [TEST_LEAF_2]: 'remote-pty-2'
          }
        }
      }
    })

    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'remote-pty-1'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: TEST_LEAF_1 },
            second: { type: 'leaf', leafId: TEST_LEAF_2 },
            ratio: 0.5
          },
          activeLeafId: TEST_LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_1]: 'remote-pty-1' }
        }
      }
    })

    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({
      [TEST_LEAF_1]: 'remote-pty-1',
      [TEST_LEAF_2]: 'remote-pty-2'
    })
  })

  // Expired leases still prove a sibling may run remotely; terminated leases must not restore its binding.
  it.each([
    ['expired', { [TEST_LEAF_1]: 'remote-pty-1', [TEST_LEAF_2]: 'remote-pty-2' }],
    ['terminated', { [TEST_LEAF_1]: 'remote-pty-1' }]
  ] as const)(
    'repairs a partial renderer snapshot for a %s sibling lease only when it is not terminated',
    async (siblingState, expected) => {
      const store = createStoreWithSshRemotePtyLeases([
        {
          targetId: 'ssh-1',
          ptyId: 'remote-pty-1',
          worktreeId: 'wt1',
          tabId: 'tab1',
          leafId: TEST_LEAF_1,
          state: 'detached'
        },
        {
          targetId: 'ssh-1',
          ptyId: 'remote-pty-2',
          worktreeId: 'wt1',
          tabId: 'tab1',
          leafId: TEST_LEAF_2,
          state: siblingState
        }
      ])
      const layout = {
        root: {
          type: 'split' as const,
          direction: 'horizontal' as const,
          first: { type: 'leaf' as const, leafId: TEST_LEAF_1 },
          second: { type: 'leaf' as const, leafId: TEST_LEAF_2 },
          ratio: 0.5
        },
        activeLeafId: TEST_LEAF_1,
        expandedLeafId: null
      }
      const tabs = {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: null
          }
        ]
      }
      store.setWorkspaceSession({
        activeRepoId: 'r1',
        activeWorktreeId: 'wt1',
        activeTabId: 'tab1',
        tabsByWorktree: tabs,
        terminalLayoutsByTabId: {
          tab1: {
            ...layout,
            ptyIdsByLeafId: { [TEST_LEAF_1]: 'remote-pty-1', [TEST_LEAF_2]: 'remote-pty-2' }
          }
        }
      })

      store.setWorkspaceSession({
        activeRepoId: 'r1',
        activeWorktreeId: 'wt1',
        activeTabId: 'tab1',
        tabsByWorktree: tabs,
        terminalLayoutsByTabId: {
          tab1: { ...layout, ptyIdsByLeafId: { [TEST_LEAF_1]: 'remote-pty-1' } }
        }
      })

      expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual(
        expected
      )
    }
  )

  it('does not restore layout bindings for leaves removed from the incoming layout', async () => {
    const store = createStoreWithSshRemotePtyLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty-1',
        tabId: 'tab1',
        leafId: TEST_LEAF_1,
        state: 'detached'
      },
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty-2',
        tabId: 'tab1',
        leafId: TEST_LEAF_2,
        state: 'detached'
      }
    ])
    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'remote-pty-1'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: TEST_LEAF_1 },
            second: { type: 'leaf', leafId: TEST_LEAF_2 },
            ratio: 0.5
          },
          activeLeafId: TEST_LEAF_2,
          expandedLeafId: null,
          ptyIdsByLeafId: {
            [TEST_LEAF_1]: 'remote-pty-1',
            [TEST_LEAF_2]: 'remote-pty-2'
          }
        }
      }
    })

    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'remote-pty-1'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: { type: 'leaf', leafId: TEST_LEAF_1 },
          activeLeafId: TEST_LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_1]: 'remote-pty-1' }
        }
      }
    })

    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({
      [TEST_LEAF_1]: 'remote-pty-1'
    })
  })

  it('does not restore missing layout bindings without a live SSH lease', async () => {
    const store = await createStore()
    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'local-pty-1'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: TEST_LEAF_1 },
            second: { type: 'leaf', leafId: TEST_LEAF_2 },
            ratio: 0.5
          },
          activeLeafId: TEST_LEAF_2,
          expandedLeafId: null,
          ptyIdsByLeafId: {
            [TEST_LEAF_1]: 'local-pty-1',
            [TEST_LEAF_2]: 'local-pty-2'
          }
        }
      }
    })

    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'local-pty-1'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: TEST_LEAF_1 },
            second: { type: 'leaf', leafId: TEST_LEAF_2 },
            ratio: 0.5
          },
          activeLeafId: TEST_LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_1]: 'local-pty-1' }
        }
      }
    })

    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({
      [TEST_LEAF_1]: 'local-pty-1'
    })
  })

  it('clears workspace bindings before removing SSH remote PTY leases for a target', async () => {
    const store = createStoreWithSshRemotePtyLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty',
        worktreeId: 'wt1',
        tabId: 'tab1',
        leafId: TEST_LEAF_1,
        state: 'detached'
      }
    ])
    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'remote-pty'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: { type: 'leaf', leafId: TEST_LEAF_1 },
          activeLeafId: TEST_LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_1]: 'remote-pty' }
        }
      }
    })

    await store.removeSshRemotePtyLeases('ssh-1')

    const session = store.getWorkspaceSession()
    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([])
    expect(session.tabsByWorktree.wt1[0].ptyId).toBeNull()
    expect(session.terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
  })

  it('waits for the terminal leaf mutation lane before SSH target binding cleanup', async () => {
    const store = await storeWithBoundSshPane()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let laneHeld = false
    const holder = store.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: 'wt1', tabId: 'tab1', leafId: TEST_LEAF_1 }],
      async () => {
        laneHeld = true
        await blocked
      }
    )
    await vi.waitFor(() => expect(laneHeld).toBe(true))

    let cleaned = false
    const cleanup = store.removeSshRemotePtyLeases('ssh-1').then(() => {
      cleaned = true
    })
    await Promise.resolve()
    expect(cleaned).toBe(false)
    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({
      [TEST_LEAF_1]: 'ssh:ssh-1@@remote-pty'
    })
    release()
    await holder
    await cleanup
    expect(cleaned).toBe(true)
    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
  })

  it('reacquires the expanded leaf set when a matching SSH binding appears while cleanup waits', async () => {
    const store = await storeWithBoundSshPane(true)
    const initial = store.getWorkspaceSession()
    await store.setWorkspaceSession({
      ...initial,
      tabsByWorktree: {
        ...initial.tabsByWorktree,
        wt1: [
          ...initial.tabsByWorktree.wt1,
          { ...initial.tabsByWorktree.wt1[0], id: 'tab2', ptyId: null }
        ]
      },
      terminalLayoutsByTabId: {
        ...initial.terminalLayoutsByTabId,
        tab2: {
          root: { type: 'leaf', leafId: TEST_LEAF_2 },
          activeLeafId: TEST_LEAF_2,
          expandedLeafId: null,
          ptyIdsByLeafId: {}
        }
      }
    })
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let laneHeld = false
    const holder = store.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: 'wt1', tabId: 'tab1', leafId: TEST_LEAF_1 }],
      async () => {
        laneHeld = true
        await blocked
      }
    )
    await vi.waitFor(() => expect(laneHeld).toBe(true))

    const cleanup = store.removeSshRemotePtyLeases('ssh-1')
    await expect(
      store.persistPtyBinding({
        worktreeId: 'wt1',
        tabId: 'tab2',
        leafId: TEST_LEAF_2,
        ptyId: 'ssh:ssh-1@@remote-pty',
        mayCreate: false
      })
    ).resolves.toBe(true)

    release()
    await holder
    await cleanup

    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([])
    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab2.ptyIdsByLeafId).toEqual({})
  })

  it('waits for the terminal leaf mutation lane before retiring one SSH PTY binding', async () => {
    const store = await storeWithBoundSshPane()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let laneHeld = false
    const holder = store.runTerminalLeafMutations(
      [{ executionHostId: 'local', worktreeId: 'wt1', tabId: 'tab1', leafId: TEST_LEAF_1 }],
      async () => {
        laneHeld = true
        await blocked
      }
    )
    await vi.waitFor(() => expect(laneHeld).toBe(true))

    let retired = false
    const retirement = store
      .markSshRemotePtyLease(
        'ssh-1',
        'ssh:ssh-1@@remote-pty',
        PtyExitProof.from('exit-observed', undefined)
      )
      .then(() => {
        retired = true
      })
    await Promise.resolve()
    expect(retired).toBe(false)
    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({
      [TEST_LEAF_1]: 'ssh:ssh-1@@remote-pty'
    })

    release()
    await holder
    await retirement
    expect(retired).toBe(true)
    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
  })

  it('preclaims only matching SSH retirement leaves when an unrelated SSH leaf exists', async () => {
    const store = await storeWithBoundSshPane()
    const session = store.getWorkspaceSession()
    await store.setWorkspaceSession({
      ...session,
      tabsByWorktree: {
        ...session.tabsByWorktree,
        wt1: [
          ...session.tabsByWorktree.wt1,
          { ...session.tabsByWorktree.wt1[0], id: 'tab-unrelated', ptyId: 'ssh-unrelated' }
        ]
      },
      terminalLayoutsByTabId: {
        ...session.terminalLayoutsByTabId,
        'tab-unrelated': {
          root: { type: 'leaf', leafId: TEST_LEAF_2 },
          activeLeafId: TEST_LEAF_2,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_2]: 'ssh-unrelated' }
        }
      }
    })

    const keys = store.getSshPtyRetirementMutationKeys('ssh-1', 'ssh:ssh-1@@remote-pty')
    expect(keys.map(({ worktreeId, tabId, leafId }) => ({ worktreeId, tabId, leafId }))).toEqual([
      { worktreeId: 'wt1', tabId: 'tab1', leafId: TEST_LEAF_1 }
    ])

    await store.runTerminalLeafMutations(keys, () =>
      store.markSshRemotePtyLease(
        'ssh-1',
        'ssh:ssh-1@@remote-pty',
        PtyExitProof.from('exit-observed', undefined)
      )
    )

    expect(store.getWorkspaceSession().terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
    expect(
      store.getWorkspaceSession().terminalLayoutsByTabId['tab-unrelated'].ptyIdsByLeafId
    ).toEqual({ [TEST_LEAF_2]: 'ssh-unrelated' })
  })

  it('does not clear a same-id replacement whose incarnation differs from the exit proof', async () => {
    const store = await storeWithBoundSshPane()
    const session = store.getWorkspaceSession()
    store.setWorkspaceSession({
      ...session,
      terminalPtyIncarnationsByPaneKey: { [`tab1:${TEST_LEAF_1}`]: 'inc-new' }
    })

    await store.markSshRemotePtyLease(
      'ssh-1',
      'ssh:ssh-1@@remote-pty',
      PtyExitProof.from('exit-observed', 'inc-old')
    )

    const current = store.getWorkspaceSession()
    expect(current.tabsByWorktree.wt1[0].ptyId).toBe('ssh:ssh-1@@remote-pty')
    expect(current.terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({
      [TEST_LEAF_1]: 'ssh:ssh-1@@remote-pty'
    })
    expect(current.terminalPtyIncarnationsByPaneKey?.[`tab1:${TEST_LEAF_1}`]).toBe('inc-new')
  })

  it('matches scoped SSH workspace bindings against raw relay leases', async () => {
    const store = createStoreWithSshRemotePtyLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty',
        worktreeId: 'wt1',
        tabId: 'tab1',
        leafId: TEST_LEAF_1,
        state: 'detached'
      }
    ])
    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'ssh:ssh-1@@remote-pty'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: { type: 'leaf', leafId: TEST_LEAF_1 },
          activeLeafId: TEST_LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_1]: 'ssh:ssh-1@@remote-pty' }
        }
      }
    })

    await store.removeSshRemotePtyLeases('ssh-1')

    const session = store.getWorkspaceSession()
    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([])
    expect(session.tabsByWorktree.wt1[0].ptyId).toBeNull()
    expect(session.terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
  })

  it('rejects mismatched scoped SSH remote PTY lease ids on write paths', async () => {
    const store = await createStore()

    await expect(
      store.markSshRemotePtyLease(
        'ssh-1',
        'ssh:ssh-2@@remote-pty',
        PtyExitProof.from('exit-observed', undefined)
      )
    ).rejects.toThrow('belongs to SSH connection "ssh-2"')
  })

  it('updates SSH remote PTY leases when callers pass scoped app ids', async () => {
    const store = createStoreWithSshRemotePtyLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty',
        state: 'attached'
      }
    ])

    await store.markSshRemotePtyLease(
      'ssh-1',
      'ssh:ssh-1@@remote-pty',
      PtyExitProof.from('exit-observed', undefined)
    )

    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([])
  })

  it('clears workspace bindings when marking an SSH remote PTY lease terminated', async () => {
    const store = await storeWithBoundSshPane()

    await store.markSshRemotePtyLease(
      'ssh-1',
      'ssh:ssh-1@@remote-pty',
      PtyExitProof.from('exit-observed', undefined)
    )

    const session = store.getWorkspaceSession()
    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([])
    expect(session.tabsByWorktree.wt1[0].ptyId).toBeNull()
    expect(session.terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
  })

  it('clears workspace bindings before removing contextless SSH remote PTY leases', async () => {
    const store = createStoreWithSshRemotePtyLeases([
      {
        targetId: 'ssh-1',
        ptyId: 'remote-pty',
        state: 'detached'
      }
    ])
    store.setWorkspaceSession({
      activeRepoId: 'r1',
      activeWorktreeId: 'wt1',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab1',
            worktreeId: 'wt1',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            ptyId: 'remote-pty'
          }
        ]
      },
      terminalLayoutsByTabId: {
        tab1: {
          root: { type: 'leaf', leafId: TEST_LEAF_1 },
          activeLeafId: TEST_LEAF_1,
          expandedLeafId: null,
          ptyIdsByLeafId: { [TEST_LEAF_1]: 'remote-pty' }
        }
      }
    })

    await store.removeSshRemotePtyLeases('ssh-1')

    const session = store.getWorkspaceSession()
    expect(store.getSshRemotePtyLeases('ssh-1')).toEqual([])
    expect(session.tabsByWorktree.wt1[0].ptyId).toBeNull()
    expect(session.terminalLayoutsByTabId.tab1.ptyIdsByLeafId).toEqual({})
  })
})
