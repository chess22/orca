import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function createLocalBuildVersion(baseVersion, timestamp, commit) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(baseVersion)) {
    throw new Error(`Package version is not valid semver: ${baseVersion}`)
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Local build timestamp is invalid.')
  }
  const sanitizedCommit = commit.replace(/[^0-9A-Za-z-]/g, '').slice(0, 12)
  if (!sanitizedCommit) {
    throw new Error('Git commit identity is empty.')
  }
  const suffix = `local.${timestamp}.${sanitizedCommit}`
  return baseVersion.includes('-') ? `${baseVersion}.${suffix}` : `${baseVersion}-${suffix}`
}

export function getLocalBuildIdentity() {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  return {
    commit,
    version: createLocalBuildVersion(packageJson.version, Date.now(), commit)
  }
}

export function localMacBuildEnvironment(identity, architecture = process.arch) {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported local macOS build architecture: ${architecture}`)
  }
  return {
    ...process.env,
    ORCA_BUILD_COMMIT: identity.commit,
    ORCA_BUILD_SOURCE_COMMIT: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim(),
    ORCA_BUILD_TARGET_ARCH: architecture,
    ORCA_BUILD_ID: `local-${identity.version}-${architecture}`,
    ORCA_LOCAL_BUILD_VERSION: identity.version
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const identity = getLocalBuildIdentity()
  console.log(`[build:mac] local update version ${identity.version}`)
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const env = localMacBuildEnvironment(identity)
  for (const args of [
    ['run', 'build:desktop'],
    ['run', 'build:computer-macos'],
    ['run', 'build:keyboard-layout-macos'],
    ['run', 'build:notification-status-macos'],
    ['run', 'ensure:electron-runtime'],
    ['exec', 'electron-builder', '--config', 'config/electron-builder.config.cjs', '--mac']
  ]) {
    execFileSync(pnpm, args, { env, stdio: 'inherit' })
  }
}
