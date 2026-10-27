import { afterEach, describe, expect, it } from 'vitest'
import { getRuntimeBuildProvenance } from '../../runtime-build-provenance'
import { STATUS_METHODS } from './status'

describe('status.get build provenance', () => {
  afterEach(() => {
    delete (globalThis as { ORCA_RUNTIME_BUILD_PROVENANCE?: unknown }).ORCA_RUNTIME_BUILD_PROVENANCE
  })

  it('publishes immutable source and artifact provenance from the running bundle', async () => {
    const provenance = {
      commit: '0123456789ab',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      buildId: '1.4.239-0123456789ab-arm64',
      packageName: 'orca',
      packageVersion: '1.4.239',
      attestation: 'attested' as const
    }
    const expected = {
      commit: provenance.commit,
      sourceCommit: provenance.sourceCommit,
      buildId: provenance.buildId,
      artifactIdentity: `orca@1.4.239:${process.platform}-${process.arch}`,
      targetArchitecture: process.arch,
      attestation: provenance.attestation
    }
    ;(
      globalThis as {
        ORCA_RUNTIME_BUILD_PROVENANCE?: typeof provenance
      }
    ).ORCA_RUNTIME_BUILD_PROVENANCE = provenance
    const runtime = {
      getRuntimeId: () => 'runtime-provenance',
      machineNameReady: async () => undefined,
      getStatus: () => ({ runtimeId: 'runtime-provenance' })
    }

    const first = await STATUS_METHODS[0].handler(undefined, { runtime } as never)
    expect(first).toMatchObject({ build: expected })
    first.build!.buildId = 'mutated-after-read'
    const second = await STATUS_METHODS[0].handler(undefined, { runtime } as never)
    expect(second).toMatchObject({ build: { buildId: expected.buildId } })
  })

  it('omits provenance from older or development test bundles that did not inject it', async () => {
    const runtime = {
      getRuntimeId: () => 'runtime-old',
      machineNameReady: async () => undefined,
      getStatus: () => ({ runtimeId: 'runtime-old' })
    }
    const status = await STATUS_METHODS[0].handler(undefined, { runtime } as never)
    expect(status).not.toHaveProperty('build')
  })

  it('accepts matching slice metadata and rejects mismatched packaged identity', () => {
    const provenance = {
      commit: '0123456789ab',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      buildId: 'dual-arch-build',
      packageName: 'orca',
      packageVersion: '1.4.239',
      attestation: 'attested' as const
    }
    ;(
      globalThis as {
        ORCA_RUNTIME_BUILD_PROVENANCE?: typeof provenance
      }
    ).ORCA_RUNTIME_BUILD_PROVENANCE = provenance
    const packaged = {
      commit: provenance.commit,
      sourceCommit: provenance.sourceCommit,
      buildId: provenance.buildId,
      version: provenance.packageVersion,
      packageName: provenance.packageName,
      platform: process.platform,
      architecture: process.arch,
      artifactIdentity: `orca@1.4.239:${process.platform}-${process.arch}`,
      attestation: provenance.attestation
    }
    expect(getRuntimeBuildProvenance('1.4.239', packaged)).toMatchObject({
      buildId: provenance.buildId,
      targetArchitecture: process.arch,
      artifactIdentity: packaged.artifactIdentity
    })
    expect(
      getRuntimeBuildProvenance('1.4.239', { ...packaged, buildId: 'other-build' })
    ).toBeUndefined()
    expect(
      getRuntimeBuildProvenance('1.4.239', { ...packaged, commit: 'ffffffffffff' })
    ).toBeUndefined()
    expect(
      getRuntimeBuildProvenance('1.4.239', { ...packaged, packageName: 'other' })
    ).toBeUndefined()
    expect(
      getRuntimeBuildProvenance('1.4.239', {
        ...packaged,
        artifactIdentity: `orca@1.4.239:${process.platform}-other`
      })
    ).toBeUndefined()
  })
})
