import type {
  TerminalConditionalRespawnRequest,
  TerminalConditionalRespawnResult
} from '../../../../shared/terminal-conditional-respawn'

type MutationRecord = {
  fingerprint: string
  request: TerminalConditionalRespawnRequest
  result?: Promise<TerminalConditionalRespawnResult>
  resolvedResult?: TerminalConditionalRespawnResult
}

const MAX_RECORDED_MUTATIONS = 256

function sortedRecord(value: Record<string, string> | undefined): [string, string][] | null {
  return value ? Object.entries(value).sort(([left], [right]) => left.localeCompare(right)) : null
}

export function conditionalRespawnRequestFingerprint(
  request: TerminalConditionalRespawnRequest
): string {
  return JSON.stringify([
    request.terminal,
    request.expected.worktreeId,
    request.expected.tabId,
    request.expected.leafId,
    request.expected.ptyId,
    request.expected.ptyGeneration,
    request.expected.incarnationId,
    request.expected.rootProcessId,
    request.replacement.cols ?? null,
    request.replacement.rows ?? null,
    request.replacement.cwd ?? null,
    request.replacement.command ?? null,
    sortedRecord(request.replacement.env),
    request.replacement.envToDelete ? [...request.replacement.envToDelete].sort() : null
  ])
}

export class ConditionalRespawnMutationRecords {
  private readonly records = new Map<string, MutationRecord>()

  run(
    request: TerminalConditionalRespawnRequest,
    mutation: () => Promise<TerminalConditionalRespawnResult>
  ): Promise<TerminalConditionalRespawnResult> {
    const fingerprint = conditionalRespawnRequestFingerprint(request)
    const existing = this.records.get(request.mutationId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.resolve({
          outcome: 'precondition_failed',
          mutationId: request.mutationId,
          reason: 'mutation_id_reused'
        })
      }
      if (existing.result) {
        return existing.result.then((result) => ({ ...result, replayed: true }))
      }
      return this.start(existing, mutation)
    }
    if (this.records.size >= MAX_RECORDED_MUTATIONS) {
      return Promise.resolve({
        outcome: 'failed_before_mutation',
        mutationId: request.mutationId,
        reason: 'mutation_ledger_full'
      })
    }
    const record: MutationRecord = { fingerprint, request }
    this.records.set(request.mutationId, record)
    return this.start(record, mutation)
  }

  findRecoverableGap(args: {
    terminal: string
    ptyId: string
    retiredIncarnationId: string
  }): TerminalConditionalRespawnRequest | null {
    const matches = [...this.records.values()].filter((record) => {
      const result = record.resolvedResult
      const recoverable =
        (result?.outcome === 'partial' && result.oldStopped && !result.replacementStarted) ||
        (result?.outcome === 'indeterminate' &&
          result.oldStopped === true &&
          result.replacementStarted !== false &&
          result.incarnationId === undefined)
      return (
        recoverable &&
        record.request.terminal === args.terminal &&
        record.request.expected.ptyId === args.ptyId &&
        record.request.expected.incarnationId === args.retiredIncarnationId
      )
    })
    return matches.length === 1 ? matches[0]!.request : null
  }

  private start(
    record: MutationRecord,
    mutation: () => Promise<TerminalConditionalRespawnResult>
  ): Promise<TerminalConditionalRespawnResult> {
    const result = Promise.resolve().then(mutation)
    record.result = result
    void result.then(
      (value) => {
        record.resolvedResult = value
        if (
          value.outcome === 'indeterminate' &&
          (value.reason === 'provider_response_lost' || value.reason === 'response_lost') &&
          record.result === result
        ) {
          record.result = undefined
        }
      },
      () => {
        if (record.result === result) {
          record.result = undefined
        }
      }
    )
    return result
  }
}
