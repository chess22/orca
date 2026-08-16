import { describe, expect, it } from 'vitest'
import { createLocalBuildVersion, resolveMacLocalBuildVersion } from './build-mac-local.mjs'

describe('createLocalBuildVersion', () => {
  it('creates unique valid prerelease versions without changing the release base', () => {
    expect(createLocalBuildVersion('1.4.159-rc.0', 123456, 'abc123')).toBe(
      '1.4.159-rc.0.local.123456.abc123'
    )
    expect(createLocalBuildVersion('1.4.159', 123456, 'abc123')).toBe('1.4.159-local.123456.abc123')
  })

  it('sanitizes commit identifiers', () => {
    expect(createLocalBuildVersion('1.0.0', 1, 'abc/def')).toBe('1.0.0-local.1.abcdef')
  })
})

describe('resolveMacLocalBuildVersion', () => {
  it('preserves the staged DEV2 version', () => {
    expect(
      resolveMacLocalBuildVersion('1.4.183-local.123.abc', {
        ORCA_DEV2_BUILD: '1',
        ORCA_LOCAL_BUILD_VERSION: '1.4.183-dev2.1'
      })
    ).toBe('1.4.183-dev2.1')
  })

  it('keeps generated identities for ordinary local builds', () => {
    expect(
      resolveMacLocalBuildVersion('1.4.183-local.123.abc', {
        ORCA_LOCAL_BUILD_VERSION: 'ignored'
      })
    ).toBe('1.4.183-local.123.abc')
  })
})
