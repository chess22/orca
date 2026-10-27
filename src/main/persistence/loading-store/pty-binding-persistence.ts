import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { cloneWorkspaceSessionState } from '../restoring-sessions/session-owner-fields'
import { rollbackWorkspaceSessionAfterFailedAsyncWrite } from '../restoring-sessions/workspace-session-write-rollback'
import { clearReplacedPaneBinding } from './replaced-pane-binding'

import type { PtyBindingSourceExpectation } from './store'

import type { StoreRuntimeState } from './store-runtime-state'
import { resolveHostId, type SessionHostPartitionOperations } from './session-host-partitions'
import {
  withdrawUnstartedPane,
  type UnstartedPaneKept
} from '../terminal-topology/unstarted-pane-withdraw'
import type { PtyBindingOrigin } from './pty-binding-span'
import type { TerminalPanePlacement } from '../../../shared/terminal-pane-placement'
import type {
  TerminalLeafMoveRequest,
  TerminalLeafMoveResult
} from '../../../shared/terminal-leaf-move'
import {
  admitPane,
  moveLeaf,
  topologyCommitContext,
  withdrawPane,
  type TerminalTopologyCommitContext
} from '../terminal-topology/terminal-topology-commit'
import type {
  TerminalPaneAdmission,
  TerminalPaneAdmissionOutcome
} from '../terminal-topology/terminal-pane-admission'
import type {
  CommandOf,
  LayoutRefusalCode
} from '../../../shared/workspace-layout/workspace-layout-command-types'
import { persistPtyBindingOperation } from './persist-pty-binding-operation'
import { bumpPtyBindingGeneration } from './pty-binding-generations'

export type PtyBindingPersistenceOperationsRuntime = Pick<
  StoreRuntimeState,
  | 'runDurableMutation'
  | 'lastDurableWriteGeneration'
  | 'pendingWrite'
  | 'quitFlushStarted'
  | 'dirtyProfileStateDomains'
  | 'state'
  | 'writeGeneration'
  | 'writeTimer'
  | 'ptyBindingGenerations'
  | 'terminalLeafMutationLane'
>

function markPtyBindingSessionDirty(
  runtime: Pick<StoreRuntimeState, 'dirtyProfileStateDomains'>,
  hostId: ReturnType<typeof resolveHostId>
): void {
  runtime.dirtyProfileStateDomains?.add(
    hostId === LOCAL_EXECUTION_HOST_ID ? 'workspaceSession' : 'workspaceSessionsByHostId'
  )
}

export type PersistPtyBindingArgs = {
  worktreeId: string
  tabId: string
  leafId: string
  ptyId: string
  incarnationId?: string
  startupCwd?: string
  /** Proven host fallback correction; ordinary binds only seed new tabs. */
  correctStartupCwd?: string
  expectedBinding?: { ptyId: string; incarnationId?: string }
  expectedSourceBinding?: PtyBindingSourceExpectation
  /**
   * Defaults true, which is what `pty:spawn` needs — it can beat the debounced layout writer
   * and must be able to mint the surface it is binding. A reattach is the opposite: the pane
   * either still exists or the user closed it, so creating one grafts back a tab they closed.
   * Callers pass false only once absence is meaningful; see the relay's reattach bind.
   */
  mayCreate?: boolean
  /** Reattach must not revive a surface a prior build durably recorded as retired. */
  mayReviveRetiredSurface?: boolean
  /** Span metadata only; see `PtyBindingOrigin`. The write path never reads it. */
  origin?: PtyBindingOrigin
  /** Where a new leaf goes. Report-only for now: the span records whether it names today's tab. */
  placement?: TerminalPanePlacement
  /** Replaces a gone process: with no `incarnationId`, the pane's recorded one is cleared. */
  dropsIncarnation?: true
}

const ptyBindingPersistenceOperationsContext = Symbol('PtyBindingPersistenceOperations')
export type PtyBindingPersistenceOperationsContext = {
  runtime: PtyBindingPersistenceOperationsRuntime
  sessions: SessionHostPartitionOperations
}

export class PtyBindingPersistenceOperations {
  readonly [ptyBindingPersistenceOperationsContext]: PtyBindingPersistenceOperationsContext

  constructor(
    runtime: PtyBindingPersistenceOperationsRuntime,
    sessions: SessionHostPartitionOperations
  ) {
    this[ptyBindingPersistenceOperationsContext] = { runtime, sessions }
  }

  /**
   * Clears a stopped process's binding, keeping the pane; fenced on the id, which is dead in any
   * incarnation. `fence.incarnationId` narrows that to one process, for an absence answer.
   */
  async retirePtyBinding(
    binding: Pick<PersistPtyBindingArgs, 'worktreeId' | 'tabId' | 'leafId' | 'ptyId'>,
    hostId?: string | null,
    fence?: { incarnationId: string | undefined }
  ): Promise<boolean> {
    const { runtime, sessions } = this[ptyBindingPersistenceOperationsContext]
    const resolved = resolveHostId(hostId)
    const publish = (session: WorkspaceSessionState): void => {
      if (resolved === LOCAL_EXECUTION_HOST_ID) {
        runtime.state.workspaceSession = session
      } else {
        runtime.state.workspaceSessionsByHostId = {
          ...runtime.state.workspaceSessionsByHostId,
          [resolved]: session
        }
      }
      markPtyBindingSessionDirty(runtime, resolved)
    }
    return runtime.terminalLeafMutationLane.run([{ executionHostId: resolved, ...binding }], () =>
      runtime.runDurableMutation(() => {
        const session = sessions.getWorkspaceSession(resolved)
        const currentId =
          session.terminalLayoutsByTabId[binding.tabId]?.ptyIdsByLeafId?.[binding.leafId]
        if (!currentId) {
          return { value: true, persist: 'if-dirty' }
        }
        if (currentId !== binding.ptyId) {
          return { value: false, persist: false }
        }
        if (
          fence &&
          session.terminalPtyIncarnationsByPaneKey?.[makePaneKey(binding.tabId, binding.leafId)] !==
            fence.incarnationId
        ) {
          return { value: false, persist: false }
        }
        if (!session.tabsByWorktree[binding.worktreeId]?.some((tab) => tab.id === binding.tabId)) {
          return { value: false, persist: false }
        }
        const before = cloneWorkspaceSessionState(session)
        const retired = clearReplacedPaneBinding(session, {
          ...binding,
          parentTabId: binding.tabId
        })
        // Host retirement must not run renderer snapshot repair, which would put the old binding back.
        publish(retired)
        bumpPtyBindingGeneration(runtime, resolved, binding.leafId)
        const staged = cloneWorkspaceSessionState(retired)
        return {
          value: true,
          writtenHostIds: [resolved],
          rollback: () => {
            publish(
              rollbackWorkspaceSessionAfterFailedAsyncWrite(
                before,
                staged,
                sessions.getWorkspaceSession(resolved)
              )
            )
            bumpPtyBindingGeneration(runtime, resolved, binding.leafId)
          }
        }
      })
    )
  }

  async persistPtyBinding(
    input: PersistPtyBindingArgs | (() => PersistPtyBindingArgs | null),
    hostId?: string | null,
    laneBinding?: Pick<PersistPtyBindingArgs, 'worktreeId' | 'tabId' | 'leafId'>
  ): Promise<boolean> {
    return await persistPtyBindingOperation(
      this[ptyBindingPersistenceOperationsContext],
      input,
      hostId,
      laneBinding
    )
  }

  /**
   * Detach-to-new-tab, committed before the renderer mounts the target tab (STA-9259). It lives on
   * the binding domain only for its runtime and partition access; the commit module owns the write.
   */
  moveTerminalLeafToNewTab(request: TerminalLeafMoveRequest): Promise<TerminalLeafMoveResult> {
    const { runtime, sessions } = this[ptyBindingPersistenceOperationsContext]
    const hostIds = sessions.getWorkspaceSessionHostIds().map(resolveHostId)
    const keys = hostIds.flatMap((executionHostId) => [
      {
        executionHostId,
        worktreeId: request.worktreeId,
        tabId: request.sourceTabId,
        leafId: request.leafId
      },
      {
        executionHostId,
        worktreeId: request.worktreeId,
        tabId: request.targetTabId,
        leafId: request.leafId
      }
    ])
    return runtime.terminalLeafMutationLane.run(keys, () =>
      runtime.runDurableMutation(moveLeaf(request, this.topology()))
    )
  }

  /** Writes a runtime-started pane before its terminal starts; the commit module owns the write. */
  admitTerminalPane(
    admission: TerminalPaneAdmission,
    hostId?: string | null
  ): Promise<TerminalPaneAdmissionOutcome> {
    const { runtime } = this[ptyBindingPersistenceOperationsContext]
    const executionHostId = resolveHostId(hostId)
    const leafIds =
      admission.type === 'createTerminalTab'
        ? [admission.leafId]
        : [admission.leafId, admission.newLeafId]
    return runtime.terminalLeafMutationLane.run(
      leafIds.map((leafId) => ({
        executionHostId,
        worktreeId: admission.workspace,
        tabId: admission.tabId,
        leafId
      })),
      () => runtime.runDurableMutation(admitPane(executionHostId, admission, this.topology()))
    )
  }

  /** With `stillStarting`, a pane whose terminal bound or is starting stays (UnstartedPaneKept). */
  withdrawTerminalPane(
    pane: CommandOf<'closePane'>,
    hostId?: string | null,
    stillStarting?: () => boolean
  ): Promise<LayoutRefusalCode | UnstartedPaneKept | null> {
    const { runtime } = this[ptyBindingPersistenceOperationsContext]
    const resolved = resolveHostId(hostId)
    return runtime.terminalLeafMutationLane.run(
      [
        {
          executionHostId: resolved,
          worktreeId: pane.workspace,
          tabId: pane.tabId,
          leafId: pane.leafId
        }
      ],
      () =>
        runtime.runDurableMutation(
          stillStarting
            ? withdrawUnstartedPane(resolved, pane, this.topology(), stillStarting)
            : withdrawPane(resolved, pane, this.topology())
        )
    )
  }

  private topology(): TerminalTopologyCommitContext {
    return topologyCommitContext(this[ptyBindingPersistenceOperationsContext])
  }
}
