import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultUserDataPath } from './metadata'

const originalUserDataPathEnv = process.env.ORCA_USER_DATA_PATH
const originalAppDataEnv = process.env.APPDATA
const originalXdgConfigHomeEnv = process.env.XDG_CONFIG_HOME

function writePackagedAppAsar(resourcesPath: string, name: string): void {
  const asarDir = join(resourcesPath, 'app.asar')
  mkdirSync(asarDir, { recursive: true })
  writeFileSync(join(asarDir, 'package.json'), JSON.stringify({ name }), 'utf8')
}

describe('getDefaultUserDataPath', () => {
  beforeEach(() => {
    delete process.env.ORCA_USER_DATA_PATH
    delete process.env.APPDATA
    delete process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    process.env.ORCA_USER_DATA_PATH = originalUserDataPathEnv
    process.env.APPDATA = originalAppDataEnv
    process.env.XDG_CONFIG_HOME = originalXdgConfigHomeEnv
  })

  // Why: ORCA_USER_DATA_PATH is the explicit override used by interactive
  // `pnpm dev` sessions (see config/scripts/orca-dev.mjs) and must win over
  // any app.asar discovery.
  it('prefers the ORCA_USER_DATA_PATH override when set', () => {
    process.env.ORCA_USER_DATA_PATH = '/custom/user-data'
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca-dev-app')

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe('/custom/user-data')
  })

  // Why: a packaged Orca Dev CLI invoked with ELECTRON_RUN_AS_NODE must resolve
  // its own bundle's userData directory (matching Electron's app.asar
  // package.json "name" field), not the hardcoded production default —
  // otherwise it silently connects to the production app's running runtime.
  it('resolves the userData directory from the bundled app.asar package name on darwin', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca-dev-app')

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', 'orca-dev-app')
    )
  })

  it('resolves the userData directory from the bundled app.asar package name on win32', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming'
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca-dev-app')

    expect(getDefaultUserDataPath('win32', root, resourcesPath)).toBe(
      join('C:\\Users\\test\\AppData\\Roaming', 'orca-dev-app')
    )
  })

  it('resolves the userData directory from the bundled app.asar package name on linux', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca-dev-app')

    expect(getDefaultUserDataPath('linux', root, resourcesPath)).toBe(
      join(root, '.config', 'orca-dev-app')
    )
  })

  it('falls back to the production `orca` directory when no resourcesPath is available', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))

    expect(getDefaultUserDataPath('darwin', root, undefined)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })

  it('falls back to the production `orca` directory when app.asar/package.json is unreadable', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    mkdirSync(resourcesPath, { recursive: true })

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })

  it('falls back to the production `orca` directory when the app.asar package name is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    const asarDir = join(resourcesPath, 'app.asar')
    mkdirSync(asarDir, { recursive: true })
    writeFileSync(join(asarDir, 'package.json'), JSON.stringify({}), 'utf8')

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })

  it('resolves the production `orca` directory for a packaged production build', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca')

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })
})
