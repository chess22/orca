import { defineMethod } from '../core'
import { getRemoteServerUpdaterSnapshot } from '../../remote-server-updater'
import { getPublishedHostDescriptor } from '../../host-descriptor'
import { getRuntimeBuildProvenance } from '../../runtime-build-provenance'

export const STATUS_METHODS = [
  defineMethod({
    name: 'status.get',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime, pairedDeviceId }) => {
      // Why: a status answered while the friendly-name lookup is still in flight publishes the bare
      // hostname; the wait is capped below the CLI's status probe so a slow lookup never reads as down.
      await runtime.machineNameReady()
      const snapshot = getRemoteServerUpdaterSnapshot(runtime.getRuntimeId())
      const hostDescriptor = getPublishedHostDescriptor(runtime.getRuntimeId())
      const build = getRuntimeBuildProvenance(snapshot.appVersion)
      return {
        ...runtime.getStatus(),
        ...(hostDescriptor ? { hostDescriptor } : {}),
        ...(pairedDeviceId ? { pairedDeviceId } : {}),
        ...(build ? { build } : {}),
        appVersion: snapshot.appVersion,
        remoteUpdateSupport: snapshot.support
      }
    }
  })
]
