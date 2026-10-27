import type { ExecutionHostId } from './execution-host'
import type { PtyIncarnationId } from './pty-incarnation'
import type { PtyLivenessVerdict } from './pty-liveness-verdict'
import type { RuntimeListingHostScope } from './runtime-listing-host-scope'
import type { RuntimeMobileSessionTabsResult } from './runtime-session-contracts'
import type { TabGroupLayoutNode } from './tab-types'
import type { TerminalExitCause } from './terminal-exit-cause'
import type { TerminalPaneLayoutNode } from './terminal-tab-types'
import type { TerminalAgent } from './terminal-agent'

export type RuntimeTerminalSummary = {
  handle: string
  ptyId: string | null
  /** Exact owning-provider process for this PTY incarnation; absent when it cannot be proven. */
  rootProcessId?: number
  incarnationId?: string | null
  /** Execution-host ownership evidence for this exact PTY incarnation. */
  agentOwnership?: 'absent' | 'present' | 'unknown'
  /** Present only when agentOwnership is authoritative. */
  agentOwnerCount?: number
  orphaned?: boolean
  /**
   * Orphaned only: the pane the host last recorded for this PTY, which the renderer owning it can
   * still hold even when its graph omitted that pane. Absent when none was recorded or the host
   * predates the field.
   */
  recordedPaneKey?: string
  worktreeId: string
  worktreePath: string
  branch: string
  tabId: string
  leafId: string
  title: string | null
  /** A user's name for this pane from the host's saved layout; absent when unset or the host predates it. */
  paneTitle?: string
  connected: boolean
  writable: boolean
  lastOutputAt: number | null
  preview: string
  /** Host-resolved observed agent identity; absent when unknown. Does not imply launch support. */
  agentIdentity?: TerminalAgent
  /** Absent while running or when the host predates the field; never infer a clean finish. */
  exitCause?: TerminalExitCause
  /** Absent when the host predates the field or could not name the execution host. */
  executionHostId?: ExecutionHostId
  /**
   * The execution host's word on the pane's terminal. Read this, not `connected`: `connected`
   * keeps its old meaning, so an unreachable host reads connected. Absent from older hosts.
   */
  verdict?: PtyLivenessVerdict['status']
}

export type RuntimeTerminalVisualTerminalNode = {
  type: 'terminal'
  handle: string
  tabId: string
  leafId: string
  title: string | null
  connected: boolean
  active: boolean
}

export type RuntimeTerminalVisualPaneNode =
  | RuntimeTerminalVisualTerminalNode
  | {
      type: 'pane-split'
      direction: Extract<TerminalPaneLayoutNode, { type: 'split' }>['direction']
      first: RuntimeTerminalVisualPaneNode
      second: RuntimeTerminalVisualPaneNode
    }

export type RuntimeTerminalVisualTab = {
  tabId: string
  title: string | null
  activeLeafId: string | null
  panes: RuntimeTerminalVisualPaneNode
}

export type RuntimeTerminalVisualGroupNode = {
  type: 'group'
  groupId: string | null
  activeTabId: string | null
  tabs: RuntimeTerminalVisualTab[]
}

export type RuntimeTerminalVisualLayoutNode =
  | RuntimeTerminalVisualGroupNode
  | {
      type: 'split'
      direction: Extract<TabGroupLayoutNode, { type: 'split' }>['direction']
      first: RuntimeTerminalVisualLayoutNode
      second: RuntimeTerminalVisualLayoutNode
    }

export type RuntimeTerminalVisualLayout = {
  worktreeId: string
  worktreePath: string
  root: RuntimeTerminalVisualLayoutNode
}

/** The shared listing-scope shape, kept under its incumbent name for existing consumers. */
export type RuntimeTerminalListHostScope = RuntimeListingHostScope

export type RuntimeTerminalListResult = {
  terminals: RuntimeTerminalSummary[]
  visualLayouts?: RuntimeTerminalVisualLayout[]
  topologyRevisions?: Record<string, number>
  totalCount: number
  truncated: boolean
  /** Absent from hosts that predate the field; treat that scope as unverifiable. */
  hostScope?: RuntimeTerminalListHostScope
}

export type RuntimeTerminalOrphanAdoptionClaim = {
  terminal: string
  ptyId: string
  incarnationId: PtyIncarnationId
  tabId: string
  leafId: string
}

export type RuntimeTerminalOrphanTopologyTab = {
  tabId: string
  root: TerminalPaneLayoutNode
  activeLeafId: string
  expandedLeafId: string | null
}

export type RuntimeTerminalOrphanTopologyGroup = {
  id: string
  activeTabId: string
  tabOrder: string[]
  recentTabIds?: string[]
}

export type RuntimeTerminalOrphanTopology = {
  tabs: RuntimeTerminalOrphanTopologyTab[]
  groups: RuntimeTerminalOrphanTopologyGroup[]
  groupLayout?: TabGroupLayoutNode
}

export type RuntimeTerminalOrphanAdoptionRequest = {
  worktree: string
  expectedTopologyRevision: number
  claims: RuntimeTerminalOrphanAdoptionClaim[]
  activeTabId?: string
  activeGroupId?: string
  topology?: RuntimeTerminalOrphanTopology
}

export type RuntimeTerminalOrphanAdoptionResult = {
  adopted: boolean
  topologyRevision: number
  snapshot: RuntimeMobileSessionTabsResult
}
