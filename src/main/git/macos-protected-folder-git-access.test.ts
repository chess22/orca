import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn(() => '/Users/ada') }))

vi.mock('node:os', () => ({ homedir: homedirMock }))

import { shouldDeferMacosProtectedFolderGitDiscovery } from './macos-protected-folder-git-access'
import {
  completeMacosProtectedFolderGitStartup,
  resetMacosProtectedFolderGitStartupForTests,
  shouldDeferMacosProtectedFolderGitStartup
} from './macos-protected-folder-git-access'

describe('shouldDeferMacosProtectedFolderGitDiscovery', () => {
  let platform: PropertyDescriptor | undefined

  beforeEach(() => {
    platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    resetMacosProtectedFolderGitStartupForTests()
  })

  afterEach(() => {
    if (platform) {
      Object.defineProperty(process, 'platform', platform)
    }
    vi.clearAllMocks()
  })

  it.each(['Documents', 'Desktop', 'Downloads'])(
    'defers %s discovery using only the target path',
    (folder) => {
      expect(shouldDeferMacosProtectedFolderGitDiscovery(`/Users/ada/${folder}/repo`)).toBe(true)
    }
  )

  it('does not defer a lexical sibling of a protected folder', () => {
    expect(shouldDeferMacosProtectedFolderGitDiscovery('/Users/ada/Documents-backup/repo')).toBe(
      false
    )
  })

  it('does not defer repositories outside protected folders', () => {
    expect(shouldDeferMacosProtectedFolderGitDiscovery('/Users/ada/code/repo')).toBe(false)
  })

  it('defers protected Git only until the startup graph is ready', () => {
    expect(shouldDeferMacosProtectedFolderGitStartup('/Users/ada/Documents/repo')).toBe(true)

    completeMacosProtectedFolderGitStartup()

    expect(shouldDeferMacosProtectedFolderGitStartup('/Users/ada/Documents/repo')).toBe(false)
  })

  it('does not apply the local macOS gate to WSL-routed Git', () => {
    expect(shouldDeferMacosProtectedFolderGitStartup('/Users/ada/Documents/repo', 'Ubuntu')).toBe(
      false
    )
  })
})
