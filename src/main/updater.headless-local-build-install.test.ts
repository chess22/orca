import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const {
  appMock,
  autoUpdaterMock,
  nativeUpdaterMock,
  chooseLocalBuildMock: loadLocalBuildCandidateMock,
  moduleFactories,
  resetUpdaterMocks,
  startLocalBuildFeedMock,
  closeLocalBuildFeedMock
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

const { assertLocalBuildCompatibilityMock } = vi.hoisted(() => ({
  assertLocalBuildCompatibilityMock: vi.fn()
}))

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('./ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())
vi.mock('./local-builds/local-build-candidate', () => ({
  loadLocalBuildCandidate: loadLocalBuildCandidateMock
}))
vi.mock('./local-builds/local-build-compatibility', () => ({
  assertLocalBuildCompatibility: assertLocalBuildCompatibilityMock
}))

warmUpdaterModule()

const request = {
  manifestPath: '/private/tmp/build/latest-mac.yml',
  expectedManifestSha256: 'a'.repeat(64),
  expectedArtifactSha256: 'b'.repeat(64)
}

function mockRollbackCandidate(): void {
  loadLocalBuildCandidateMock.mockResolvedValue({
    version: '1.0.50-local.1',
    compatibility: {
      formatVersion: 1,
      appId: 'com.stablyai.orca',
      buildId: '1.0.50-local.1-abc-arm64',
      version: '1.0.50-local.1',
      commit: 'abc',
      stateSchemaVersion: 1,
      readableStateSchemaVersions: [1],
      daemonProtocolVersion: 53,
      attachableDaemonProtocolVersions: [53],
      platform: 'darwin',
      architecture: 'arm64'
    },
    manifestContent: 'version: 1.0.50-local.1',
    artifacts: new Map(),
    close: vi.fn()
  })
}

describe('headless local build updater backend', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    mockRollbackCandidate()
    assertLocalBuildCompatibilityMock.mockReset().mockResolvedValue({
      liveTerminalCount: 0,
      liveDaemonProtocols: []
    })
  })

  it('accepts a verified older rollback through the updater path without opening a dialog', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.50-local.1' })
      return Promise.resolve(undefined)
    })
    autoUpdaterMock.downloadUpdate.mockResolvedValue(undefined)
    try {
      vi.useFakeTimers()
      const {
        setupAutoUpdater,
        startHeadlessLocalBuildInstall,
        getHeadlessLocalBuildInstallStatus
      } = await loadUpdaterModule()
      setupAutoUpdater(null, { getLastUpdateCheckAt: () => Date.now() })

      const accepted = await startHeadlessLocalBuildInstall(request)
      expect(loadLocalBuildCandidateMock).toHaveBeenCalledWith(request.manifestPath, process.arch, {
        expectedManifestSha256: request.expectedManifestSha256,
        expectedArtifactSha256: request.expectedArtifactSha256
      })
      expect(assertLocalBuildCompatibilityMock).toHaveBeenCalledOnce()
      expect(startLocalBuildFeedMock).toHaveBeenCalledOnce()
      expect(autoUpdaterMock.allowDowngrade).toBe(true)
      expect(autoUpdaterMock.disableDifferentialDownload).toBe(true)
      expect(accepted.transitions.map((entry) => entry.phase)).toEqual([
        'validating',
        'checking',
        'available'
      ])

      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce()
      expect(getHeadlessLocalBuildInstallStatus()?.current).toMatchObject({
        phase: 'downloading',
        version: '1.0.50-local.1',
        percent: 0
      })
      expect(closeLocalBuildFeedMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      platform.mockRestore()
    }
  })

  it('rejects a concurrent start while the first exact build check is unresolved', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    let finishCheck: (() => void) | undefined
    autoUpdaterMock.checkForUpdates.mockImplementation(
      () => new Promise<void>((resolve) => (finishCheck = resolve))
    )
    try {
      const { setupAutoUpdater, startHeadlessLocalBuildInstall } = await loadUpdaterModule()
      setupAutoUpdater(null, { getLastUpdateCheckAt: () => Date.now() })
      const first = startHeadlessLocalBuildInstall(request)
      await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce())
      await expect(startHeadlessLocalBuildInstall(request)).rejects.toThrow('already in progress')
      finishCheck?.()
      await first
    } finally {
      platform.mockRestore()
    }
  })

  it('records a failed phase when a queued action loses its updater guard race', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.50-local.1' })
      return Promise.resolve(undefined)
    })
    autoUpdaterMock.downloadUpdate.mockResolvedValue(undefined)
    try {
      vi.useFakeTimers()
      const {
        setupAutoUpdater,
        startHeadlessLocalBuildInstall,
        downloadUpdate,
        getHeadlessLocalBuildInstallStatus
      } = await loadUpdaterModule()
      setupAutoUpdater(null, { getLastUpdateCheckAt: () => Date.now() })
      await startHeadlessLocalBuildInstall(request)
      downloadUpdate()
      await vi.advanceTimersByTimeAsync(0)
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce()
      expect(getHeadlessLocalBuildInstallStatus()?.current).toMatchObject({
        phase: 'failed',
        message: 'The updater refused the queued download action.'
      })
    } finally {
      vi.useRealTimers()
      platform.mockRestore()
    }
  })

  it('accepts the queued install and exposes installing before native relaunch', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-available', { version: '1.0.50-local.1' })
      return Promise.resolve(undefined)
    })
    autoUpdaterMock.downloadUpdate.mockResolvedValue(undefined)
    try {
      vi.useFakeTimers()
      const {
        setupAutoUpdater,
        startHeadlessLocalBuildInstall,
        getHeadlessLocalBuildInstallStatus
      } = await loadUpdaterModule()
      setupAutoUpdater(null, { getLastUpdateCheckAt: () => Date.now() })
      await startHeadlessLocalBuildInstall(request)
      await vi.advanceTimersByTimeAsync(0)
      const nativeDownloaded = nativeUpdaterMock.on.mock.calls.find(
        ([eventName]) => eventName === 'update-downloaded'
      )?.[1] as (() => void) | undefined
      nativeDownloaded?.()
      autoUpdaterMock.emit('update-downloaded', { version: '1.0.50-local.1' })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(getHeadlessLocalBuildInstallStatus()?.current.phase).toBe('installing')
      expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      platform.mockRestore()
    }
  })

  it('fails closed before touching electron-updater on non-macOS', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    try {
      const { startHeadlessLocalBuildInstall, getHeadlessLocalBuildInstallStatus } =
        await loadUpdaterModule()
      await expect(
        startHeadlessLocalBuildInstall({
          manifestPath: '/tmp/latest-mac.yml',
          expectedManifestSha256: 'a'.repeat(64),
          expectedArtifactSha256: 'b'.repeat(64)
        })
      ).rejects.toThrow('only on macOS')
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(getHeadlessLocalBuildInstallStatus()?.current.phase).toBe('failed')
    } finally {
      platform.mockRestore()
    }
  })

  it('fails closed in an unpackaged app', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    appMock.isPackaged = false
    try {
      const { startHeadlessLocalBuildInstall, getHeadlessLocalBuildInstallStatus } =
        await loadUpdaterModule()
      await expect(
        startHeadlessLocalBuildInstall({
          manifestPath: '/tmp/latest-mac.yml',
          expectedManifestSha256: 'a'.repeat(64),
          expectedArtifactSha256: 'b'.repeat(64)
        })
      ).rejects.toThrow('requires a packaged Orca app')
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(getHeadlessLocalBuildInstallStatus()?.current.phase).toBe('failed')
    } finally {
      platform.mockRestore()
    }
  })
})
