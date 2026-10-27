import type { PtySpawnOptions, PtySpawnResult } from '../providers/pty-provider-contract'
import type { TerminalOscColorQueryReplyColors } from '../../shared/terminal-osc-color-reply'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonSessionOwnerResolver } from './daemon-session-owner-resolution'
import { DaemonPtyAdapterSubscriptionFanout } from './daemon-pty-adapter-subscription-fanout'
import type { DaemonRouterRetirement } from './daemon-router-retirement'
import type { LegacyDaemonExitProof } from './daemon-legacy-exit-proof'
import { findLegacySessionOwner } from './daemon-router-legacy-owner'
import { routeSpawnOrHold } from './daemon-router-newer-daemon-hold'
import { retireExitedLegacyAdapter, type ExitedLegacyVerdict } from './daemon-router-exited-legacy'

export type RouterCoreContext = {
  current: DaemonPtyAdapter
  legacy: DaemonPtyAdapter[]
  sessionAdapters: Map<string, DaemonPtyAdapter>
  ownerResolver: DaemonSessionOwnerResolver<DaemonPtyAdapter>
  retirement: DaemonRouterRetirement
  legacyExitProof: LegacyDaemonExitProof
}

export function createRouterCoordination(
  current: DaemonPtyAdapter,
  legacy: DaemonPtyAdapter[],
  sessionAdapters: Map<string, DaemonPtyAdapter>,
  retirement: DaemonRouterRetirement,
  legacyExitProof: LegacyDaemonExitProof,
  retireExited: (adapter: DaemonPtyAdapter, error: unknown) => boolean
) {
  const adapters = [current, ...legacy]
  const ownerResolver = new DaemonSessionOwnerResolver(adapters, sessionAdapters, retireExited)
  const subscriptions = new DaemonPtyAdapterSubscriptionFanout(
    adapters,
    (id, adapter) => ownerResolver.forgetRoute(id, adapter),
    (adapter) => ownerResolver.invalidateProvider(adapter)
  )
  const core = { current, legacy, sessionAdapters, ownerResolver, retirement, legacyExitProof }
  return { ownerResolver, subscriptions, core }
}

export function disposeRoutedAdapters(
  subscriptions: DaemonPtyAdapterSubscriptionFanout,
  adapters: DaemonPtyAdapter[]
): void {
  subscriptions.dispose()
  for (const adapter of adapters) {
    adapter.dispose()
  }
}

export function setRoutedColorQueryReplyColors(
  adapters: DaemonPtyAdapter[],
  colors: TerminalOscColorQueryReplyColors
): void {
  for (const adapter of adapters) {
    adapter.setColorQueryReplyColors(colors)
  }
}

export async function listRoutedProcesses(
  context: RouterCoreContext,
  opts?: Parameters<DaemonPtyAdapter['listProcesses']>[0]
) {
  const processes = await context.ownerResolver.listProcesses(opts)
  context.legacyExitProof.record(context.legacy)
  return processes
}

export async function discoverRoutedSessions(context: RouterCoreContext): Promise<void> {
  await context.ownerResolver.discoverRoutes()
  context.legacyExitProof.record(context.legacy)
}

export function retireLegacyAdapter(
  context: RouterCoreContext,
  subscriptions: DaemonPtyAdapterSubscriptionFanout,
  adapter: DaemonPtyAdapter,
  error: unknown
): ExitedLegacyVerdict {
  const { current, legacy, legacyExitProof: exitProof } = context
  return retireExitedLegacyAdapter({ adapter, error, current, legacy, exitProof, subscriptions })
}

export type { ExitedLegacyVerdict }

export async function spawnRoutedPty(
  context: RouterCoreContext,
  opts: PtySpawnOptions
): Promise<PtySpawnResult> {
  if (context.retirement.admissionClosed) {
    throw new Error('Terminal daemon is decommissioning')
  }
  context.retirement.spawnInFlight++
  try {
    if (opts.attachOnly && opts.sessionId) {
      return await context.ownerResolver.spawnAttachOnly({ ...opts, sessionId: opts.sessionId })
    }
    const adapter =
      (opts.sessionId ? context.sessionAdapters.get(opts.sessionId) : undefined) ??
      (await findLegacySessionOwner(opts, context.current, context.legacy, context.legacyExitProof))
    const target = await routeSpawnOrHold(opts, adapter, context.current, context.ownerResolver)
    const result = await target.spawn(opts)
    if (!result.exitedBeforeSpawnReply) {
      context.ownerResolver.recordRoute(result.id, target, result.incarnationId)
    }
    return result
  } finally {
    context.retirement.spawnInFlight--
  }
}

export function resolveAdapterForInspection(
  context: Pick<RouterCoreContext, 'current' | 'legacy' | 'sessionAdapters'>,
  sessionId: string
): DaemonPtyAdapter {
  const adapter =
    context.sessionAdapters.get(sessionId) ??
    [context.current, ...context.legacy].find((candidate) => candidate.hasPty(sessionId))
  if (!adapter) {
    throw new Error('terminal_gone')
  }
  context.sessionAdapters.set(sessionId, adapter)
  return adapter
}
