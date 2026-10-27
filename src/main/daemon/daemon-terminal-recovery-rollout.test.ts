import { describe, expect, it, vi } from 'vitest'
import type { TerminalEmptyLeafRecoveryRequest } from '../../shared/terminal-empty-leaf-recovery'
import type { DaemonTerminalAdmissionOptions } from './daemon-terminal-admission'
import { DaemonTerminalAdmission } from './daemon-terminal-admission'
import type { RecoverEmptyLeafIfMatchRequest, RespawnIfMatchRequest } from './types'

const helpers = vi.hoisted(() => ({
  respawn: vi.fn(async (_owner: unknown, _clientId: string, request: RespawnIfMatchRequest) => ({
    outcome: 'precondition_failed' as const,
    mutationId: request.payload.mutationId,
    reason: 'terminal_not_live'
  })),
  recover: vi.fn(
    async (_owner: unknown, _clientId: string, request: RecoverEmptyLeafIfMatchRequest) => ({
      outcome: 'failed_before_mutation' as const,
      recoveryId: request.payload.recoveryId,
      reason: 'terminal_not_retired'
    })
  ),
  complete: vi.fn(() => ({ completed: true }))
}))

vi.mock('./daemon-terminal-conditional-respawn-admission', () => ({
  admitConditionalTerminalRespawn: helpers.respawn,
  resolveSpawnAdmissionDeadline: vi.fn()
}))
vi.mock('./daemon-terminal-empty-leaf-recovery-admission', () => ({
  admitEmptyLeafRecovery: helpers.recover,
  completeEmptyLeafRecoveryAdmission: helpers.complete
}))

const recovery: TerminalEmptyLeafRecoveryRequest = {
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
}

function admission(): DaemonTerminalAdmission {
  const noAccess = new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(
          `enabled rollout unexpectedly touched daemon dependency ${String(property)}`
        )
      }
    }
  )
  return new DaemonTerminalAdmission(noAccess as DaemonTerminalAdmissionOptions)
}

describe('daemon terminal recovery rollout', () => {
  it('dispatches respawn into daemon admission', async () => {
    const request: RespawnIfMatchRequest = {
      id: 'request-1',
      type: 'respawnIfMatch',
      payload: {
        sessionId: 'pty-1',
        mutationId: 'mutation-1',
        expectedIncarnationId: 'incarnation-1',
        expectedRootProcessId: 4242,
        cols: 120,
        rows: 40,
        cwd: '/tmp/worktree',
        command: 'exec relay'
      }
    }

    await expect(admission().respawnIfMatch('client-1', request)).resolves.toMatchObject({
      mutationId: 'mutation-1',
      reason: 'terminal_not_live'
    })
    expect(helpers.respawn).toHaveBeenCalledOnce()
  })

  it('dispatches recovery and both completion decisions into daemon admission', async () => {
    const instance = admission()
    const request: RecoverEmptyLeafIfMatchRequest = {
      id: 'request-1',
      type: 'recoverEmptyLeafIfMatch',
      payload: recovery
    }

    await expect(instance.recoverEmptyLeafIfMatch('client-1', request)).resolves.toMatchObject({
      recoveryId: 'recovery-1',
      reason: 'terminal_not_retired'
    })
    expect(
      instance.completeEmptyLeafRecovery(
        'client-1',
        { recoveryId: 'recovery-1', ptyId: 'pty-1', incarnationId: 'incarnation-2' },
        true
      )
    ).toEqual({ completed: true })
    expect(
      instance.completeEmptyLeafRecovery(
        'client-1',
        { recoveryId: 'recovery-1', ptyId: 'pty-1', incarnationId: 'incarnation-2' },
        false
      )
    ).toEqual({ completed: true })
    expect(helpers.recover).toHaveBeenCalledOnce()
    expect(helpers.complete).toHaveBeenCalledTimes(2)
  })
})
