import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { IPtyProvider } from '../../../providers/pty-provider-contract'
import { stopRendererOwnedPty, type PtyKillIpcDeps } from '../ipc/renderer-kill'
import { finishPtyShutdown } from '../provider/liveness'
import { ptyIncarnationById, ptyOwnership } from '../provider/ownership-state'
import { getLocalPtyProvider, setLocalPtyProvider } from '../provider/registry'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import {
  killPtyFromRuntimeController,
  stopAndWaitPtyFromRuntimeController,
  stopPtyIncarnationIfMatchFromRuntimeController
} from './kill'
import { PtyExitProof } from '../../../pty-exit-proof'

const PTY_ID = 'respawned-pty'

function providerWhose(duringShutdown: () => void, listed: { id: string }[]): IPtyProvider {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stops call only shutdown and listProcesses.
  return {
    shutdown: async () => duringShutdown(),
    listProcesses: async () => listed
  } as unknown as IPtyProvider
}

function harness() {
  const runtime = {
    markPtyStopRequested: vi.fn(),
    markPtyLivenessUnverifiable: vi.fn(),
    markPtyLivenessLive: vi.fn(),
    onPtyExit: vi.fn()
  }
  const ports = {
    runtime,
    getLocalPtyProviderStartupPromise: () => undefined,
    shutdownProviderAndDetectExit: async (provider: IPtyProvider, id: string) => {
      await provider.shutdown(id, { immediate: true })
      return false
    },
    rememberSyntheticKillExit: vi.fn(),
    sendPtyExitToRenderer: vi.fn(),
    finishPtyShutdown,
    retiredRejectedPtyIds: new Map<string, NodeJS.Timeout>()
  }
  return { runtime, ports }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stops read only these ports and an optional store.
const asControllerDeps = (ports: unknown) => ports as PtyRuntimeControllerDeps
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the tab-close stop reads only these ports and an optional store.
const asKillIpcDeps = (ports: unknown) => ports as PtyKillIpcDeps

async function settleKill(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const original = getLocalPtyProvider()
afterEach(() => {
  setLocalPtyProvider(original)
  ptyOwnership.delete(PTY_ID)
  ptyIncarnationById.delete(PTY_ID)
})

describe('a stop whose shutdown lands after a same-id respawn', () => {
  function respawn(): void {
    ptyOwnership.set(PTY_ID, LOCAL_EXECUTION_HOST_ID)
    ptyIncarnationById.set(PTY_ID, 'inc-respawn')
  }
  function start(): ReturnType<typeof harness> {
    setLocalPtyProvider(providerWhose(respawn, [{ id: PTY_ID }]))
    ptyOwnership.set(PTY_ID, LOCAL_EXECUTION_HOST_ID)
    ptyIncarnationById.set(PTY_ID, 'inc-stopped')
    return harness()
  }

  function expectRespawnUntouched({ runtime, ports }: ReturnType<typeof harness>): void {
    expect(ptyOwnership.get(PTY_ID)).toBe(LOCAL_EXECUTION_HOST_ID)
    expect(ptyIncarnationById.get(PTY_ID)).toBe('inc-respawn')
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(ports.sendPtyExitToRenderer).not.toHaveBeenCalled()
  }

  it('leaves the respawn alone after a runtime kill', async () => {
    const h = start()
    killPtyFromRuntimeController(asControllerDeps(h.ports), PTY_ID)
    await settleKill()
    expectRespawnUntouched(h)
  })

  it('reports the listed respawn live after a stop-and-wait', async () => {
    const h = start()
    await expect(
      stopAndWaitPtyFromRuntimeController(asControllerDeps(h.ports), PTY_ID)
    ).resolves.toBe(false)
    expect(h.runtime.markPtyLivenessLive).toHaveBeenCalledWith(PTY_ID)
    expectRespawnUntouched(h)
  })

  it('leaves the respawn alone after a renderer tab close', async () => {
    const h = start()
    await stopRendererOwnedPty(asKillIpcDeps(h.ports), { id: PTY_ID })
    expectRespawnUntouched(h)
  })

  it('refuses a renderer stop when its queued mutation observes a replacement incarnation', async () => {
    const h = start()
    const shutdown = vi.spyOn(getLocalPtyProvider(), 'shutdown')
    Object.assign(h.ports, {
      store: {
        getWorkspaceSessionHostIds: () => [],
        runTerminalLeafMutations: async (_keys: unknown, operation: () => Promise<void>) => {
          respawn()
          return await operation()
        }
      }
    })

    await expect(stopRendererOwnedPty(asKillIpcDeps(h.ports), { id: PTY_ID })).rejects.toThrow(
      'terminal_kill_pty_identity_changed'
    )
    expect(shutdown).not.toHaveBeenCalled()
    expectRespawnUntouched(h)
  })
})

describe('exact replacement cleanup', () => {
  it('uses the provider incarnation fence and observes the replacement stopped', async () => {
    let providerAlive = true
    const killFenced = vi.fn(async () => {
      providerAlive = false
      return { outcome: 'ended' as const }
    })
    setLocalPtyProvider({
      supportsFencedTermination: () => true,
      killFenced
    } as unknown as IPtyProvider)
    ptyOwnership.set(PTY_ID, LOCAL_EXECUTION_HOST_ID)

    await expect(
      stopPtyIncarnationIfMatchFromRuntimeController(PTY_ID, 'inc-replacement')
    ).resolves.toBe(true)
    expect(killFenced).toHaveBeenCalledExactlyOnceWith({
      id: PTY_ID,
      expectedIncarnationId: 'inc-replacement',
      requireNoAgentOwner: false,
      requireUnattached: false
    })
    expect(providerAlive).toBe(false)
  })
})

describe('an SSH retirement persistence failure', () => {
  it('keeps provider ownership and incarnation state intact', async () => {
    ptyOwnership.set(PTY_ID, 'ssh:ssh-1')
    ptyIncarnationById.set(PTY_ID, 'inc-current')
    const store = {
      markSshRemotePtyLease: vi.fn(async () => {
        throw new Error('durable retirement failed')
      })
    }

    await expect(
      finishPtyShutdown(
        PTY_ID,
        'ssh-1',
        store as never,
        // The exact incarnation remains current throughout the failed write.
        PtyExitProof.from('exit-observed', 'inc-current')
      )
    ).rejects.toThrow('durable retirement failed')
    expect(ptyOwnership.get(PTY_ID)).toBe('ssh:ssh-1')
    expect(ptyIncarnationById.get(PTY_ID)).toBe('inc-current')
  })
})

describe('a stop of a PTY whose incarnation was stamped mid-stop', () => {
  // Owner reconciliation can discover this same process's incarnation while shutdown is pending.
  function start(): ReturnType<typeof harness> {
    setLocalPtyProvider(providerWhose(() => ptyIncarnationById.set(PTY_ID, 'inc-same'), []))
    ptyOwnership.set(PTY_ID, LOCAL_EXECUTION_HOST_ID)
    return harness()
  }

  function expectRetired({ ports }: ReturnType<typeof harness>): void {
    expect(ptyOwnership.has(PTY_ID)).toBe(false)
    expect(ports.sendPtyExitToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ id: PTY_ID })
    )
  }

  it('retires it after a renderer tab close', async () => {
    const h = start()
    await stopRendererOwnedPty(asKillIpcDeps(h.ports), { id: PTY_ID })
    expectRetired(h)
  })

  it('retires it after a runtime kill', async () => {
    const h = start()
    killPtyFromRuntimeController(asControllerDeps(h.ports), PTY_ID)
    await settleKill()
    expectRetired(h)
  })
})
