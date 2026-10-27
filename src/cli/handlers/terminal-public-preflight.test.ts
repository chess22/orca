import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { TERMINAL_HANDLERS } from './terminal'

const preflight = {
  status: 'ready' as const,
  originalMutationId: 'mutation-1',
  ptyGeneration: 3,
  retiredIncarnationId: 'inc-1',
  layoutEpoch: 8,
  persistedBindingVersion: 3,
  tombstoneId: '["pty-1","inc-1"]',
  replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 120, rows: 40 }
}

function client(result: unknown): RuntimeClient {
  const runtimeClient = new RuntimeClient('/tmp/orca-terminal-public-preflight', 60_000, null, null)
  vi.spyOn(runtimeClient, 'call').mockResolvedValue({
    id: 'request-1',
    ok: true,
    result,
    _meta: { runtimeId: 'runtime-1' }
  })
  return runtimeClient
}

describe('terminal public preflight JSON', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [
      'terminal list',
      {
        terminals: [
          {
            providerKind: 'daemon-backed',
            installRestartPersistence: 'eligible',
            emptyLeafRecovery: preflight
          }
        ]
      },
      new Map()
    ],
    [
      'terminal show',
      {
        terminal: {
          providerKind: 'daemon-backed',
          installRestartPersistence: 'eligible',
          emptyLeafRecovery: preflight
        }
      },
      new Map([['terminal', 'term-1']])
    ]
  ] as const)('preserves additive fields from %s', async (handler, result, flags) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await TERMINAL_HANDLERS[handler]({
      flags: new Map(flags),
      client: client(result),
      cwd: '/tmp/worktree',
      json: true
    })
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ result })
  })

  it('preserves an older host response with every additive field absent', async () => {
    const result = { terminal: { handle: 'term-1', ptyId: 'pty-1' } }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await TERMINAL_HANDLERS['terminal show']({
      flags: new Map([['terminal', 'term-1']]),
      client: client(result),
      cwd: '/tmp/worktree',
      json: true
    })
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ result })
  })
})
