import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyOrcaDev2Environment,
  getOrcaDev2UserDataPath,
  ORCA_DEV2_APP_ID,
  ORCA_DEV2_APP_NAME,
  ORCA_DEV2_VERSION
} from './orca-dev2-profile.mjs'

describe('Orca Dev 2 identity', () => {
  it('uses an isolated profile on every desktop platform', () => {
    expect(getOrcaDev2UserDataPath({ HOME: '/home/me' }, 'linux')).toBe(
      path.join('/home/me', '.config', 'orca-dev2-app')
    )
    expect(getOrcaDev2UserDataPath({ HOME: '/Users/me' }, 'darwin')).toBe(
      path.join('/Users/me', 'Library', 'Application Support', 'orca-dev2-app')
    )
    expect(getOrcaDev2UserDataPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32')).toBe(
      path.join('C:\\Users\\me\\AppData\\Roaming', 'orca-dev2-app')
    )
  })

  it('seeds a stable app, runtime, and CLI identity', () => {
    const env = { HOME: '/home/me' }
    applyOrcaDev2Environment(env, 'linux')
    expect(env).toMatchObject({
      ORCA_DEV_USER_DATA_PATH: path.join('/home/me', '.config', 'orca-dev2-app'),
      ORCA_DEV_INSTANCE_KEY: ORCA_DEV2_APP_ID,
      ORCA_DEV_INSTANCE_LABEL: ORCA_DEV2_APP_NAME,
      ORCA_DEV_DOCK_TITLE: ORCA_DEV2_APP_NAME,
      ORCA_DEV_CLI_NAME: 'orca-dev2'
    })
  })

  it('tracks the staged DEV2 build version', () => {
    expect(ORCA_DEV2_VERSION).toBe('1.4.183-dev2.2')
  })
})
