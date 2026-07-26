import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackagedBuildMetadata } from './dev-instance-identity'

const NO_BUILD_METADATA: PackagedBuildMetadata = { branch: null, commitHash: null }

// Why: electron-builder.config.cjs ships this as its own extraResource rather
// than merging buildBranch/buildCommitHash into the packaged package.json —
// growing package.json via extraMetadata corrupted the resulting app.asar
// (the merged file came out missing its opening brace, breaking Electron's
// own bootstrap). This file lives beside app.asar under process.resourcesPath.
export function readPackagedBuildMetadataFromResourceFile(
  resourceFilePath: string,
  readFile: (path: string, encoding: 'utf8') => string = readFileSync
): PackagedBuildMetadata {
  try {
    const raw = JSON.parse(readFile(resourceFilePath, 'utf8')) as {
      branch?: unknown
      commitHash?: unknown
    }
    return {
      branch: typeof raw.branch === 'string' ? raw.branch : null,
      commitHash: typeof raw.commitHash === 'string' ? raw.commitHash : null
    }
  } catch {
    return NO_BUILD_METADATA
  }
}

export function getPackagedBuildMetadata(
  resourcesPath: string,
  isPackaged: boolean
): PackagedBuildMetadata {
  // Why: interactive `pnpm dev` has no packaged resources directory carrying
  // this file — skip the read rather than return a false negative.
  if (!isPackaged) {
    return NO_BUILD_METADATA
  }
  return readPackagedBuildMetadataFromResourceFile(join(resourcesPath, 'build-identity.json'))
}
