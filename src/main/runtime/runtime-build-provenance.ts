import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeBuildProvenance } from '../../shared/runtime-session-contracts'

type CompiledRuntimeBuildProvenance = Pick<
  RuntimeBuildProvenance,
  'commit' | 'sourceCommit' | 'buildId' | 'attestation'
> & {
  packageName: string
  packageVersion: string
}

type PackagedRuntimeBuildProvenance = Omit<RuntimeBuildProvenance, 'targetArchitecture'> & {
  version: string
  packageName: string
  platform: string
  architecture: string
}

function readPackagedRuntimeBuildProvenance(): PackagedRuntimeBuildProvenance | null | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) {
    return undefined
  }
  try {
    return JSON.parse(
      readFileSync(join(resourcesPath, 'orca-local-build.json'), 'utf8')
    ) as PackagedRuntimeBuildProvenance
  } catch {
    return null
  }
}

export function getRuntimeBuildProvenance(
  runtimeVersion?: string,
  packagedProvenance = readPackagedRuntimeBuildProvenance()
): RuntimeBuildProvenance | undefined {
  const provenance =
    typeof ORCA_RUNTIME_BUILD_PROVENANCE !== 'undefined'
      ? ORCA_RUNTIME_BUILD_PROVENANCE
      : (globalThis as { ORCA_RUNTIME_BUILD_PROVENANCE?: CompiledRuntimeBuildProvenance })
          .ORCA_RUNTIME_BUILD_PROVENANCE
  if (
    !provenance ||
    !/^[0-9a-f]{40}$/.test(provenance.sourceCommit) ||
    !provenance.commit ||
    !provenance.buildId ||
    !provenance.packageName ||
    !provenance.packageVersion ||
    (provenance.attestation !== 'attested' && provenance.attestation !== 'unattested')
  ) {
    return undefined
  }
  if (process.arch !== 'arm64' && process.arch !== 'x64') {
    return undefined
  }
  if (packagedProvenance === null) {
    return undefined
  }
  const version = runtimeVersion || provenance.packageVersion
  const artifactIdentity = `${provenance.packageName}@${version}:${process.platform}-${process.arch}`
  if (
    packagedProvenance &&
    (packagedProvenance.commit !== provenance.commit ||
      packagedProvenance.packageName !== provenance.packageName ||
      packagedProvenance.buildId !== provenance.buildId ||
      packagedProvenance.sourceCommit !== provenance.sourceCommit ||
      packagedProvenance.version !== version ||
      packagedProvenance.platform !== process.platform ||
      packagedProvenance.architecture !== process.arch ||
      packagedProvenance.artifactIdentity !== artifactIdentity ||
      packagedProvenance.attestation !== provenance.attestation)
  ) {
    return undefined
  }
  return {
    commit: provenance.commit,
    sourceCommit: provenance.sourceCommit,
    buildId: provenance.buildId,
    artifactIdentity,
    targetArchitecture: process.arch,
    attestation: provenance.attestation
  }
}
