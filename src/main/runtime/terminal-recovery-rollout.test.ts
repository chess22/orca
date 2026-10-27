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
  it('does not advertise either recovery mutation', () => {
    const capabilities = new OrcaRuntimeService().getStatus().capabilities

    expect(capabilities).not.toContain(TERMINAL_CONDITIONAL_RESPAWN_RUNTIME_CAPABILITY)
    expect(capabilities).not.toContain(TERMINAL_EMPTY_LEAF_RECOVERY_RUNTIME_CAPABILITY)
  })

  it('refuses both public RPCs before calling runtime mutation methods', async () => {
    const respawnTerminalIfMatch = vi.fn()
    const recoverTerminalEmptyLeafIfMatch = vi.fn()
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
        // SAFETY: disabled handlers return before accessing any runtime member beyond the spies.
        { runtime: runtime as unknown as OrcaRuntimeService }
      )
    ).resolves.toEqual({
      respawn: {
        outcome: 'unsupported',
        mutationId: 'mutation-1',
        reason: 'source_baseline_disabled'
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
        // SAFETY: disabled handlers return before accessing any runtime member beyond the spies.
        { runtime: runtime as unknown as OrcaRuntimeService }
      )
    ).resolves.toEqual({
      recovery: {
        outcome: 'failed_before_mutation',
        recoveryId: 'recovery-1',
        reason: 'source_baseline_disabled'
      }
    })
    expect(respawnTerminalIfMatch).not.toHaveBeenCalled()
    expect(recoverTerminalEmptyLeafIfMatch).not.toHaveBeenCalled()
  })

  it('refuses direct runtime calls before either mutation ledger or recovery state machine', async () => {
    const sideEffectAccess = vi.fn((property: string | symbol) => {
      throw new Error(`disabled recovery accessed side-effect dependency: ${String(property)}`)
    })
    // Avoid the production service constructor: it owns timers and process handles unrelated to
    // this source gate. Throwing getters prove the guard returns before every mutation dependency.
    const runtime = Object.create(OrcaRuntimeService.prototype) as OrcaRuntimeService
    Object.defineProperties(runtime, {
      conditionalRespawnMutations: { get: () => sideEffectAccess('conditionalRespawnMutations') },
      emptyLeafRecovery: { get: () => sideEffectAccess('emptyLeafRecovery') },
      ptyController: { get: () => sideEffectAccess('ptyController') },
      store: { get: () => sideEffectAccess('store') }
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

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(runtime.respawnTerminalIfMatch(respawnRequest)).resolves.toEqual({
        outcome: 'unsupported',
        mutationId: 'mutation-direct',
        reason: 'source_baseline_disabled'
      })
      await expect(runtime.recoverTerminalEmptyLeafIfMatch(recoveryRequest)).resolves.toEqual({
        outcome: 'failed_before_mutation',
        recoveryId: 'recovery-direct',
        reason: 'source_baseline_disabled'
      })
    }

    expect(sideEffectAccess).not.toHaveBeenCalled()
  })
})
