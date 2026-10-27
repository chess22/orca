import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { TERMINAL_HANDLERS } from './terminal'

describe('terminal respawn-if-match CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('lets the runtime reuse the current size when dimensions are omitted', async () => {
    const client = new RuntimeClient('/tmp/orca-respawn-test', 60_000, null, null)
    const call = vi.spyOn(client, 'call').mockResolvedValue({
      id: 'respawn',
      ok: true,
      result: {
        respawn: {
          outcome: 'respawned',
          mutationId: 'mutation-1',
          ptyId: 'pty-1',
          incarnationId: 'incarnation-2'
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    vi.spyOn(client, 'getCliStatus').mockResolvedValue({
      id: 'status',
      ok: true,
      result: {
        app: { running: true, pid: 123 },
        runtime: {
          state: 'ready',
          reachable: true,
          runtimeId: 'runtime-1',
          capabilities: [TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY]
        },
        graph: { state: 'ready' }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal respawn-if-match']({
      flags: new Map([
        ['terminal', 'term-1'],
        ['mutation-id', 'mutation-1'],
        ['expected-worktree-id', 'worktree-1'],
        ['expected-tab-id', 'tab-1'],
        ['expected-leaf-id', 'leaf-1'],
        ['expected-pty-id', 'pty-1'],
        ['expected-pty-generation', '3'],
        ['expected-incarnation-id', 'incarnation-1']
      ]),
      client,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.respawnIfMatch', {
      mutationId: 'mutation-1',
      terminal: 'term-1',
      expected: {
        worktreeId: 'worktree-1',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        ptyId: 'pty-1',
        ptyGeneration: 3,
        incarnationId: 'incarnation-1'
      },
      replacement: { cols: undefined, rows: undefined, cwd: undefined, command: undefined }
    })
  })
})
