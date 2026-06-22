import type {
  ManagedAgentSkillManualCommand,
  ManagedAgentSkillName,
  ManagedAgentSkillScope,
  SkillDiscoveryResult
} from '../../shared/skills'
import { selectManagedSkillDiscoveryCandidates } from './managed-skill-discovery-selection'
import { buildManagedSkillManualCommand } from './managed-skill-update-contract'

type ManagedSkillGlobalCandidate = SkillDiscoveryResult['skills'][number]

type ManagedSkillCandidateFallback = {
  reason:
    | 'ambiguous-install'
    | 'bundled-or-plugin-install'
    | 'missing-install'
    | 'project-install'
    | 'symlinked-global-install'
  scope: ManagedAgentSkillScope
  manualCommand?: ManagedAgentSkillManualCommand
}

export type ManagedSkillGlobalCandidateDecision =
  | { status: 'candidate'; candidate: ManagedSkillGlobalCandidate }
  | { status: 'fallback'; fallback: ManagedSkillCandidateFallback }

export function selectSingleGlobalManagedSkillCandidate(args: {
  discovery: SkillDiscoveryResult
  homeDir: string
  projectRootPath?: string | null
  skillName: ManagedAgentSkillName
}): ManagedSkillGlobalCandidateDecision {
  const { homeCandidates, allRepoCandidates, repoCandidates, bundledOrPluginCandidates } =
    selectManagedSkillDiscoveryCandidates(args)

  if (
    homeCandidates.length === 0 &&
    allRepoCandidates.length === 0 &&
    bundledOrPluginCandidates.length === 0
  ) {
    return {
      status: 'fallback',
      fallback: {
        reason: 'missing-install',
        scope: 'missing',
        manualCommand: buildManagedSkillManualCommand('install', args.skillName)
      }
    }
  }
  if (repoCandidates.length > 0 && homeCandidates.length > 0) {
    return {
      status: 'fallback',
      fallback: { reason: 'ambiguous-install', scope: 'project' }
    }
  }
  if (!args.projectRootPath && allRepoCandidates.length > 0) {
    return {
      status: 'fallback',
      fallback: {
        reason: homeCandidates.length > 0 ? 'ambiguous-install' : 'project-install',
        scope: 'project'
      }
    }
  }
  if (repoCandidates.length > 0) {
    return {
      status: 'fallback',
      fallback: { reason: 'project-install', scope: 'project' }
    }
  }
  if (bundledOrPluginCandidates.length > 0 || homeCandidates.length !== 1) {
    return {
      status: 'fallback',
      fallback: {
        reason: 'bundled-or-plugin-install',
        scope:
          bundledOrPluginCandidates[0]?.sourceKind === 'plugin'
            ? 'plugin'
            : bundledOrPluginCandidates[0]?.sourceKind === 'bundled'
              ? 'bundled'
              : 'global'
      }
    }
  }

  const candidate = homeCandidates[0]
  if (candidate.directoryIsSymlink || candidate.skillFileIsSymlink) {
    return {
      status: 'fallback',
      fallback: { reason: 'symlinked-global-install', scope: 'global' }
    }
  }
  return { status: 'candidate', candidate }
}
