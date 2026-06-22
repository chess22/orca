import { isAbsolute, normalize, relative, sep } from 'node:path'
import type {
  ManagedAgentSkillEnsureRequest,
  ManagedAgentSkillEnsureResult
} from '../../shared/skills'
import type { ExpectedManagedSkillRevision } from './managed-skill-update-contract'

export function shouldCooldownFallback(result: ManagedAgentSkillEnsureResult): boolean {
  return (
    result.status === 'fallback' &&
    result.reason !== 'cooldown' &&
    result.reason !== 'background-update-disabled'
  )
}

export function makeManagedSkillSuccessCacheKey(args: {
  appVersion: string
  request: ManagedAgentSkillEnsureRequest
  expected: ExpectedManagedSkillRevision | undefined
}): string {
  return [
    args.appVersion,
    'host',
    '',
    'global',
    normalizeManagedSkillKeyPart(args.request.context),
    normalizeManagedSkillKeyPart(args.request.discoveryTarget?.projectRootPath),
    args.request.skillName,
    args.expected?.expectedHash ?? 'missing-expected-hash',
    args.expected?.expectedSourceRef ?? 'missing-source-ref'
  ].join(':')
}

export function normalizeManagedSkillKeyPart(value: string | null | undefined): string {
  return value ? normalizePathForManagedSkillKey(value) : ''
}

export function normalizePathForManagedSkillKey(value: string): string {
  const normalized = normalize(value)
  const stripped = normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
  return process.platform === 'win32' ? stripped.toLowerCase() : stripped
}

export function isRelevantManagedProjectCandidate(
  rootPath: string,
  projectRootPath: string | null | undefined
): boolean {
  if (!projectRootPath) {
    return false
  }
  const rel = relative(projectRootPath, rootPath)
  if (!rel) {
    return true
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
