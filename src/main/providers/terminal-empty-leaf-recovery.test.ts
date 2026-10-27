import { describe, expect, it, vi } from 'vitest'
import type { TerminalEmptyLeafRecoveryRequest } from '../../shared/terminal-empty-leaf-recovery'
import {
  TerminalEmptyLeafRecoveryProvider,
  type TerminalRecoveryProviderGap
} from './terminal-empty-leaf-recovery'

function request(command = 'exec relay'): TerminalEmptyLeafRecoveryRequest {
  return {
    originalMutationId: 'mutation-1',
    recoveryId: 'recovery-1',
    terminal: 'term-1',
    expected: {
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      ptyId: 'pty-1',
      ptyGeneration: 4,
      retiredIncarnationId: 'inc-retired',
      layoutEpoch: 8,
      persistedBindingVersion: 3,
      tombstoneId: 'tombstone-1'
    },
    replacement: { command, cwd: '/worktree', cols: 100, rows: 30 }
  }
}

function gap(overrides: Partial<TerminalRecoveryProviderGap> = {}): TerminalRecoveryProviderGap {
  return {
    ptyId: 'pty-1',
    retiredIncarnationId: 'inc-retired',
    tombstoneId: 'tombstone-1',
    liveIncarnationId: null,
    agentOwnerCount: 0,
    recoveryOwnerId: null,
    ...overrides
  }
}

describe('terminal empty-leaf recovery provider', () => {
  it('reserves the PTY, creates once, and replays the recorded result', async () => {
    const spawnReplacement = vi.fn(async () => ({
      ptyId: 'pty-1',
      incarnationId: 'inc-new',
      processId: 202
    }))
    const provider = new TerminalEmptyLeafRecoveryProvider({
      runWithPtyReservation: async (_ptyId, operation) => await operation(),
      inspectGap: async () => gap(),
      spawnReplacement
    })

    const first = await provider.recover(request())
    await expect(provider.recover(request())).resolves.toEqual({ ...first, replayed: true })
    expect(first).toEqual({
      outcome: 'recovered',
      recoveryId: 'recovery-1',
      ptyId: 'pty-1',
      incarnationId: 'inc-new',
      processId: 202
    })
    expect(spawnReplacement).toHaveBeenCalledOnce()
  })

  it('fails closed when one recovery id names different replacement fields', async () => {
    const spawnReplacement = vi.fn(async () => ({ ptyId: 'pty-1', incarnationId: 'inc-new' }))
    const provider = new TerminalEmptyLeafRecoveryProvider({
      runWithPtyReservation: async (_ptyId, operation) => await operation(),
      inspectGap: async () => gap(),
      spawnReplacement
    })

    await provider.recover(request())
    await expect(provider.recover(request('different relay'))).resolves.toEqual({
      outcome: 'precondition_failed',
      recoveryId: 'recovery-1',
      reason: 'recovery_id_reused'
    })
    expect(spawnReplacement).toHaveBeenCalledOnce()
  })

  it('does not claim that a replacement failed to start after an unobserved spawn error', async () => {
    const provider = new TerminalEmptyLeafRecoveryProvider({
      runWithPtyReservation: async (_ptyId, operation) => await operation(),
      inspectGap: async () => gap(),
      spawnReplacement: async () => {
        throw new Error('spawn response lost')
      }
    })

    await expect(provider.recover(request())).resolves.toEqual({
      outcome: 'indeterminate',
      recoveryId: 'recovery-1',
      reason: 'replacement_start_unverified',
      replacementStarted: true,
      replacementPublished: false
    })
  })

  it.each([
    ['retirement_unverifiable', null],
    ['tombstone_changed', gap({ tombstoneId: 'other' })],
    ['liveness_unverifiable', gap({ liveIncarnationId: undefined })],
    ['terminal_live', gap({ liveIncarnationId: 'inc-live' })],
    ['agent_owner_unverifiable', gap({ agentOwnerCount: null })],
    ['agent_owned', gap({ agentOwnerCount: 1 })],
    ['recovery_owned', gap({ recoveryOwnerId: 'other-recovery' })]
  ] as const)('refuses %s before spawning', async (reason, observed) => {
    const spawnReplacement = vi.fn()
    const provider = new TerminalEmptyLeafRecoveryProvider({
      runWithPtyReservation: async (_ptyId, operation) => await operation(),
      inspectGap: async () => observed,
      spawnReplacement
    })

    await expect(provider.recover(request())).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason
    })
    expect(spawnReplacement).not.toHaveBeenCalled()
  })
})
