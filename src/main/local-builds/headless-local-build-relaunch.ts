import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const MARKER_NAME = 'headless-local-build-relaunch.json'
const MAX_AGE_MS = 15 * 60_000

const MARKER_FORMAT_VERSION = 1

type RelaunchMarker = { formatVersion: number; version: string; createdAt: number }

export function stageHeadlessLocalBuildRelaunch(userDataPath: string, version: string): void {
  if (!version) {
    throw new Error('Cannot stage a background relaunch without a target version.')
  }
  const path = join(userDataPath, MARKER_NAME)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(
    temporary,
    JSON.stringify({ formatVersion: MARKER_FORMAT_VERSION, version, createdAt: Date.now() }),
    {
      encoding: 'utf8',
      mode: 0o600
    }
  )
  renameSync(temporary, path)
}

export function clearHeadlessLocalBuildRelaunch(userDataPath: string): void {
  rmSync(join(userDataPath, MARKER_NAME), { force: true })
}

export function consumeHeadlessLocalBuildRelaunch(
  userDataPath: string,
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
): boolean {
  const path = join(userDataPath, MARKER_NAME)
  const claimedPath = `${path}.consume-${process.pid}-${randomUUID()}`
  try {
    // Atomic rename is the one-shot claim: concurrent processes cannot both consume the marker.
    renameSync(path, claimedPath)
  } catch {
    return false
  }
  let parsed: RelaunchMarker
  try {
    parsed = JSON.parse(readFileSync(claimedPath, 'utf8')) as RelaunchMarker
  } catch {
    rmSync(claimedPath, { force: true })
    return false
  }
  rmSync(claimedPath, { force: true })
  if (
    parsed.formatVersion !== MARKER_FORMAT_VERSION ||
    parsed.version !== version ||
    !Number.isFinite(parsed.createdAt) ||
    parsed.createdAt > now ||
    now - parsed.createdAt > MAX_AGE_MS
  ) {
    return false
  }
  env.ORCA_BACKGROUND_LAUNCH = '1'
  return true
}
