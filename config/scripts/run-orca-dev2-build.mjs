import { spawnSync } from 'node:child_process'
import { ORCA_DEV2_VERSION } from './orca-dev2-profile.mjs'

const platform = process.argv[2]
if (!['mac', 'win', 'linux'].includes(platform)) {
  console.error('Usage: run-orca-dev2-build.mjs <mac|win|linux>')
  process.exit(2)
}

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [`build:${platform}`],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ORCA_DEV2_BUILD: '1',
      ORCA_LOCAL_BUILD_VERSION: ORCA_DEV2_VERSION
    }
  }
)

if (result.signal) {
  process.kill(process.pid, result.signal)
}
process.exit(result.status ?? (result.error ? 1 : 0))
