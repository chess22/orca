import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { parseArgs } from '../args'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'

describe('terminal close CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the default close RPC unchanged', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { close: { handle: 'term-1', tabId: 'tab-1', ptyKilled: true } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: new Map([['terminal', 'term-1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.close', { terminal: 'term-1' })
  })

  it('routes --tab to the durable whole-tab RPC', async () => {
    const parsed = parseArgs(['terminal', 'close', '--terminal', 'term-1', '--tab'])
    const call = vi.fn().mockResolvedValue({
      result: {
        close: {
          handle: 'term-1',
          tabId: 'tab-1',
          closeMode: 'tab',
          ptyKilled: false
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: parsed.flags,
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(parsed.flags.get('tab')).toBe(true)
    expect(call).toHaveBeenCalledWith('terminal.closeTab', { terminal: 'term-1' })
  })

  it('documents that --tab waits for durable persistence', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'close'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain(
      'orca terminal close [--terminal <handle>] [--tab] [--tab-id <id> --worktree <selector>] [--json]'
    )
    expect(help).toContain('durable persistence')
  })

  it('closes a saved tab by worktree and tab ID with explicit user intent', async () => {
    const call = vi.fn().mockResolvedValue({ result: { closed: true } })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: new Map([
        ['tab-id', 'tab-1'],
        ['worktree', 'id:wt-1']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('session.tabs.close', {
      worktree: 'id:wt-1',
      tabId: 'tab-1',
      reason: 'user'
    })
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      result: { closed: true }
    })
  })

  it('preserves a refused saved-tab close response', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { closed: true, refused: true, refusalReason: 'live-host-pty' }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: new Map([
        ['tab-id', 'tab-1'],
        ['worktree', 'id:wt-1']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: false
    })

    expect(log).toHaveBeenCalledWith('Close refused for saved tab tab-1: live-host-pty.')
  })

  it.each([['terminal'], ['tab']])('rejects --tab-id with --%s', async (conflict) => {
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal close']({
        flags: new Map([
          ['tab-id', 'tab-1'],
          ['worktree', 'id:wt-1'],
          [conflict, conflict === 'tab' ? true : 'term-1']
        ]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(call).not.toHaveBeenCalled()
  })

  it('requires --worktree with --tab-id', async () => {
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal close']({
        flags: new Map([['tab-id', 'tab-1']]),
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'Missing required --worktree'
    })
    expect(call).not.toHaveBeenCalled()
  })
})
