import { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import {
  createMockSubprocess,
  startDaemonAdapterHarness,
  waitFor
} from './daemon-pty-adapter-test-harness'
import type { ConnectedDaemonClient } from './daemon-client-connections'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { TerminalLeafMutationLane } from '../terminal-leaf-mutation-lane'
import { withBoundPane } from '../runtime/bind-first-pane.test-fixture'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import type { PendingDaemonSpawnOperation } from './daemon-pty-runtime-state'
import {
  MAX_RETAINED_CONDITIONAL_RESPAWN_EXITS,
  recordConditionalRespawnExit
} from './daemon-pty-adapter-conditional-respawn'
import { terminalEmptyLeafTombstoneId } from '../../shared/terminal-empty-leaf-recovery'

describe('DaemonPtyAdapter conditional respawn', () => {
  let harness: Awaited<ReturnType<typeof startDaemonAdapterHarness>>
  let handles: ReturnType<typeof createMockSubprocess>[]
  let exitReplacementOnSpawn: boolean
  let disconnectReplacementOnSpawn: boolean
  let failReplacementSpawn: boolean
  let blockPreparation: boolean
  let preparationCalls: number
  let preparationGate: PromiseWithResolvers<void>
  let onPtySessionExit: ReturnType<typeof vi.fn<(sessionId: string) => void>>

  beforeEach(async () => {
    handles = []
    exitReplacementOnSpawn = false
    disconnectReplacementOnSpawn = false
    failReplacementSpawn = false
    blockPreparation = false
    preparationCalls = 0
    preparationGate = Promise.withResolvers<void>()
    onPtySessionExit = vi.fn()
    harness = await startDaemonAdapterHarness(
      () => {
        if (failReplacementSpawn && handles.length === 1) {
          throw new Error('replacement spawn failed')
        }
        const handle = createMockSubprocess()
        handles.push(handle)
        if (exitReplacementOnSpawn && handles.length === 2) {
          const subscribe = handle.onExit.bind(handle)
          handle.onExit = (callback) => {
            subscribe(callback)
            queueMicrotask(() => handle._simulateExit(17))
          }
        }
        if (disconnectReplacementOnSpawn && handles.length === 3) {
          queueMicrotask(() => {
            const connections = (
              harness.server as unknown as {
                connections: { values(): IterableIterator<ConnectedDaemonClient> }
              }
            ).connections
            const client = [...connections.values()][0]
            if (client) {
              client.authenticatedPairEstablished = false
              client.controlSocket.destroy()
            }
          })
        }
        return handle
      },
      {
        preparePtySpawn: async () => {
          preparationCalls++
          if (blockPreparation) {
            await preparationGate.promise
          }
        },
        onPtySessionExit
      }
    )
  })

  afterEach(async () => {
    for (const handle of handles) {
      handle._simulateExit(0)
    }
    harness.adapter.dispose()
    await harness.server.shutdown()
    rmSync(harness.dir, { recursive: true, force: true })
  })

  it('suppresses the predecessor exit and publishes the replacement incarnation', async () => {
    const sessionId = 'conditional-respawn-exit-fence'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    const exits: string[] = []
    harness.adapter.onExit(({ id }) => exits.push(id))

    const result = await harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId!,
      original.pid!,
      'mutation-exit-fence',
      { cols: 100, rows: 30 }
    )

    expect(result).toMatchObject({ outcome: 'respawned', ptyId: sessionId })
    expect(exits).toEqual([])
    expect(harness.adapter.hasPty(sessionId)).toBe(true)
    expect(handles).toHaveLength(2)
    const internals = harness.adapter as unknown as {
      sessionIncarnations: Map<string, string>
      activeSessionIds: Set<string>
    }
    expect(internals.sessionIncarnations.get(sessionId)).toBe(
      result.outcome === 'respawned' ? result.incarnationId : undefined
    )
    expect(internals.activeSessionIds.has(sessionId)).toBe(true)
  })

  it('recovers a confirmed post-stop gap and replays without a second spawn', async () => {
    const sessionId = 'conditional-respawn-post-stop-recovery'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    failReplacementSpawn = true
    const mutationId = 'mutation-post-stop-gap'
    const ambiguous = await harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId!,
      original.pid!,
      mutationId,
      { command: 'exec relay', cwd: '/repo', cols: 100, rows: 30 }
    )
    expect(ambiguous).toMatchObject({
      outcome: 'indeterminate',
      oldStopped: true,
      replacementStarted: true
    })
    failReplacementSpawn = false
    const request = {
      originalMutationId: mutationId,
      recoveryId: 'recovery-post-stop-gap',
      terminal: 'term-1',
      expected: {
        worktreeId: 'worktree-1',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        ptyId: sessionId,
        ptyGeneration: 1,
        retiredIncarnationId: original.incarnationId!,
        layoutEpoch: 1,
        persistedBindingVersion: 1,
        tombstoneId: terminalEmptyLeafTombstoneId(sessionId, original.incarnationId!)
      },
      replacement: { command: 'exec relay', cwd: '/repo', cols: 100, rows: 30 }
    }

    const connections: { values(): IterableIterator<ConnectedDaemonClient> } = Reflect.get(
      harness.server,
      'connections'
    )
    const controlSocket = [...connections.values()][0]!.controlSocket
    const write = controlSocket.write.bind(controlSocket)
    let dropped = false
    // SAFETY: the test proxy preserves Socket.write arguments and return values outside one dropped reply.
    Object.defineProperty(controlSocket, 'write', {
      value: (chunk: Uint8Array | string, ...args: unknown[]) => {
        if (!dropped && String(chunk).includes('"outcome":"recovered"')) {
          dropped = true
          controlSocket.destroy()
          return false
        }
        return Reflect.apply(write, controlSocket, [chunk, ...args])
      }
    })

    await expect(harness.adapter.recoverEmptyLeafIfMatch(request)).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'provider_response_lost'
    })
    const recovered = await harness.adapter.recoverEmptyLeafIfMatch(request)
    const replay = await harness.adapter.recoverEmptyLeafIfMatch(request)
    expect(recovered.outcome).toBe('recovered')
    if (recovered.outcome !== 'recovered') {
      throw new Error('recovery was not prepared')
    }
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        recovered.incarnationId,
        true
      )
    ).resolves.toBe(true)
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        recovered.incarnationId,
        true
      )
    ).resolves.toBe(true)
    await expect(
      harness.adapter.completeEmptyLeafRecovery(
        request.recoveryId,
        sessionId,
        recovered.incarnationId,
        false
      )
    ).resolves.toBe(false)
    const competing = await harness.adapter.recoverEmptyLeafIfMatch({
      ...request,
      recoveryId: 'competing-recovery'
    })

    expect(recovered).toMatchObject({ outcome: 'recovered', ptyId: sessionId })
    expect(replay).toMatchObject({ outcome: 'recovered', ptyId: sessionId, replayed: true })
    expect(dropped).toBe(true)
    expect(competing).toMatchObject({ outcome: 'precondition_failed', reason: 'terminal_live' })
    expect(handles).toHaveLength(2)
    expect(harness.adapter.hasPty(sessionId)).toBe(true)
  })

  it('fails closed when the terminal root process changed', async () => {
    const sessionId = 'conditional-respawn-root-process-changed'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid! + 1,
        'mutation-root-process-changed',
        { cols: 100, rows: 30 }
      )
    ).resolves.toEqual({
      outcome: 'precondition_failed',
      mutationId: 'mutation-root-process-changed',
      reason: 'root_process_changed'
    })
    expect(handles).toHaveLength(1)
    expect(handles[0]!.forceKill).not.toHaveBeenCalled()
  })

  it('clears live adapter state when the replacement exits before its reply', async () => {
    const sessionId = 'conditional-respawn-early-replacement-exit'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    const exits: string[] = []
    harness.adapter.onExit(({ id }) => exits.push(id))
    exitReplacementOnSpawn = true

    const result = await harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId!,
      original.pid!,
      'mutation-early-exit',
      { cols: 100, rows: 30 }
    )

    expect(result).toMatchObject({
      outcome: 'partial',
      reason: 'replacement_exited_before_publication',
      replacementStarted: true,
      replacementPublished: false
    })
    expect(exits).toEqual([sessionId])
    expect(harness.adapter.hasPty(sessionId)).toBe(false)
    const internals = harness.adapter as unknown as {
      sessionIncarnations: Map<string, string>
      activeSessionIds: Set<string>
    }
    expect(internals.sessionIncarnations.has(sessionId)).toBe(false)
    expect(internals.activeSessionIds.has(sessionId)).toBe(false)
  })

  it('retires an early replacement exit through the adapter and runtime listener', async () => {
    const sessionId = 'conditional-respawn-runtime-early-exit'
    const worktreeId = 'repo-1::/tmp/worktree'
    const tabId = 'tab-runtime'
    const leafId = '11111111-1111-4111-8111-111111111111'
    const handle = 'term_runtime_early_exit'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    const lane = new TerminalLeafMutationLane()
    let session: WorkspaceSessionState = withBoundPane(getDefaultWorkspaceSession(), {
      worktreeId,
      tabId,
      leafId,
      ptyId: sessionId,
      incarnationId: original.incarnationId
    })
    const runtime = new OrcaRuntimeService({
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
      persistPtyBinding: async (args: {
        tabId: string
        leafId: string
        incarnationId?: string
      }) => {
        session.terminalPtyIncarnationsByPaneKey = {
          ...session.terminalPtyIncarnationsByPaneKey,
          [`${args.tabId}:${args.leafId}`]: args.incarnationId!
        }
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
    } as never)
    runtime.registerPty(sessionId, worktreeId, null, {
      tabId,
      leafId,
      incarnationId: original.incarnationId,
      terminalHandle: handle
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [{ tabId, worktreeId, title: 'Terminal', activeLeafId: leafId, layout: null }],
      leaves: [{ tabId, worktreeId, leafId, paneRuntimeId: 1, ptyId: sessionId }]
    })
    harness.adapter.onExit(({ id, code, incarnationId }) => {
      void runtime.onPtyExit(id, code, incarnationId, { providerExitObserved: true })
    })
    runtime.setPtyController({
      write: () => true,
      kill: () => false,
      getSize: () => ({ cols: 80, rows: 24 }),
      getForegroundProcess: async () => null,
      respawnIfMatch: (id, expectedIncarnationId, expectedRootProcessId, mutationId, replacement) =>
        harness.adapter.respawnIfMatch(
          id,
          expectedIncarnationId,
          expectedRootProcessId,
          mutationId,
          replacement
        )
    } as never)
    exitReplacementOnSpawn = true
    const shown = await runtime.showTerminal(handle)

    await expect(
      runtime.respawnTerminalIfMatch({
        mutationId: 'mutation-runtime-early-exit',
        terminal: handle,
        expected: {
          worktreeId,
          tabId,
          leafId,
          ptyId: sessionId,
          ptyGeneration: shown.ptyGeneration!,
          incarnationId: original.incarnationId!,
          rootProcessId: original.pid!
        },
        replacement: {}
      })
    ).resolves.toMatchObject({
      outcome: 'partial',
      ptyId: sessionId,
      reason: 'replacement_exited_before_publication'
    })
    await expect(runtime.showTerminal(handle)).resolves.toMatchObject({
      connected: false,
      writable: false
    })
  })

  it('rejects a replaced stream after preparation without stopping the original', async () => {
    const sessionId = 'conditional-respawn-stream-replaced'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    blockPreparation = true
    const replacing = harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId!,
      original.pid!,
      'mutation-stream-replaced',
      { cols: 100, rows: 30 }
    )
    await waitFor(() => preparationCalls === 2)
    const connections = (
      harness.server as unknown as {
        connections: { values(): IterableIterator<ConnectedDaemonClient> }
      }
    ).connections
    const client = [...connections.values()][0]!
    const originalStream = client.streamSocket
    client.streamSocket = new Socket()
    preparationGate.resolve()

    await expect(replacing).resolves.toMatchObject({
      outcome: 'failed_before_mutation',
      reason: 'client_disconnected'
    })
    client.streamSocket.destroy()
    client.streamSocket = originalStream
    expect(handles[0]!.forceKill).not.toHaveBeenCalled()
    expect(handles).toHaveLength(1)
  })

  it('does not suppress a natural exit while preparation is waiting', async () => {
    const sessionId = 'conditional-respawn-preparation-exit'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    const exits: string[] = []
    harness.adapter.onExit(({ id }) => exits.push(id))
    blockPreparation = true
    const replacing = harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId!,
      original.pid!,
      'mutation-preparation-exit',
      { cols: 100, rows: 30 }
    )
    await waitFor(() => preparationCalls === 2)
    handles[0]!._simulateExit(17)
    await waitFor(() => onPtySessionExit.mock.calls.length === 1)
    preparationGate.resolve()

    await expect(replacing).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'attachment_owner_changed'
    })
    expect(onPtySessionExit).toHaveBeenCalledWith(sessionId)
    expect(handles).toHaveLength(1)
  })

  it('replays the predecessor exit when replacement spawning fails', async () => {
    const sessionId = 'conditional-respawn-spawn-failure-exit'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    failReplacementSpawn = true

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-spawn-failure-exit',
        { cols: 100, rows: 30 }
      )
    ).resolves.toMatchObject({
      outcome: 'indeterminate',
      replacementStarted: true
    })
    expect(onPtySessionExit).toHaveBeenCalledWith(sessionId)
    const attachments = (
      harness.server as unknown as {
        attachments: { clientIdForSession(id: string): string | undefined }
      }
    ).attachments
    expect(attachments.clientIdForSession(sessionId)).toBeUndefined()
  })

  it('releases the exit fence after an indeterminate stop', async () => {
    const sessionId = 'conditional-respawn-stop-indeterminate-exit'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    vi.mocked(handles[0]!.forceKill).mockImplementation(() => {
      throw new Error('stop failed')
    })

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-stop-indeterminate-exit',
        { cols: 100, rows: 30 }
      )
    ).resolves.toMatchObject({ outcome: 'indeterminate', reason: 'stop_failed' })
    handles[0]!._simulateExit(137)
    await waitFor(() => onPtySessionExit.mock.calls.length === 1)
    expect(onPtySessionExit).toHaveBeenCalledWith(sessionId)
    const attachments = (
      harness.server as unknown as {
        attachments: { clientIdForSession(id: string): string | undefined }
      }
    ).attachments
    expect(attachments.clientIdForSession(sessionId)).toBeUndefined()
  })

  it('replays the exact committed result after response loss and rejects mismatched reuse', async () => {
    const sessionId = 'conditional-respawn-response-loss-replay'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    const connections = (
      harness.server as unknown as {
        connections: { values(): IterableIterator<ConnectedDaemonClient> }
      }
    ).connections
    const client = [...connections.values()][0]!
    const controlSocket = client.controlSocket
    const write = controlSocket.write.bind(controlSocket)
    let dropped = false
    // SAFETY: the test proxy preserves Socket.write arguments and return values outside one dropped reply.
    controlSocket.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      if (!dropped && String(chunk).includes('"outcome":"respawned"')) {
        dropped = true
        controlSocket.destroy()
        return false
      }
      return Reflect.apply(write, controlSocket, [chunk, ...args])
    }) as typeof controlSocket.write

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-replay',
        { cols: 100, rows: 30 }
      )
    ).resolves.toEqual({
      outcome: 'indeterminate',
      mutationId: 'mutation-response-loss-replay',
      reason: 'response_lost'
    })
    expect(dropped).toBe(true)
    // SAFETY: this integration test reads the real server host only to compare the committed wire result.
    const host = (
      harness.server as unknown as {
        host: { listSessions(): { sessionId: string; incarnationId?: string; pid: number }[] }
      }
    ).host
    const replacement = host.listSessions().find((session) => session.sessionId === sessionId)!

    const replay = await harness.adapter.respawnIfMatch(
      sessionId,
      original.incarnationId!,
      original.pid!,
      'mutation-response-loss-replay',
      { cols: 100, rows: 30 }
    )
    expect(replay).toEqual({
      outcome: 'respawned',
      mutationId: 'mutation-response-loss-replay',
      ptyId: sessionId,
      incarnationId: replacement.incarnationId,
      processId: replacement.pid,
      replayed: true
    })
    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-replay',
        { cols: 101, rows: 30 }
      )
    ).resolves.toMatchObject({
      outcome: 'precondition_failed',
      mutationId: 'mutation-response-loss-replay',
      reason: 'mutation_id_reused'
    })
    expect(handles).toHaveLength(2)
    expect(handles[0]!.forceKill).toHaveBeenCalledOnce()
    expect(handles[1]!.forceKill).not.toHaveBeenCalled()
  })

  it('bounds retained exits and fails closed when response-loss evidence overflows', async () => {
    const sessionId = 'conditional-respawn-response-loss-overflow'
    const mutationId = 'mutation-response-loss-overflow'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    const connections = (
      harness.server as unknown as {
        connections: { values(): IterableIterator<ConnectedDaemonClient> }
      }
    ).connections
    const client = [...connections.values()][0]!
    const controlSocket = client.controlSocket
    const write = controlSocket.write.bind(controlSocket)
    let dropped = false
    controlSocket.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      if (!dropped && String(chunk).includes('"outcome":"respawned"')) {
        dropped = true
        controlSocket.destroy()
        return false
      }
      return Reflect.apply(write, controlSocket, [chunk, ...args])
    }) as typeof controlSocket.write

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        mutationId,
        {
          cols: 100,
          rows: 30
        }
      )
    ).resolves.toMatchObject({ outcome: 'indeterminate', reason: 'response_lost' })
    const uncertain = (
      harness.adapter as unknown as {
        uncertainConditionalRespawns: Map<string, { operation: PendingDaemonSpawnOperation }>
      }
    ).uncertainConditionalRespawns.get(mutationId)!
    for (let index = 0; index <= MAX_RETAINED_CONDITIONAL_RESPAWN_EXITS; index++) {
      expect(
        recordConditionalRespawnExit(uncertain.operation, sessionId, {
          code: index,
          incarnationId: `unrelated-${index}`
        })
      ).toBe(true)
    }
    expect(uncertain.operation.exitsBySessionId.get(sessionId)).toHaveLength(
      MAX_RETAINED_CONDITIONAL_RESPAWN_EXITS
    )
    expect(uncertain.operation.conditionalRespawnExitCaptureOverflowed).toBe(true)

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        mutationId,
        {
          cols: 100,
          rows: 30
        }
      )
    ).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'response_lost_exit_capture_overflow'
    })
    expect(handles).toHaveLength(2)
  })

  it('replays a replacement exit observed after response loss without reporting it live', async () => {
    const sessionId = 'conditional-respawn-response-loss-exit-replay'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    await harness.adapter.spawn({
      sessionId: 'conditional-respawn-response-loss-exit-keepalive',
      cols: 80,
      rows: 24
    })
    const exits: string[] = []
    harness.adapter.onExit(({ id }) => exits.push(id))
    const connections = (
      harness.server as unknown as {
        connections: { values(): IterableIterator<ConnectedDaemonClient> }
      }
    ).connections
    const client = [...connections.values()][0]!
    const controlSocket = client.controlSocket
    const write = controlSocket.write.bind(controlSocket)
    let dropped = false
    // SAFETY: the test proxy preserves Socket.write arguments and return values outside one dropped reply.
    controlSocket.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      if (!dropped && String(chunk).includes('"outcome":"respawned"')) {
        dropped = true
        controlSocket.destroy()
        return false
      }
      return Reflect.apply(write, controlSocket, [chunk, ...args])
    }) as typeof controlSocket.write

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-exit-replay',
        { cols: 100, rows: 30 }
      )
    ).resolves.toMatchObject({ outcome: 'indeterminate', reason: 'response_lost' })
    expect(handles).toHaveLength(3)
    handles[2]!._simulateExit(23)
    await waitFor(() => onPtySessionExit.mock.calls.length === 1)
    expect(exits).toEqual([])

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-exit-replay',
        { cols: 101, rows: 30 }
      )
    ).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'mutation_id_reused'
    })

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-exit-replay',
        { cols: 100, rows: 30 }
      )
    ).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_exited_before_publication',
      oldStopped: true,
      replacementStarted: true,
      replacementPublished: true
    })
    expect(exits).toEqual([sessionId])
    expect(harness.adapter.hasPty(sessionId)).toBe(false)
    expect(handles).toHaveLength(3)
  })

  it('replays daemon publication state after response loss before using a retained exit', async () => {
    const sessionId = 'conditional-respawn-response-loss-before-publication'
    const original = await harness.adapter.spawn({ sessionId, cols: 80, rows: 24 })
    await harness.adapter.spawn({
      sessionId: 'conditional-respawn-response-loss-before-publication-keepalive',
      cols: 80,
      rows: 24
    })
    disconnectReplacementOnSpawn = true

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-before-publication',
        { cols: 100, rows: 30 }
      )
    ).resolves.toMatchObject({ outcome: 'indeterminate', reason: 'response_lost' })
    await waitFor(() => vi.mocked(handles[2]!.forceKill).mock.calls.length === 1)

    await expect(
      harness.adapter.respawnIfMatch(
        sessionId,
        original.incarnationId!,
        original.pid!,
        'mutation-response-loss-before-publication',
        { cols: 100, rows: 30 }
      )
    ).resolves.toMatchObject({
      outcome: 'partial',
      replacementStarted: true,
      replacementPublished: false
    })
    expect(handles).toHaveLength(3)
  })
})
