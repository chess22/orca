import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type {
  ManagedAgentSkillEnsureRequest,
  ManagedAgentSkillEnsureResult,
  ManagedAgentSkillName,
  SkillDiscoveryResult
} from '../../shared/skills'
import type { Store } from '../persistence'
import { discoverSkills } from './discovery'
import {
  buildManagedSkillFallback,
  buildManagedSkillReadyResult
} from './managed-skill-ensure-result'
import { selectSingleGlobalManagedSkillCandidate } from './managed-skill-global-candidate'
import { readManagedSkillLockEntry } from './managed-skill-lockfile'
import {
  makeManagedSkillSuccessCacheKey,
  normalizeManagedSkillKeyPart,
  shouldCooldownFallback
} from './managed-skill-update-cache-key'
import {
  buildManagedSkillManualCommand,
  EXPECTED_MANAGED_SKILL_REVISIONS,
  isImmutableSourceRef,
  isManagedAgentSkillName,
  type ExpectedManagedSkillRevision
} from './managed-skill-update-contract'
import { resolveManagedSkillTarget, type ResolvedManagedSkillTarget } from './managed-skill-target'

type ManagedSkillCoordinatorDeps = {
  appVersion?: string
  backgroundUpdatesEnabled?: () => boolean
  cooldownMs?: number
  discoverHostSkills?: (projectRootPath?: string | null) => Promise<SkillDiscoveryResult>
  homeDir?: () => string
  now?: () => number
  readTextFile?: (path: string) => Promise<string>
  expectedRevisions?: Partial<Record<ManagedAgentSkillName, ExpectedManagedSkillRevision>>
}

const DEFAULT_COOLDOWN_MS = 60_000

const coordinatorByStore = new WeakMap<Store, ManagedSkillUpdateCoordinator>()

export function getManagedSkillUpdateCoordinator(store: Store): ManagedSkillUpdateCoordinator {
  const existing = coordinatorByStore.get(store)
  if (existing) {
    return existing
  }
  const coordinator = new ManagedSkillUpdateCoordinator({
    appVersion: process.env.npm_package_version,
    backgroundUpdatesEnabled: () =>
      store.getSettings().managedAgentSkillBackgroundUpdatesEnabled !== false,
    discoverHostSkills: (projectRootPath) =>
      discoverSkills({
        repos: store.getRepos(),
        ...(projectRootPath ? { cwd: projectRootPath } : {})
      })
  })
  coordinatorByStore.set(store, coordinator)
  return coordinator
}

export class ManagedSkillUpdateCoordinator {
  private readonly appVersion: string
  private readonly backgroundUpdatesEnabled: () => boolean
  private readonly cooldownMs: number
  private readonly discoverHostSkills: (
    projectRootPath?: string | null
  ) => Promise<SkillDiscoveryResult>
  private readonly homeDir: () => string
  private readonly now: () => number
  private readonly readTextFile: (path: string) => Promise<string>
  private readonly expectedRevisions: Partial<
    Record<ManagedAgentSkillName, ExpectedManagedSkillRevision>
  >
  private readonly inFlightByPreDiscoveryKey = new Map<
    string,
    Promise<ManagedAgentSkillEnsureResult>
  >()
  private readonly cooldownUntilByKey = new Map<string, number>()
  private readonly successCache = new Set<string>()

  constructor(deps: ManagedSkillCoordinatorDeps = {}) {
    this.appVersion = deps.appVersion ?? 'unknown'
    this.backgroundUpdatesEnabled = deps.backgroundUpdatesEnabled ?? (() => true)
    this.cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS
    this.discoverHostSkills = deps.discoverHostSkills ?? (() => discoverSkills({ repos: [] }))
    this.homeDir = deps.homeDir ?? homedir
    this.now = deps.now ?? Date.now
    this.readTextFile = deps.readTextFile ?? readFileUtf8
    this.expectedRevisions = deps.expectedRevisions ?? EXPECTED_MANAGED_SKILL_REVISIONS
  }

  ensureManagedReady(
    request: ManagedAgentSkillEnsureRequest
  ): Promise<ManagedAgentSkillEnsureResult> {
    if (!isManagedAgentSkillName(request.skillName)) {
      return Promise.resolve(
        buildManagedSkillFallback({
          request,
          reason: 'unsupported-skill',
          runtime: 'unknown',
          scope: 'missing'
        })
      )
    }

    const target = resolveManagedSkillTarget(request)
    if (!target.ok) {
      const targetFallbackKey = [
        this.appVersion,
        target.runtime,
        target.distro ?? '',
        'target-fallback',
        normalizeManagedSkillKeyPart(request.context),
        normalizeManagedSkillKeyPart(request.discoveryTarget?.projectRootPath),
        request.skillName,
        target.reason
      ].join(':')
      const cooldownUntil = this.cooldownUntilByKey.get(targetFallbackKey)
      if (!request.force && cooldownUntil && cooldownUntil > this.now()) {
        return Promise.resolve(
          buildManagedSkillFallback({
            request,
            reason: 'cooldown',
            runtime: target.runtime,
            distro: target.distro,
            scope: 'missing'
          })
        )
      }
      this.cooldownUntilByKey.set(targetFallbackKey, this.now() + this.cooldownMs)
      return Promise.resolve(
        buildManagedSkillFallback({
          request,
          reason: target.reason,
          runtime: target.runtime,
          distro: target.distro,
          scope: 'missing'
        })
      )
    }

    const expected = this.expectedRevisions[request.skillName]
    const successLookupKey = makeManagedSkillSuccessCacheKey({
      appVersion: this.appVersion,
      request,
      expected
    })
    if (target.runtime === 'host' && this.successCache.has(successLookupKey)) {
      return Promise.resolve(buildManagedSkillReadyResult(request))
    }

    const preDiscoveryKey = [
      this.appVersion,
      target.runtime,
      target.distro ?? '',
      'pre-discovery',
      this.backgroundUpdatesEnabled() ? 'background-updates-on' : 'background-updates-off',
      normalizeManagedSkillKeyPart(request.context),
      normalizeManagedSkillKeyPart(request.discoveryTarget?.projectRootPath),
      request.skillName,
      expected?.expectedHash ?? 'missing-expected-hash',
      expected?.expectedSourceRef ?? 'missing-source-ref'
    ].join(':')
    const existing = this.inFlightByPreDiscoveryKey.get(preDiscoveryKey)
    if (existing) {
      return existing
    }
    const preDiscoveryCooldownUntil = this.cooldownUntilByKey.get(preDiscoveryKey)
    if (!request.force && preDiscoveryCooldownUntil && preDiscoveryCooldownUntil > this.now()) {
      return Promise.resolve(
        buildManagedSkillFallback({
          request,
          reason: 'cooldown',
          runtime: target.runtime,
          distro: target.distro,
          scope: 'missing'
        })
      )
    }

    const promise = this.evaluate(request, target, expected)
      .then((result) => {
        if (shouldCooldownFallback(result)) {
          this.cooldownUntilByKey.set(preDiscoveryKey, this.now() + this.cooldownMs)
        }
        return result
      })
      .finally(() => {
        if (this.inFlightByPreDiscoveryKey.get(preDiscoveryKey) === promise) {
          this.inFlightByPreDiscoveryKey.delete(preDiscoveryKey)
        }
      })
    this.inFlightByPreDiscoveryKey.set(preDiscoveryKey, promise)
    return promise
  }

  private async evaluate(
    request: ManagedAgentSkillEnsureRequest,
    target: Extract<ResolvedManagedSkillTarget, { ok: true }>,
    expected: ExpectedManagedSkillRevision | undefined
  ): Promise<ManagedAgentSkillEnsureResult> {
    if (target.runtime === 'wsl') {
      return buildManagedSkillFallback({
        request,
        reason: 'wsl-runtime',
        runtime: 'wsl',
        distro: target.distro,
        scope: 'missing'
      })
    }

    const discovery = await this.discoverHostSkills(request.discoveryTarget?.projectRootPath)
    const globalCandidateDecision = selectSingleGlobalManagedSkillCandidate({
      discovery,
      homeDir: this.homeDir(),
      projectRootPath: request.discoveryTarget?.projectRootPath,
      skillName: request.skillName
    })
    if (globalCandidateDecision.status === 'fallback') {
      return buildManagedSkillFallback({
        request,
        reason: globalCandidateDecision.fallback.reason,
        runtime: 'host',
        scope: globalCandidateDecision.fallback.scope,
        manualCommand: globalCandidateDecision.fallback.manualCommand
      })
    }
    if (!expected) {
      // Why: without a pinned/hash manifest, V1 cannot prove staleness or offer a
      // real update path, so installed global managed skills should not prompt.
      const cacheKey = makeManagedSkillSuccessCacheKey({
        appVersion: this.appVersion,
        request,
        expected
      })
      this.successCache.add(cacheKey)
      return buildManagedSkillReadyResult(request)
    }
    if (!isImmutableSourceRef(expected.expectedSourceRef)) {
      return buildManagedSkillFallback({
        request,
        reason: 'unsupported-cli-contract',
        runtime: 'host',
        scope: 'global'
      })
    }

    const cacheKey = makeManagedSkillSuccessCacheKey({
      appVersion: this.appVersion,
      request,
      expected
    })
    if (this.successCache.has(cacheKey)) {
      return buildManagedSkillReadyResult(request)
    }

    const backgroundUpdatesEnabled = this.backgroundUpdatesEnabled()
    const cooldownUntil = this.cooldownUntilByKey.get(cacheKey)
    if (backgroundUpdatesEnabled && !request.force && cooldownUntil && cooldownUntil > this.now()) {
      return buildManagedSkillFallback({
        request,
        reason: 'cooldown',
        runtime: 'host',
        scope: 'global'
      })
    }

    const lockEntryResult = await readManagedSkillLockEntry({
      homeDir: this.homeDir(),
      readTextFile: this.readTextFile,
      skillName: request.skillName
    })
    if (!lockEntryResult.ok) {
      return buildManagedSkillFallback({
        request,
        reason: lockEntryResult.reason,
        runtime: 'host',
        scope: 'global'
      })
    }
    if (lockEntryResult.entry.skillFolderHash === expected.expectedHash) {
      this.successCache.add(cacheKey)
      return buildManagedSkillReadyResult(request)
    }
    if (!backgroundUpdatesEnabled) {
      return buildManagedSkillFallback({
        request,
        reason: 'background-update-disabled',
        runtime: 'host',
        scope: 'global',
        manualCommand: buildManagedSkillManualCommand('update', request.skillName)
      })
    }

    // Why: this tree does not ship the verified CLI hash/ref update contract
    // yet, so stale installs must fall back instead of running blind `npx`.
    this.cooldownUntilByKey.set(cacheKey, this.now() + this.cooldownMs)
    return buildManagedSkillFallback({
      request,
      reason: 'unsupported-cli-contract',
      runtime: 'host',
      scope: 'global'
    })
  }
}

function readFileUtf8(path: string): Promise<string> {
  return readFile(path, 'utf8')
}
