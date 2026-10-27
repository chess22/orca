import type * as AgentSessionResume from './agent-session-resume'
import type { StartupCommandDelivery } from './codex-startup-delivery'
import type { ExecutionHostId } from './execution-host'
import type { StartupCwdFallback } from './startup-cwd-fallback'
import type { TerminalExitCause } from './terminal-exit-cause'
import type { TuiAgent } from './terminal-agent'
export type {
  RuntimeTerminalSend,
  RuntimeTerminalPromptStage,
  RuntimeTerminalPromptDelivery
} from './runtime-terminal-send-contract'

export type {
  RuntimeTerminalListHostScope,
  RuntimeTerminalListResult,
  RuntimeTerminalOrphanAdoptionClaim,
  RuntimeTerminalOrphanAdoptionRequest,
  RuntimeTerminalOrphanAdoptionResult,
  RuntimeTerminalOrphanTopology,
  RuntimeTerminalOrphanTopologyGroup,
  RuntimeTerminalOrphanTopologyTab,
  RuntimeTerminalSummary,
  RuntimeTerminalVisualGroupNode,
  RuntimeTerminalVisualLayout,
  RuntimeTerminalVisualLayoutNode,
  RuntimeTerminalVisualPaneNode,
  RuntimeTerminalVisualTab,
  RuntimeTerminalVisualTerminalNode
} from './runtime-terminal-list-contracts'
import type { RuntimeTerminalSummary } from './runtime-terminal-list-contracts'

export type RuntimeWorktreeTerminalSleepResult = {
  stopped: number
  stoppedPtyIds: string[]
  livePtyIds: string[]
} & (
  | { postStopVerified: true; postStopFailure?: never; remainingLivePtyIds?: never }
  | {
      postStopVerified: false
      postStopFailure: 'terminal_liveness_unavailable'
      remainingLivePtyIds?: never
    }
  | {
      postStopVerified: false
      postStopFailure: 'terminal_worktree_sleep_still_live'
      remainingLivePtyIds: string[]
    }
)

export type RuntimeWorktreeTerminalCloseResult = {
  closed: number
  stopped: number
  retiredSurfaces: true
  ptyStopVerdict?: 'live' | 'unverifiable'
  ptyStopReason?: string
}

export type RuntimeTerminalInteractiveWaitSource = 'hook' | 'prompt-text' | 'title'

export type RuntimeTerminalInteractiveWait = {
  source: RuntimeTerminalInteractiveWaitSource
  reason?: RuntimeTerminalWaitBlockedReason
  since?: number
}

export type RuntimeTerminalShow = RuntimeTerminalSummary & {
  paneRuntimeId: number
  ptyId: string | null
  /** Absent when the execution host predates conditional terminal respawn. */
  ptyGeneration?: number
  rendererGraphEpoch: number
  /** Null means evaluated with no wait; absent means not evaluated. */
  agentWait?: RuntimeTerminalInteractiveWait | null
}

export type RuntimeTerminalState = 'running' | 'exited' | 'unknown'

export type RuntimeTerminalRowMetadata = {
  wrapped: boolean
  trailingSpaces: number
}

export type RuntimeTerminalRead = {
  handle: string
  status: RuntimeTerminalState
  tail: string[]
  /** Execution-host wrap evidence, aligned with tail; absent on older peers. */
  tailRows?: RuntimeTerminalRowMetadata[]
  truncated: boolean
  limited?: boolean
  oldestCursor?: string
  nextCursor: string | null
  latestCursor?: string
  returnedLineCount?: number
  source?: 'stream' | 'screen' | 'screen-unavailable'
  /** UI-only composer text, excluded from `tail`. */
  draft?: string
}

export type RuntimeTerminalRename = {
  handle: string
  tabId: string
  title: string | null
}

export type RuntimeTerminalSetPaneTitle = {
  handle: string
  tabId: string
  leafId: string
  title: string | null
}

export type RuntimeTerminalAgentStatusState = 'working' | 'permission' | 'idle' | null

export type RuntimeTerminalAgentStatus = {
  handle: string
  isRunningAgent: boolean
  status: RuntimeTerminalAgentStatusState
}

export type RuntimeTerminalPresentation = 'background' | 'focused'

type RuntimeTerminalCreateBaseRequestPayload = {
  requestId: string
  worktreeId?: string
  afterTabId?: string
  targetGroupId?: string
  command?: string
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  launchConfig?: AgentSessionResume.SleepingAgentLaunchConfig
  resumeProviderSession?: AgentSessionResume.AgentProviderSessionMetadata
  launchToken?: string
  launchAgent?: TuiAgent
  viewMode?: 'terminal' | 'chat'
  startupCommandDelivery?: StartupCommandDelivery
  title?: string
  activate?: boolean
  presentation?: RuntimeTerminalPresentation
  surfaceOwner?: false
  /** Windows shell the created tab spawns AS, instead of the host default. */
  shellOverride?: string
}

export type RuntimeTerminalCreateRequestPayload =
  | (RuntimeTerminalCreateBaseRequestPayload & { source?: undefined })
  | (RuntimeTerminalCreateBaseRequestPayload & {
      worktreeId: string
      source: 'runtime-session'
    })

export type RuntimeTerminalCreate = {
  handle: string
  /** Host-owned PTY incarnation used to fence remote identity observations. */
  incarnationId?: string | null
  tabId?: string
  paneKey?: string | null
  ptyId?: string | null
  worktreeId: string
  title: string | null
  executionHostId?: ExecutionHostId
  hostPlatform?: NodeJS.Platform
  surface?: 'background' | 'visible'
  warning?: string
  agentSessionDisposition?: 'created' | 'adopted'
  isReattach?: true
  /** Spawn process identity for host-internal ownership proof. */
  processId?: number
  /** Host-internal: the requested folder was gone, so the process started at the workspace root. */
  startupCwdFallback?: StartupCwdFallback
  /** Host-internal saved-folder decision; excluded by RPC result projection. */
  savedStartupCwd?: string
}

export type RuntimeTerminalSplit = {
  handle: string
  tabId: string
  paneRuntimeId: number
  // Why: paired callers need the host-created leaf identity to focus the exact pane.
  leafId?: string
}

export type RuntimeTerminalResolvePane = {
  handle: string
  /** Host-owned PTY incarnation used to fence remote identity observations. */
  incarnationId?: string | null
  tabId: string
  leafId: string
  ptyId: string | null
  connected?: boolean
  worktreeId?: string
  executionHostId?: ExecutionHostId
  hostPlatform?: NodeJS.Platform
}

export type RuntimeTerminalFocus = {
  handle: string
  tabId: string
  worktreeId: string
  navigated?: boolean
}

export type RuntimeTerminalClose = {
  handle: string
  tabId: string
  closeMode?: 'tab'
  ptyKilled: boolean
  ptyStopVerdict?: 'live' | 'unverifiable'
  ptyStopReason?: string
  /** The host durably recorded a kill order it replays when the PTY's SSH host reconnects.
   *  Older hosts never send it, so a client promises no retry without it. */
  pendingKillRecorded?: true
}

export type RuntimeTerminalWaitCondition = 'exit' | 'tui-idle'

// Why both spellings: the codex-* members were published by every host before the agent-neutral
// rename, so they are permanent — a client still has to read them off an older host. This build
// keeps a codex-* reason only where the matched wording is plausibly Codex's own; every matcher
// that inspects no agent publishes the agent-* spelling.
export type RuntimeTerminalWaitBlockedReason =
  | 'codex-update-prompt'
  | 'codex-trust-workspace'
  | 'codex-cwd-prompt'
  | 'codex-model-migration-prompt'
  | 'codex-hooks-review-prompt'
  | 'codex-interactive-prompt'
  | 'agent-update-prompt'
  | 'agent-trust-workspace'
  | 'agent-cwd-prompt'
  | 'agent-hooks-review-prompt'
  | 'agent-interactive-prompt'
  | 'agent-approval-prompt'

export type RuntimeTerminalWait = {
  handle: string
  condition: RuntimeTerminalWaitCondition
  satisfied: boolean
  status: RuntimeTerminalState
  exitCode: number | null
  exitCause?: TerminalExitCause
  blockedReason?: RuntimeTerminalWaitBlockedReason
}
