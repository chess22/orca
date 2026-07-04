import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  getReleaseChannel,
  isBenignCheckFailure,
  isMissingUpdateManifestFailure,
  isReleaseAssetsPublishingFailure,
  isPrereleaseVersion
} from './updater-fallback'

describe('compareVersions', () => {
  it('compares prerelease and build semver strings correctly', () => {
    expect(compareVersions('1.0.70-rc.1', '1.0.69')).toBeGreaterThan(0)
    expect(compareVersions('1.0.70', '1.0.70-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.70+build.5', '1.0.70')).toBe(0)
    expect(compareVersions('v1.0.70-beta.2', '1.0.70-beta.1')).toBeGreaterThan(0)
  })
})

describe('isPrereleaseVersion', () => {
  it('recognises RC, beta, and alpha variants', () => {
    expect(isPrereleaseVersion('1.3.17-rc.1')).toBe(true)
    expect(isPrereleaseVersion('v1.3.17-rc.2')).toBe(true)
    expect(isPrereleaseVersion('1.0.0-beta.5')).toBe(true)
    expect(isPrereleaseVersion('2.1.0-alpha')).toBe(true)
  })

  it('returns false for stable releases and unparseable values', () => {
    expect(isPrereleaseVersion('1.3.17')).toBe(false)
    expect(isPrereleaseVersion('v1.3.17')).toBe(false)
    expect(isPrereleaseVersion('1.3.17+build.5')).toBe(false)
    expect(isPrereleaseVersion('not-a-version')).toBe(false)
  })
})

describe('getReleaseChannel', () => {
  it('classifies stable, rc, and perf-rc tracks', () => {
    expect(getReleaseChannel('1.4.122')).toBe('stable')
    expect(getReleaseChannel('v1.4.122')).toBe('stable')
    expect(getReleaseChannel('1.4.122+build.5')).toBe('stable')
    expect(getReleaseChannel('1.4.122-rc.3')).toBe('rc')
    expect(getReleaseChannel('v1.4.122-rc.3')).toBe('rc')
    expect(getReleaseChannel('1.4.122-rc.3.perf')).toBe('perf-rc')
    expect(getReleaseChannel('v1.4.122-rc.3.perf')).toBe('perf-rc')
  })

  it('treats non-perf prereleases as the rc track and unparseable values as stable', () => {
    expect(getReleaseChannel('1.0.0-beta.5')).toBe('rc')
    expect(getReleaseChannel('2.1.0-alpha')).toBe('rc')
    // Why: a perf identifier anywhere in the prerelease marks the perf track,
    // even without a numeric suffix.
    expect(getReleaseChannel('1.4.122-rc.3.perf.1')).toBe('perf-rc')
    expect(getReleaseChannel('not-a-version')).toBe('stable')
  })
})

describe('isMissingUpdateManifestFailure', () => {
  it('matches platform manifest 404s but not generic network failures', () => {
    expect(
      isMissingUpdateManifestFailure(
        'Cannot find channel "latest-mac.yml" update info: HttpError: 404'
      )
    ).toBe(true)
    expect(isMissingUpdateManifestFailure('net::ERR_FAILED')).toBe(false)
    expect(isMissingUpdateManifestFailure('Unable to find latest version on GitHub')).toBe(false)
  })
})

describe('isBenignCheckFailure', () => {
  it('treats in-progress release asset publication as retryable', () => {
    expect(isBenignCheckFailure('Latest release assets are still publishing')).toBe(true)
  })
})

describe('isReleaseAssetsPublishingFailure', () => {
  it('only matches the explicit release-asset publishing sentinel', () => {
    expect(isReleaseAssetsPublishingFailure('Latest release assets are still publishing')).toBe(
      true
    )
    expect(
      isReleaseAssetsPublishingFailure('Cannot find channel "latest-mac.yml" update info: 404')
    ).toBe(false)
  })
})
