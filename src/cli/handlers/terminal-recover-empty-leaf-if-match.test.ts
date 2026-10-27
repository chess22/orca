import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { TERMINAL_HANDLERS } from './terminal'

const REQUIRED_FLAGS = {
  'original-mutation-id': 'mutation-1',
  'recovery-id': 'recovery-1',
  terminal: 'term-1',
  'expected-worktree-id': 'worktree-1',
  'expected-tab-id': 'tab-1',
  'expected-leaf-id': 'leaf-1',
  'expected-pty-id': 'pty-1',
  'expected-pty-generation': '3',
  'retired-incarnation-id': 'incarnation-1',
  'layout-epoch': '8',
  'persisted-binding-version': '3',
  'tombstone-id': '["pty-1","incarnation-1"]',
  command: 'exec relay',
  cwd: '/tmp/worktree',
  cols: '120',
  rows: '40'
} as const

function flags(overrides: Record<string, string | undefined> = {}) {
  const values = new Map<string, string>()
  for (const [name, value] of Object.entries({ ...REQUIRED_FLAGS, ...overrides })) {
    if (value !== undefined) {
      values.set(name, value)
    }
  }
  return values
}

function client() {
  return new RuntimeClient('/tmp/orca-recovery-test', 60_000, null, null)
}

describe('terminal recover-empty-leaf-if-match CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it.each(Object.keys(REQUIRED_FLAGS))('requires a non-empty --%s', async (name) => {
    for (const value of [undefined, '']) {
      const runtimeClient = client()
      const call = vi.spyOn(runtimeClient, 'call')
      await expect(
        TERMINAL_HANDLERS['terminal recover-empty-leaf-if-match']({
          flags: flags({ [name]: value }),
          client: runtimeClient,
          cwd: '/tmp/worktree',
          json: true
        })
      ).rejects.toThrow(new RegExp(`--${name}`))
      expect(call).not.toHaveBeenCalled()
    }
  })

  it.each(['expected-pty-generation', 'layout-epoch', 'persisted-binding-version'])(
    'requires --%s to be a non-negative safe integer',
    async (name) => {
      for (const value of ['-1', '1.5', '9007199254740992']) {
        const runtimeClient = client()
        const call = vi.spyOn(runtimeClient, 'call')
        await expect(
          TERMINAL_HANDLERS['terminal recover-empty-leaf-if-match']({
            flags: flags({ [name]: value }),
            client: runtimeClient,
            cwd: '/tmp/worktree',
            json: true
          })
        ).rejects.toThrow(new RegExp(`--${name}`))
        expect(call).not.toHaveBeenCalled()
      }
    }
  )

  it.each(['cols', 'rows'])('requires --%s to be a positive safe integer', async (name) => {
    for (const value of ['0', '-1', '1.5', '9007199254740992']) {
      const runtimeClient = client()
      const call = vi.spyOn(runtimeClient, 'call')
      await expect(
        TERMINAL_HANDLERS['terminal recover-empty-leaf-if-match']({
          flags: flags({ [name]: value }),
          client: runtimeClient,
          cwd: '/tmp/worktree',
          json: true
        })
      ).rejects.toThrow(new RegExp(`--${name}`))
      expect(call).not.toHaveBeenCalled()
    }
  })

  it('dispatches the exact recovery request to the public RPC', async () => {
    const runtimeClient = client()
    const call = vi.spyOn(runtimeClient, 'call').mockResolvedValue({
      id: 'recovery',
      ok: true,
      result: {
        recovery: {
          outcome: 'recovered',
          recoveryId: 'recovery-1',
          ptyId: 'pty-1',
          incarnationId: 'incarnation-2'
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal recover-empty-leaf-if-match']({
      flags: flags(),
      client: runtimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledExactlyOnceWith('terminal.recoverEmptyLeafIfMatch', {
      originalMutationId: 'mutation-1',
      recoveryId: 'recovery-1',
      terminal: 'term-1',
      expected: {
        worktreeId: 'worktree-1',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        ptyId: 'pty-1',
        ptyGeneration: 3,
        retiredIncarnationId: 'incarnation-1',
        layoutEpoch: 8,
        persistedBindingVersion: 3,
        tombstoneId: '["pty-1","incarnation-1"]'
      },
      replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 120, rows: 40 }
    })
  })
})
