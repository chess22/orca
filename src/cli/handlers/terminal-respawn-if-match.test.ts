import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { TERMINAL_HANDLERS } from './terminal'
import { getRequiredPositiveIntegerFlag } from './terminal-handler-values'

describe('terminal respawn-if-match CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it.each([undefined, '', '0', '-1', '1.5', '9007199254740992'])(
    'rejects an invalid expected root pid before dispatch: %s',
    (value) => {
      const flags = new Map<string, string>()
      if (value !== undefined) {
        flags.set('expected-root-pid', value)
      }

      expect(() => getRequiredPositiveIntegerFlag(flags, 'expected-root-pid')).toThrow(
        /--expected-root-pid/
      )
    }
  )

  it.each(['cols', 'rows'])('requires --%s to be a positive safe integer', (name) => {
    for (const value of ['0', '-1', '1.5', '9007199254740992']) {
      expect(() => getRequiredPositiveIntegerFlag(new Map([[name, value]]), name)).toThrow(
        new RegExp(`--${name}`)
      )
    }
  })

  it.each(['command', 'cwd', 'cols', 'rows'])(
    'rejects a missing explicit --%s before dispatch',
    async (missingFlag) => {
      const client = new RuntimeClient('/tmp/orca-respawn-test', 60_000, null, null)
      const call = vi.spyOn(client, 'call')
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
      const flags = new Map([
        ['terminal', 'term-1'],
        ['mutation-id', 'mutation-1'],
        ['expected-worktree-id', 'worktree-1'],
        ['expected-tab-id', 'tab-1'],
        ['expected-leaf-id', 'leaf-1'],
        ['expected-pty-id', 'pty-1'],
        ['expected-pty-generation', '3'],
        ['expected-incarnation-id', 'incarnation-1'],
        ['expected-root-pid', '4242'],
        ['cols', '120'],
        ['rows', '40'],
        ['cwd', '/tmp/replacement'],
        ['command', 'exec replacement']
      ])
      flags.delete(missingFlag)

      await expect(
        TERMINAL_HANDLERS['terminal respawn-if-match']({
          flags,
          client,
          cwd: '/tmp/worktree',
          json: true
        })
      ).rejects.toThrow(new RegExp(`--${missingFlag}`))
      expect(call).not.toHaveBeenCalled()
    }
  )

  it('passes the explicit replacement specification to the runtime', async () => {
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
        ['expected-incarnation-id', 'incarnation-1'],
        ['expected-root-pid', '4242'],
        ['cols', '120'],
        ['rows', '40'],
        ['cwd', '/tmp/replacement'],
        ['command', 'exec replacement']
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
        incarnationId: 'incarnation-1',
        rootProcessId: 4242
      },
      replacement: {
        cols: 120,
        rows: 40,
        cwd: '/tmp/replacement',
        command: 'exec replacement'
      }
    })
  })

  it('refuses before the mutation RPC when the host does not advertise respawn', async () => {
    const client = new RuntimeClient('/tmp/orca-respawn-test', 60_000, null, null)
    const call = vi.spyOn(client, 'call')
    vi.spyOn(client, 'getCliStatus').mockResolvedValue({
      id: 'status',
      ok: true,
      result: {
        app: { running: true, pid: 123 },
        runtime: { state: 'ready', reachable: true, runtimeId: 'runtime-1', capabilities: [] },
        graph: { state: 'ready' }
      },
      _meta: { runtimeId: 'runtime-1' }
    })

    await expect(
      TERMINAL_HANDLERS['terminal respawn-if-match']({
        flags: new Map([
          ['terminal', 'term-1'],
          ['mutation-id', 'mutation-1'],
          ['expected-worktree-id', 'worktree-1'],
          ['expected-tab-id', 'tab-1'],
          ['expected-leaf-id', 'leaf-1'],
          ['expected-pty-id', 'pty-1'],
          ['expected-pty-generation', '3'],
          ['expected-incarnation-id', 'incarnation-1'],
          ['expected-root-pid', '4242'],
          ['cols', '120'],
          ['rows', '40'],
          ['cwd', '/tmp/replacement'],
          ['command', 'exec replacement']
        ]),
        client,
        cwd: '/tmp/worktree',
        json: true
      })
    ).rejects.toThrow(/does not support conditional terminal respawn/)
    expect(call).not.toHaveBeenCalled()
  })
})
