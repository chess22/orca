import {
  COMPUTER_USE_SKILL_NAME,
  ORCA_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from '../../../shared/agent-feature-install-commands'
import type { FeatureInteractionId } from '../../../shared/feature-interactions'
import type {
  ManagedAgentSkillContext,
  ManagedAgentSkillName,
  SkillDiscoveryTarget
} from '../../../shared/skills'

export type RuntimeManagedSkillNudge = {
  skillName: ManagedAgentSkillName
  context: ManagedAgentSkillContext
  remoteRuntime?: boolean
  discoveryTarget?: SkillDiscoveryTarget
}

export type RuntimeManagedSkillNudgeHandler = (
  args: RuntimeManagedSkillNudge
) => void | Promise<void>

export function getManagedSkillNudgeForFeatureInteraction(
  id: FeatureInteractionId
): RuntimeManagedSkillNudge | null {
  if (id === 'agent-orchestration') {
    return { skillName: ORCHESTRATION_SKILL_NAME, context: 'agent-orchestration' }
  }
  if (id === 'computer-use') {
    return { skillName: COMPUTER_USE_SKILL_NAME, context: 'agent-computer-use' }
  }
  if (id === 'agent-browser-use') {
    return { skillName: ORCA_CLI_SKILL_NAME, context: 'agent-orca-cli' }
  }
  return null
}
