import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { accessMock, homedirMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  homedirMock: vi.fn(() => '/Users/ada')
}))

vi.mock('node:fs/promises', () => ({ access: accessMock }))
vi.mock('node:os', () => ({ homedir: homedirMock }))

import {
  mayScanGitInProtectedFolder,
  resetMacosProtectedFolderGitAccessForTests
} from './macos-protected-folder-git-access'

describe('mayScanGitInProtectedFolder', () => {
  let platform: PropertyDescriptor | undefined

  beforeEach(() => {
    platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    resetMacosProtectedFolderGitAccessForTests()
  })

  afterEach(() => {
    if (platform) {
      Object.defineProperty(process, 'platform', platform)
    }
    vi.clearAllMocks()
  })

  it('shares one denied Documents probe across repos and later scans', async () => {
    accessMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }))

    await expect(
      Promise.all([
        mayScanGitInProtectedFolder('/Users/ada/Documents/repo-a'),
        mayScanGitInProtectedFolder('/Users/ada/Documents/repo-b')
      ])
    ).resolves.toEqual([false, false])
    await expect(mayScanGitInProtectedFolder('/Users/ada/Documents/repo-c')).resolves.toBe(false)
    expect(accessMock).toHaveBeenCalledTimes(1)
    expect(accessMock).toHaveBeenCalledWith('/Users/ada/Documents', expect.any(Number))
  })

  it('does not probe repositories outside protected folders', async () => {
    await expect(mayScanGitInProtectedFolder('/Users/ada/code/repo')).resolves.toBe(true)
    expect(accessMock).not.toHaveBeenCalled()
  })
})
