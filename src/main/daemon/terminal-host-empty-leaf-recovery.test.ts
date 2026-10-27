import { describe, expect, it, vi } from 'vitest'
import type { Session } from './session'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { CreateOrAttachResult } from './terminal-host-create-contract'
import {
  terminalEmptyLeafTombstoneId,
  type TerminalEmptyLeafRecoveryRequest
} from '../../shared/terminal-empty-leaf-recovery'
import {
  recoverTerminalHostEmptyLeafIfMatch,
  type EmptyLeafRecoveryHost
} from './terminal-host-empty-leaf-recovery'

const REQUEST: TerminalEmptyLeafRecoveryRequest = {
  originalMutationId: 'mutation-1',
  recoveryId: 'recovery-1',
  terminal: 'term-1',
  expected: {
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    ptyId: 'pty-1',
    ptyGeneration: 2,
    retiredIncarnationId: 'inc-old',
    layoutEpoch: 7,
    persistedBindingVersion: 2,
    tombstoneId: terminalEmptyLeafTombstoneId('pty-1', 'inc-old')
  },
  replacement: { command: 'exec relay', cwd: '/repo', cols: 100, rows: 30 }
}

function fixture(overrides: Partial<EmptyLeafRecoveryHost> = {}) {
  const attachToken = Symbol('attach')
  const createOrAttachReserved: EmptyLeafRecoveryHost['createOrAttachReserved'] = vi.fn(
    async (): Promise<CreateOrAttachResult> => ({
      isNew: true,
      snapshot: null,
      pid: 42,
      shellState: 'ready',
      wslDistro: null,
      attachToken,
      incarnationId: 'inc-new'
    })
  )
  const owner: EmptyLeafRecoveryHost = {
    sessions: new Map<string, Session>(),
    retiredIncarnations: new Map([
      ['pty-1', { incarnationId: 'inc-old', code: 0, expiresAt: Number.MAX_SAFE_INTEGER }]
    ]),
    agentSessionOwners: { listForPty: () => [] },
    conditionalRespawns: new Map([
      [
        'mutation-1',
        {
          fingerprint: 'original',
          identity: {
            sessionId: 'pty-1',
            expectedIncarnationId: 'inc-old',
            expectedRootProcessId: 41,
            command: 'exec relay',
            cwd: '/repo',
            cols: 100,
            rows: 30,
            clientId: 'client-1',
            env: undefined,
            envToDelete: undefined
          },
          promise: Promise.resolve({
            outcome: 'indeterminate',
            mutationId: 'mutation-1',
            reason: 'post_stop_gap',
            oldStopped: true,
            replacementStarted: true
          })
        }
      ]
    ]),
    emptyLeafRecoveries: new Map(),
    withSessionCreationReservation: async (_opts, operation) => await operation(),
    createOrAttachReserved,
    ...overrides
  }
  const published = vi.fn()
  const opts: InternalCreateOrAttachOptions & {
    onReplacementPublished: (token: symbol) => void
  } = {
    sessionId: 'pty-1',
    cols: 100,
    rows: 30,
    cwd: '/repo',
    command: 'exec relay',
    spawnAdmission: { clientId: 'client-1', declaredIntent: null, deadlineAt: 1 },
    streamClient: { onData: () => undefined, onExit: () => undefined },
    onReplacementPublished: published
  }
  return { owner, opts, createOrAttachReserved, published }
}

describe('terminal host empty-leaf recovery', () => {
  it('serializes concurrent exact replay to one replacement', async () => {
    const { owner, opts, createOrAttachReserved, published } = fixture()
    const [first, replay] = await Promise.all([
      recoverTerminalHostEmptyLeafIfMatch(owner, REQUEST, opts),
      recoverTerminalHostEmptyLeafIfMatch(owner, REQUEST, opts)
    ])
    expect(first).toMatchObject({ outcome: 'recovered', incarnationId: 'inc-new' })
    expect(replay).toMatchObject({ outcome: 'recovered', incarnationId: 'inc-new', replayed: true })
    expect(createOrAttachReserved).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledOnce()
  })

  it('fails closed before spawn on changed recovery payload', async () => {
    const { owner, opts, createOrAttachReserved } = fixture()
    await recoverTerminalHostEmptyLeafIfMatch(owner, REQUEST, opts)
    await expect(
      recoverTerminalHostEmptyLeafIfMatch(
        owner,
        { ...REQUEST, replacement: { ...REQUEST.replacement, command: 'different' } },
        opts
      )
    ).resolves.toMatchObject({ outcome: 'precondition_failed', reason: 'recovery_id_reused' })
    expect(createOrAttachReserved).toHaveBeenCalledOnce()
  })

  it('requires recovery replacement fields to match the original mutation', async () => {
    const { owner, opts, createOrAttachReserved } = fixture()
    const changed = {
      ...REQUEST,
      recoveryId: 'recovery-changed-original',
      replacement: { ...REQUEST.replacement, command: 'different' }
    }
    await expect(
      recoverTerminalHostEmptyLeafIfMatch(owner, changed, { ...opts, command: 'different' })
    ).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'original_mutation_identity_changed'
    })
    expect(createOrAttachReserved).not.toHaveBeenCalled()
  })

  it('requires recovery environment fields to match the original mutation', async () => {
    const { owner, opts, createOrAttachReserved } = fixture()
    const changed = {
      ...REQUEST,
      recoveryId: 'recovery-changed-environment',
      replacement: { ...REQUEST.replacement, env: { RELAY_TARGET_HANDLE: 'term-main' } }
    }
    await expect(
      recoverTerminalHostEmptyLeafIfMatch(owner, changed, {
        ...opts,
        env: changed.replacement.env
      })
    ).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason: 'original_mutation_identity_changed'
    })
    expect(createOrAttachReserved).not.toHaveBeenCalled()
  })

  it.each(['client', 'cwd', 'cols', 'rows', 'envToDelete'] as const)(
    'rejects original %s drift before recovery spawn',
    async (field) => {
      const { owner, opts, createOrAttachReserved } = fixture()
      const changed = {
        ...REQUEST,
        recoveryId: `recovery-changed-${field}`,
        replacement: {
          ...REQUEST.replacement,
          ...(field === 'cwd' ? { cwd: '/other' } : {}),
          ...(field === 'cols' ? { cols: 101 } : {}),
          ...(field === 'rows' ? { rows: 31 } : {}),
          ...(field === 'envToDelete' ? { envToDelete: ['STALE_RELAY'] } : {})
        }
      }
      const changedOpts = {
        ...opts,
        cwd: changed.replacement.cwd,
        cols: changed.replacement.cols,
        rows: changed.replacement.rows,
        envToDelete: changed.replacement.envToDelete,
        spawnAdmission: {
          clientId: field === 'client' ? 'client-2' : 'client-1',
          declaredIntent: opts.spawnAdmission?.declaredIntent ?? null,
          deadlineAt: opts.spawnAdmission?.deadlineAt ?? 1
        }
      }

      await expect(
        recoverTerminalHostEmptyLeafIfMatch(owner, changed, changedOpts)
      ).resolves.toMatchObject({
        outcome: 'precondition_failed',
        reason: 'original_mutation_identity_changed'
      })
      expect(createOrAttachReserved).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['original_mutation_unverified', () => fixture({ conditionalRespawns: new Map() })],
    [
      'terminal_live',
      () => {
        const sessions = new Map<string, Session>()
        sessions.set('pty-1', Object.create(null))
        return fixture({ sessions })
      }
    ],
    [
      'retired_incarnation_changed',
      () =>
        fixture({
          retiredIncarnations: new Map([
            ['pty-1', { incarnationId: 'inc-other', code: 0, expiresAt: Number.MAX_SAFE_INTEGER }]
          ])
        })
    ],
    ['agent_owned', () => fixture({ agentSessionOwners: { listForPty: () => [{}] } })]
  ])('refuses %s without spawning', async (reason, make) => {
    const { owner, opts, createOrAttachReserved } = make()
    await expect(recoverTerminalHostEmptyLeafIfMatch(owner, REQUEST, opts)).resolves.toMatchObject({
      outcome: 'precondition_failed',
      reason
    })
    expect(createOrAttachReserved).not.toHaveBeenCalled()
  })
})
