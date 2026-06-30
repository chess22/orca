import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoveryTarget,
  SkillSourceKind
} from '../../../shared/skills'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import { markOrchestrationSetupComplete } from '@/lib/orchestration-setup-state'
import { hasInstalledAgentSkillNamed, normalizeSkillName } from './installed-agent-skill-matching'
import { useMountedRef } from './useMountedRef'

export {
  hasInstalledAgentSkill,
  hasInstalledAgentSkillNamed
} from './installed-agent-skill-matching'

export const GLOBAL_AGENT_SKILL_SOURCE_KINDS = [
  'home'
] as const satisfies readonly SkillSourceKind[]

type InstalledAgentSkillOptions = {
  enabled?: boolean
  discoveryTarget?: SkillDiscoveryTarget
  sourceKinds?: readonly SkillSourceKind[]
}

let cachedDiscoveryByTarget = new Map<string, SkillDiscoveryResult>()
let pendingDiscoveryByTarget = new Map<string, Promise<SkillDiscoveryResult>>()
let pendingDiscoverySatisfiesForcedRefreshByTarget = new Map<string, boolean>()
let discoveryCacheListeners = new Set<(key: string, result: SkillDiscoveryResult) => void>()
let discoveryFailureListeners = new Set<(key: string, error: unknown) => void>()
let suppressedDiscoveryPromises = new WeakSet<Promise<SkillDiscoveryResult>>()
let suppressedDiscoveryResults = new WeakSet<SkillDiscoveryResult>()

function isOrchestrationSkillName(skillName: string): boolean {
  return normalizeSkillName(skillName) === ORCHESTRATION_SKILL_NAME
}

function getSkillDiscoveryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not scan installed skills.'
}

export type InstalledAgentSkillState = {
  installed: boolean
  loading: boolean
  error: string | null
  skills: readonly DiscoveredSkill[]
  refresh: () => Promise<boolean>
}

function normalizeSkillDiscoveryTarget(
  target: SkillDiscoveryTarget | undefined
): SkillDiscoveryTarget | undefined {
  const projectRuntime = target?.projectRuntime
  if (projectRuntime) {
    if (projectRuntime.status === 'repair-required') {
      return { projectRuntime }
    }
    if (projectRuntime.runtime.kind === 'wsl') {
      return {
        runtime: 'wsl',
        wslDistro: projectRuntime.runtime.distro,
        projectRuntime
      }
    }
    return {
      runtime: 'host',
      projectRuntime
    }
  }

  if (target?.runtime !== 'wsl') {
    return undefined
  }
  return { runtime: 'wsl', wslDistro: target.wslDistro?.trim() || null }
}

function getSkillDiscoveryTargetKey(target: SkillDiscoveryTarget | undefined): string {
  if (target?.projectRuntime) {
    return target.projectRuntime.status === 'resolved'
      ? target.projectRuntime.runtime.cacheKey
      : target.projectRuntime.repair.cacheKey
  }
  const normalizedTarget = normalizeSkillDiscoveryTarget(target)
  return normalizedTarget?.runtime === 'wsl' ? `wsl:${normalizedTarget.wslDistro ?? ''}` : 'host'
}

function startInstalledAgentSkillDiscovery(
  force: boolean,
  target: SkillDiscoveryTarget | undefined
): Promise<SkillDiscoveryResult> {
  const key = getSkillDiscoveryTargetKey(target)
  const normalizedTarget = normalizeSkillDiscoveryTarget(target)
  const discovery = window.api.skills
    .discover(normalizedTarget)
    .then((result) => {
      cachedDiscoveryByTarget.set(key, result)
      if (suppressedDiscoveryPromises.has(discovery)) {
        suppressedDiscoveryResults.add(result)
        return result
      }
      for (const listener of discoveryCacheListeners) {
        listener(key, result)
      }
      return result
    })
    .catch((error) => {
      if (!suppressedDiscoveryPromises.has(discovery)) {
        for (const listener of discoveryFailureListeners) {
          listener(key, error)
        }
      }
      throw error
    })
    .finally(() => {
      if (pendingDiscoveryByTarget.get(key) === discovery) {
        pendingDiscoveryByTarget.delete(key)
        pendingDiscoverySatisfiesForcedRefreshByTarget.delete(key)
      }
    })
  pendingDiscoveryByTarget.set(key, discovery)
  pendingDiscoverySatisfiesForcedRefreshByTarget.set(key, force)
  return discovery
}

async function discoverInstalledAgentSkills(
  force: boolean,
  target?: SkillDiscoveryTarget,
  readAfterPending = false
): Promise<SkillDiscoveryResult> {
  const key = getSkillDiscoveryTargetKey(target)
  const cachedDiscovery = cachedDiscoveryByTarget.get(key)
  if (!force && cachedDiscovery) {
    return cachedDiscovery
  }

  const inFlightDiscovery = pendingDiscoveryByTarget.get(key)
  if (inFlightDiscovery) {
    if (!force || (!readAfterPending && pendingDiscoverySatisfiesForcedRefreshByTarget.get(key))) {
      return inFlightDiscovery
    }
    suppressedDiscoveryPromises.add(inFlightDiscovery)
    try {
      await inFlightDiscovery
    } catch {
      // Why: an explicit re-check should still read current disk state even if
      // the older background scan failed.
    }
    const nextPendingDiscovery = pendingDiscoveryByTarget.get(key)
    if (nextPendingDiscovery && nextPendingDiscovery !== inFlightDiscovery) {
      return nextPendingDiscovery
    }
  }

  return startInstalledAgentSkillDiscovery(force, target)
}

export const _installedAgentSkillDiscoveryInternalsForTests = {
  discoverInstalledAgentSkills,
  getSkillDiscoveryTargetKey,
  isOrchestrationSkillName,
  reset(): void {
    cachedDiscoveryByTarget = new Map()
    pendingDiscoveryByTarget = new Map()
    pendingDiscoverySatisfiesForcedRefreshByTarget = new Map()
    discoveryCacheListeners = new Set()
    discoveryFailureListeners = new Set()
    suppressedDiscoveryPromises = new WeakSet()
    suppressedDiscoveryResults = new WeakSet()
  }
}

export function useInstalledAgentSkill(
  skillName: string,
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  return useInstalledAgentSkillNames([skillName], options)
}

export function useInstalledAgentSkillNames(
  skillNames: readonly string[],
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  const { enabled = true, discoveryTarget, sourceKinds } = options
  const skillNamesKey = skillNames.map(normalizeSkillName).join('\n')
  const candidateSkillNames = useMemo(() => skillNamesKey.split('\n'), [skillNamesKey])
  const discoveryTargetKey = getSkillDiscoveryTargetKey(discoveryTarget)
  const cachedDiscovery = cachedDiscoveryByTarget.get(discoveryTargetKey) ?? null
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
    const nextCachedDiscovery = cachedDiscoveryByTarget.get(discoveryTargetKey) ?? null
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
    async (force = true, readAfterPending = false): Promise<boolean> => {
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
      let suppressedResult = false
      try {
        const next = await discoverInstalledAgentSkills(force, discoveryTarget, readAfterPending)
        if (suppressedDiscoveryResults.has(next)) {
          suppressedResult = true
          return false
        }
        installedAfterRefresh = hasInstalledAgentSkillNamed(next.skills, candidateSkillNames, {
          sourceKinds
        })
        writeIfCurrent(() => {
          setResult(next)
          setError(null)
        })
      } catch (refreshError) {
        writeIfCurrent(() => {
          setError(getSkillDiscoveryErrorMessage(refreshError))
        })
      } finally {
        if (!suppressedResult) {
          writeIfCurrent(() => {
            setLoading(false)
          })
        }
      }
      return installedAfterRefresh
    },
    [candidateSkillNames, discoveryTarget, discoveryTargetKey, enabled, mountedRef, sourceKinds]
  )

  useEffect(() => {
    // Why: explicit product surfaces should read current disk state, not a session-old cache.
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    if (!enabled) {
      return
    }
    // Why: explicit refreshes can be initiated by a sibling setup panel while
    // setup-guide progress or settings nav badges are mounted elsewhere.
    const listener = (key: string, next: SkillDiscoveryResult): void => {
      if (!mountedRef.current || key !== currentDiscoveryTargetKeyRef.current) {
        return
      }
      setResult(next)
      setError(null)
      setLoading(false)
    }
    discoveryCacheListeners.add(listener)
    const failureListener = (key: string, refreshError: unknown): void => {
      if (!mountedRef.current || key !== currentDiscoveryTargetKeyRef.current) {
        return
      }
      setError(getSkillDiscoveryErrorMessage(refreshError))
      setLoading(false)
    }
    discoveryFailureListeners.add(failureListener)
    return () => {
      discoveryCacheListeners.delete(listener)
      discoveryFailureListeners.delete(failureListener)
    }
  }, [enabled, mountedRef])

  const skills = useMemo(
    () => (enabled && resultForRender ? resultForRender.skills : []),
    [enabled, resultForRender]
  )

  const installed = useMemo(
    () =>
      enabled ? hasInstalledAgentSkillNamed(skills, candidateSkillNames, { sourceKinds }) : false,
    [candidateSkillNames, enabled, skills, sourceKinds]
  )

  useEffect(() => {
    if (installed && candidateSkillNames.some(isOrchestrationSkillName)) {
      // Why: older floating-workspace education still keys off this marker; any
      // surface that detects the orchestration skill should satisfy setup.
      markOrchestrationSetupComplete()
    }
  }, [candidateSkillNames, installed])

  const forceRefresh = useCallback(() => refresh(true, true), [refresh])

  return {
    installed,
    loading: loadingForRender,
    error: errorForRender,
    skills,
    refresh: forceRefresh
  }
}
