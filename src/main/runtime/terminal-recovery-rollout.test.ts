import { describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY,
  TERMINAL_EMPTY_LEAF_RECOVERY_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import { OrcaRuntimeService } from './orca-runtime'
import { eraseRpcMethods } from './rpc/core'
import { TERMINAL_LIFECYCLE_METHODS } from './rpc/methods/terminal/terminal-lifecycle-methods'

function lifecycleMethod(name: string) {
  const method = eraseRpcMethods(TERMINAL_LIFECYCLE_METHODS).find(
    (candidate) => candidate.name === name
  )
  const params = method?.params
  if (!method || !params || 'stream' in method) {
    throw new Error(`Missing terminal lifecycle method: ${name}`)
  }
  return { handler: method.handler, params }
}

describe('terminal recovery source rollout', () => {
  it('advertises both recovery mutations', () => {
    const capabilities = new OrcaRuntimeService().getStatus().capabilities

    expect(capabilities).toContain(TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY)
    expect(capabilities).toContain(TERMINAL_EMPTY_LEAF_RECOVERY_RUNTIME_CAPABILITY)
  })

  it('dispatches both public RPCs to the runtime mutation methods', async () => {
    const respawnTerminalIfMatch = vi.fn(async () => ({
      outcome: 'precondition_failed' as const,
      mutationId: 'mutation-1',
      reason: 'terminal_not_live'
    }))
    const recoverTerminalEmptyLeafIfMatch = vi.fn(async () => ({
      outcome: 'failed_before_mutation' as const,
      recoveryId: 'recovery-1',
      reason: 'terminal_not_retired'
    }))
    const runtime = { respawnTerminalIfMatch, recoverTerminalEmptyLeafIfMatch }
    const respawn = lifecycleMethod('terminal.respawnIfMatch')
    const recovery = lifecycleMethod('terminal.recoverEmptyLeafIfMatch')

    await expect(
      respawn.handler(
        respawn.params.parse({
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
          replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 120, rows: 40 }
        }),
        { runtime: runtime as unknown as OrcaRuntimeService }
      )
    ).resolves.toEqual({
      respawn: {
        outcome: 'precondition_failed',
        mutationId: 'mutation-1',
        reason: 'terminal_not_live'
      }
    })
    await expect(
      recovery.handler(
        recovery.params.parse({
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
        }),
        { runtime: runtime as unknown as OrcaRuntimeService }
      )
    ).resolves.toEqual({
      recovery: {
        outcome: 'failed_before_mutation',
        recoveryId: 'recovery-1',
        reason: 'terminal_not_retired'
      }
    })
    expect(respawnTerminalIfMatch).toHaveBeenCalledOnce()
    expect(recoverTerminalEmptyLeafIfMatch).toHaveBeenCalledOnce()
  })

  it('dispatches direct runtime calls into the mutation ledger and recovery state machine', async () => {
    const mutationRun = vi.fn(async (request: { mutationId: string }) => ({
      outcome: 'precondition_failed' as const,
      mutationId: request.mutationId,
      reason: 'terminal_not_live'
    }))
    const recoveryRun = vi.fn(async (request: { recoveryId: string }) => ({
      outcome: 'failed_before_mutation' as const,
      recoveryId: request.recoveryId,
      reason: 'terminal_not_retired'
    }))
    // Avoid the production service constructor: it owns timers and process handles unrelated to
    // this source gate. The two small collaborators are the first stateful runtime boundaries.
    const runtime = Object.create(OrcaRuntimeService.prototype) as OrcaRuntimeService
    Object.defineProperties(runtime, {
      conditionalRespawnMutations: { value: { run: mutationRun } },
      emptyLeafRecovery: { value: { recover: recoveryRun } }
    })
    const respawnRequest = {
      mutationId: 'mutation-direct',
      terminal: 'term-direct',
      expected: {
        worktreeId: 'worktree-direct',
        tabId: 'tab-direct',
        leafId: 'leaf-direct',
        ptyId: 'pty-direct',
        ptyGeneration: 4,
        incarnationId: 'incarnation-direct',
        rootProcessId: 5150
      },
      replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 100, rows: 30 }
    }
    const recoveryRequest = {
      originalMutationId: 'mutation-direct',
      recoveryId: 'recovery-direct',
      terminal: 'term-direct',
      expected: {
        worktreeId: 'worktree-direct',
        tabId: 'tab-direct',
        leafId: 'leaf-direct',
        ptyId: 'pty-direct',
        ptyGeneration: 4,
        retiredIncarnationId: 'incarnation-direct',
        layoutEpoch: 9,
        persistedBindingVersion: 4,
        tombstoneId: '["pty-direct","incarnation-direct"]'
      },
      replacement: { command: 'exec relay', cwd: '/tmp/worktree', cols: 100, rows: 30 }
    }

    await expect(runtime.respawnTerminalIfMatch(respawnRequest)).resolves.toMatchObject({
      mutationId: 'mutation-direct',
      reason: 'terminal_not_live'
    })
    await expect(runtime.recoverTerminalEmptyLeafIfMatch(recoveryRequest)).resolves.toMatchObject({
      recoveryId: 'recovery-direct',
      reason: 'terminal_not_retired'
    })
    expect(mutationRun).toHaveBeenCalledOnce()
    expect(recoveryRun).toHaveBeenCalledOnce()
  })
})
