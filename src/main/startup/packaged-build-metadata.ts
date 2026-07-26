import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackagedBuildMetadata } from './dev-instance-identity'

const NO_BUILD_METADATA: PackagedBuildMetadata = { branch: null, commitHash: null }

// Why: electron-builder.config.cjs extraMetadata writes buildBranch/
// buildCommitHash into the packaged package.json; Electron transparently reads
// files inside app.asar through the normal fs API, so this needs no unpacking.
export function readPackagedBuildMetadataFromPackageJson(
  packageJsonPath: string,
  readFile: (path: string, encoding: 'utf8') => string = readFileSync
): PackagedBuildMetadata {
  try {
    const raw = JSON.parse(readFile(packageJsonPath, 'utf8')) as {
      buildBranch?: unknown
      buildCommitHash?: unknown
    }
    return {
      branch: typeof raw.buildBranch === 'string' ? raw.buildBranch : null,
      commitHash: typeof raw.buildCommitHash === 'string' ? raw.buildCommitHash : null
    }
  } catch {
    return NO_BUILD_METADATA
  }
}

export function getPackagedBuildMetadata(
  appPath: string,
  isPackaged: boolean
): PackagedBuildMetadata {
  // Why: interactive `pnpm dev` reads the repo root package.json, which never
  // carries these fields — skip the read rather than return a false negative.
  if (!isPackaged) {
    return NO_BUILD_METADATA
  }
  return readPackagedBuildMetadataFromPackageJson(join(appPath, 'package.json'))
}
