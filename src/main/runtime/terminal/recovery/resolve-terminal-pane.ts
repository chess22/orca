import { OrcaRuntimeWithResolveTerminalPaneRecovery } from './resolve-terminal-pane-recovery'
import type { RuntimeTerminalRead, RuntimeTerminalShow } from '../../../../shared/runtime-types'
import type { RuntimeProviderSnapshotReadOptions } from '../../runtime-terminal-contracts'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  buildVisibleSnapshotReadFallback,
  labelTerminalReadSource,
  readTerminalTail
} from '../../terminal-tail-read'
import { getTerminalState } from '../../terminal-wait-results'
import { readStructuredWorkerTerminal } from '../../structured-worker-terminal-read'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'

export abstract class OrcaRuntimeWithResolveTerminalPane extends OrcaRuntimeWithResolveTerminalPaneRecovery {
  async showTerminal(handle: string): Promise<RuntimeTerminalShow> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      const worktreesById = await this.getResolvedWorktreeMap()
      const summary = this.buildPtyTerminalSummary(pty.pty, worktreesById)
      const preview = await this.visibleSnapshotPreview(pty.pty.ptyId, summary.preview)
      this.assertLiveTerminalHandleTargetsPty(handle, pty.pty.ptyId)
      const agentWait = await this.getTerminalInteractiveWait(handle)
      const rootProcessId = await this.rootProcessIdForCurrentPty(handle, pty.pty)
      const recorded = this.paneOfPty(pty.pty)
      const recordedLeaf =
        recorded.tabId && recorded.paneKey
          ? this.leaves.get(
              this.getLeafKey(recorded.tabId, parsePaneKey(recorded.paneKey)?.leafId ?? '')
            )
          : undefined
      return {
        ...summary,
        preview,
        tabId: recorded.tabId ?? pty.record.tabId,
        leafId: parsePaneKey(recorded.paneKey ?? '')?.leafId ?? pty.record.leafId,
        paneRuntimeId: -1,
        ptyId: pty.pty.ptyId,
        ptyGeneration: recordedLeaf?.ptyGeneration ?? pty.record.ptyGeneration,
        rendererGraphEpoch: this.rendererGraphEpoch,
        ...(rootProcessId !== undefined ? { rootProcessId } : {}),
        ...(agentWait !== undefined ? { agentWait } : {})
      }
    }
    const graphEpoch = this.captureReadyGraphEpoch()
    const worktreesById = await this.getResolvedWorktreeMap()
    this.assertStableReadyGraph(graphEpoch)
    const { leaf } = this.getLiveLeafForHandle(handle)
    const summary = this.buildTerminalSummary(leaf, worktreesById)
    const preview = leaf.ptyId
      ? await this.visibleSnapshotPreview(leaf.ptyId, summary.preview)
      : summary.preview
    this.assertStableReadyGraph(graphEpoch)
    if (leaf.ptyId) {
      this.assertLiveTerminalHandleTargetsPty(handle, leaf.ptyId)
    }
    const agentWait = await this.getTerminalInteractiveWait(handle)
    const livePty = leaf.ptyId ? this.ptysById.get(leaf.ptyId) : undefined
    const rootProcessId = livePty
      ? await this.rootProcessIdForCurrentPty(handle, livePty)
      : undefined
    return {
      ...summary,
      preview,
      paneRuntimeId: leaf.paneRuntimeId,
      ptyId: leaf.ptyId,
      ptyGeneration: leaf.ptyGeneration,
      rendererGraphEpoch: this.rendererGraphEpoch,
      ...(rootProcessId !== undefined ? { rootProcessId } : {}),
      ...(agentWait !== undefined ? { agentWait } : {})
    }
  }

  async readTerminal(
    handle: string,
    opts: { cursor?: number; limit?: number; screen?: boolean } = {},
    providerSnapshot: RuntimeProviderSnapshotReadOptions = {}
  ): Promise<RuntimeTerminalRead> {
    // Before the PTY lookup, because a structured worker has no PTY and no leaf: without this the
    // only peer read verb answers `terminal_handle_stale` for a perfectly live worker.
    const structured = await readStructuredWorkerTerminal({
      handle,
      db: this.getOrchestrationDbIfAvailable?.() ?? null,
      ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
      ...(opts.limit === undefined ? {} : { limit: opts.limit })
    })
    if (structured) {
      // `screen` asks for a rendered grid; there is none, and the journal is the whole record.
      return { ...structured, source: opts.screen ? 'screen-unavailable' : 'stream' }
    }
    // Switch point: a saved pane main holds with no terminal yet starts first (once, shared).
    const starting = ORCA_LAYOUT_OWNER_IS_MAIN ? this.startRestoredHandlePane(handle) : null
    if (starting) {
      const target = await starting
      return { ...(await this.readTerminal(target, opts, providerSnapshot)), handle }
    }
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      const read = this.readPtyTerminal(handle, pty.pty, opts)
      const visibleRead = opts.screen
        ? await this.readRenderedScreen(pty.pty.ptyId, read, opts)
        : await this.withVisibleSnapshotFallback(pty.pty.ptyId, read, opts, providerSnapshot)
      this.assertLiveTerminalHandleTargetsPty(handle, pty.pty.ptyId)
      return labelTerminalReadSource(visibleRead)
    }

    const { leaf } = this.getLiveLeafForHandle(handle)
    const read = readTerminalTail({
      handle,
      status: getTerminalState(leaf),
      previewLines: leaf.tailBuffer,
      completedLines: leaf.tailTranscriptBuffer,
      partialLine: leaf.tailPartialLine,
      completedLineCount: leaf.tailLinesTotal,
      bufferTruncated: leaf.tailTruncated,
      cursor: opts.cursor,
      limit: opts.limit
    })
    if (!leaf.ptyId) {
      return { ...read, source: opts.screen ? 'screen-unavailable' : 'stream' }
    }
    const visibleRead = opts.screen
      ? await this.readRenderedScreen(leaf.ptyId, read, opts)
      : await this.withVisibleSnapshotFallback(leaf.ptyId, read, opts, providerSnapshot)
    this.assertLiveTerminalHandleTargetsPty(handle, leaf.ptyId)
    return labelTerminalReadSource(visibleRead)
  }

  protected async readRenderedScreen(
    ptyId: string,
    read: RuntimeTerminalRead,
    opts: { limit?: number } = {}
  ): Promise<RuntimeTerminalRead> {
    const visibleState = await this.readVisibleTerminalState(ptyId)
    const projection =
      visibleState ??
      (await this.readProviderTerminalTailLines(ptyId, opts.limit, { visibleScreenOnly: true }))
    if (projection.lines.length === 0) {
      return { ...read, source: 'screen-unavailable' }
    }
    return buildVisibleSnapshotReadFallback(
      read,
      projection.lines,
      opts.limit,
      projection.draft,
      projection.tailRows
    )
  }
}
