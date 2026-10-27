import { describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { returnValue?: unknown }, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: { returnValue?: unknown }, ...args: unknown[]) => unknown
      ) => {
        handlers.set(channel, handler)
      }
    ),
    on: vi.fn(
      (
        channel: string,
        handler: (event: { returnValue?: unknown }, ...args: unknown[]) => unknown
      ) => {
        handlers.set(channel, handler)
      }
    )
  }
}))

import { getDefaultWorkspaceSession } from '../../shared/constants'
import {
  addWorkspace,
  emptySession,
  GIT_KEY,
  leaf
} from '../../shared/workspace-layout/workspace-layout-session.test-fixture'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { TerminalLeafMutationLane } from '../terminal-leaf-mutation-lane'
import { registerSessionHandlers } from './session'

const MOVED_KEY = 'repo-1::/tmp/moved'

function sessionIn(worktreeId: string): WorkspaceSessionState {
  return addWorkspace(emptySession(), worktreeId, [
    { id: 'group-1', tabs: [{ id: 'tab-a', leaves: [[leaf(1), 'pty-1']] }] }
  ])
}

async function expectMoveWaitsForPriorLeafLane(
  channel: 'session:set' | 'session:patch'
): Promise<void> {
  const lane = new TerminalLeafMutationLane()
  let session = sessionIn(GIT_KEY)
  const store = {
    getSshTarget: vi.fn(() => ({})),
    getWorkspaceSession: vi.fn(() => session),
    setWorkspaceSession: vi.fn((next: WorkspaceSessionState) => {
      session = next
    }),
    patchWorkspaceSession: vi.fn((patch: Partial<WorkspaceSessionState>) => {
      session = { ...session, ...patch }
    }),
    runTerminalLeafMutations: lane.run.bind(lane),
    flushPendingOrThrowAsync: vi.fn(() => Promise.resolve())
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers under test touch only the store methods stubbed above and never the runtime.
  registerSessionHandlers(store as never, {} as never)

  const gate = Promise.withResolvers<void>()
  const holder = lane.run(
    [{ executionHostId: 'local', worktreeId: GIT_KEY, tabId: 'tab-a', leafId: leaf(1) }],
    () => gate.promise
  )
  let completed = false
  const moved = sessionIn(MOVED_KEY)
  const save = Promise.resolve(
    channel === 'session:set'
      ? handlers.get(channel)?.({}, moved, 'local')
      : handlers.get(channel)?.(
          {},
          {
            tabsByWorktree: moved.tabsByWorktree,
            terminalLayoutsByTabId: moved.terminalLayoutsByTabId
          },
          'local'
        )
  ).then(() => {
    completed = true
  })

  await Promise.resolve()
  expect(completed).toBe(false)
  gate.resolve()
  await holder
  await save
  expect(completed).toBe(true)
}

describe('registerSessionHandlers', () => {
  it('drops renderer writes to a fenced host source partition and keeps every other one', async () => {
    const store = {
      getSshTarget: vi.fn((id: string) =>
        id === 'fenced' ? { orcadFence: { environmentId: 'env-1' } } : {}
      ),
      // Read by the switch-on save, which keeps main's own layout.
      getWorkspaceSession: vi.fn(() => getDefaultWorkspaceSession()),
      setWorkspaceSession: vi.fn(),
      patchWorkspaceSession: vi.fn(),
      runTerminalLeafMutations: vi.fn((_keys, operation) => operation()),
      flushPendingOrThrowAsync: vi.fn(() => Promise.resolve())
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers under test touch only the store methods stubbed above and never the runtime.
    registerSessionHandlers(store as never, {} as never)

    for (const hostId of ['ssh:fenced', 'ssh:open', undefined]) {
      await handlers.get('session:set')?.({}, {}, hostId)
      await handlers.get('session:patch')?.({}, {}, hostId)
    }
    expect(store.setWorkspaceSession.mock.calls.map(([, hostId]) => hostId)).toEqual([
      'ssh:open',
      undefined
    ])
    expect(store.patchWorkspaceSession.mock.calls.map(([, hostId]) => hostId)).toEqual([
      'ssh:open',
      undefined
    ])
  })

  it('makes session:set acquire both worktrees when a terminal tab moves', async () => {
    await expectMoveWaitsForPriorLeafLane('session:set')
  })

  it('makes session:patch acquire both worktrees when a terminal tab moves', async () => {
    await expectMoveWaitsForPriorLeafLane('session:patch')
  })
})
