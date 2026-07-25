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

  it('uses ORCA_USER_DATA_PATH when bundle discovery is unavailable', () => {
    process.env.ORCA_USER_DATA_PATH = '/custom/user-data'
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))

    expect(getDefaultUserDataPath('darwin', root, undefined)).toBe('/custom/user-data')
  })

  it.each([
    ['orca-dev-app', 'orca-dev-app'],
    ['orca-test-app', 'orca-test-app']
  ])('prefers bundled identity %s over ambient production userData', (name, expectedDir) => {
    process.env.ORCA_USER_DATA_PATH = '/ambient/production/orca'
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, name)

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', expectedDir)
    )
  })

  it.each(['orca-dev-app', 'orca-test-app'])(
    'keeps packaged identity %s out of the production profile on darwin',
    (name) => {
      const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
      const resourcesPath = join(root, 'Resources')
      writePackagedAppAsar(resourcesPath, name)

      const resolved = getDefaultUserDataPath('darwin', root, resourcesPath)
      expect(resolved).toBe(join(root, 'Library', 'Application Support', name))
      expect(resolved).not.toBe(join(root, 'Library', 'Application Support', 'orca'))
    }
  )

  it('resolves Orca Test userData from its bundled identity on win32', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming'
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca-test-app')

    expect(getDefaultUserDataPath('win32', root, resourcesPath)).toBe(
      join('C:\\Users\\test\\AppData\\Roaming', 'orca-test-app')
    )
  })

  it('resolves Orca Test userData from its bundled identity on linux', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca-test-app')

    expect(getDefaultUserDataPath('linux', root, resourcesPath)).toBe(
      join(root, '.config', 'orca-test-app')
    )
  })

  it('falls back to production when resourcesPath is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))

    expect(getDefaultUserDataPath('darwin', root, undefined)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })

  it('falls back to production when app.asar/package.json is unreadable', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    mkdirSync(resourcesPath, { recursive: true })

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })

  it('resolves production for a packaged production build', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-metadata-'))
    const resourcesPath = join(root, 'Resources')
    writePackagedAppAsar(resourcesPath, 'orca')

    expect(getDefaultUserDataPath('darwin', root, resourcesPath)).toBe(
      join(root, 'Library', 'Application Support', 'orca')
    )
  })
})
