import { describe, expect, it, vi } from 'vitest'
import { installPackagedGuiSighupGuard } from './configure-process'

function createRuntime(platform: NodeJS.Platform): Pick<NodeJS.Process, 'on' | 'platform'> {
  return {
    platform,
    on: vi.fn() as NodeJS.Process['on']
  }
}

describe('installPackagedGuiSighupGuard', () => {
  it.each([
    ['darwin', true],
    ['linux', true],
    ['darwin', false],
    ['linux', false],
    ['win32', true],
    ['win32', false],
    ['freebsd', true]
  ] as const)('gates %s packaged=%s launches', (platform, isPackaged) => {
    const runtime = createRuntime(platform)

    installPackagedGuiSighupGuard(isPackaged, false, runtime)

    const shouldInstall = isPackaged && (platform === 'darwin' || platform === 'linux')
    expect(runtime.on).toHaveBeenCalledTimes(shouldInstall ? 1 : 0)
    if (shouldInstall) {
      expect(runtime.on).toHaveBeenCalledWith('SIGHUP', expect.any(Function))
    }
  })

  it('does not guard an SSH-hosted serve runtime', () => {
    const runtime = createRuntime('linux')

    installPackagedGuiSighupGuard(true, true, runtime)

    expect(runtime.on).not.toHaveBeenCalled()
  })

  it('registers once without changing other signal handlers', () => {
    const runtime = createRuntime('darwin')

    installPackagedGuiSighupGuard(true, false, runtime)
    installPackagedGuiSighupGuard(true, false, runtime)

    expect(runtime.on).toHaveBeenCalledTimes(1)
    expect(runtime.on).toHaveBeenCalledWith('SIGHUP', expect.any(Function))
    expect(runtime.on).not.toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(runtime.on).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function))
  })
})
