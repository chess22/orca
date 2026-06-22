import type {
  ManagedAgentSkillEnsureRequest,
  ManagedAgentSkillFallbackReason,
  ManagedAgentSkillRuntime
} from '../../shared/skills'

export type ResolvedManagedSkillTarget =
  | {
      ok: true
      runtime: Extract<ManagedAgentSkillRuntime, 'host' | 'wsl'>
      distro?: string | null
    }
  | {
      ok: false
      runtime: ManagedAgentSkillRuntime
      distro?: string | null
      reason: ManagedAgentSkillFallbackReason
    }

export function resolveManagedSkillTarget(
  request: ManagedAgentSkillEnsureRequest
): ResolvedManagedSkillTarget {
  if (request.remoteRuntime) {
    return { ok: false, runtime: 'remote', reason: 'remote-runtime' }
  }
  const target = request.discoveryTarget
  if (!target) {
    return { ok: false, runtime: 'unknown', reason: 'target-required' }
  }
  if (target.projectRuntime?.status === 'repair-required') {
    return { ok: false, runtime: 'wsl', reason: 'repair-required-runtime' }
  }
  if (target.projectRuntime?.status === 'resolved') {
    const runtime = target.projectRuntime.runtime
    if (runtime.kind === 'wsl') {
      return { ok: true, runtime: 'wsl', distro: runtime.distro }
    }
    return { ok: true, runtime: 'host' }
  }
  if (target.runtime === 'wsl') {
    return { ok: true, runtime: 'wsl', distro: target.wslDistro ?? null }
  }
  if (target.runtime === 'host') {
    return { ok: true, runtime: 'host' }
  }
  return { ok: false, runtime: 'unknown', reason: 'target-required' }
}
