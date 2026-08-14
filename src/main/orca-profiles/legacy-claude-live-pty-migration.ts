import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { DEFAULT_LOCAL_ORCA_PROFILE_ID } from '../../shared/orca-profiles'
import { legacyDataFilePath } from './profile-storage-paths'

type ClaudeLivePtyStore = {
  addClaudeLivePtySessionId(sessionId: string): void
  getClaudeLivePtySessionIds(): string[]
  flushOrThrow(): void
}

function readLegacyState(dataFile: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(dataFile, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function validClaudePtyIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return [...new Set(value.filter((id): id is string => typeof id === 'string'))].filter(
    (id) => id.length > 0 && id.length <= 512
  )
}

export function migrateLegacyClaudeLivePtyIds(options: {
  profileId: string
  store: ClaudeLivePtyStore
  userDataPath: string
}): number {
  if (options.profileId !== DEFAULT_LOCAL_ORCA_PROFILE_ID) {
    return 0
  }
  const dataFile = legacyDataFilePath(options.userDataPath)
  const legacyState = readLegacyState(dataFile)
  const legacyIds = validClaudePtyIds(legacyState?.claudeLivePtySessionIds)
  if (!legacyState || legacyIds.length === 0) {
    return 0
  }

  for (const id of legacyIds) {
    options.store.addClaudeLivePtySessionId(id)
  }
  options.store.flushOrThrow()

  const imported = new Set(options.store.getClaudeLivePtySessionIds())
  const remaining = validClaudePtyIds(legacyState.claudeLivePtySessionIds).filter(
    (id) => !imported.has(id)
  )
  legacyState.claudeLivePtySessionIds = remaining
  const temporaryFile = `${dataFile}.claude-live-pty-migration.tmp`
  writeFileSync(temporaryFile, JSON.stringify(legacyState, null, 2), 'utf-8')
  renameSync(temporaryFile, dataFile)
  return legacyIds.length - remaining.length
}
