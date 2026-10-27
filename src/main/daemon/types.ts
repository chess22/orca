export type {
  ConfirmForegroundProcessRequest,
  ConfirmShellForegroundRequest,
  GetForegroundProcessRequest,
  InspectProcessRequest
} from './daemon-foreground-process-protocol'

import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
export type { TerminalModes } from './terminal-modes'
import type { TerminalSnapshot } from './terminal-snapshot'
export type { TerminalSnapshot } from './terminal-snapshot'
export {
  AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION,
  AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION,
  ASYNC_CWD_VALIDATION_DAEMON_PROTOCOL_VERSION,
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  CONDITIONAL_RESPAWN_PROTOCOL_VERSION,
  COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION,
  GET_FOREGROUND_PROCESS_PROTOCOL_VERSION,
  GIT_CREDENTIAL_GUARD_HOST_PROTOCOL_VERSION,
  PREVIOUS_DAEMON_PROTOCOL_VERSIONS,
  PROTOCOL_VERSION,
  PTY_STARTUP_INGRESS_PROTOCOL_VERSION,
  MODE_2031_UNSUBSCRIBE_FACT_PROTOCOL_VERSION,
  supportsMode2031UnsubscribeFact,
  supportsPtyStartupIngress
} from './daemon-protocol-version'

export type SessionState = 'created' | 'spawning' | 'running' | 'exiting' | 'exited'

export type ShellReadyState = 'pending' | 'ready' | 'timed_out' | 'unsupported'

export type { TerminalCheckpointFile } from './daemon-checkpoint-file'

export type { DaemonEndpointIdentity, HelloMessage, HelloResponse } from './daemon-hello-protocol'

export type * from './daemon-request-types'

export type RpcResponseOk<T = unknown> = {
  id: string
  ok: true
  payload: T
}

export type RpcResponseError = {
  id: string
  ok: false
  error: string
}

export type RpcResponse<T = unknown> = RpcResponseOk<T> | RpcResponseError

export type { DaemonCreateOrAttachResult as CreateOrAttachResult } from './daemon-create-or-attach-result'
export type GetSnapshotResult = {
  snapshot: TerminalSnapshot | null
}

export type ListSessionsResult = {
  sessions: SessionInfo[]
}

export type ShutdownIfIdleResult = {
  retiring: boolean
}

export type SystemResolverHealth = 'healthy' | 'unhealthy' | 'unknown'

export type SystemResolverHealthResult = {
  health: SystemResolverHealth
}

export type SessionInfo = {
  foregroundProcess?: string
  sessionId: string
  incarnationId?: string
  state: SessionState
  shellState: ShellReadyState
  isAlive: boolean
  terminalHandle?: string
  wslDistro?: string | null
  pid: number | null
  cwd: string | null
  cols: number
  rows: number
  createdAt: number
  agentSessionOwners?: AgentSessionOwnerBinding[]
}

/** Router/adapter metadata for legacy-session labels; never transmitted on the daemon wire. */
export type DaemonSessionInfo = SessionInfo & {
  protocolVersion: number
}

export type * from './daemon-stream-events'

// Fire-and-forget request IDs: the daemon processes these without a response.
export const NOTIFY_PREFIX = 'notify_'

export {
  TerminalAttachCanceledError,
  DaemonConnectionLostError,
  DaemonProtocolError,
  DaemonRequestTimeoutError,
  DAEMON_UNAVAILABLE_RECONNECT_MESSAGE,
  SessionNotFoundError
} from './daemon-errors'
