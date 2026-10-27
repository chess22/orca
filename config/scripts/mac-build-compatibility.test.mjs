import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createMacBuildCompatibility } = require('./mac-build-compatibility.cjs')

describe('mac build compatibility metadata', () => {
  it('binds version, commit, and architecture into the packaged contract', () => {
    expect(
      createMacBuildCompatibility({
        version: '1.2.3-local.1',
        commit: 'abc123',
        architecture: 'arm64',
        sourceCommit: 'a'.repeat(40),
        artifactIdentity: 'orca@1.2.3-local.1:darwin-arm64',
        attestation: 'attested'
      })
    ).toMatchObject({
      formatVersion: 1,
      appId: 'com.stablyai.orca',
      buildId: '1.2.3-local.1-abc123-arm64',
      version: '1.2.3-local.1',
      commit: 'abc123',
      sourceCommit: 'a'.repeat(40),
      artifactIdentity: 'orca@1.2.3-local.1:darwin-arm64',
      attestation: 'attested',
      stateSchemaVersion: 1,
      platform: 'darwin',
      architecture: 'arm64'
    })
  })

  it('rejects unsupported architecture metadata', () => {
    expect(() =>
      createMacBuildCompatibility({
        version: '1.2.3',
        commit: 'abc123',
        architecture: 'universal'
      })
    ).toThrow('Unsupported macOS build architecture')
  })

  it('materializes platform-specific package provenance from one canonical build', () => {
    expect(
      createMacBuildCompatibility({
        version: '1.2.3',
        commit: 'abc123',
        architecture: 'x64',
        platform: 'win32',
        buildId: 'shared-build',
        packageName: 'orca',
        artifactIdentity: 'orca@1.2.3:win32-x64'
      })
    ).toMatchObject({
      buildId: 'shared-build',
      packageName: 'orca',
      platform: 'win32',
      architecture: 'x64',
      artifactIdentity: 'orca@1.2.3:win32-x64'
    })
  })
})
