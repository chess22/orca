import { DaemonPtyAdapter } from '../../../daemon/daemon-pty-adapter'
import { DaemonPtyRouter } from '../../../daemon/daemon-pty-router'
import { DegradedDaemonPtyProvider } from '../../../daemon/degraded-daemon-pty-provider'
import { getAllDaemonAdapters } from '../../../daemon/daemon-provider-routing'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import type { IPtyProvider } from '../../../providers/pty-provider-contract'

export type TerminalProviderKind = 'daemon-backed' | 'in-process' | 'unknown'

export function terminalProviderKind(provider: IPtyProvider, ptyId: string): TerminalProviderKind {
  if (provider instanceof DegradedDaemonPtyProvider) {
    const fallbackOwns = provider.fallback.hasPty?.(ptyId) === true
    const daemonOwns = getAllDaemonAdapters(provider).some((adapter) => adapter.hasPty(ptyId))
    return fallbackOwns === daemonOwns ? 'unknown' : fallbackOwns ? 'in-process' : 'daemon-backed'
  }
  if (provider instanceof DaemonPtyAdapter || provider instanceof DaemonPtyRouter) {
    return provider.hasPty(ptyId) ? 'daemon-backed' : 'unknown'
  }
  if (provider instanceof LocalPtyProvider) {
    return provider.hasPty(ptyId) ? 'in-process' : 'unknown'
  }
  return 'unknown'
}
