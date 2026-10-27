import { describe, expect, it, vi } from 'vitest'
import type { TerminalConditionalRespawnRequest } from '../../../../shared/terminal-conditional-respawn'
import type { RuntimeEmptyLeafRecoveryState } from './empty-leaf-recovery-state'
import {
  inspectTerminalEmptyLeafRecoveryPreflight,
  terminalEmptyLeafRecoveryPreflight
} from './empty-leaf-recovery-preflight'

const original: TerminalConditionalRespawnRequest = {
  mutationId: 'mutation-1',
  terminal: 'terminal-1',
  expected: {
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    ptyId: 'pty-1',
    ptyGeneration: 3,
    incarnationId: 'incarnation-1',
    rootProcessId: 42
  },
  replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 120, rows: 40 }
}

const authoritativeState: RuntimeEmptyLeafRecoveryState = {
  layoutEpoch: 8,
  terminal: 'terminal-1',
  worktreeId: 'worktree-1',
  tabId: 'tab-1',
  leafId: 'leaf-1',
  ptyId: 'pty-1',
  ptyGeneration: 3,
  retiredIncarnationId: 'incarnation-1',
  persistedBindingVersion: 3,
  tombstoneId: '["pty-1","incarnation-1"]',
  leafEmpty: true,
  liveIncarnationId: null,
  agentOwnerCount: 0,
  recoveryOwnerId: null
}

function preflight(state: RuntimeEmptyLeafRecoveryState | null) {
  return inspectTerminalEmptyLeafRecoveryPreflight({
    terminal: original.terminal,
    pty: { ptyId: 'pty-1', incarnationId: 'incarnation-1', connected: false },
    leaf: { ptyId: 'pty-1', ptyGeneration: 3, connected: false, writable: false },
    findRecoverableGap: () => original,
    captureLayoutEpoch: () => 8,
    inspectState: () => state
  })
}

describe('terminalEmptyLeafRecoveryPreflight', () => {
  it('publishes ready through the public preflight when recovery mutations are enabled', () => {
    const findRecoverableGap = vi.fn(() => original)
    const inspectState = vi.fn(() => authoritativeState)

    expect(
      terminalEmptyLeafRecoveryPreflight({
        terminal: original.terminal,
        pty: { ptyId: 'pty-1', incarnationId: 'incarnation-1', connected: false },
        leaf: { ptyId: 'pty-1', ptyGeneration: 3, connected: false, writable: false },
        findRecoverableGap,
        captureLayoutEpoch: () => 8,
        inspectState
      })
    ).toMatchObject({
      status: 'ready',
      originalMutationId: 'mutation-1',
      retiredIncarnationId: 'incarnation-1'
    })
    expect(findRecoverableGap).toHaveBeenCalledOnce()
    expect(inspectState).toHaveBeenCalledOnce()
  })

  it('publishes ready only when authoritative state matches every original request fence', () => {
    expect(preflight(authoritativeState)).toMatchObject({
      status: 'ready',
      originalMutationId: 'mutation-1',
      ptyGeneration: 3,
      retiredIncarnationId: 'incarnation-1',
      layoutEpoch: 8,
      persistedBindingVersion: 3,
      tombstoneId: '["pty-1","incarnation-1"]'
    })
  })

  it.each([
    null,
    { ...authoritativeState, layoutEpoch: 9 },
    { ...authoritativeState, ptyGeneration: 4 },
    { ...authoritativeState, retiredIncarnationId: 'incarnation-2' },
    { ...authoritativeState, persistedBindingVersion: 4 },
    { ...authoritativeState, tombstoneId: 'wrong' },
    { ...authoritativeState, liveIncarnationId: undefined },
    { ...authoritativeState, agentOwnerCount: null }
  ])('fails closed when authoritative state is missing, unknown, or drifted', (state) => {
    expect(preflight(state)).toEqual({ status: 'unknown' })
  })
})
