import { join } from 'node:path'
import type { ManagedAgentSkillName, SkillDiscoveryResult } from '../../shared/skills'
import { isDiscoveredManagedSkill } from './managed-skill-discovery-candidate'
import {
  isRelevantManagedProjectCandidate,
  normalizePathForManagedSkillKey
} from './managed-skill-update-cache-key'

type ManagedSkillDiscoveryCandidate = SkillDiscoveryResult['skills'][number]

export type ManagedSkillDiscoverySelection = {
  homeCandidates: ManagedSkillDiscoveryCandidate[]
  allRepoCandidates: ManagedSkillDiscoveryCandidate[]
  repoCandidates: ManagedSkillDiscoveryCandidate[]
  bundledOrPluginCandidates: ManagedSkillDiscoveryCandidate[]
}

export function selectManagedSkillDiscoveryCandidates(args: {
  discovery: SkillDiscoveryResult
  homeDir: string
  projectRootPath?: string | null
  skillName: ManagedAgentSkillName
}): ManagedSkillDiscoverySelection {
  const candidates = args.discovery.skills.filter((skill) =>
    isDiscoveredManagedSkill(skill, args.skillName)
  )
  const allRepoCandidates = candidates.filter((skill) => skill.sourceKind === 'repo')
  return {
    homeCandidates: candidates.filter((skill) => isManagedGlobalHomeCandidate(skill, args.homeDir)),
    allRepoCandidates,
    repoCandidates: allRepoCandidates.filter((skill) =>
      isRelevantManagedProjectCandidate(skill.rootPath, args.projectRootPath)
    ),
    bundledOrPluginCandidates: candidates.filter(
      (skill) => skill.sourceKind === 'bundled' || skill.sourceKind === 'plugin'
    )
  }
}

function isManagedGlobalHomeCandidate(
  skill: ManagedSkillDiscoveryCandidate,
  homeDir: string
): boolean {
  return (
    skill.sourceKind === 'home' &&
    skill.providers.includes('agent-skills') &&
    normalizePathForManagedSkillKey(skill.rootPath) ===
      normalizePathForManagedSkillKey(join(homeDir, '.agents', 'skills'))
  )
}
