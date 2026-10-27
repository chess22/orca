import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import {
  TerminalLeafMutationLane,
  type TerminalLeafMutationKey
} from '../../../terminal-leaf-mutation-lane'
import type { IPtyProvider } from '../../../providers/pty-provider-contract'
import { createPtyIpcSession } from '../session'
import { bindProviderListeners } from './bind-listeners'
import { ptyIncarnationById, ptyOwnership } from './ownership-state'
import { getLocalPtyProvider, setLocalPtyProvider } from './registry'
import { settleRuntimePtyExit } from './runtime-exit-settlement'

const KEY: TerminalLeafMutationKey = {
  executionHostId: 'local',
  worktreeId: 'worktree-a',
  tabId: 'tab-a',
  leafId: 'leaf-a'
}

describe('provider runtime exit settlement', () => {
  const priorProvider = getLocalPtyProvider()
  afterEach(() => {
    vi.restoreAllMocks()
    setLocalPtyProvider(priorProvider)
    ptyOwnership.delete('pty-a')
    ptyIncarnationById.delete('pty-a')
  })

  it('contains a cleanup throw after a contended leaf lane', async () => {
    const lane = new TerminalLeafMutationLane()
    let release!: () => void
    const held = lane.run(
      [KEY],
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const settlement = settleRuntimePtyExit('pty-a', () =>
      lane.run([KEY], () => {
        throw new Error('cleanup_failed_after_wait')
      })
    )

    expect(logged).not.toHaveBeenCalled()
    release()
    await held
    await expect(settlement).resolves.toBe(false)
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce())
    expect(logged).toHaveBeenCalledWith(
      '[pty] Failed to retire PTY pty-a after provider exit:',
      expect.objectContaining({ message: 'cleanup_failed_after_wait' })
    )
  })

  it('contains a synchronous cleanup throw and settles once', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const settlement = settleRuntimePtyExit('pty-a', () => {
      throw new Error('cleanup_failed_synchronously')
    })

    await expect(settlement).resolves.toBe(false)
    expect(logged).toHaveBeenCalledOnce()
  })

  it('reports successful cleanup only after the lane releases', async () => {
    const lane = new TerminalLeafMutationLane()
    let release!: () => void
    const held = lane.run(
      [KEY],
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const cleanup = vi.fn()
    const settlement = settleRuntimePtyExit('pty-a', () => lane.run([KEY], cleanup))

    expect(cleanup).not.toHaveBeenCalled()
    release()
    await held
    await expect(settlement).resolves.toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it.each([
    { cleanupFails: false, identityChanges: false, rendererExitCount: 1 },
    { cleanupFails: true, identityChanges: false, rendererExitCount: 0 },
    { cleanupFails: false, identityChanges: true, rendererExitCount: 0 }
  ])(
    'holds renderer exit behind the runtime lane (cleanup fails: $cleanupFails, identity changes: $identityChanges)',
    async ({ cleanupFails, identityChanges, rendererExitCount }) => {
      const lane = new TerminalLeafMutationLane()
      let release!: () => void
      const held = lane.run(
        [KEY],
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      const cleanupFinished = vi.fn()
      const onPtyExit = () =>
        lane.run([KEY], () => {
          if (cleanupFails) {
            throw new Error('provider_cleanup_failed')
          }
          cleanupFinished()
        })
      // SAFETY: bindProviderListeners reaches only the onPtyExit member in this test.
      const runtime = { onPtyExit } as unknown as OrcaRuntimeService
      let emitExit: Parameters<IPtyProvider['onExit']>[0] = () => {}
      const provider = {
        onData: () => () => {},
        onExit: (listener: typeof emitExit) => {
          emitExit = listener
          return () => {}
        }
      }
      // SAFETY: bindProviderListeners uses only the provider's onData/onExit subscriptions here.
      setLocalPtyProvider(provider as unknown as IPtyProvider)
      ptyOwnership.set('pty-a', 'local')
      ptyIncarnationById.set('pty-a', 'inc-a')
      const session = createPtyIpcSession({ runtime })
      session.consumeSyntheticKillExit = () => false
      session.sendPtyExitToRenderer = vi.fn()
      bindProviderListeners(session)
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      emitExit({ id: 'pty-a', code: 0, incarnationId: 'inc-a' })
      expect(session.sendPtyExitToRenderer).not.toHaveBeenCalled()
      if (identityChanges) {
        ptyIncarnationById.set('pty-a', 'inc-b')
      }
      release()
      await held
      if (!cleanupFails) {
        await vi.waitFor(() => expect(cleanupFinished).toHaveBeenCalledOnce())
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      await (cleanupFails
        ? vi.waitFor(() =>
            expect(logged).toHaveBeenCalledWith(
              '[pty] Failed to retire PTY pty-a after provider exit:',
              expect.objectContaining({ message: 'provider_cleanup_failed' })
            )
          )
        : vi.waitFor(() =>
            expect(session.sendPtyExitToRenderer).toHaveBeenCalledTimes(rendererExitCount)
          ))
      expect(session.sendPtyExitToRenderer).toHaveBeenCalledTimes(rendererExitCount)
      if (identityChanges) {
        expect(ptyIncarnationById.get('pty-a')).toBe('inc-b')
      }
    }
  )
})
