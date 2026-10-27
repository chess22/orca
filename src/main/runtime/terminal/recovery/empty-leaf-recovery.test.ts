import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalEmptyLeafRecoveryRequest,
  TerminalEmptyLeafRecoveryResult
} from '../../../../shared/terminal-empty-leaf-recovery'
import {
  RuntimeEmptyLeafRecovery,
  type RuntimeEmptyLeafRecoveryPorts,
  type RuntimeEmptyLeafRecoveryState
} from './empty-leaf-recovery'

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

function state(
  overrides: Partial<RuntimeEmptyLeafRecoveryState> = {}
): RuntimeEmptyLeafRecoveryState {
  return {
    layoutEpoch: 8,
    terminal: 'term-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    ptyId: 'pty-1',
    ptyGeneration: 4,
    retiredIncarnationId: 'inc-retired',
    persistedBindingVersion: 3,
    tombstoneId: 'tombstone-1',
    leafEmpty: true,
    liveIncarnationId: null,
    agentOwnerCount: 0,
    recoveryOwnerId: null,
    ...overrides
  }
}

const RECOVERED: TerminalEmptyLeafRecoveryResult = {
  outcome: 'recovered',
  recoveryId: 'recovery-1',
  ptyId: 'pty-1',
  incarnationId: 'inc-new',
  processId: 202
}

function ports(
  overrides: Partial<RuntimeEmptyLeafRecoveryPorts> = {}
): RuntimeEmptyLeafRecoveryPorts {
  const defaults: RuntimeEmptyLeafRecoveryPorts = {
    runWithLeafReservation: async (_request, operation) => await operation(),
    inspectState: () => state(),
    recoverProvider: async () => RECOVERED,
    persistReplacement: async () => true,
    publishReplacement: () => {},
    rollbackPersistedReplacement: async () => true,
    abortUnpublishedReplacement: async () => true,
    stopUnpublishedReplacement: async () => true
  }
  return { ...defaults, ...overrides }
}

describe('runtime empty-leaf recovery', () => {
  it('creates, persists, and publishes one exact replacement in order', async () => {
    const calls: string[] = []
    const recoverProvider = vi.fn(async (received: TerminalEmptyLeafRecoveryRequest) => {
      calls.push('provider')
      expect(received).toEqual(request())
      return RECOVERED
    })
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        inspectState: () => state(),
        persistReplacement: async () => {
          calls.push('persist')
          return true
        },
        publishReplacement: () => {
          calls.push('publish')
        }
      })
    )

    await expect(recovery.recover(request())).resolves.toEqual(RECOVERED)
    await expect(recovery.recover(request())).resolves.toEqual({ ...RECOVERED, replayed: true })
    expect(calls).toEqual(['provider', 'persist', 'publish'])
    expect(recoverProvider).toHaveBeenCalledOnce()
  })

  it('rejects a changed fingerprint before a second provider call', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        inspectState: () => state()
      })
    )

    await recovery.recover(request())
    await expect(recovery.recover(request('different relay'))).resolves.toEqual({
      outcome: 'precondition_failed',
      recoveryId: 'recovery-1',
      reason: 'recovery_id_reused'
    })
    expect(recoverProvider).toHaveBeenCalledOnce()
  })

  it('re-enters the provider ledger after a lost response', async () => {
    const recoverProvider = vi
      .fn<() => Promise<TerminalEmptyLeafRecoveryResult>>()
      .mockResolvedValueOnce({
        outcome: 'indeterminate',
        recoveryId: 'recovery-1',
        reason: 'provider_response_lost',
        replacementStarted: true,
        replacementPublished: false
      })
      .mockResolvedValueOnce(RECOVERED)
    const recovery = new RuntimeEmptyLeafRecovery(ports({ recoverProvider }))

    await expect(recovery.recover(request())).resolves.toMatchObject({ outcome: 'indeterminate' })
    await expect(recovery.recover(request())).resolves.toEqual(RECOVERED)
    expect(recoverProvider).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['empty_leaf_unverifiable', null],
    ['empty_leaf_identity_changed', state({ leafEmpty: false })],
    ['empty_leaf_identity_changed', state({ layoutEpoch: 9 })],
    ['empty_leaf_identity_changed', state({ persistedBindingVersion: 4 })],
    ['empty_leaf_identity_changed', state({ tombstoneId: 'other' })],
    ['liveness_unverifiable', state({ liveIncarnationId: undefined })],
    ['terminal_live', state({ liveIncarnationId: 'inc-live' })],
    ['agent_owner_unverifiable', state({ agentOwnerCount: null })],
    ['agent_owned', state({ agentOwnerCount: 1 })],
    ['recovery_owned', state({ recoveryOwnerId: 'other-recovery' })]
  ] as const)('fails closed on %s', async (reason, observed) => {
    const recoverProvider = vi.fn()
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({ inspectState: () => observed, recoverProvider })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason
    })
    expect(recoverProvider).not.toHaveBeenCalled()
  })

  it('stops a replacement when persistence refuses the tombstone CAS', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const abortUnpublishedReplacement = vi.fn(async () => true)
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        persistReplacement: async () => false,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    const first = await recovery.recover(request())
    expect(first).toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_persisted_replacement_stopped',
      replacementStarted: true,
      replacementPublished: false,
      incarnationId: 'inc-new'
    })
    await expect(recovery.recover(request())).resolves.toEqual({ ...first, replayed: true })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledExactlyOnceWith(request(), 'inc-new')
  })

  it('reports commit failure as indeterminate when persisted binding rollback loses its CAS', async () => {
    const rollbackPersistedReplacement = vi.fn(async () => false)
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_published_binding_rollback_unverified',
      replacementStarted: true,
      incarnationId: 'inc-new'
    })
    expect(rollbackPersistedReplacement).toHaveBeenCalledExactlyOnceWith(request(), 'inc-new')
    expect(stopUnpublishedReplacement).toHaveBeenCalledExactlyOnceWith(request(), 'inc-new')
  })

  it.each([
    ['reverse-CAS rejection', 'replacement_not_published_binding_rollback_unverified', true],
    ['exact-stop refusal', 'replacement_not_published_stop_unverified', false]
  ] as const)('contains %s as an indeterminate result', async (_case, reason, rollbackRejects) => {
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement: async () => {
          if (rollbackRejects) {
            throw new Error('reverse CAS failed')
          }
          return true
        },
        stopUnpublishedReplacement: async () => rollbackRejects
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason,
      replacementStarted: true
    })
  })

  it('retries unresolved cleanup without spawning a second replacement', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const stopUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['stopUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        persistReplacement: async () => false,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_persisted_stop_unverified'
    })
    await expect(recovery.recover(request('drifted relay'))).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'recovery_id_reused'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_persisted_replacement_stopped',
      replayed: true
    })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledTimes(2)
  })

  it('retains newly verified stages when another cleanup stage remains pending', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const abortUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['abortUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const stopUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['stopUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        persistReplacement: async () => false,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_persisted_abort_unverified'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_persisted_stop_unverified',
      replayed: true
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'partial',
      replayed: true
    })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledTimes(2)
    expect(stopUnpublishedReplacement).toHaveBeenCalledTimes(3)
  })

  it('caches completed persisted cleanup without rerunning any stage', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const rollbackPersistedReplacement = vi.fn(async () => true)
    const abortUnpublishedReplacement = vi.fn(async () => true)
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    const first = await recovery.recover(request())
    expect(first).toMatchObject({ outcome: 'partial' })
    await expect(recovery.recover(request())).resolves.toEqual({ ...first, replayed: true })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(rollbackPersistedReplacement).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledOnce()
  })

  it('retries exact stop after its response rejects without repeating abort', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const abortUnpublishedReplacement = vi.fn(async () => true)
    const stopUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['stopUnpublishedReplacement']>()
      .mockRejectedValueOnce(new Error('stop response lost'))
      .mockResolvedValueOnce(true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        persistReplacement: async () => false,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_persisted_stop_unverified'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({ outcome: 'partial' })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledTimes(2)
  })

  it('retries reverse-CAS after its response rejects without repeating containment', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const rollbackPersistedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['rollbackPersistedReplacement']>()
      .mockRejectedValueOnce(new Error('rollback response lost'))
      .mockResolvedValueOnce(true)
    const abortUnpublishedReplacement = vi.fn(async () => true)
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_published_binding_rollback_unverified'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({ outcome: 'partial' })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(rollbackPersistedReplacement).toHaveBeenCalledTimes(2)
    expect(abortUnpublishedReplacement).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledOnce()
  })

  it('converges all three persisted cleanup stages from false on exact retry', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const rollbackPersistedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['rollbackPersistedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const abortUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['abortUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const stopUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['stopUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({ outcome: 'indeterminate' })
    await expect(recovery.recover(request())).resolves.toMatchObject({ outcome: 'partial' })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(rollbackPersistedReplacement).toHaveBeenCalledTimes(2)
    expect(abortUnpublishedReplacement).toHaveBeenCalledTimes(2)
    expect(stopUnpublishedReplacement).toHaveBeenCalledTimes(2)
  })

  it('retries only exact stop after rollback and abort were verified', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const rollbackPersistedReplacement = vi.fn(async () => true)
    const abortUnpublishedReplacement = vi.fn(async () => true)
    const stopUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['stopUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_published_stop_unverified'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_published_replacement_stopped',
      replayed: true
    })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(rollbackPersistedReplacement).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledTimes(2)
  })

  it('retries only daemon abort after its response was lost and exact stop succeeded', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const abortUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['abortUnpublishedReplacement']>()
      .mockRejectedValueOnce(new Error('abort response lost'))
      .mockResolvedValueOnce(true)
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        persistReplacement: async () => false,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_persisted_abort_unverified'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_persisted_replacement_stopped',
      replayed: true
    })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledTimes(2)
    expect(stopUnpublishedReplacement).toHaveBeenCalledOnce()
  })

  it('shares one in-flight cleanup retry between concurrent exact replays', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    let releaseAbort: (() => void) | undefined
    const abortUnpublishedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['abortUnpublishedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        async () =>
          await new Promise<boolean>((resolve) => {
            releaseAbort = () => resolve(true)
          })
      )
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        persistReplacement: async () => false,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )
    await recovery.recover(request())

    const first = recovery.recover(request())
    const second = recovery.recover(request())
    releaseAbort?.()

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ outcome: 'partial', replayed: true }),
      expect.objectContaining({ outcome: 'partial', replayed: true })
    ])
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(abortUnpublishedReplacement).toHaveBeenCalledTimes(2)
    expect(stopUnpublishedReplacement).toHaveBeenCalledOnce()
  })

  it('retries only reverse-CAS after abort and exact stop were verified', async () => {
    const recoverProvider = vi.fn(async () => RECOVERED)
    const rollbackPersistedReplacement = vi
      .fn<RuntimeEmptyLeafRecoveryPorts['rollbackPersistedReplacement']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const abortUnpublishedReplacement = vi.fn(async () => true)
    const stopUnpublishedReplacement = vi.fn(async () => true)
    const recovery = new RuntimeEmptyLeafRecovery(
      ports({
        recoverProvider,
        publishReplacement: async () => {
          throw new Error('commit failed')
        },
        rollbackPersistedReplacement,
        abortUnpublishedReplacement,
        stopUnpublishedReplacement
      })
    )

    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'indeterminate',
      reason: 'replacement_not_published_binding_rollback_unverified'
    })
    await expect(recovery.recover(request())).resolves.toMatchObject({
      outcome: 'partial',
      reason: 'replacement_not_published_replacement_stopped',
      replayed: true
    })
    expect(recoverProvider).toHaveBeenCalledOnce()
    expect(rollbackPersistedReplacement).toHaveBeenCalledTimes(2)
    expect(abortUnpublishedReplacement).toHaveBeenCalledOnce()
    expect(stopUnpublishedReplacement).toHaveBeenCalledOnce()
  })
})
