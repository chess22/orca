import { randomUUID } from 'node:crypto'

function effectiveVersion(packageVersion, env) {
  return (
    env.ORCA_LOCAL_BUILD_VERSION ||
    env.ORCA_HOURLY_BUILD_VERSION ||
    env.ORCA_DAILY_BUILD_VERSION ||
    env.ORCA_ADHOC_BUILD_VERSION ||
    packageVersion
  )
}

export function resolveRuntimeBuildProvenance({
  sourceCommit,
  sourceDirty = false,
  packageName,
  packageVersion,
  env = process.env
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('Runtime provenance requires a full lowercase source commit.')
  }
  const version = effectiveVersion(packageVersion, env)
  const declaredTargetArchitecture = env.ORCA_BUILD_TARGET_ARCH?.trim()
  if (
    declaredTargetArchitecture &&
    declaredTargetArchitecture !== 'arm64' &&
    declaredTargetArchitecture !== 'x64'
  ) {
    throw new Error('Runtime provenance requires an explicit supported target architecture.')
  }
  const expectedSourceCommit = (env.ORCA_BUILD_SOURCE_COMMIT || env.GITHUB_SHA)?.trim()
  if (expectedSourceCommit && expectedSourceCommit !== sourceCommit) {
    throw new Error(
      `GITHUB_SHA ${expectedSourceCommit} does not match checked-out HEAD ${sourceCommit}.`
    )
  }
  const commit = env.ORCA_BUILD_COMMIT?.trim() || sourceCommit.slice(0, 12)
  if (commit !== sourceCommit && commit !== sourceCommit.slice(0, commit.length)) {
    throw new Error(
      `ORCA_BUILD_COMMIT ${commit} does not identify checked-out HEAD ${sourceCommit}.`
    )
  }
  const suppliedBuildId = env.ORCA_BUILD_ID?.trim()
  const buildId = suppliedBuildId || `unattested-${randomUUID()}`
  if (!commit || !buildId || buildId.length > 512) {
    throw new Error('Runtime build identity is invalid.')
  }
  return {
    commit,
    sourceCommit,
    buildId,
    packageName,
    packageVersion: version,
    attestation: sourceDirty ? 'unattested' : 'attested'
  }
}

export function createRuntimeBuildProvenanceBundle({
  sourceCommit,
  sourceDirty,
  packageName,
  packageVersion,
  env = process.env
}) {
  const provenance = resolveRuntimeBuildProvenance({
    sourceCommit,
    sourceDirty,
    packageName,
    packageVersion,
    env
  })
  const literal = JSON.stringify(provenance)
  return {
    literal,
    assetPlugin: {
      name: 'orca-runtime-build-provenance-asset',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'runtime-build-provenance.json',
          source: `${JSON.stringify(provenance, null, 2)}\n`
        })
      }
    }
  }
}

export function assertPackagedRuntimeBuildProvenance(provenance, expected) {
  if (
    (expected.requireAttestation !== false && provenance.attestation !== 'attested') ||
    !provenance.buildId
  ) {
    throw new Error('Packaged runtime provenance must be attested from a clean source tree.')
  }
  if (provenance.sourceCommit !== expected.sourceCommit) {
    throw new Error('Packaged runtime provenance source commit does not match checked-out HEAD.')
  }
  if (provenance.packageVersion !== expected.version) {
    throw new Error('Packaged runtime provenance version does not match package metadata.')
  }
  if (provenance.buildId !== expected.buildId) {
    throw new Error('Packaged runtime provenance build ID does not match package metadata.')
  }
  const artifactIdentity = `${provenance.packageName}@${expected.version}:${expected.platform}-${expected.architecture}`
  if (expected.artifactIdentity !== artifactIdentity) {
    throw new Error(
      'Packaged runtime provenance artifact identity does not match package metadata.'
    )
  }
  return {
    ...provenance,
    artifactIdentity,
    targetArchitecture: expected.architecture
  }
}
