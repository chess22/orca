import type {
  ManagedAgentSkillEnsureRequest,
  ManagedAgentSkillEnsureResult,
  ManagedAgentSkillFallback,
  ManagedAgentSkillFallbackReason,
  ManagedAgentSkillManualCommand,
  ManagedAgentSkillRuntime,
  ManagedAgentSkillScope
} from '../../shared/skills'
import { getManagedSkillFallbackMessage } from './managed-skill-fallback-message'

export function buildManagedSkillReadyResult(
  request: ManagedAgentSkillEnsureRequest
): ManagedAgentSkillEnsureResult {
  return {
    status: 'ready',
    skillName: request.skillName,
    context: request.context,
    runtime: 'host',
    scope: 'global'
  }
}

export function buildManagedSkillFallback(args: {
  request: ManagedAgentSkillEnsureRequest
  reason: ManagedAgentSkillFallbackReason
  runtime: ManagedAgentSkillRuntime
  distro?: string | null
  scope: ManagedAgentSkillScope
  manualCommand?: ManagedAgentSkillManualCommand
}): ManagedAgentSkillFallback {
  return {
    status: 'fallback',
    skillName: args.request.skillName,
    context: args.request.context,
    runtime: args.runtime,
    distro: args.distro,
    scope: args.scope,
    reason: args.reason,
    uiKey: [
      args.runtime,
      args.distro ?? '',
      args.request.skillName,
      args.request.context,
      args.request.discoveryTarget?.projectRootPath ?? ''
    ].join(':'),
    message: getManagedSkillFallbackMessage(args.reason),
    manualCommand: args.manualCommand,
    request: args.request
  }
}
