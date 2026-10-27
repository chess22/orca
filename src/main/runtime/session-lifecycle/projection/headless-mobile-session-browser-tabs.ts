import type { RuntimeMobileSessionBrowserTab } from '../../../../shared/runtime-types'
import type { Tab } from '../../../../shared/tab-types'
import { getRuntimeBrowserPageRegistry } from '../../runtime-browser-page-registry'
import { OrcaRuntimeWithPersistTerminalSurfaceRetirements } from '../../session-tabs/terminal-surface-retirements'

export abstract class OrcaRuntimeWithHeadlessMobileBrowserTabs extends OrcaRuntimeWithPersistTerminalSurfaceRetirements {
  // Why: headless serve backs browser panes with offscreen WebContents that live
  // only in the BrowserManager, never in a renderer graph. Without surfacing them
  // as session tabs, a session.tabs snapshot (e.g. on terminal open) prunes the
  // paired browser tab and closing it fails with tab_not_found. Synthesize browser
  // session tabs from the live bridge so they are first-class alongside terminals.
  protected buildHeadlessMobileSessionBrowserTabs(
    worktreeId: string
  ): RuntimeMobileSessionBrowserTab[] {
    // Saved tabs whose page starts on first use are listed as running ones are.
    const serverTabs =
      this.offscreenBrowserBackend && this.agentBrowserBridge?.tabList
        ? [
            ...this.agentBrowserBridge.tabList(worktreeId).tabs,
            ...this.serveBrowserTabs.listUnstarted(worktreeId)
          ]
        : []
    const publishedServerTabs = serverTabs.map((tab) => {
      const persistedProps = this.getPersistedUnifiedSessionTabProps(
        worktreeId,
        this.serveBrowserTabs.unifiedTabId(worktreeId, tab.browserPageId)
      )
      return {
        type: 'browser' as const,
        // Why: an offscreen page has no separate workspace identity, so the page id
        // is its own workspace id (matches the server's browserWorkspaceId fallback).
        id: tab.browserPageId,
        title: tab.title || tab.url || 'Browser',
        browserWorkspaceId: tab.browserPageId,
        browserPageId: tab.browserPageId,
        url: tab.url || 'about:blank',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        loadError: tab.loadError ?? undefined,
        certificateFailure: tab.certificateFailure ?? undefined,
        ...(persistedProps ? { color: persistedProps.color } : {}),
        ...(persistedProps ? { isPinned: persistedProps.isPinned === true } : {}),
        isActive: tab.active === true
      }
    })
    const publishedClientTabs = getRuntimeBrowserPageRegistry(this)
      .listPages(worktreeId)
      .map((page) => ({
        type: 'browser' as const,
        id: page.browserPageId,
        title: page.title || page.url || 'Browser',
        browserWorkspaceId: page.browserPageId,
        browserPageId: page.browserPageId,
        browserProfileId: page.browserProfileId,
        executionHostKey: page.executionHostKey,
        placement: page.placement,
        url: page.url,
        loading: page.loading,
        canGoBack: page.canGoBack,
        canGoForward: page.canGoForward,
        isActive: page.active
      }))
    return [...publishedServerTabs, ...publishedClientTabs]
  }

  protected getPersistedUnifiedSessionTabProps(
    worktreeId: string,
    tabId: string
  ): Pick<Tab, 'color' | 'isPinned'> | null {
    const tab =
      this.getWorkspaceSessionForWorktree(worktreeId)?.unifiedTabs?.[worktreeId]?.find(
        (candidate) => candidate.id === tabId || candidate.entityId === tabId
      ) ?? null
    return tab ? { color: tab.color, isPinned: tab.isPinned } : null
  }
}
