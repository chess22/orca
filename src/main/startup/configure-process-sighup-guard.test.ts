import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  const { app } = await import('electron')
  Object.defineProperty(app, 'isPackaged', { configurable: true, value: false })
})

describe('installPackagedSighupGuard', () => {
  it('registers a SIGHUP listener for packaged non-Windows runs', async () => {
    const { app } = await import('electron')
    const { installPackagedSighupGuard } = await import('./configure-process')
    const originalOn = process.on.bind(process)
    let sighupHandler: (() => void) | undefined

    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
    setPlatform('darwin')
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((event, listener) => {
      if (event === 'SIGHUP') {
        sighupHandler = listener as () => void
        return process
      }
      return originalOn(event, listener)
    }) as typeof process.on)
    installPackagedSighupGuard()
    sighupHandler?.()

    expect(onSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function))
  })

  it('does not register a SIGHUP listener in dev mode', async () => {
    const { installPackagedSighupGuard } = await import('./configure-process')
    const onSpy = vi.spyOn(process, 'on')

    setPlatform('darwin')
    installPackagedSighupGuard()

    expect(onSpy).not.toHaveBeenCalledWith('SIGHUP', expect.any(Function))
  })

  it('does not register a SIGHUP listener on Windows', async () => {
    const { app } = await import('electron')
    const { installPackagedSighupGuard } = await import('./configure-process')
    const onSpy = vi.spyOn(process, 'on')

    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
    setPlatform('win32')
    installPackagedSighupGuard()

    expect(onSpy).not.toHaveBeenCalledWith('SIGHUP', expect.any(Function))
  })
})
