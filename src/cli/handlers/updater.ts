import type { CommandHandler, HandlerContext } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { UPDATER_LOCAL_BUILD_INSTALL_RUNTIME_CAPABILITY } from '../../shared/updater-runtime-capabilities'

type LocalBuildInstallSnapshot = {
  operationId: string
  manifestPath: string
  current: {
    phase: string
    version?: string
    percent?: number
    message?: string
  }
}

function assertLocalRuntime({ client }: HandlerContext): void {
  if (client.isRemote) {
    throw new RuntimeClientError(
      'local_runtime_required',
      "Local build installation is only available to this Mac's Orca desktop runtime."
    )
  }
}

async function assertLocalBuildInstallCapability({ client }: HandlerContext): Promise<void> {
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(UPDATER_LOCAL_BUILD_INSTALL_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'runtime_capability_missing',
      'This Orca runtime does not support headless local build installation. Update Orca before retrying; no updater request was sent.'
    )
  }
}

function formatSnapshot(snapshot: LocalBuildInstallSnapshot | null): string {
  if (!snapshot) {
    return 'No local build install has started.'
  }
  const current = snapshot.current
  return [
    `operationId: ${snapshot.operationId}`,
    `phase: ${current.phase}`,
    `manifest: ${snapshot.manifestPath}`,
    ...(current.version ? [`version: ${current.version}`] : []),
    ...(current.percent === undefined ? [] : [`percent: ${current.percent}`]),
    ...(current.message ? [`message: ${current.message}`] : [])
  ].join('\n')
}

export const UPDATER_HANDLERS: Record<string, CommandHandler> = {
  'updater local-build start': async (context) => {
    assertLocalRuntime(context)
    const params = {
      manifestPath: getRequiredStringFlag(context.flags, 'manifest'),
      expectedManifestSha256: getRequiredStringFlag(context.flags, 'manifest-sha256'),
      expectedArtifactSha256: getRequiredStringFlag(context.flags, 'artifact-sha256')
    }
    await assertLocalBuildInstallCapability(context)
    const response = await context.client.call<LocalBuildInstallSnapshot>(
      'updater.localBuild.start',
      params
    )
    printResult(response, context.json, formatSnapshot)
  },
  'updater local-build get': async (context) => {
    assertLocalRuntime(context)
    await assertLocalBuildInstallCapability(context)
    const response = await context.client.call<LocalBuildInstallSnapshot | null>(
      'updater.localBuild.get'
    )
    printResult(response, context.json, formatSnapshot)
  }
}
