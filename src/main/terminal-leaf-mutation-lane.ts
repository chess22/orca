import type { ExecutionHostId } from '../shared/execution-host'
import { AsyncLocalStorage } from 'node:async_hooks'

export type TerminalLeafMutationKey = {
  executionHostId: ExecutionHostId
  worktreeId: string
  tabId: string
  leafId: string
}

function serializeTerminalLeafMutationKey(key: TerminalLeafMutationKey): string {
  // A terminal leaf is one logical surface even while its durable binding is mirrored or moved
  // between host partitions. Callers still carry the observed host for audit/snapshot purposes,
  // but partition identity must not split the mutation lane: a provider operation keyed by an SSH
  // connection and a graph mutation keyed by the worktree's current host must serialize together.
  return JSON.stringify([key.worktreeId, key.tabId, key.leafId])
}

/** Serializes authoritative mutations of one terminal leaf without blocking unrelated leaves. */
export class TerminalLeafMutationLane {
  private readonly tails = new Map<string, Promise<void>>()
  private readonly held = new AsyncLocalStorage<ReadonlySet<string>>()

  run<T>(keys: readonly TerminalLeafMutationKey[], operation: () => Promise<T> | T): Promise<T> {
    const inherited = this.held.getStore() ?? new Set<string>()
    const serialized = [...new Set(keys.map(serializeTerminalLeafMutationKey))]
      .filter((key) => !inherited.has(key))
      .sort()
    if (inherited.size > 0 && serialized.length > 0) {
      return Promise.reject(new Error('terminal_leaf_mutation_nested_key_expansion'))
    }
    const acquired = new Set([...inherited, ...serialized])
    const invoke = (): Promise<T> => Promise.resolve(this.held.run(acquired, operation))
    if (serialized.length === 0) {
      return invoke()
    }
    const waits: Promise<void>[] = []
    const releases: (() => void)[] = []
    let contended = false
    for (const key of serialized) {
      const existing = this.tails.get(key)
      const previous = existing ?? Promise.resolve()
      contended ||= existing !== undefined
      let release!: () => void
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const tail = previous.then(() => current)
      this.tails.set(key, tail)
      waits.push(previous)
      releases.push(() => {
        release()
        if (this.tails.get(key) === tail) {
          this.tails.delete(key)
        }
      })
    }
    const result = contended ? Promise.all(waits).then(invoke) : invoke()
    return result.finally(() => {
      for (const release of releases.toReversed()) {
        release()
      }
    })
  }
}
