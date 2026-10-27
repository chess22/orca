import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../shared/execution-host'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { rollbackFailedPtyBinding } from './pty-binding-write-rollback'
import { cloneWorkspaceSessionState } from '../restoring-sessions/session-owner-fields'
import { resolveHostId } from './session-host-partitions'
import { evaluatePtyBindingFastLane } from './pty-binding-fast-lane'
import { durabilityOnlyBindingResult, isDurabilityOnlyMatch } from './pty-binding-durability-only'
import { ptyBindingIsRefused } from './pty-binding-refusals'
import { applyPtyBinding } from './pty-binding-session-update'
import {
  reportPtyBindingOwnerConflict,
  reportPtyBindingPlacement,
  startPtyBindingSpan,
  type PtyBindingSpan
} from './pty-binding-span'
import { bumpPtyBindingGeneration } from './pty-binding-generations'
import type {
  PersistPtyBindingArgs,
  PtyBindingPersistenceOperationsContext
} from './pty-binding-persistence'

function markSessionDirty(
  context: PtyBindingPersistenceOperationsContext,
  hostId: ReturnType<typeof resolveHostId>
): void {
  context.runtime.dirtyProfileStateDomains?.add(
    hostId === LOCAL_EXECUTION_HOST_ID ? 'workspaceSession' : 'workspaceSessionsByHostId'
  )
}

function writeBinding(
  context: PtyBindingPersistenceOperationsContext,
  args: PersistPtyBindingArgs,
  session: WorkspaceSessionState,
  resolvedHostId: ReturnType<typeof resolveHostId>,
  bindingWorktreeId: string,
  paneKey: string
): () => void {
  const { runtime, sessions } = context
  const sessionBeforeBinding = cloneWorkspaceSessionState(session)
  const restore = (restoredSession = sessionBeforeBinding): void => {
    if (resolvedHostId === LOCAL_EXECUTION_HOST_ID) {
      runtime.state.workspaceSession = restoredSession
    } else {
      runtime.state.workspaceSessionsByHostId = {
        ...runtime.state.workspaceSessionsByHostId,
        [resolvedHostId]: restoredSession
      }
    }
  }
  try {
    if (resolvedHostId !== LOCAL_EXECUTION_HOST_ID) {
      runtime.state.workspaceSessionsByHostId = {
        ...runtime.state.workspaceSessionsByHostId,
        [resolvedHostId]: session
      }
    }
    applyPtyBinding(args, session, bindingWorktreeId, paneKey)
    bumpPtyBindingGeneration(runtime, resolvedHostId, args.leafId)
    markSessionDirty(context, resolvedHostId)
    const boundSession = cloneWorkspaceSessionState(session)
    return () => {
      const current = sessions.getWorkspaceSession(resolvedHostId)
      const rolledBack = rollbackFailedPtyBinding(
        sessionBeforeBinding,
        boundSession,
        current,
        bindingWorktreeId,
        args.tabId,
        args.leafId
      )
      if (rolledBack !== current) {
        restore(rolledBack)
        bumpPtyBindingGeneration(runtime, resolvedHostId, args.leafId)
      }
    }
  } catch (error) {
    restore()
    throw error
  }
}

export async function persistPtyBindingOperation(
  context: PtyBindingPersistenceOperationsContext,
  input: PersistPtyBindingArgs | (() => PersistPtyBindingArgs | null),
  hostId?: string | null,
  laneBinding?: Pick<PersistPtyBindingArgs, 'worktreeId' | 'tabId' | 'leafId'>
): Promise<boolean> {
  const { runtime, sessions } = context
  const resolvedHostId = resolveHostId(hostId)
  const savePending = runtime.writeTimer !== null || runtime.pendingWrite !== null
  let span: PtyBindingSpan | undefined
  let outcome: 'refused' | 'fast_lane' | 'flushed' = 'flushed'
  try {
    const keyBinding = typeof input === 'function' ? laneBinding : input
    if (!keyBinding) {
      throw new Error('terminal_leaf_mutation_key_required')
    }
    const persisted = await runtime.terminalLeafMutationLane.run(
      [{ executionHostId: resolvedHostId, ...keyBinding }],
      () =>
        runtime.runDurableMutation(() => {
          const args = typeof input === 'function' ? input() : input
          if (!args) {
            return { value: false, persist: false }
          }
          span = startPtyBindingSpan({
            hostKind: parseExecutionHostId(resolvedHostId)?.kind ?? 'local',
            origin: args.origin ?? 'unknown',
            savePending,
            generationGap: runtime.writeGeneration - runtime.lastDurableWriteGeneration
          })
          const paneKey = `${args.tabId}:${args.leafId}`
          const bindingWorktreeId = args.expectedSourceBinding?.worktreeId ?? args.worktreeId
          const session = sessions.getWorkspaceSession(resolvedHostId)
          const partitions = sessions.getWorkspaceSessionHostIds().map((partitionHostId) => ({
            hostId: partitionHostId,
            session: sessions.getWorkspaceSession(partitionHostId)
          }))
          if (ptyBindingIsRefused(args, session, bindingWorktreeId, paneKey, partitions)) {
            outcome = 'refused'
            return { value: false, persist: false }
          }
          reportPtyBindingPlacement(span, args, session, bindingWorktreeId)
          const verdict = evaluatePtyBindingFastLane(
            args,
            session,
            bindingWorktreeId,
            !runtime.quitFlushStarted &&
              runtime.lastDurableWriteGeneration >= runtime.writeGeneration
          )
          span.setEligibility(verdict)
          if (verdict.eligible) {
            outcome = 'fast_lane'
            span.setPath('durable_match')
            return { value: true, persist: false }
          }
          if (isDurabilityOnlyMatch(verdict)) {
            span.setPath('durability_only')
            markSessionDirty(context, resolvedHostId)
            return durabilityOnlyBindingResult(resolvedHostId)
          }
          span.setPath('mutation')
          reportPtyBindingOwnerConflict(span, args, resolvedHostId, partitions)
          return {
            value: true,
            writtenHostIds: [resolvedHostId],
            rollback: writeBinding(
              context,
              args,
              session,
              resolvedHostId,
              bindingWorktreeId,
              paneKey
            )
          }
        })
    )
    span?.finish(outcome)
    return persisted
  } catch (error) {
    span?.finish('threw', error)
    throw error
  }
}
