import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalConditionalRespawnRequest,
  TerminalConditionalRespawnResult
} from '../../../../shared/terminal-conditional-respawn'
import {
  conditionalRespawnRequestFingerprint,
  ConditionalRespawnMutationRecords
} from './conditional-respawn-mutation-record'

function request(
  replacement: TerminalConditionalRespawnRequest['replacement'] = {}
): TerminalConditionalRespawnRequest {
  return {
    mutationId: 'mutation-1',
    terminal: 'term-1',
    expected: {
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      ptyId: 'pty-1',
      ptyGeneration: 7,
      incarnationId: 'incarnation-1',
      rootProcessId: 4242
    },
    replacement
  }
}

const RESPAWNED: TerminalConditionalRespawnResult = {
  outcome: 'respawned',
  mutationId: 'mutation-1',
  ptyId: 'pty-1',
  incarnationId: 'incarnation-2'
}

describe('conditional respawn mutation records', () => {
  it('shares one in-flight mutation and replays its exact result', async () => {
    const records = new ConditionalRespawnMutationRecords()
    let resolve!: (result: TerminalConditionalRespawnResult) => void
    const operation = new Promise<TerminalConditionalRespawnResult>((settle) => {
      resolve = settle
    })
    const mutation = vi.fn(() => operation)

    const first = records.run(request(), mutation)
    const replay = records.run(request(), mutation)
    resolve(RESPAWNED)

    await expect(first).resolves.toEqual(RESPAWNED)
    await expect(replay).resolves.toEqual({ ...RESPAWNED, replayed: true })
    expect(mutation).toHaveBeenCalledOnce()
  })

  it('fails closed when a mutation id is reused with a different request', async () => {
    const records = new ConditionalRespawnMutationRecords()
    const mutation = vi.fn(async () => RESPAWNED)

    await records.run(request({ command: 'relay' }), mutation)
    await expect(records.run(request({ command: 'shell' }), mutation)).resolves.toEqual({
      outcome: 'precondition_failed',
      mutationId: 'mutation-1',
      reason: 'mutation_id_reused'
    })
    expect(mutation).toHaveBeenCalledOnce()
  })

  it('re-enters the provider after a transport-ambiguous result while retaining the fingerprint', async () => {
    const records = new ConditionalRespawnMutationRecords()
    const mutation = vi
      .fn<() => Promise<TerminalConditionalRespawnResult>>()
      .mockResolvedValueOnce({
        outcome: 'indeterminate',
        mutationId: 'mutation-1',
        reason: 'provider_response_lost'
      })
      .mockResolvedValueOnce(RESPAWNED)

    await expect(records.run(request(), mutation)).resolves.toMatchObject({
      outcome: 'indeterminate'
    })
    await expect(records.run(request(), mutation)).resolves.toEqual(RESPAWNED)
    await expect(records.run(request({ command: 'different' }), mutation)).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'mutation_id_reused'
    })
    expect(mutation).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes unordered environment inputs without mutating the request', () => {
    const left = request({ env: { B: '2', A: '1' }, envToDelete: ['Z', 'C'] })
    const right = request({ env: { A: '1', B: '2' }, envToDelete: ['C', 'Z'] })

    expect(conditionalRespawnRequestFingerprint(left)).toBe(
      conditionalRespawnRequestFingerprint(right)
    )
    expect(left.replacement.envToDelete).toEqual(['Z', 'C'])
  })
})
