import { describe, expect, it } from 'vitest'
import type { TerminalEmptyLeafRecoveryRequest } from '../../shared/terminal-empty-leaf-recovery'
import type { DaemonTerminalAdmissionOptions } from './daemon-terminal-admission'
import { DaemonTerminalAdmission } from './daemon-terminal-admission'
import type { RecoverEmptyLeafIfMatchRequest, RespawnIfMatchRequest } from './types'

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
        throw new Error(`disabled recovery touched daemon dependency ${String(property)}`)
      }
    }
  )
  // SAFETY: every tested disabled path must return before reading any admission dependency.
  return new DaemonTerminalAdmission(noAccess as DaemonTerminalAdmissionOptions)
}

describe('daemon terminal recovery rollout', () => {
  it('refuses respawn before admission state or host mutation', async () => {
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

    await expect(admission().respawnIfMatch('client-1', request)).resolves.toEqual({
      outcome: 'unsupported',
      mutationId: 'mutation-1',
      reason: 'source_baseline_disabled'
    })
  })

  it('refuses recovery and completion before admission ledgers or host mutation', async () => {
    const instance = admission()
    const request: RecoverEmptyLeafIfMatchRequest = {
      id: 'request-1',
      type: 'recoverEmptyLeafIfMatch',
      payload: recovery
    }

    await expect(instance.recoverEmptyLeafIfMatch('client-1', request)).resolves.toEqual({
      outcome: 'failed_before_mutation',
      recoveryId: 'recovery-1',
      reason: 'source_baseline_disabled'
    })
    expect(
      instance.completeEmptyLeafRecovery(
        'client-1',
        { recoveryId: 'recovery-1', ptyId: 'pty-1', incarnationId: 'incarnation-2' },
        true
      )
    ).toEqual({ completed: false })
    expect(
      instance.completeEmptyLeafRecovery(
        'client-1',
        { recoveryId: 'recovery-1', ptyId: 'pty-1', incarnationId: 'incarnation-2' },
        false
      )
    ).toEqual({ completed: false })
  })
})
