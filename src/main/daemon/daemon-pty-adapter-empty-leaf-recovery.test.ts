import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockSubprocess, startDaemonAdapterHarness } from './daemon-pty-adapter-test-harness'
import type { ConnectedDaemonClient } from './daemon-client-connections'
import { terminalEmptyLeafTombstoneId } from '../../shared/terminal-empty-leaf-recovery'

describe('DaemonPtyAdapter empty-leaf recovery completion', () => {
  let harness: Awaited<ReturnType<typeof startDaemonAdapterHarness>>
  let handles: ReturnType<typeof createMockSubprocess>[]
  let failReplacementSpawn: boolean

  beforeEach(async () => {
    handles = []
    failReplacementSpawn = false
    harness = await startDaemonAdapterHarness(() => {
      if (failReplacementSpawn && handles.length === 1) {
        throw new Error('replacement spawn failed')
      }
      const handle = createMockSubprocess()
      handles.push(handle)
      return handle
    })
  })

  afterEach(async () => {
    for (const handle of handles) {
      handle._simulateExit(0)
    }
    harness.adapter.dispose()
    await harness.server.shutdown()
    rmSync(harness.dir, { recursive: true, force: true })
  })

  it('replays an exact abort receipt after its response is lost and rejects receipt drift', async () => {
    const sessionId = 'empty-leaf-abort-response-loss'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    if (!original.incarnationId || typeof original.pid !== 'number') {
      throw new Error('original terminal identity unavailable')
    }
    failReplacementSpawn = true
    const mutationId = 'mutation-abort-response-loss'
    await harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId,
      original.pid,
      mutationId,
      { command: 'exec relay', cwd: '/repo', cols: 100, rows: 30 }
    )
    failReplacementSpawn = false
    const request = {
      originalMutationId: mutationId,
      recoveryId: 'recovery-abort-response-loss',
      terminal: 'term-abort-response-loss',
      expected: {
        worktreeId: 'worktree-1',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        ptyId: sessionId,
        ptyGeneration: 1,
        retiredIncarnationId: original.incarnationId,
        layoutEpoch: 1,
        persistedBindingVersion: 1,
        tombstoneId: terminalEmptyLeafTombstoneId(sessionId, original.incarnationId)
      },
      replacement: { command: 'exec relay', cwd: '/repo', cols: 100, rows: 30 }
    }
    const recovered = await harness.adapter.recoverEmptyLeafIfMatch(request)
    if (recovered.outcome !== 'recovered') {
      throw new Error('recovery was not prepared')
    }
    const admission: {
      preparedEmptyLeafRecoveries: Map<string, unknown>
      completeEmptyLeafRecovery(
        clientId: string,
        payload: { recoveryId: string; ptyId: string; incarnationId: string },
        commit: boolean
      ): { completed: boolean }
    } = Reflect.get(harness.server, 'admission')
    const connections: { values(): IterableIterator<ConnectedDaemonClient> } = Reflect.get(
      harness.server,
      'connections'
    )
    const client = [...connections.values()][0]
    if (!client) {
      throw new Error('daemon client unavailable')
    }
    const write = client.controlSocket.write.bind(client.controlSocket)
    let dropped = false
    Object.defineProperty(client.controlSocket, 'write', {
      value: (chunk: Uint8Array | string, ...args: unknown[]) => {
        if (!dropped && String(chunk).includes('"completed":true')) {
          dropped = true
          client.controlSocket.destroy()
          return false
        }
        return Reflect.apply(write, client.controlSocket, [chunk, ...args])
      }
    })

    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        recovered.incarnationId,
        false
      )
    ).resolves.toBe(false)
    expect(dropped).toBe(true)
    expect(admission.preparedEmptyLeafRecoveries.size).toBe(0)
    await expect(
      harness.adapter.killFenced({
        id: sessionId,
        expectedIncarnationId: recovered.incarnationId,
        requireNoAgentOwner: true,
        requireUnattached: true
      })
    ).resolves.toMatchObject({ outcome: 'ended' })
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        recovered.incarnationId,
        false
      )
    ).resolves.toBe(true)
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        'wrong-pty',
        recovered.incarnationId,
        false
      )
    ).resolves.toBe(false)
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        'wrong-incarnation',
        false
      )
    ).resolves.toBe(false)
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        recovered.incarnationId,
        true
      )
    ).resolves.toBe(false)
    expect(
      admission.completeEmptyLeafRecovery(
        `${client.clientId}-wrong`,
        {
          recoveryId: request.recoveryId,
          ptyId: sessionId,
          incarnationId: recovered.incarnationId
        },
        false
      )
    ).toEqual({ completed: false })
    expect(handles).toHaveLength(2)
  })
})
