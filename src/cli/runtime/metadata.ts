import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  findTransport,
  getRuntimeMetadataPath,
  type RuntimeMetadata
} from '../../shared/runtime-bootstrap'
import { RuntimeClientError } from './types'

export function readMetadata(userDataPath: string): RuntimeMetadata {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
    if (!metadata || !findTransport(metadata, 'unix', 'named-pipe') || !metadata.authToken) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        `Orca runtime metadata is incomplete at ${metadataPath}`
      )
    }
    return metadata
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'runtime_unavailable',
      `Could not read Orca runtime metadata at ${metadataPath}. Start the Orca app first.`
    )
  }
}

export function tryReadMetadata(userDataPath: string): RuntimeMetadata | null {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
  } catch {
    return null
  }
}

const DEFAULT_PACKAGED_APP_NAME = 'orca'

// Why: Electron derives app.getPath('userData') from the bundled app.asar's
// package.json "name" field (see extraMetadata in electron-builder.config.cjs),
// not from productName/appId. A CLI invoked with ELECTRON_RUN_AS_NODE never
// calls app.getPath itself, so without reading the same field it always
// resolved the hardcoded production folder — even when running from inside a
// parallel build like Orca Dev — and connected to whichever app happened to
// own that shared metadata file. fs.readFileSync sees inside app.asar via
// Electron's asar-transparent fs patch (unlike require(), which is bypassed
// under ELECTRON_RUN_AS_NODE), so this reads reliably from a packaged CLI.
function readPackagedAppName(resourcesPath: string | undefined): string | null {
  if (!resourcesPath) {
    return null
  }
  try {
    const pkg = JSON.parse(
      readFileSync(join(resourcesPath, 'app.asar', 'package.json'), 'utf8')
    ) as { name?: unknown }
    return typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : null
  } catch {
    return null
  }
}

export function getDefaultUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir(),
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath
): string {
  // Why: in dev mode (and for parallel Orca instances), the Electron app writes
  // runtime metadata to a separate userData directory (e.g. `orca-dev`) to avoid
  // clobbering the production app's metadata. The CLI needs to find the same
  // metadata file, so this env var lets the CLI target a specific instance.
  if (process.env.ORCA_USER_DATA_PATH) {
    return process.env.ORCA_USER_DATA_PATH
  }
  const appName = readPackagedAppName(resourcesPath) ?? DEFAULT_PACKAGED_APP_NAME
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', appName)
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'APPDATA is not set, so the Orca runtime metadata path cannot be resolved.'
      )
    }
    return join(appData, appName)
  }
  // Why: the CLI must find the same metadata file Electron writes in packaged
  // runs, so this mirrors Electron's default userData base instead of inventing
  // a CLI-specific config path.
  return join(process.env.XDG_CONFIG_HOME || join(homeDir, '.config'), appName)
}
