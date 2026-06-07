import { useAppStore } from '@/store'
import { shouldShutdownSimulatorForPaneUnmountFromTabs } from './simulator-tab-shutdown'

export const isMacOsHost = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

type EnsureSimulatorTabOptions = {
  targetGroupId?: string
  placement?: 'activeGroup' | 'rightSplit'
  /** When true, activate the tab and focus the owning group (default true). */
  surfacePane?: boolean
}

/** One simulator tab per worktree; focuses existing tab instead of creating duplicates. */
export function ensureSimulatorTab(
  worktreeId: string,
  options?: EnsureSimulatorTabOptions
): string | null {
  if (!isMacOsHost) {
    return null
  }
  const store = useAppStore.getState()
  if (store.settings?.mobileEmulatorEnabled === false) {
    return null
  }
  const sourceGroupId =
    options?.targetGroupId ??
    store.activeGroupIdByWorktree[worktreeId] ??
    store.groupsByWorktree[worktreeId]?.[0]?.id
  if (!sourceGroupId) {
    return null
  }

  const existing = (store.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.contentType === 'simulator'
  )
  const shouldSurface = options?.surfacePane ?? true
  if (existing) {
    if (shouldSurface && store.activeWorktreeId === worktreeId) {
      store.activateTab(existing.id)
      store.focusGroup(worktreeId, existing.groupId)
      store.setActiveTabType('simulator')
    }
    return existing.id
  }

  // Why: create the tab before splitting so even a dev reload between store
  // updates restores a real simulator tab rather than an empty right pane.
  const tab = store.createUnifiedTab(worktreeId, 'simulator', {
    label: 'Mobile Emulator',
    targetGroupId: sourceGroupId,
    activate: shouldSurface
  })
  let groupId = sourceGroupId
  if (options?.placement === 'rightSplit' && shouldSurface) {
    const moved = store.dropUnifiedTab(tab.id, {
      groupId: sourceGroupId,
      splitDirection: 'right'
    })
    if (moved) {
      groupId =
        useAppStore
          .getState()
          .unifiedTabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tab.id)
          ?.groupId ?? sourceGroupId
    }
  }
  if (shouldSurface) {
    store.activateTab(tab.id)
    store.setActiveTabType('simulator')
    store.focusGroup(worktreeId, groupId)
  }
  return tab.id
}

export function countSimulatorTabs(
  worktreeId: string,
  options: { excludingTabId?: string } = {}
): number {
  return (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.contentType === 'simulator' && tab.id !== options.excludingTabId
  ).length
}

export function shouldShutdownSimulatorForPaneUnmount(worktreeId: string, tabId?: string): boolean {
  return shouldShutdownSimulatorForPaneUnmountFromTabs(
    useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? [],
    tabId
  )
}

export { shouldShutdownSimulatorForPaneUnmountFromTabs }
