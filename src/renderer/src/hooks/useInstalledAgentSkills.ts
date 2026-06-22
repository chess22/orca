import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoveryTarget,
  SkillSourceKind
} from '../../../shared/skills'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import { markOrchestrationSetupComplete } from '@/lib/orchestration-setup-state'
import {
  clearInstalledAgentSkillDiscoveryCache,
  discoverInstalledAgentSkills,
  getCachedInstalledAgentSkillDiscovery,
  getSkillDiscoveryTargetKey,
  resetInstalledAgentSkillDiscoveryForTests
} from './installed-agent-skill-discovery'
import { useMountedRef } from './useMountedRef'

const INSTALLED_AGENT_SKILLS_CHANGED_EVENT = 'orca:installed-agent-skills-changed'
export const GLOBAL_AGENT_SKILL_SOURCE_KINDS = [
  'home'
] as const satisfies readonly SkillSourceKind[]

type InstalledAgentSkillOptions = {
  enabled?: boolean
  discoveryTarget?: SkillDiscoveryTarget
  projectRootPath?: string | null
  sourceKinds?: readonly SkillSourceKind[]
}

type InstalledAgentSkillMatchOptions = {
  projectRootPath?: string | null
  sourceKinds?: readonly SkillSourceKind[]
}

export type InstalledAgentSkillState = {
  installed: boolean
  loading: boolean
  error: string | null
  skills: readonly DiscoveredSkill[]
  refresh: () => Promise<boolean>
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}

function isOrchestrationSkillName(skillName: string): boolean {
  return normalizeSkillName(skillName) === ORCHESTRATION_SKILL_NAME
}

function basenameFromPath(pathValue: string): string {
  return pathValue.split(/[\\/]/).filter(Boolean).at(-1) ?? pathValue
}

export function hasInstalledAgentSkill(
  skills: readonly DiscoveredSkill[],
  skillName: string,
  options: InstalledAgentSkillMatchOptions = {}
): boolean {
  const expected = normalizeSkillName(skillName)
  return skills.some((skill) => {
    if (!skill.installed) {
      return false
    }
    if (options.sourceKinds && !options.sourceKinds.includes(skill.sourceKind)) {
      return false
    }
    if (
      options.projectRootPath &&
      skill.sourceKind === 'repo' &&
      !isPathInsideOrEqual(options.projectRootPath, skill.rootPath)
    ) {
      return false
    }
    return (
      normalizeSkillName(skill.name) === expected ||
      normalizeSkillName(basenameFromPath(skill.directoryPath)) === expected
    )
  })
}

export function notifyInstalledAgentSkillsChanged(): void {
  clearInstalledAgentSkillDiscoveryCache()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INSTALLED_AGENT_SKILLS_CHANGED_EVENT))
  }
}

export const _installedAgentSkillDiscoveryInternalsForTests = {
  discoverInstalledAgentSkills,
  getSkillDiscoveryTargetKey,
  isOrchestrationSkillName,
  reset: resetInstalledAgentSkillDiscoveryForTests
}

export function useInstalledAgentSkill(
  skillName: string,
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  const {
    enabled = true,
    discoveryTarget,
    projectRootPath = discoveryTarget?.projectRootPath,
    sourceKinds
  } = options
  const discoveryTargetKey = getSkillDiscoveryTargetKey(discoveryTarget)
  const cachedDiscovery = getCachedInstalledAgentSkillDiscovery(discoveryTarget)
  const [result, setResult] = useState<SkillDiscoveryResult | null>(cachedDiscovery)
  const [loading, setLoading] = useState(enabled && !cachedDiscovery)
  const [error, setError] = useState<string | null>(null)
  const currentDiscoveryTargetKeyRef = useRef(discoveryTargetKey)
  const refreshGenerationRef = useRef(0)
  const stateResetInputRef = useRef({ discoveryTargetKey, enabled })
  currentDiscoveryTargetKeyRef.current = discoveryTargetKey
  // Why: skill scans can outlive transient settings/onboarding panels; keep
  // the module cache update but skip React state writes after unmount.
  const mountedRef = useMountedRef()
  let resultForRender = result
  let loadingForRender = loading
  let errorForRender = error
  if (
    stateResetInputRef.current.discoveryTargetKey !== discoveryTargetKey ||
    stateResetInputRef.current.enabled !== enabled
  ) {
    const nextCachedDiscovery = getCachedInstalledAgentSkillDiscovery(discoveryTarget)
    const nextLoading = enabled && !nextCachedDiscovery
    stateResetInputRef.current = { discoveryTargetKey, enabled }
    resultForRender = nextCachedDiscovery
    loadingForRender = nextLoading
    errorForRender = null
    setResult(nextCachedDiscovery)
    setLoading(nextLoading)
    setError(null)
  }

  const refresh = useCallback(
    async (force = true): Promise<boolean> => {
      const requestDiscoveryTargetKey = discoveryTargetKey
      const requestGeneration = ++refreshGenerationRef.current
      const writeIfCurrent = (write: () => void): void => {
        if (
          mountedRef.current &&
          requestGeneration === refreshGenerationRef.current &&
          currentDiscoveryTargetKeyRef.current === requestDiscoveryTargetKey
        ) {
          write()
        }
      }

      if (!enabled) {
        writeIfCurrent(() => {
          setLoading(false)
        })
        return false
      }
      writeIfCurrent(() => {
        setLoading(true)
      })
      let installedAfterRefresh = false
      try {
        const next = await discoverInstalledAgentSkills(force, discoveryTarget)
        installedAfterRefresh = hasInstalledAgentSkill(next.skills, skillName, {
          projectRootPath,
          sourceKinds
        })
        writeIfCurrent(() => {
          setResult(next)
          setError(null)
        })
      } catch (refreshError) {
        writeIfCurrent(() => {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : 'Could not scan installed skills.'
          )
        })
      } finally {
        writeIfCurrent(() => {
          setLoading(false)
        })
      }
      return installedAfterRefresh
    },
    [
      discoveryTarget,
      discoveryTargetKey,
      enabled,
      mountedRef,
      projectRootPath,
      skillName,
      sourceKinds
    ]
  )

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const refreshFromExternalChange = (): void => {
      void refresh(true)
    }
    // Why: skill install commands run outside React state, often in a terminal.
    // Refresh on focus and explicit install events so completion is detected.
    window.addEventListener('focus', refreshFromExternalChange)
    window.addEventListener(INSTALLED_AGENT_SKILLS_CHANGED_EVENT, refreshFromExternalChange)
    return () => {
      window.removeEventListener('focus', refreshFromExternalChange)
      window.removeEventListener(INSTALLED_AGENT_SKILLS_CHANGED_EVENT, refreshFromExternalChange)
    }
  }, [enabled, refresh])

  const skills = useMemo(
    () => (enabled && resultForRender ? resultForRender.skills : []),
    [enabled, resultForRender]
  )

  const installed = useMemo(
    () =>
      enabled ? hasInstalledAgentSkill(skills, skillName, { projectRootPath, sourceKinds }) : false,
    [enabled, projectRootPath, skills, skillName, sourceKinds]
  )

  useEffect(() => {
    if (installed && isOrchestrationSkillName(skillName)) {
      // Why: older floating-workspace education still keys off this marker; any
      // surface that detects the orchestration skill should satisfy setup.
      markOrchestrationSetupComplete()
    }
  }, [installed, skillName])

  const forceRefresh = useCallback(() => refresh(true), [refresh])

  return {
    installed,
    loading: loadingForRender,
    error: errorForRender,
    skills,
    refresh: forceRefresh
  }
}
