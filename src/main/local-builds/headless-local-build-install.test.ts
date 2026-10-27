import { describe, expect, it, vi } from 'vitest'
import {
  assertHeadlessLocalBuildInstallRequest,
  HeadlessLocalBuildInstallTracker
} from './headless-local-build-install'

const request = {
  manifestPath: '/tmp/build/latest-mac.yml',
  expectedManifestSha256: 'a'.repeat(64),
  expectedArtifactSha256: 'b'.repeat(64)
}
const feedIdentity = 'http://127.0.0.1:1234/token/'

describe('headless local build install tracker', () => {
  it('keeps a machine-readable history through stage, install and relaunch', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
    try {
      const tracker = new HeadlessLocalBuildInstallTracker()
      tracker.begin(request)
      tracker.markChecking('1.2.3-local.1')

      expect(
        tracker.observeUpdaterStatus(
          {
            state: 'available',
            version: '1.2.3-local.1',
            changelog: null,
            source: 'local'
          },
          feedIdentity
        )
      ).toBe('download')
      const download = tracker.getQueuedAction('download')!
      expect(
        tracker.takeAction(download, {
          version: '1.2.3-local.1',
          source: 'local',
          feedIdentity
        })
      ).toBe('accepted')
      tracker.observeUpdaterStatus(
        {
          state: 'downloading',
          version: '1.2.3-local.1',
          percent: 50,
          source: 'local'
        },
        feedIdentity
      )
      expect(
        tracker.observeUpdaterStatus(
          {
            state: 'downloaded',
            version: '1.2.3-local.1',
            source: 'local'
          },
          feedIdentity
        )
      ).toBe('install')
      const install = tracker.getQueuedAction('install')!
      expect(
        tracker.takeAction(install, {
          version: '1.2.3-local.1',
          source: 'local',
          feedIdentity
        })
      ).toBe('accepted')
      tracker.markInstalling()
      const relaunchEnvironment: NodeJS.ProcessEnv = {}
      tracker.markRelaunching(relaunchEnvironment)

      expect(relaunchEnvironment.ORCA_BACKGROUND_LAUNCH).toBe('1')

      expect(tracker.get()).toMatchObject({
        manifestPath: request.manifestPath,
        expectedManifestSha256: request.expectedManifestSha256,
        expectedArtifactSha256: request.expectedArtifactSha256,
        current: { phase: 'relaunching', version: '1.2.3-local.1' },
        transitions: [
          { phase: 'validating' },
          { phase: 'checking', version: '1.2.3-local.1' },
          { phase: 'available', version: '1.2.3-local.1' },
          { phase: 'downloading', version: '1.2.3-local.1', percent: 50 },
          { phase: 'staged', version: '1.2.3-local.1' },
          { phase: 'installing', version: '1.2.3-local.1' },
          { phase: 'relaunching', version: '1.2.3-local.1' }
        ]
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores release status and records local failures', () => {
    const tracker = new HeadlessLocalBuildInstallTracker()
    tracker.begin(request)

    expect(
      tracker.observeUpdaterStatus(
        {
          state: 'available',
          version: '9.9.9',
          changelog: null
        },
        feedIdentity
      )
    ).toBeNull()
    tracker.observeUpdaterStatus(
      {
        state: 'error',
        message: 'signature mismatch',
        source: 'local'
      },
      feedIdentity
    )

    expect(tracker.get()?.current).toMatchObject({
      phase: 'failed',
      message: 'signature mismatch'
    })
  })

  it.each([
    ['version', { version: '1.2.4-local.1', source: 'local', feedIdentity }],
    ['source', { version: '1.2.3-local.1', source: 'release', feedIdentity }],
    [
      'feed identity',
      {
        version: '1.2.3-local.1',
        source: 'local',
        feedIdentity: 'http://127.0.0.1:4321/other/'
      }
    ]
  ])('fails a queued action closed when %s drifts', (_field, observed) => {
    const tracker = new HeadlessLocalBuildInstallTracker()
    tracker.begin(request)
    tracker.markChecking('1.2.3-local.1')
    tracker.observeUpdaterStatus(
      { state: 'available', version: '1.2.3-local.1', changelog: null, source: 'local' },
      feedIdentity
    )
    const queued = tracker.getQueuedAction('download')!

    expect(tracker.takeAction(queued, observed)).toBe('drifted')
    expect(
      tracker.takeAction(queued, {
        version: '1.2.3-local.1',
        source: 'local',
        feedIdentity
      })
    ).toBe('missing')
  })

  it.each([
    [{ ...request, manifestPath: '/tmp/build/not-a-manifest.yml' }, 'manifestPath'],
    [{ ...request, expectedManifestSha256: 'A'.repeat(64) }, 'expectedManifestSha256'],
    [{ ...request, expectedArtifactSha256: 'short' }, 'expectedArtifactSha256']
  ])('rejects an invalid exact request', (value, field) => {
    expect(() => assertHeadlessLocalBuildInstallRequest(value)).toThrow(field)
  })
})
