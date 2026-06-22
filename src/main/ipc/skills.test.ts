import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'

const { handleMock, discoverSkillsMock, getDefaultWslDistroMock, getWslHomeMock } = vi.hoisted(
  () => ({
    handleMock: vi.fn(),
    discoverSkillsMock: vi.fn(),
    getDefaultWslDistroMock: vi.fn(),
    getWslHomeMock: vi.fn()
  })
)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('../skills/discovery', () => ({
  discoverSkills: discoverSkillsMock
}))

vi.mock('../wsl', () => ({
  getDefaultWslDistro: getDefaultWslDistroMock,
  getWslHome: getWslHomeMock
}))

import { registerSkillsHandlers } from './skills'

describe('registerSkillsHandlers', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const repos = [{ id: 'repo-1', path: 'C:\\Users\\alice\\repo' }]
  const store = {
    getRepos: vi.fn(() => repos),
    getSettings: vi.fn(() => getDefaultSettings('C:\\Users\\alice'))
  }

  beforeEach(() => {
    handleMock.mockReset()
    discoverSkillsMock.mockReset()
    getDefaultWslDistroMock.mockReset()
    getWslHomeMock.mockReset()
    store.getRepos.mockClear()
    store.getSettings.mockClear()
    discoverSkillsMock.mockResolvedValue({ skills: [], sources: [], scannedAt: 1 })
    getWslHomeMock.mockReturnValue('\\\\wsl.localhost\\Ubuntu\\home\\alice')
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  function getDiscoverHandler() {
    registerSkillsHandlers(store as never)
    const call = handleMock.mock.calls.find((entry: unknown[]) => entry[0] === 'skills:discover')
    if (!call) {
      throw new Error('skills:discover handler was not registered')
    }
    return call[1] as (_event: unknown, target?: unknown) => Promise<unknown>
  }

  function getEnsureHandler() {
    registerSkillsHandlers(store as never)
    const call = handleMock.mock.calls.find(
      (entry: unknown[]) => entry[0] === 'skills:ensureManagedReady'
    )
    if (!call) {
      throw new Error('skills:ensureManagedReady handler was not registered')
    }
    return call[1] as (
      event: { sender: { send: ReturnType<typeof vi.fn> } },
      request: unknown
    ) => Promise<unknown>
  }

  it('uses host skill discovery when resolved project runtime overrides stale WSL target state', async () => {
    const handler = getDiscoverHandler()

    await handler(null, {
      runtime: 'wsl',
      wslDistro: 'Debian',
      projectRuntime: {
        status: 'resolved',
        runtime: {
          kind: 'windows-host',
          hostPlatform: 'win32',
          projectId: 'repo-1',
          reason: 'project-override',
          cacheKey: 'repo-1:windows-host'
        }
      }
    })

    expect(discoverSkillsMock).toHaveBeenCalledWith({ repos })
    expect(getWslHomeMock).not.toHaveBeenCalled()
  })

  it('uses the selected project WSL distro for skill discovery', async () => {
    const handler = getDiscoverHandler()

    await handler(null, {
      projectRuntime: {
        status: 'resolved',
        runtime: {
          kind: 'wsl',
          hostPlatform: 'wsl',
          projectId: 'repo-1',
          distro: 'Ubuntu',
          reason: 'project-override',
          cacheKey: 'repo-1:wsl:Ubuntu'
        }
      }
    })

    expect(getDefaultWslDistroMock).not.toHaveBeenCalled()
    expect(getWslHomeMock).toHaveBeenCalledWith('Ubuntu')
    expect(discoverSkillsMock).toHaveBeenCalledWith({
      repos: [],
      homeDir: '\\\\wsl.localhost\\Ubuntu\\home\\alice',
      cwd: '\\\\wsl.localhost\\Ubuntu\\home\\alice'
    })
  })

  it('blocks skill discovery when project runtime requires repair', async () => {
    const handler = getDiscoverHandler()

    await expect(
      handler(null, {
        projectRuntime: {
          status: 'repair-required',
          repair: {
            projectId: 'repo-1',
            preferredRuntime: { kind: 'wsl', distro: 'Ubuntu' },
            reason: 'wsl-distro-missing',
            source: 'project-override',
            cacheKey: 'repo-1:repair:wsl-distro-missing:Ubuntu'
          }
        }
      })
    ).rejects.toThrow('Project runtime requires repair before skill discovery')
    expect(discoverSkillsMock).not.toHaveBeenCalled()
  })

  it('registers managed ensure and returns repair-required fallback without emitting setup', async () => {
    const handler = getEnsureHandler()
    const send = vi.fn()

    const result = await handler(
      { sender: { send } },
      {
        skillName: 'linear-tickets',
        context: 'linear-worktree',
        discoveryTarget: {
          projectRuntime: {
            status: 'repair-required',
            repair: {
              projectId: 'repo-1',
              preferredRuntime: { kind: 'wsl', distro: 'Ubuntu' },
              reason: 'wsl-distro-missing',
              source: 'project-override',
              cacheKey: 'repo-1:repair:wsl-distro-missing:Ubuntu'
            }
          }
        }
      }
    )

    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'repair-required-runtime',
      skillName: 'linear-tickets'
    })
    expect(send).not.toHaveBeenCalled()
    expect(discoverSkillsMock).not.toHaveBeenCalled()
  })

  it('does not emit managed fallback events for cooldown results', async () => {
    const handler = getEnsureHandler()
    const send = vi.fn()
    const request = {
      skillName: 'orchestration',
      context: 'agent-orchestration',
      discoveryTarget: { runtime: 'host' }
    }

    await handler({ sender: { send } }, request)
    send.mockClear()
    const result = await handler({ sender: { send } }, request)

    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'cooldown'
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not emit managed fallback events for remote runtime results', async () => {
    const handler = getEnsureHandler()
    const send = vi.fn()
    const result = await handler(
      { sender: { send } },
      {
        skillName: 'orchestration',
        context: 'agent-orchestration',
        remoteRuntime: true
      }
    )

    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'remote-runtime'
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not emit managed fallback events for WSL runtime results', async () => {
    const handler = getEnsureHandler()
    const send = vi.fn()
    const result = await handler(
      { sender: { send } },
      {
        skillName: 'linear-tickets',
        context: 'linear-worktree',
        discoveryTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      }
    )

    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'wsl-runtime'
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not emit managed fallback events without a manual command', async () => {
    const handler = getEnsureHandler()
    const send = vi.fn()
    discoverSkillsMock.mockResolvedValue({
      skills: [
        {
          id: 'repo-linear-tickets',
          name: 'linear-tickets',
          description: null,
          providers: ['agent-skills'],
          sourceKind: 'repo',
          sourceLabel: 'repo',
          rootPath: '/workspace/current/.agents/skills',
          directoryPath: '/workspace/current/.agents/skills/linear-tickets',
          skillFilePath: '/workspace/current/.agents/skills/linear-tickets/SKILL.md',
          installed: true,
          fileCount: 1,
          updatedAt: 1
        }
      ],
      sources: [],
      scannedAt: 1
    })
    const result = await handler(
      { sender: { send } },
      {
        skillName: 'linear-tickets',
        context: 'linear-worktree',
        discoveryTarget: { runtime: 'host', projectRootPath: '/workspace/current' }
      }
    )

    expect(result).toMatchObject({
      status: 'fallback',
      reason: 'project-install'
    })
    expect(send).not.toHaveBeenCalled()
  })
})
