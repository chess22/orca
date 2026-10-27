import type { WorktreePtyHostFence } from '../worktree-pty-host-fence'
import type { RuntimeTerminalClose } from '../../../shared/runtime-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { ResolvedWorktree } from '../runtime-worktree-path-identity'
import type { LayoutApplyReply } from '../../../shared/workspace-layout/workspace-layout-command-types'
import type { WindowLayoutCommand } from '../runtime-layout-apply'
import {
  OrcaRuntimeWithExplicitCloseTabPtyStops,
  type ExplicitCloseStop
} from './explicit-terminal-close-pty-stops'
import {
  closePairedHostLeafFirst,
  isTerminalTabPinnedInSession
} from './paired-host-terminal-close'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'

export abstract class OrcaRuntimeWithExplicitTerminalCloseIdentity extends OrcaRuntimeWithExplicitCloseTabPtyStops {
  protected abstract getResolvedWorktreeMap(): Promise<Map<string, ResolvedWorktree>>
  abstract applyLayoutCommand(command: WindowLayoutCommand): Promise<LayoutApplyReply>
  protected abstract refreshPtyWorktreeRecordsFromController(
    resolvedWorktrees: ResolvedWorktree[],
    targetWorktreeId?: string | null,
    deadline?: number
  ): Promise<Set<string> | null>
  protected abstract getLivePtyIdsForWorktree(
    worktreeId: string,
    freshPtyIds?: ReadonlySet<string>,
    hostFence?: WorktreePtyHostFence
  ): Set<string>
  protected abstract getTerminalHandlesForPtyId(ptyId: string): string[]
  protected abstract getRecordedTerminalSleepHandles(
    ptyIds: Iterable<string>,
    terminalHandlesByPtyId: Readonly<Record<string, readonly string[]>>
  ): string[]
  protected abstract commitWorktreeTerminalSleepPtys(args: {
    worktreeId: string
    generation: number
    ptyIds: readonly string[]
    pendingPtyIds: Set<string>
    committedPtyIds: Set<string>
    terminalHandlesByPtyId: Readonly<Record<string, readonly string[]>>
  }): void

  protected describeTerminalClose(
    handle: string,
    tabId: string,
    ptyId: string | null,
    stop: ExplicitCloseStop
  ): RuntimeTerminalClose {
    const close: RuntimeTerminalClose = { handle, tabId, ptyKilled: stop.stopped }
    if (stop.stopped || !ptyId) {
      return close
    }
    const verdict = this.getPtyLivenessVerdict(ptyId)
    if (verdict?.status === 'unverifiable') {
      return { ...close, ptyStopVerdict: 'unverifiable', ptyStopReason: verdict.reason }
    }
    if (verdict?.status === 'live') {
      return { ...close, ptyStopVerdict: 'live' }
    }
    return close
  }

  /** null when this machine owns the PTY; see `closePairedHostLeafFirst` otherwise. */
  protected closeOnOwningPairedHost(
    handle: string,
    leaf: { worktreeId: string; tabId: string; leafId: string; ptyId: string | null },
    method: 'terminal.close' | 'terminal.closeTab',
    closesTab: boolean
  ): ReturnType<typeof closePairedHostLeafFirst> {
    return closePairedHostLeafFirst(leaf, method, {
      call: (environmentId, hostMethod, params, timeoutMs) =>
        this.callOrchestrationWorkerServer(environmentId, hostMethod, params, timeoutMs),
      isTabPinned: () =>
        closesTab &&
        this.getWorkspaceSessionHostIdsForTab(leaf.worktreeId, leaf.tabId).some((hostId) =>
          isTerminalTabPinnedInSession(this.store?.getWorkspaceSession?.(hostId), leaf)
        ),
      readBoundLeaf: () => this.getLiveLeafForHandle(handle).leaf
    })
  }

  protected terminalCloseMutationKeys(handle: string) {
    const pty = this.getLivePtyForHandle(handle)
    const recorded = pty ? this.paneOfPty(pty.pty) : null
    let leaf: ReturnType<typeof this.getLiveLeafForHandle>['leaf'] | null = null
    try {
      leaf = this.getLiveLeafForHandle(handle).leaf
    } catch {
      // A direct PTY record may be authoritative without a renderer graph leaf.
    }
    const candidates = new Map<string, { worktreeId: string; tabId: string; leafId: string }>()
    const addCandidate = (worktreeId?: string, tabId?: string | null, leafId?: string | null) => {
      if (worktreeId && tabId && leafId) {
        candidates.set(`${worktreeId}\0${tabId}\0${leafId}`, { worktreeId, tabId, leafId })
      }
    }
    addCandidate(
      pty?.pty.worktreeId,
      recorded?.tabId,
      parsePaneKey(recorded?.paneKey ?? '')?.leafId
    )
    addCandidate(pty?.pty.worktreeId, pty?.record.tabId, pty?.record.leafId)
    addCandidate(leaf?.worktreeId, leaf?.tabId, leaf?.leafId)
    if (pty) {
      const currentSurface = this.resolvePtyTabCloseSurfaceAuthority({
        handle,
        ptyId: pty.pty.ptyId,
        incarnationId: pty.pty.incarnationId,
        worktreeId: pty.pty.worktreeId
      })?.surface.tab
      addCandidate(pty.pty.worktreeId, currentSurface?.parentTabId, currentSurface?.leafId)
    }
    const tabKeys = new Map<string, { worktreeId: string; tabId: string; leafIds: Set<string> }>()
    for (const candidate of candidates.values()) {
      const key = `${candidate.worktreeId}\0${candidate.tabId}`
      const tab = tabKeys.get(key) ?? {
        worktreeId: candidate.worktreeId,
        tabId: candidate.tabId,
        leafIds: new Set<string>()
      }
      tab.leafIds.add(candidate.leafId)
      tabKeys.set(key, tab)
    }
    return [...tabKeys.values()].flatMap(({ worktreeId, tabId, leafIds }) => {
      const hostIds = this.getWorkspaceSessionHostIdsForTab(worktreeId, tabId)
      const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
      for (const tab of snapshot?.tabs ?? []) {
        if (tab.type === 'terminal' && tab.parentTabId === tabId) {
          leafIds.add(tab.leafId)
        }
      }
      for (const executionHostId of hostIds) {
        const layout =
          this.store?.getWorkspaceSession?.(executionHostId)?.terminalLayoutsByTabId[tabId]
        for (const leafId of Object.keys(layout?.ptyIdsByLeafId ?? {})) {
          leafIds.add(leafId)
        }
      }
      const mutationHostIds: ExecutionHostId[] =
        hostIds.length > 0 ? hostIds : [LOCAL_EXECUTION_HOST_ID]
      return mutationHostIds.flatMap((executionHostId) =>
        [...leafIds].map((leafId) => ({ executionHostId, worktreeId, tabId, leafId }))
      )
    })
  }

  private normalizedTerminalCloseMutationKeys(handle: string) {
    return this.terminalCloseMutationKeys(handle).toSorted((left, right) =>
      JSON.stringify([
        left.executionHostId,
        left.worktreeId,
        left.tabId,
        left.leafId
      ]).localeCompare(
        JSON.stringify([right.executionHostId, right.worktreeId, right.tabId, right.leafId])
      )
    )
  }

  protected captureTerminalCloseIdentity(handle: string) {
    const direct = this.getLivePtyForHandle(handle)
    if (direct) {
      const recorded = this.paneOfPty(direct.pty)
      const mobileSurface = this.resolvePtyTabCloseSurfaceAuthority({
        handle,
        ptyId: direct.pty.ptyId,
        incarnationId: direct.pty.incarnationId,
        worktreeId: direct.pty.worktreeId
      })?.surface
      return {
        kind: 'pty' as const,
        ptyId: direct.pty.ptyId,
        incarnationId: direct.pty.incarnationId,
        connectionId: direct.pty.connectionId,
        ptyGeneration: direct.record.ptyGeneration,
        worktreeId: direct.pty.worktreeId,
        recordWorktreeId: direct.record.worktreeId,
        recorded: {
          tabId: recorded.tabId,
          paneKey: recorded.paneKey,
          recordedAtGraphSequence: recorded.recordedAtGraphSequence
        },
        mobileSurface: mobileSurface ? structuredClone(mobileSurface) : null,
        mutationKeys: this.normalizedTerminalCloseMutationKeys(handle)
      }
    }
    try {
      const { leaf } = this.getLiveLeafForHandle(handle)
      return {
        kind: 'leaf' as const,
        tabId: leaf.tabId,
        leafId: leaf.leafId,
        ptyId: leaf.ptyId,
        ptyGeneration: leaf.ptyGeneration,
        mutationKeys: this.normalizedTerminalCloseMutationKeys(handle)
      }
    } catch {
      return null
    }
  }

  protected assertTerminalCloseIdentity(
    handle: string,
    expected: ReturnType<typeof this.captureTerminalCloseIdentity>
  ): void {
    const current = this.captureTerminalCloseIdentity(handle)
    if (!expected || !current || JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error('terminal_handle_stale')
    }
  }
}
