import { join } from 'node:path'
import { ORCA_SKILLS_REPOSITORY_URL } from '../../shared/agent-feature-install-commands'
import type { ManagedAgentSkillFallbackReason, ManagedAgentSkillName } from '../../shared/skills'

type ManagedSkillLockEntry = {
  source?: unknown
  sourceType?: unknown
  sourceUrl?: unknown
  skillPath?: unknown
  skillFolderHash?: unknown
}

const SUPPORTED_LOCKFILE_SCHEMA_VERSION = 3

export async function readManagedSkillLockEntry(args: {
  homeDir: string
  readTextFile: (path: string) => Promise<string>
  skillName: ManagedAgentSkillName
}): Promise<
  | { ok: true; entry: { skillFolderHash: string } }
  | { ok: false; reason: ManagedAgentSkillFallbackReason }
> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await args.readTextFile(join(args.homeDir, '.agents', '.skill-lock.json')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: 'lockfile-missing' }
    }
    return { ok: false, reason: 'lockfile-malformed' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'lockfile-malformed' }
  }
  const lockfile = parsed as { version?: unknown; skills?: unknown }
  if (lockfile.version !== SUPPORTED_LOCKFILE_SCHEMA_VERSION) {
    return { ok: false, reason: 'lockfile-unsupported-schema' }
  }
  if (!lockfile.skills || typeof lockfile.skills !== 'object') {
    return { ok: false, reason: 'lockfile-malformed' }
  }
  const entry = (lockfile.skills as Record<string, ManagedSkillLockEntry>)[args.skillName]
  if (!entry) {
    return { ok: false, reason: 'lock-entry-missing' }
  }
  if (!isManagedLockEntryForSkill(entry, args.skillName)) {
    return { ok: false, reason: 'lock-entry-unmanaged-source' }
  }
  return { ok: true, entry: { skillFolderHash: entry.skillFolderHash } }
}

function isManagedLockEntryForSkill(
  entry: ManagedSkillLockEntry,
  skillName: ManagedAgentSkillName
): entry is ManagedSkillLockEntry & { skillFolderHash: string } {
  return (
    entry.source === 'stablyai/orca' &&
    entry.sourceType === 'github' &&
    typeof entry.sourceUrl === 'string' &&
    normalizeRepositoryUrl(entry.sourceUrl) ===
      normalizeRepositoryUrl(ORCA_SKILLS_REPOSITORY_URL) &&
    entry.skillPath === `skills/${skillName}/SKILL.md` &&
    typeof entry.skillFolderHash === 'string' &&
    entry.skillFolderHash.length > 0
  )
}

function normalizeRepositoryUrl(value: string): string {
  return value.replace(/\.git$/, '')
}
