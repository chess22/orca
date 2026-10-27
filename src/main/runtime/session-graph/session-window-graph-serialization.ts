import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import type {
  RuntimeRendererSyncWindowGraph,
  RuntimeSyncWindowGraph,
  RuntimeSyncWindowGraphResult
} from '../../../shared/runtime-session-contracts'
import type { TerminalLeafMutationKey } from '../../terminal-leaf-mutation-lane'
import type { RuntimeLeafRecord } from '../runtime-terminal-state-records'
import { OrcaRuntimeWithAttachWindow } from './session-graph-promotion'

export abstract class OrcaRuntimeWithSerializedWindowGraph extends OrcaRuntimeWithAttachWindow {
  protected abstract withMainSurfaces(
    windowId: number,
    graph: RuntimeSyncWindowGraph
  ): RuntimeSyncWindowGraph
  abstract syncWindowGraph(
    windowId: number,
    graph: RuntimeSyncWindowGraph | RuntimeRendererSyncWindowGraph
  ): RuntimeSyncWindowGraphResult

  async syncWindowGraphSerialized(
    windowId: number,
    graph: RuntimeSyncWindowGraph | RuntimeRendererSyncWindowGraph
  ): Promise<RuntimeSyncWindowGraphResult> {
    const effective = ORCA_LAYOUT_OWNER_IS_MAIN ? this.withMainSurfaces(windowId, graph) : graph
    const currentByKey = this.leaves
    const incomingByKey = new Map(
      effective.leaves.map((leaf) => [this.getLeafKey(leaf.tabId, leaf.leafId), leaf])
    )
    const keys: TerminalLeafMutationKey[] = []
    const add = (leaf: Pick<RuntimeLeafRecord, 'worktreeId' | 'tabId' | 'leafId'>): void => {
      keys.push({
        executionHostId:
          this.tryGetWorkspaceSessionHostIdForWorktree(leaf.worktreeId) ?? LOCAL_EXECUTION_HOST_ID,
        worktreeId: leaf.worktreeId,
        tabId: leaf.tabId,
        leafId: leaf.leafId
      })
    }
    for (const [leafKey, current] of currentByKey) {
      const incoming = incomingByKey.get(leafKey)
      if (
        !incoming ||
        incoming.ptyId !== current.ptyId ||
        incoming.worktreeId !== current.worktreeId
      ) {
        add(current)
        if (incoming) {
          add(incoming)
        }
      }
    }
    for (const [leafKey, incoming] of incomingByKey) {
      if (!currentByKey.has(leafKey)) {
        add(incoming)
      }
    }
    return this.runTerminalLeafMutations(keys, () => this.syncWindowGraph(windowId, effective))
  }
}
