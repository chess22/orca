import { describe, expect, it, vi } from 'vitest'
import type { CliStatusResult, RuntimeStatus } from '../../shared/runtime-types'
import { formatCliStatus, printResult } from '../format'
import { projectCliRuntimeBuildStatus } from './status'

const BUILD = {
  commit: '43324e009085',
  sourceCommit: '43324e0090854634c9cfd5567451a8aee339e139',
  buildId: 'local-1.4.239-arm64',
  artifactIdentity: 'orca@1.4.239:darwin-arm64',
  targetArchitecture: 'arm64' as const,
  attestation: 'attested' as const
}

function runtimeStatus(build: RuntimeStatus['build'] | null = BUILD): RuntimeStatus {
  return {
    runtimeId: 'runtime-1',
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: 1,
    liveTabCount: 1,
    liveLeafCount: 1,
    appVersion: '1.4.239',
    ...(build ? { build } : {})
  }
}

function cliStatus(
  runtime: Pick<CliStatusResult['runtime'], 'appVersion' | 'build' | 'buildStatus'>
): CliStatusResult {
  return {
    app: { running: true, pid: 42 },
    runtime: {
      state: 'ready',
      reachable: true,
      runtimeId: 'runtime-1',
      ...runtime
    },
    graph: { state: 'ready' }
  }
}

describe('CLI status build provenance', () => {
  it('projects the complete status.get build and version into structured output', () => {
    expect(projectCliRuntimeBuildStatus(runtimeStatus())).toEqual({
      appVersion: '1.4.239',
      build: BUILD,
      buildStatus: 'available'
    })
  })

  it('keeps the complete projection in the public JSON envelope', () => {
    const projected = cliStatus(projectCliRuntimeBuildStatus(runtimeStatus()))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    printResult(
      { id: 'status', ok: true, result: projected, _meta: { runtimeId: 'runtime-1' } },
      true,
      formatCliStatus
    )

    expect(JSON.parse(String(log.mock.calls[0]?.[0])).result.runtime).toEqual({
      state: 'ready',
      reachable: true,
      runtimeId: 'runtime-1',
      appVersion: '1.4.239',
      build: BUILD,
      buildStatus: 'available'
    })
    log.mockRestore()
  })

  it('marks a mixed-version runtime without build provenance as unverifiable', () => {
    expect(projectCliRuntimeBuildStatus(runtimeStatus(null))).toEqual({
      appVersion: '1.4.239',
      build: null,
      buildStatus: 'unverifiable'
    })
  })

  it('prints every provenance identity field and the runtime version', () => {
    expect(formatCliStatus(cliStatus(projectCliRuntimeBuildStatus(runtimeStatus())))).toContain(
      [
        'appVersion: 1.4.239',
        'buildProvenance: available',
        'buildCommit: 43324e009085',
        'buildSourceCommit: 43324e0090854634c9cfd5567451a8aee339e139',
        'buildId: local-1.4.239-arm64',
        'buildArtifactIdentity: orca@1.4.239:darwin-arm64',
        'buildTargetArchitecture: arm64',
        'buildAttestation: attested'
      ].join('\n')
    )
  })

  it('prints missing provenance as unverifiable without inventing identity fields', () => {
    const output = formatCliStatus(cliStatus(projectCliRuntimeBuildStatus(runtimeStatus(null))))

    expect(output).toContain('appVersion: 1.4.239')
    expect(output).toContain('buildProvenance: unverifiable')
    expect(output).not.toContain('buildCommit:')
  })
})
