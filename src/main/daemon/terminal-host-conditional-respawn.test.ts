import './mock-descendant-sweep'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockSubprocess } from './daemon-pty-adapter-test-harness'
import { TerminalHost } from './terminal-host'
import type { TerminalHostOptions } from './terminal-host-options'

const streamClient = () => ({ onData: vi.fn(), onExit: vi.fn() })
const publish = vi.fn<(token: symbol) => void>()
const reaped = vi.fn<(sessionId: string) => void>()
let handles: ReturnType<typeof createMockSubprocess>[]
let spawnSubprocess: ReturnType<typeof vi.fn<TerminalHostOptions['spawnSubprocess']>>
let host: TerminalHost

beforeEach(() => {
  handles = []
  publish.mockReset()
  reaped.mockReset()
  spawnSubprocess = vi.fn<TerminalHostOptions['spawnSubprocess']>(() => {
    const handle = createMockSubprocess()
    handles.push(handle)
    return handle
  })
  host = new TerminalHost({ spawnSubprocess, onSessionReaped: reaped })
})

afterEach(async () => {
  for (const handle of handles) {
    handle._simulateExit(0)
  }
  await host.dispose()
})

async function create() {
  return await host.createOrAttach({
    sessionId: 'pty',
    cols: 80,
    rows: 24,
    streamClient: streamClient()
  })
}

function respawn(
  expectedIncarnationId: string,
  mutationId: string,
  mutationRefusal: () => string | null = () => null,
  beginExitFence: () => (replacementPublished: boolean) => void = () => () => {}
) {
  return host.respawnIfMatch({
    sessionId: 'pty',
    mutationId,
    expectedIncarnationId,
    cols: 100,
    rows: 30,
    streamClient: streamClient(),
    mutationRefusal,
    beginExitFence,
    onReplacementPublished: publish
  })
}

describe('TerminalHost conditional respawn', () => {
  it('rejects a stale incarnation without stopping or spawning', async () => {
    await create()

    await expect(respawn('stale', 'mutation-stale')).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'incarnation_changed'
    })
    expect(spawnSubprocess).toHaveBeenCalledOnce()
    expect(handles[0]!.forceKill).not.toHaveBeenCalled()
  })

  it('serializes concurrent replacements so exactly one wins', async () => {
    const original = await create()

    const results = await Promise.all([
      respawn(original.incarnationId, 'mutation-a'),
      respawn(original.incarnationId, 'mutation-b')
    ])

    expect(results.filter((result) => result.outcome === 'respawned')).toHaveLength(1)
    expect(results.filter((result) => result.outcome === 'precondition_failed')).toHaveLength(1)
    expect(spawnSubprocess).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledOnce()
  })

  it('revalidates mutation authority after waiting for the session reservation', async () => {
    let releaseSpawn!: (handle: ReturnType<typeof createMockSubprocess>) => void
    const blockedSpawn = new Promise<ReturnType<typeof createMockSubprocess>>((resolve) => {
      releaseSpawn = resolve
    })
    spawnSubprocess.mockImplementationOnce(() => blockedSpawn)
    const creating = create()
    await vi.waitFor(() => expect(spawnSubprocess).toHaveBeenCalledOnce())

    let authorized = true
    const beginExitFence = vi.fn(() => () => {})
    const replacing = respawn(
      'incarnation-before-create',
      'mutation-reservation-wait',
      () => (authorized ? null : 'attachment_owner_changed'),
      beginExitFence
    )
    authorized = false
    const originalHandle = createMockSubprocess()
    handles.push(originalHandle)
    releaseSpawn(originalHandle)
    await creating

    await expect(replacing).resolves.toEqual({
      outcome: 'failed_before_mutation',
      mutationId: 'mutation-reservation-wait',
      reason: 'attachment_owner_changed'
    })
    expect(originalHandle.forceKill).not.toHaveBeenCalled()
    expect(spawnSubprocess).toHaveBeenCalledOnce()
    expect(beginExitFence).not.toHaveBeenCalled()
  })

  it('refuses authority loss after stop without spawning a replacement', async () => {
    const original = await create()
    let checks = 0
    const finishExitFence = vi.fn()

    await expect(
      respawn(
        original.incarnationId,
        'mutation-authority-after-stop',
        () => (++checks === 1 ? null : 'daemon_unavailable'),
        () => finishExitFence
      )
    ).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'daemon_unavailable',
      oldStopped: true,
      replacementStarted: false,
      replacementPublished: false
    })
    expect(spawnSubprocess).toHaveBeenCalledOnce()
    expect(finishExitFence).toHaveBeenCalledWith(false)
    expect(reaped).toHaveBeenCalledWith('pty')
  })

  it('reaps an unpublished replacement after authority loss', async () => {
    const original = await create()
    let checks = 0
    const finishExitFence = vi.fn()

    await expect(
      respawn(
        original.incarnationId,
        'mutation-authority-before-publication',
        () => (++checks < 3 ? null : 'client_disconnected'),
        () => finishExitFence
      )
    ).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'client_disconnected',
      oldStopped: true,
      replacementStarted: true,
      replacementPublished: false,
      ptyId: 'pty',
      incarnationId: expect.any(String)
    })
    expect(spawnSubprocess).toHaveBeenCalledTimes(2)
    expect(handles[1]!.forceKill).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    expect(finishExitFence).toHaveBeenCalledWith(false)
    expect(host.listSessions()).toEqual([])
  })

  it('reaps the replacement when attachment publication fails', async () => {
    const original = await create()
    publish.mockImplementationOnce(() => {
      throw new Error('attachment publication failed')
    })

    await expect(
      respawn(original.incarnationId, 'mutation-publication-failure')
    ).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'attachment publication failed',
      oldStopped: true,
      replacementStarted: true,
      replacementPublished: false
    })
    expect(handles[1]!.forceKill).toHaveBeenCalledOnce()
    expect(host.listSessions()).toEqual([])
  })

  it('retains identity evidence when unpublished replacement cleanup is unverified', async () => {
    const original = await create()
    publish.mockImplementationOnce(() => {
      throw new Error('attachment publication failed')
    })
    spawnSubprocess.mockImplementationOnce(() => {
      const handle = createMockSubprocess()
      vi.mocked(handle.forceKill).mockImplementation(() => {
        throw new Error('kill rejected')
      })
      handles.push(handle)
      return handle
    })

    await expect(
      respawn(original.incarnationId, 'mutation-publication-cleanup-uncertain')
    ).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'unpublished_replacement_stop_unverified',
      oldStopped: true,
      replacementStarted: true,
      incarnationId: expect.any(String)
    })
    expect(host.listSessions()).toMatchObject([
      { sessionId: 'pty', isAlive: true, state: 'exiting' }
    ])
  })

  it('replays one mutation without stopping or spawning twice', async () => {
    const original = await create()
    const first = await respawn(original.incarnationId, 'mutation-replay')
    const replay = await respawn(original.incarnationId, 'mutation-replay')

    expect(first.outcome).toBe('respawned')
    expect(replay).toEqual({ ...first, replayed: true })
    expect(spawnSubprocess).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledOnce()
  })

  it('fails closed when the bounded replay ledger is full', async () => {
    await create()
    for (let index = 0; index < 256; index += 1) {
      await expect(respawn('stale', `mutation-stale-${index}`)).resolves.toMatchObject({
        outcome: 'precondition_failed'
      })
    }

    await expect(respawn('stale', 'mutation-over-cap')).resolves.toEqual({
      outcome: 'failed_before_mutation',
      mutationId: 'mutation-over-cap',
      reason: 'mutation_ledger_full'
    })
    expect(spawnSubprocess).toHaveBeenCalledOnce()
  })

  it('does not let a queued ordinary kill stop the published replacement', async () => {
    const original = await create()
    const replacing = respawn(original.incarnationId, 'mutation-kill-race')
    const queuedKill = host.kill('pty', { immediate: true })

    await expect(replacing).resolves.toMatchObject({ outcome: 'respawned' })
    await queuedKill

    expect(spawnSubprocess).toHaveBeenCalledTimes(2)
    expect(handles[0]!.forceKill).toHaveBeenCalledOnce()
    expect(handles[1]!.forceKill).not.toHaveBeenCalled()
    expect(host.listSessions()).toMatchObject([{ state: 'running' }])
  })

  it('reports partial when replacement spawn fails after the old process stops', async () => {
    const original = await create()
    const finishExitFence = vi.fn()
    spawnSubprocess.mockImplementationOnce(() => {
      throw new Error('replacement spawn failed')
    })

    await expect(
      respawn(
        original.incarnationId,
        'mutation-spawn-failure',
        () => null,
        () => finishExitFence
      )
    ).resolves.toMatchObject({
      outcome: 'partial',
      oldStopped: true,
      replacementStarted: false,
      replacementPublished: false,
      reason: 'replacement spawn failed'
    })
    expect(spawnSubprocess).toHaveBeenCalledTimes(2)
    expect(publish).not.toHaveBeenCalled()
    expect(finishExitFence).toHaveBeenCalledWith(false)
    expect(reaped).toHaveBeenCalledWith('pty')
  })

  it('does not spawn after an immediate stop rejects', async () => {
    const original = await create()
    const finishExitFence = vi.fn()
    vi.mocked(handles[0]!.forceKill).mockImplementation(() => {
      throw new Error('stop failed')
    })

    await expect(
      respawn(
        original.incarnationId,
        'mutation-stop-failure',
        () => null,
        () => finishExitFence
      )
    ).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'stop_failed'
    })
    expect(spawnSubprocess).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    expect(finishExitFence).toHaveBeenCalledWith(false)
    expect(reaped).not.toHaveBeenCalled()
  })
})
