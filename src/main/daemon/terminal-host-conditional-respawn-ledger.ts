import type { TerminalConditionalRespawnResult } from '../../shared/terminal-conditional-respawn'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'

export type ConditionalRespawnFingerprintIdentity = InternalCreateOrAttachOptions & {
  expectedIncarnationId: string
  expectedRootProcessId: number
}

export type TerminalConditionalRespawnLedgerEntry = {
  fingerprint: string
  promise: Promise<TerminalConditionalRespawnResult>
  identity: {
    sessionId: string
    expectedIncarnationId: string
    expectedRootProcessId: number
    command: string | undefined
    cwd: string | undefined
    cols: number
    rows: number
    clientId: string | null
    env: Record<string, string> | undefined
    envToDelete: string[] | undefined
  }
}

export type TerminalConditionalRespawnLedger = Map<string, TerminalConditionalRespawnLedgerEntry>

export function conditionalRespawnFingerprint(opts: ConditionalRespawnFingerprintIdentity): string {
  return JSON.stringify([
    opts.spawnAdmission?.clientId ?? null,
    opts.sessionId,
    opts.expectedIncarnationId,
    opts.expectedRootProcessId,
    opts.cols,
    opts.rows,
    opts.cwd ?? null,
    opts.command ?? null,
    opts.env ? Object.entries(opts.env).sort(([left], [right]) => left.localeCompare(right)) : null,
    opts.envToDelete ? [...opts.envToDelete].sort() : null
  ])
}
