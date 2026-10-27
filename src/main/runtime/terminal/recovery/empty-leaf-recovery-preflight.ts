import type { RuntimeTerminalEmptyLeafRecoveryPreflight } from '../../../../shared/runtime-types'
import {
  terminalEmptyLeafTombstoneId,
  type TerminalEmptyLeafRecoveryRequest
} from '../../../../shared/terminal-empty-leaf-recovery'
import type { TerminalConditionalRespawnRequest } from '../../../../shared/terminal-conditional-respawn'
import type {
  RuntimeLeafRecord,
  RuntimePtyWorktreeRecord
} from '../../runtime-terminal-state-records'
import { runtimeGapRefusal, type RuntimeEmptyLeafRecoveryState } from './empty-leaf-recovery-state'

type EmptyLeafPty = Pick<RuntimePtyWorktreeRecord, 'ptyId' | 'incarnationId' | 'connected'>
type EmptyLeaf = Pick<RuntimeLeafRecord, 'ptyId' | 'connected' | 'writable' | 'ptyGeneration'>

type EmptyLeafRecoveryPreflightPorts = {
  terminal: string
  pty: EmptyLeafPty
  leaf: EmptyLeaf | undefined
  findRecoverableGap(args: {
    terminal: string
    ptyId: string
    retiredIncarnationId: string
  }): TerminalConditionalRespawnRequest | null
  captureLayoutEpoch(): number
  inspectState(request: TerminalEmptyLeafRecoveryRequest): RuntimeEmptyLeafRecoveryState | null
}

export function terminalEmptyLeafRecoveryPreflight({
  terminal,
  pty,
  leaf,
  findRecoverableGap,
  captureLayoutEpoch,
  inspectState
}: EmptyLeafRecoveryPreflightPorts): RuntimeTerminalEmptyLeafRecoveryPreflight | undefined {
  if (!leaf || leaf.ptyId !== pty.ptyId || leaf.connected || leaf.writable || pty.connected) {
    return undefined
  }
  if (!pty.incarnationId) {
    return { status: 'unknown' }
  }
  const original = findRecoverableGap({
    terminal,
    ptyId: pty.ptyId,
    retiredIncarnationId: pty.incarnationId
  })
  const replacement = original?.replacement
  if (!original || !isPublicRecoveryReplacement(replacement)) {
    return { status: 'unknown' }
  }
  const layoutEpoch = captureLayoutEpoch()
  const request: TerminalEmptyLeafRecoveryRequest = {
    originalMutationId: original.mutationId,
    recoveryId: `inspect:${original.mutationId}`,
    terminal,
    expected: {
      worktreeId: original.expected.worktreeId,
      tabId: original.expected.tabId,
      leafId: original.expected.leafId,
      ptyId: original.expected.ptyId,
      ptyGeneration: original.expected.ptyGeneration,
      retiredIncarnationId: original.expected.incarnationId,
      layoutEpoch,
      persistedBindingVersion: leaf.ptyGeneration,
      tombstoneId: terminalEmptyLeafTombstoneId(pty.ptyId, pty.incarnationId)
    },
    replacement
  }
  const state = inspectState(request)
  if (runtimeGapRefusal(request, state)) {
    return { status: 'unknown' }
  }
  if (!state) {
    return { status: 'unknown' }
  }
  return {
    status: 'ready',
    originalMutationId: original.mutationId,
    ptyGeneration: state.ptyGeneration,
    retiredIncarnationId: state.retiredIncarnationId,
    layoutEpoch: state.layoutEpoch,
    persistedBindingVersion: state.persistedBindingVersion,
    tombstoneId: state.tombstoneId,
    replacement: request.replacement
  }
}

function isPublicRecoveryReplacement(
  replacement: TerminalConditionalRespawnRequest['replacement'] | undefined
): replacement is TerminalEmptyLeafRecoveryRequest['replacement'] {
  return (
    typeof replacement?.command === 'string' &&
    replacement.command.length > 0 &&
    typeof replacement.cwd === 'string' &&
    replacement.cwd.length > 0 &&
    typeof replacement.cols === 'number' &&
    Number.isSafeInteger(replacement.cols) &&
    replacement.cols > 0 &&
    typeof replacement.rows === 'number' &&
    Number.isSafeInteger(replacement.rows) &&
    replacement.rows > 0 &&
    replacement.env === undefined &&
    replacement.envToDelete === undefined
  )
}
