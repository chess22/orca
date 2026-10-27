import { describe, expect, it, vi } from 'vitest'
import { DaemonPtyAdapter } from '../../../daemon/daemon-pty-adapter'
import { DaemonPtyRouter } from '../../../daemon/daemon-pty-router'
import { DegradedDaemonPtyProvider } from '../../../daemon/degraded-daemon-pty-provider'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import { terminalProviderKind } from './provider-kind'

describe('terminalProviderKind', () => {
  it('classifies exact local and daemon ownership', () => {
    const local = new LocalPtyProvider()
    vi.spyOn(local, 'hasPty').mockReturnValue(true)
    const router: DaemonPtyRouter = Object.create(DaemonPtyRouter.prototype)
    vi.spyOn(router, 'hasPty').mockReturnValue(true)

    expect(terminalProviderKind(local, 'pty-1')).toBe('in-process')
    expect(terminalProviderKind(router, 'pty-1')).toBe('daemon-backed')
  })

  it('fails closed when no provider or multiple providers claim the PTY', () => {
    const fallback = new LocalPtyProvider()
    const fallbackOwns = vi.spyOn(fallback, 'hasPty').mockReturnValue(false)
    const adapter: DaemonPtyAdapter = Object.create(DaemonPtyAdapter.prototype)
    const daemonOwns = vi.spyOn(adapter, 'hasPty').mockReturnValue(false)
    const degraded: DegradedDaemonPtyProvider = Object.create(DegradedDaemonPtyProvider.prototype)
    Object.defineProperty(degraded, 'fallback', { value: fallback })
    vi.spyOn(degraded, 'getAllAdapters').mockReturnValue([adapter])

    expect(terminalProviderKind(degraded, 'pty-1')).toBe('unknown')
    fallbackOwns.mockReturnValue(true)
    expect(terminalProviderKind(degraded, 'pty-1')).toBe('in-process')
    daemonOwns.mockReturnValue(true)
    expect(terminalProviderKind(degraded, 'pty-1')).toBe('unknown')
    fallbackOwns.mockReturnValue(false)
    expect(terminalProviderKind(degraded, 'pty-1')).toBe('daemon-backed')
  })
})
