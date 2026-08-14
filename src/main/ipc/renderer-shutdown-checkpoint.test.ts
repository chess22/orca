import { beforeEach, describe, expect, it, vi } from 'vitest'

const { syncHandlers, getOrcaWindowSlotByWebContentsMock } = vi.hoisted(() => ({
  syncHandlers: new Map<
    string,
    (event: { returnValue?: unknown; sender?: unknown }, args: Record<string, unknown>) => void
  >(),
  getOrcaWindowSlotByWebContentsMock: vi.fn(() => null as number | null)
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(
      (
        channel: string,
        handler: (
          event: { returnValue?: unknown; sender?: unknown },
          args: Record<string, unknown>
        ) => void
      ) => {
        syncHandlers.set(channel, handler)
      }
    )
  }
}))

vi.mock('../window/orca-window-registry', () => ({
  getOrcaWindowSlotByWebContents: getOrcaWindowSlotByWebContentsMock
}))

import { registerRendererShutdownCheckpointHandler } from './renderer-shutdown-checkpoint'

describe('registerRendererShutdownCheckpointHandler', () => {
  beforeEach(() => {
    syncHandlers.clear()
    getOrcaWindowSlotByWebContentsMock.mockReset()
    getOrcaWindowSlotByWebContentsMock.mockReturnValue(null)
  })

  it('commits every shutdown state mutation before flushing both stores', () => {
    const callOrder: string[] = []
    const store = {
      setWorkspaceSession: vi.fn((_state, hostId?: string) => {
        callOrder.push(`session:${hostId ?? 'local'}`)
      }),
      updateUI: vi.fn(() => callOrder.push('ui')),
      flushOrThrow: vi.fn(() => callOrder.push('flush')),
      flushActiveViewPreferenceOrThrow: vi.fn(() => callOrder.push('active-view'))
    }
    registerRendererShutdownCheckpointHandler(store as never)

    const handler = syncHandlers.get('app:persist-before-unload-sync')
    expect(handler).toBeDefined()
    const event: { returnValue?: unknown } = {}
    const localSession = { activeWorktreeId: 'local-worktree' }
    const remoteSession = { activeWorktreeId: 'remote-worktree' }
    handler?.(event, {
      sessions: [{ state: localSession }, { state: remoteSession, hostId: 'runtime:host-1' }],
      ui: { activeView: 'settings' }
    })

    expect(store.setWorkspaceSession).toHaveBeenNthCalledWith(1, localSession, undefined, null)
    expect(store.setWorkspaceSession).toHaveBeenNthCalledWith(
      2,
      remoteSession,
      'runtime:host-1',
      null
    )
    expect(store.updateUI).toHaveBeenCalledWith({ activeView: 'settings' })
    expect(store.flushOrThrow).toHaveBeenCalledTimes(1)
    expect(store.flushActiveViewPreferenceOrThrow).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual([
      'session:local',
      'session:runtime:host-1',
      'ui',
      'flush',
      'active-view'
    ])
    expect(event.returnValue).toEqual({ ok: true })
  })

  it('checkpoints the sender window session into its slot authority', () => {
    getOrcaWindowSlotByWebContentsMock.mockReturnValue(2)
    const store = {
      setWorkspaceSession: vi.fn(),
      updateUI: vi.fn(),
      flushOrThrow: vi.fn(),
      flushActiveViewPreferenceOrThrow: vi.fn()
    }
    registerRendererShutdownCheckpointHandler(store as never)

    const sender = { id: 202 }
    const event: { returnValue?: unknown; sender?: unknown } = { sender }
    const session = { activeWorktreeId: 'slot-2-worktree' }
    syncHandlers.get('app:persist-before-unload-sync')?.(event, {
      sessions: [{ state: session }],
      ui: {}
    })

    expect(getOrcaWindowSlotByWebContentsMock).toHaveBeenCalledWith(sender)
    expect(store.setWorkspaceSession).toHaveBeenCalledWith(session, undefined, 2)
    expect(event.returnValue).toEqual({ ok: true })
  })

  it('reports a failed durable checkpoint so the renderer can retry', () => {
    const store = {
      setWorkspaceSession: vi.fn(),
      updateUI: vi.fn(),
      flushOrThrow: vi.fn(() => {
        throw new Error('disk full')
      }),
      flushActiveViewPreferenceOrThrow: vi.fn()
    }
    registerRendererShutdownCheckpointHandler(store as never)

    const handler = syncHandlers.get('app:persist-before-unload-sync')
    const event: { returnValue?: unknown } = {}
    handler?.(event, { sessions: [], ui: { activeView: 'settings' } })

    expect(event.returnValue).toEqual({ ok: false })
  })

  it('still flushes the active-view sidecar when the durable flush throws', () => {
    // Why: the two stores are independent; a durable-state failure must not drop
    // the tiny active-view checkpoint (and vice versa).
    const store = {
      setWorkspaceSession: vi.fn(),
      updateUI: vi.fn(),
      flushOrThrow: vi.fn(() => {
        throw new Error('disk full')
      }),
      flushActiveViewPreferenceOrThrow: vi.fn()
    }
    registerRendererShutdownCheckpointHandler(store as never)

    const handler = syncHandlers.get('app:persist-before-unload-sync')
    const event: { returnValue?: unknown } = {}
    handler?.(event, { sessions: [], ui: { activeView: 'settings' } })

    expect(store.flushActiveViewPreferenceOrThrow).toHaveBeenCalledTimes(1)
    expect(event.returnValue).toEqual({ ok: false })
  })

  it('flushes the durable store even when the active-view flush throws', () => {
    const store = {
      setWorkspaceSession: vi.fn(),
      updateUI: vi.fn(),
      flushOrThrow: vi.fn(),
      flushActiveViewPreferenceOrThrow: vi.fn(() => {
        throw new Error('disk full')
      })
    }
    registerRendererShutdownCheckpointHandler(store as never)

    const handler = syncHandlers.get('app:persist-before-unload-sync')
    const event: { returnValue?: unknown } = {}
    handler?.(event, { sessions: [], ui: { activeView: 'settings' } })

    expect(store.flushOrThrow).toHaveBeenCalledTimes(1)
    expect(event.returnValue).toEqual({ ok: false })
  })
})
