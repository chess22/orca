import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import {
  AGENT_INTERRUPT_SETTLE_MS,
  type AgentInterruptInferenceRequest,
  type AgentInterruptInputIntent
} from '../../../../shared/agent-interrupt-intent'
import { isExplicitAgentStatusFresh } from '@/lib/agent-status'

export type AgentInterruptInference = {
  observeInputIntent(intent: AgentInterruptInputIntent): void
  dispose(): void
}

type AgentInterruptInferenceDeps = {
  paneKey: string
  getStatusEntry: () => AgentStatusEntry | undefined
  inferInterrupt: (request: AgentInterruptInferenceRequest) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type CapturedInterruptBaseline = {
  updatedAt: number
  stateStartedAt: number
  prompt: string
  agentType: AgentStatusEntry['agentType']
  intent: AgentInterruptInputIntent
  inputCount?: number
}

function requiresDoubleEscapeForAgent(
  agentType: AgentStatusEntry['agentType'],
  intent: AgentInterruptInputIntent
): boolean {
  return agentType === 'opencode' && intent === 'plain-escape'
}

function isSameTurnBaseline(
  left: CapturedInterruptBaseline,
  right: CapturedInterruptBaseline
): boolean {
  return (
    left.agentType === right.agentType &&
    left.prompt === right.prompt &&
    left.stateStartedAt === right.stateStartedAt
  )
}

export function isPlainEscapeKeyEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'>
): boolean {
  return (
    event.key === 'Escape' &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function isCtrlCKeyEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'>
): boolean {
  return (
    event.key.toLowerCase() === 'c' &&
    !event.repeat &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

export function createAgentInterruptInference({
  paneKey,
  getStatusEntry,
  inferInterrupt,
  now = () => Date.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer)
}: AgentInterruptInferenceDeps): AgentInterruptInference {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let pendingBaseline: CapturedInterruptBaseline | null = null
  let openCodeEscapeBaseline: CapturedInterruptBaseline | null = null

  const clearPendingTimer = (): void => {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer)
      pendingTimer = null
    }
    pendingBaseline = null
  }

  const clearPending = (): void => {
    clearPendingTimer()
    openCodeEscapeBaseline = null
  }

  const captureBaseline = (
    entry: AgentStatusEntry,
    intent: AgentInterruptInputIntent
  ): CapturedInterruptBaseline | null => {
    const agentType = entry.agentType
    if (
      entry.state !== 'working' ||
      !isExplicitAgentStatusFresh(entry, now(), AGENT_STATUS_STALE_AFTER_MS)
    ) {
      return null
    }
    return {
      updatedAt: entry.updatedAt,
      stateStartedAt: entry.stateStartedAt,
      prompt: entry.prompt,
      agentType,
      intent
    }
  }

  const flushPending = (): void => {
    const baseline = pendingBaseline
    pendingTimer = null
    pendingBaseline = null
    if (!baseline) {
      return
    }

    const entry = getStatusEntry()
    if (
      !entry ||
      entry.state !== 'working' ||
      entry.agentType !== baseline.agentType ||
      entry.prompt !== baseline.prompt ||
      entry.updatedAt !== baseline.updatedAt ||
      entry.stateStartedAt !== baseline.stateStartedAt ||
      !isExplicitAgentStatusFresh(entry, now(), AGENT_STATUS_STALE_AFTER_MS)
    ) {
      return
    }

    inferInterrupt({
      paneKey,
      baselineUpdatedAt: baseline.updatedAt,
      baselineStateStartedAt: baseline.stateStartedAt,
      baselinePrompt: baseline.prompt,
      baselineAgentType: baseline.agentType,
      intent: baseline.intent,
      ...(baseline.inputCount !== undefined ? { inputCount: baseline.inputCount } : {})
    })
  }

  return {
    observeInputIntent(intent) {
      const entry = getStatusEntry()
      if (!entry) {
        clearPending()
        return
      }
      let baseline = captureBaseline(entry, intent)
      if (!baseline) {
        clearPending()
        return
      }
      if (requiresDoubleEscapeForAgent(baseline.agentType, intent)) {
        const isSecondEscape =
          openCodeEscapeBaseline !== null && isSameTurnBaseline(openCodeEscapeBaseline, baseline)
        openCodeEscapeBaseline = baseline
        clearPendingTimer()
        if (!isSecondEscape) {
          return
        }
        // Why: OpenCode uses the first Escape as a TUI/editor cancel. The
        // second Escape on the same turn is the actual running-turn interrupt.
        baseline = { ...baseline, inputCount: 2 }
      } else {
        openCodeEscapeBaseline = null
        clearPendingTimer()
      }
      pendingBaseline = baseline
      pendingTimer = setTimer(flushPending, AGENT_INTERRUPT_SETTLE_MS)
    },
    dispose() {
      clearPending()
    }
  }
}
