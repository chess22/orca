import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../../../shared/execution-host'
import type { TerminalLeafMutationKey } from '../../terminal-leaf-mutation-lane'
import type { StoreRuntimeState } from './store-runtime-state'
import type { TerminalBindingRecoveryOperations } from './terminal-binding-recovery'

type SshLeaseMutationContext = {
  runtime: Pick<StoreRuntimeState, 'state'>
  bindingRecovery: Pick<TerminalBindingRecoveryOperations, 'getRelayPtyIdForSshLeaseComparison'>
}

export function sameLogicalLeafKeys(
  left: readonly TerminalLeafMutationKey[],
  right: readonly TerminalLeafMutationKey[]
): boolean {
  const canonical = (keys: readonly TerminalLeafMutationKey[]): string[] =>
    [...new Set(keys.map((key) => JSON.stringify([key.worktreeId, key.tabId, key.leafId])))].sort()
  const a = canonical(left)
  const b = canonical(right)
  return a.length === b.length && a.every((key, index) => key === b[index])
}

export function sshPtyBindingRetirementState(
  context: SshLeaseMutationContext,
  targetId: string,
  ptyId: string
): {
  keys: TerminalLeafMutationKey[]
  fingerprint: string
  matchingIncarnationIds: (string | undefined)[]
  hasUnfencedBinding: boolean
} {
  const comparablePtyId = context.bindingRecovery.getRelayPtyIdForSshLeaseComparison(
    targetId,
    ptyId
  )
  const leases =
    context.runtime.state.sshRemotePtyLeases?.filter(
      (lease) => lease.targetId === targetId && lease.ptyId === comparablePtyId
    ) ?? []
  const sessions = [
    {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      session: context.runtime.state.workspaceSession
    },
    {
      executionHostId: toSshExecutionHostId(targetId),
      session: context.runtime.state.workspaceSessionsByHostId?.[toSshExecutionHostId(targetId)]
    }
  ] as const
  const keys: TerminalLeafMutationKey[] = []
  const rows: unknown[] = leases.map((lease) => [
    'lease',
    lease.targetId,
    lease.ptyId,
    lease.worktreeId ?? null,
    lease.tabId ?? null,
    lease.leafId ?? null,
    lease.state
  ])
  const matchingIncarnationIds: (string | undefined)[] = []
  let hasUnfencedBinding = false
  for (const { executionHostId, session } of sessions) {
    if (!session) {
      continue
    }
    const worktreeByTab = new Map<string, string>()
    for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
      for (const tab of tabs) {
        worktreeByTab.set(tab.id, worktreeId)
        if (tab.ptyId) {
          const tabPtyId = tab.ptyId
          const matchingTabLease = leases.some((lease) =>
            sshLeaseMayReferenceBinding(context, lease, targetId, tabPtyId, worktreeId, tab.id)
          )
          const layout = session.terminalLayoutsByTabId[tab.id]
          const hasMatchingLeaf = Object.entries(layout?.ptyIdsByLeafId ?? {}).some(
            ([leafId, bindingPtyId]) =>
              bindingPtyId !== null &&
              leases.some((lease) =>
                sshLeaseMayReferenceBinding(
                  context,
                  lease,
                  targetId,
                  bindingPtyId,
                  worktreeId,
                  tab.id,
                  leafId
                )
              )
          )
          if (matchingTabLease && !hasMatchingLeaf) {
            hasUnfencedBinding = true
          }
          if (matchingTabLease) {
            rows.push([executionHostId, worktreeId, tab.id, null, tab.ptyId])
          }
        }
      }
    }
    for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
      const worktreeId = worktreeByTab.get(tabId)
      if (!worktreeId) {
        continue
      }
      for (const [leafId, bindingPtyId] of Object.entries(layout.ptyIdsByLeafId ?? {})) {
        const incarnationId = session.terminalPtyIncarnationsByPaneKey?.[`${tabId}:${leafId}`]
        const matching = leases.some((lease) =>
          sshLeaseMayReferenceBinding(
            context,
            lease,
            targetId,
            bindingPtyId,
            worktreeId,
            tabId,
            leafId
          )
        )
        if (matching) {
          keys.push({ executionHostId, worktreeId, tabId, leafId })
          rows.push([
            executionHostId,
            worktreeId,
            tabId,
            leafId,
            bindingPtyId,
            incarnationId ?? null
          ])
          matchingIncarnationIds.push(incarnationId)
        }
      }
    }
  }
  rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return {
    keys,
    fingerprint: JSON.stringify(rows),
    matchingIncarnationIds,
    hasUnfencedBinding
  }
}

function sshLeaseMayReferenceBinding(
  context: SshLeaseMutationContext,
  lease: SshRemotePtyLease,
  targetId: string,
  ptyId: string,
  worktreeId: string,
  tabId: string,
  leafId?: string
): boolean {
  return (
    lease.ptyId === context.bindingRecovery.getRelayPtyIdForSshLeaseComparison(targetId, ptyId) &&
    (lease.worktreeId === undefined || lease.worktreeId === worktreeId) &&
    (lease.tabId === undefined || lease.tabId === tabId) &&
    (lease.leafId === undefined || leafId === undefined || lease.leafId === leafId)
  )
}

export function sshPtyCleanupMutationKeys(
  context: SshLeaseMutationContext,
  targetId: string
): TerminalLeafMutationKey[] {
  const leases =
    context.runtime.state.sshRemotePtyLeases?.filter((lease) => lease.targetId === targetId) ?? []
  const relayPtyIds = new Set(leases.map((lease) => lease.ptyId))
  const remoteHostId = toSshExecutionHostId(targetId)
  const sessions: {
    executionHostId: TerminalLeafMutationKey['executionHostId']
    session: typeof context.runtime.state.workspaceSession | undefined
  }[] = [
    { executionHostId: LOCAL_EXECUTION_HOST_ID, session: context.runtime.state.workspaceSession },
    {
      executionHostId: remoteHostId,
      session: context.runtime.state.workspaceSessionsByHostId?.[remoteHostId]
    }
  ]
  const keys: TerminalLeafMutationKey[] = []
  for (const { executionHostId, session } of sessions) {
    if (!session) {
      continue
    }
    const worktreeByTab = new Map<string, string>()
    for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
      for (const tab of tabs) {
        worktreeByTab.set(tab.id, worktreeId)
      }
    }
    for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
      const worktreeId = worktreeByTab.get(tabId)
      if (!worktreeId) {
        continue
      }
      for (const [leafId, ptyId] of Object.entries(layout.ptyIdsByLeafId ?? {})) {
        const comparable = context.bindingRecovery.getRelayPtyIdForSshLeaseComparison(
          targetId,
          ptyId
        )
        if (relayPtyIds.has(comparable)) {
          keys.push({ executionHostId, worktreeId, tabId, leafId })
        }
      }
    }
  }
  for (const lease of leases) {
    if (lease.worktreeId && lease.tabId && lease.leafId) {
      keys.push({
        executionHostId: remoteHostId,
        worktreeId: lease.worktreeId,
        tabId: lease.tabId,
        leafId: lease.leafId
      })
    }
  }
  return keys
}
