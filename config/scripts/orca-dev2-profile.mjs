import path from 'node:path'

export const ORCA_DEV2_APP_NAME = 'Orca Dev 2'
export const ORCA_DEV2_APP_ID = 'com.stablyai.orca.dev2'
export const ORCA_DEV2_CLI_NAME = 'orca-dev2'
export const ORCA_DEV2_USER_DATA_DIR = 'orca-dev2-app'
export const ORCA_DEV2_VERSION = '1.4.183-dev2.0'

export function getOrcaDev2UserDataPath(env = process.env, platform = process.platform) {
  if (env.ORCA_DEV2_USER_DATA_PATH) {
    return env.ORCA_DEV2_USER_DATA_PATH
  }
  if (platform === 'darwin') {
    return path.join(env.HOME ?? '', 'Library', 'Application Support', ORCA_DEV2_USER_DATA_DIR)
  }
  if (platform === 'win32') {
    return path.join(
      env.APPDATA ?? path.join(env.USERPROFILE ?? '', 'AppData', 'Roaming'),
      ORCA_DEV2_USER_DATA_DIR
    )
  }
  return path.join(
    env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? '', '.config'),
    ORCA_DEV2_USER_DATA_DIR
  )
}

export function applyOrcaDev2Environment(env = process.env, platform = process.platform) {
  env.ORCA_DEV_USER_DATA_PATH = getOrcaDev2UserDataPath(env, platform)
  env.ORCA_DEV_INSTANCE_KEY = ORCA_DEV2_APP_ID
  env.ORCA_DEV_INSTANCE_LABEL = ORCA_DEV2_APP_NAME
  env.ORCA_DEV_DOCK_TITLE = ORCA_DEV2_APP_NAME
  env.ORCA_DEV_CLI_NAME = ORCA_DEV2_CLI_NAME
}
