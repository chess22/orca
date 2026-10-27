import { defineMethod, type RpcContext } from '../core'
import {
  checkRemoteServerUpdater,
  downloadRemoteServerUpdater,
  getLocalBuildInstallStatus,
  getRemoteServerUpdaterSnapshot,
  installRemoteServerUpdater,
  startLocalBuildInstall
} from '../../remote-server-updater'
import {
  LocalBuildInstallStartParams,
  UpdaterCheckParams
} from '../../../../shared/rpc-contract/updater-params'

function assertLocalMacDesktop(context: Pick<RpcContext, 'caller' | 'clientKind'>): void {
  if (
    context.clientKind !== undefined ||
    (context.caller?.kind !== 'local-cli' && context.caller?.kind !== 'desktop')
  ) {
    throw new Error('Local build installation is only available to this Mac host.')
  }
  if (process.platform !== 'darwin') {
    throw new Error('Local build installation is only supported on macOS.')
  }
}

export const UPDATER_METHODS = [
  defineMethod({
    name: 'updater.getStatus',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => getRemoteServerUpdaterSnapshot(runtime.getRuntimeId())
  }),
  defineMethod({
    name: 'updater.check',
    permission: 'host-admin',
    params: UpdaterCheckParams,
    handler: (params, { runtime }) => checkRemoteServerUpdater(runtime.getRuntimeId(), params)
  }),
  defineMethod({
    name: 'updater.download',
    permission: 'host-admin',
    params: null,
    handler: (_params, { runtime }) => downloadRemoteServerUpdater(runtime.getRuntimeId())
  }),
  defineMethod({
    name: 'updater.install',
    permission: 'host-admin',
    params: null,
    handler: (_params, { runtime }) => installRemoteServerUpdater(runtime.getRuntimeId())
  }),
  defineMethod({
    name: 'updater.localBuild.start',
    permission: 'host-admin',
    params: LocalBuildInstallStartParams,
    handler: async (params, context) => {
      assertLocalMacDesktop(context)
      return await startLocalBuildInstall(params)
    }
  }),
  defineMethod({
    name: 'updater.localBuild.get',
    permission: 'host-admin',
    params: null,
    handler: async (_params, context) => {
      assertLocalMacDesktop(context)
      return getLocalBuildInstallStatus()
    }
  })
]
