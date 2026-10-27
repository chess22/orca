import { describe, expect, it } from 'vitest'
import {
  assertPackagedRuntimeBuildProvenance,
  resolveRuntimeBuildProvenance
} from './build-runtime-provenance.mjs'

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

describe('runtime build provenance', () => {
  it('keeps the legacy short commit and adds a full source and package identity', () => {
    expect(
      resolveRuntimeBuildProvenance({
        sourceCommit: SOURCE_COMMIT,
        packageName: 'orca',
        packageVersion: '1.4.239',
        platform: 'darwin',
        architecture: 'arm64',
        env: { ORCA_BUILD_ID: 'build-1' }
      })
    ).toEqual({
      commit: SOURCE_COMMIT.slice(0, 12),
      sourceCommit: SOURCE_COMMIT,
      buildId: 'build-1',
      packageName: 'orca',
      packageVersion: '1.4.239',
      attestation: 'attested'
    })
  })

  it('carries explicit packaging identities into the bundled metadata', () => {
    expect(
      resolveRuntimeBuildProvenance({
        sourceCommit: SOURCE_COMMIT,
        packageName: 'orca',
        packageVersion: '1.4.239',
        platform: 'darwin',
        architecture: 'arm64',
        env: {
          ORCA_LOCAL_BUILD_VERSION: '1.4.239-local.10.0123456789ab',
          ORCA_BUILD_COMMIT: '0123456789ab',
          ORCA_BUILD_ID: 'local-build-10'
        }
      })
    ).toEqual({
      commit: '0123456789ab',
      sourceCommit: SOURCE_COMMIT,
      buildId: 'local-build-10',
      packageName: 'orca',
      packageVersion: '1.4.239-local.10.0123456789ab',
      attestation: 'attested'
    })
  })

  it('keeps the canonical bundle architecture-neutral for dual-architecture packaging', () => {
    const provenance = resolveRuntimeBuildProvenance({
      sourceCommit: SOURCE_COMMIT,
      packageName: 'orca',
      packageVersion: '1.4.239',
      platform: 'darwin',
      architecture: 'arm64',
      env: { ORCA_BUILD_ID: 'cross-build', ORCA_BUILD_TARGET_ARCH: 'x64' }
    })
    expect(provenance).not.toHaveProperty('targetArchitecture')
    expect(provenance).not.toHaveProperty('artifactIdentity')
  })

  it('fails closed when the expected source commit differs from checked-out HEAD', () => {
    expect(() =>
      resolveRuntimeBuildProvenance({
        sourceCommit: SOURCE_COMMIT,
        packageName: 'orca',
        packageVersion: '1.4.239',
        platform: 'darwin',
        architecture: 'arm64',
        env: { GITHUB_SHA: 'f'.repeat(40), ORCA_BUILD_ID: 'build-1' }
      })
    ).toThrow('does not match checked-out HEAD')
  })

  it('marks dirty development builds unattested', () => {
    expect(
      resolveRuntimeBuildProvenance({
        sourceCommit: SOURCE_COMMIT,
        sourceDirty: true,
        packageName: 'orca',
        packageVersion: '1.4.239',
        platform: 'darwin',
        architecture: 'arm64',
        env: { ORCA_BUILD_ID: 'dirty-build' }
      }).attestation
    ).toBe('unattested')
  })

  it('requires package metadata to match the canonical bundle provenance', () => {
    const provenance = resolveRuntimeBuildProvenance({
      sourceCommit: SOURCE_COMMIT,
      packageName: 'orca',
      packageVersion: '1.4.239',
      platform: 'darwin',
      architecture: 'arm64',
      env: { ORCA_BUILD_ID: 'same-build', ORCA_BUILD_TARGET_ARCH: 'arm64' }
    })
    const arm64 = assertPackagedRuntimeBuildProvenance(provenance, {
      sourceCommit: SOURCE_COMMIT,
      architecture: 'arm64',
      platform: 'darwin',
      version: '1.4.239',
      buildId: 'same-build',
      artifactIdentity: 'orca@1.4.239:darwin-arm64'
    })
    const x64 = assertPackagedRuntimeBuildProvenance(provenance, {
      sourceCommit: SOURCE_COMMIT,
      architecture: 'x64',
      platform: 'darwin',
      version: '1.4.239',
      buildId: 'same-build',
      artifactIdentity: 'orca@1.4.239:darwin-x64'
    })
    expect(arm64).toMatchObject({
      targetArchitecture: 'arm64',
      artifactIdentity: 'orca@1.4.239:darwin-arm64'
    })
    expect(x64).toMatchObject({
      targetArchitecture: 'x64',
      artifactIdentity: 'orca@1.4.239:darwin-x64'
    })
  })

  it('rejects artifact identity, version, and build ID mismatches', () => {
    const provenance = resolveRuntimeBuildProvenance({
      sourceCommit: SOURCE_COMMIT,
      packageName: 'orca',
      packageVersion: '1.4.239',
      platform: 'darwin',
      architecture: 'arm64',
      env: { ORCA_BUILD_ID: 'same-build', ORCA_BUILD_TARGET_ARCH: 'arm64' }
    })
    const expected = {
      sourceCommit: SOURCE_COMMIT,
      architecture: 'arm64',
      platform: 'darwin',
      version: '1.4.239',
      buildId: 'same-build',
      artifactIdentity: 'orca@1.4.239:darwin-arm64'
    }
    expect(() =>
      assertPackagedRuntimeBuildProvenance(provenance, {
        ...expected,
        artifactIdentity: 'orca@1.4.239:darwin-x64'
      })
    ).toThrow('artifact identity')
    expect(() =>
      assertPackagedRuntimeBuildProvenance(provenance, {
        ...expected,
        version: '1.4.240'
      })
    ).toThrow('version')
    expect(() =>
      assertPackagedRuntimeBuildProvenance(provenance, {
        ...expected,
        buildId: 'different-build'
      })
    ).toThrow('build ID')
  })

  it('materializes dirty local packages as unattested while release packaging rejects them', () => {
    const provenance = resolveRuntimeBuildProvenance({
      sourceCommit: SOURCE_COMMIT,
      sourceDirty: true,
      packageName: 'orca',
      packageVersion: '1.4.239-local.1',
      platform: 'darwin',
      architecture: 'arm64',
      env: { ORCA_BUILD_ID: 'dirty-local' }
    })
    const expected = {
      sourceCommit: SOURCE_COMMIT,
      architecture: 'arm64',
      platform: 'darwin',
      version: '1.4.239-local.1',
      buildId: 'dirty-local',
      artifactIdentity: 'orca@1.4.239-local.1:darwin-arm64'
    }
    expect(() => assertPackagedRuntimeBuildProvenance(provenance, expected)).toThrow('attested')
    expect(
      assertPackagedRuntimeBuildProvenance(provenance, {
        ...expected,
        requireAttestation: false
      })
    ).toMatchObject({ attestation: 'unattested' })
  })
})
