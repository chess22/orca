import { chmodSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MARKER_NAME = 'headless-local-build-relaunch.json'
const CLAIM_NAME = 'headless-local-build-relaunch.claimed.json'
const MAX_AGE_MS = 15 * 60_000

const MARKER_FORMAT_VERSION = 1

type RelaunchMarker = { formatVersion: number; version: string; createdAt: number }

export type HeadlessLocalBuildRelaunchResult =
  | { state: 'missing' }
  | { state: 'accepted' }
  | {
      state: 'rejected'
      reason: 'already_claimed' | 'claim_failed' | 'malformed' | 'stale' | 'version_mismatch'
    }

type RelaunchPreflightOptions = {
  env?: NodeJS.ProcessEnv
  record?: (message: string) => void
  now?: number
}

type RelaunchApp = { getVersion: () => string; exit: (code: number) => void }

export function stageHeadlessLocalBuildRelaunch(userDataPath: string, version: string): void {
  if (!version) {
    throw new Error('Cannot stage a background relaunch without a target version.')
  }
  const path = join(userDataPath, MARKER_NAME)
  rmSync(join(userDataPath, CLAIM_NAME), { force: true })
  const temporary = `${path}.${process.pid}.tmp`
  rmSync(temporary, { force: true })
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
  rmSync(join(userDataPath, CLAIM_NAME), { force: true })
}

export function consumeHeadlessLocalBuildRelaunch(
  userDataPath: string,
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
): HeadlessLocalBuildRelaunchResult {
  const path = join(userDataPath, MARKER_NAME)
  const claimedPath = join(userDataPath, CLAIM_NAME)
  try {
    // Atomic rename is the one-shot claim: concurrent processes cannot both consume the marker.
    renameSync(path, claimedPath)
    chmodSync(claimedPath, 0o600)
  } catch (error) {
    if (!isMissingFileError(error)) {
      return { state: 'rejected', reason: 'claim_failed' }
    }
    return existingClaimResult(claimedPath, now)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(claimedPath, 'utf8'))
  } catch {
    return { state: 'rejected', reason: 'malformed' }
  }
  if (!isRelaunchMarker(parsed) || parsed.formatVersion !== MARKER_FORMAT_VERSION) {
    return { state: 'rejected', reason: 'malformed' }
  }
  if (parsed.createdAt > now || now - parsed.createdAt > MAX_AGE_MS) {
    return { state: 'rejected', reason: 'stale' }
  }
  if (parsed.version !== version) {
    return { state: 'rejected', reason: 'version_mismatch' }
  }
  env.ORCA_BACKGROUND_LAUNCH = '1'
  return { state: 'accepted' }
}

export function applyHeadlessLocalBuildRelaunchPreflight(
  userDataPath: string,
  version: string,
  exit: (code: number) => void,
  options: RelaunchPreflightOptions = {}
): boolean {
  const result = consumeHeadlessLocalBuildRelaunch(userDataPath, version, options.env, options.now)
  if (result.state !== 'rejected') {
    return true
  }
  const env = options.env ?? process.env
  env.ORCA_BACKGROUND_LAUNCH = '1'
  ;(options.record ?? console.error)(
    `[startup] Headless local build relaunch rejected: ${result.reason}`
  )
  exit(78)
  return false
}

export function applyHeadlessLocalBuildRelaunchAppPreflight(
  userDataPath: string,
  app: RelaunchApp
): boolean {
  return applyHeadlessLocalBuildRelaunchPreflight(userDataPath, app.getVersion(), (code) =>
    app.exit(code)
  )
}

function isRelaunchMarker(value: unknown): value is RelaunchMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    'formatVersion' in value &&
    typeof value.formatVersion === 'number' &&
    'version' in value &&
    typeof value.version === 'string' &&
    'createdAt' in value &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  )
}

function existingClaimResult(claimedPath: string, now: number): HeadlessLocalBuildRelaunchResult {
  try {
    const age = now - statSync(claimedPath).mtimeMs
    if (age <= MAX_AGE_MS) {
      return { state: 'rejected', reason: 'already_claimed' }
    }
    rmSync(claimedPath, { force: true })
    return { state: 'missing' }
  } catch (error) {
    return isMissingFileError(error)
      ? { state: 'missing' }
      : { state: 'rejected', reason: 'claim_failed' }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: string }).code === 'ENOENT'
  )
}
