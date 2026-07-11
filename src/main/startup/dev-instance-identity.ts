import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AppIdentity } from '../../shared/app-identity'

const BASE_APP_NAME = 'Orca'
const BASE_APP_USER_MODEL_ID = 'com.stablyai.orca'
const MAX_LABEL_LENGTH = 80

// Why: must match extraMetadata.name in config/electron-builder.config.cjs —
// that's the bundled app.asar package.json "name" Electron reports via
// app.getName() before this module's caller renames the app, and it's the
// only runtime signal that a *packaged* build is the parallel Orca Dev
// variant rather than production Orca (is.dev only distinguishes unpackaged
// `pnpm dev` runs). Without this, updater.ts's dev-identity check never
// matches on the packaged Orca Dev build and it keeps polling the production
// release feed.
const DEV_PACKAGED_APP_NAME = 'orca-dev-app'
export const DEV_IDENTITY_APP_NAME = 'Orca Dev'
const DEV_IDENTITY_APP_USER_MODEL_ID = 'com.stablyai.orca.dev'

// Why: shared by updater.ts and cli-installer.ts — both must recognize the
// packaged Orca Dev variant (app.getName() === 'Orca Dev' after the
// whenReady() rename) so neither the update feed nor the public `orca`
// shell command is ever claimed by a parallel dev build.
export function isDevIdentityAppName(appName: string): boolean {
  return appName === DEV_IDENTITY_APP_NAME
}

export type DevInstanceIdentity = AppIdentity & {
  appUserModelId: string
}

function cleanEnvValue(value: string | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  if (!trimmed) {
    return null
  }
  return trimmed.length > MAX_LABEL_LENGTH
    ? `${trimmed.slice(0, MAX_LABEL_LENGTH - 3)}...`
    : trimmed
}

function lastPathSegment(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  return normalized.split('/').findLast(Boolean) ?? value
}

function formatLabel(branch: string | null, worktreeName: string | null): string | null {
  if (branch && worktreeName) {
    if (branch === worktreeName || lastPathSegment(branch) === worktreeName) {
      return worktreeName
    }
    return `${worktreeName} @ ${branch}`
  }
  return branch ?? worktreeName
}

function createDevAppUserModelId(identityKey: string | null): string {
  if (!identityKey) {
    return BASE_APP_USER_MODEL_ID
  }
  const hash = createHash('sha1').update(identityKey).digest('hex').slice(0, 10)
  return `${BASE_APP_USER_MODEL_ID}.dev.${hash}`
}

export function getDevInstanceIdentity(
  isDev: boolean,
  env: NodeJS.ProcessEnv = process.env,
  packagedAppName?: string
): DevInstanceIdentity {
  if (!isDev) {
    if (packagedAppName === DEV_PACKAGED_APP_NAME) {
      return {
        name: DEV_IDENTITY_APP_NAME,
        isDev: false,
        devLabel: null,
        devBranch: null,
        devWorktreeName: null,
        devRepoRoot: null,
        dockBadgeLabel: null,
        appUserModelId: DEV_IDENTITY_APP_USER_MODEL_ID
      }
    }
    return {
      name: BASE_APP_NAME,
      isDev: false,
      devLabel: null,
      devBranch: null,
      devWorktreeName: null,
      devRepoRoot: null,
      dockBadgeLabel: null,
      appUserModelId: BASE_APP_USER_MODEL_ID
    }
  }

  const repoRoot = cleanEnvValue(env.ORCA_DEV_REPO_ROOT)
  const branch = cleanEnvValue(env.ORCA_DEV_BRANCH)
  const worktreeName =
    cleanEnvValue(env.ORCA_DEV_WORKTREE_NAME) ??
    cleanEnvValue(path.basename(repoRoot ?? process.cwd()))
  const devLabel = cleanEnvValue(env.ORCA_DEV_INSTANCE_LABEL) ?? formatLabel(branch, worktreeName)
  const dockTitle =
    cleanEnvValue(env.ORCA_DEV_DOCK_TITLE) ?? `${BASE_APP_NAME}: ${branch ?? devLabel ?? 'dev'}`

  return {
    name: dockTitle,
    isDev: true,
    devLabel,
    devBranch: branch,
    devWorktreeName: worktreeName,
    devRepoRoot: repoRoot,
    dockBadgeLabel: null,
    appUserModelId: createDevAppUserModelId(repoRoot ?? devLabel)
  }
}
