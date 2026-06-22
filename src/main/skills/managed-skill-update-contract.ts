import {
  buildAgentFeatureSkillInstallCommand,
  buildAgentFeatureSkillUpdateCommand,
  COMPUTER_USE_SKILL_NAME,
  LINEAR_TICKETS_SKILL_NAME,
  ORCA_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
} from '../../shared/agent-feature-install-commands'
import type { ManagedAgentSkillManualCommand, ManagedAgentSkillName } from '../../shared/skills'

export type ExpectedManagedSkillRevision = {
  expectedHash: string
  expectedSourceRef: string
  skillsPackageVersion: string
}

export const EXPECTED_MANAGED_SKILL_REVISIONS: Partial<
  Record<ManagedAgentSkillName, ExpectedManagedSkillRevision>
> = {}

const MANAGED_SKILL_NAMES = new Set<string>([
  COMPUTER_USE_SKILL_NAME,
  LINEAR_TICKETS_SKILL_NAME,
  ORCA_CLI_SKILL_NAME,
  ORCHESTRATION_SKILL_NAME
])

export function isManagedAgentSkillName(value: string): value is ManagedAgentSkillName {
  return MANAGED_SKILL_NAMES.has(value)
}

export function isImmutableSourceRef(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value)
}

export function buildManagedSkillManualCommand(
  kind: ManagedAgentSkillManualCommand['kind'],
  skillName: ManagedAgentSkillName
): ManagedAgentSkillManualCommand {
  return {
    kind,
    runtime: 'host',
    scope: 'global',
    command:
      kind === 'install'
        ? buildAgentFeatureSkillInstallCommand([skillName])
        : buildAgentFeatureSkillUpdateCommand(skillName)
  }
}
