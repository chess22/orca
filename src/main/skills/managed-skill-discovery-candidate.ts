import { basename } from 'node:path'
import type { DiscoveredSkill, ManagedAgentSkillName } from '../../shared/skills'

export function isDiscoveredManagedSkill(
  skill: DiscoveredSkill,
  skillName: ManagedAgentSkillName
): boolean {
  const expected = normalizeSkillName(skillName)
  return (
    normalizeSkillName(skill.name) === expected ||
    normalizeSkillName(basename(skill.directoryPath)) === expected
  )
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}
