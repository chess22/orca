import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const packagePath = path.join(repoRoot, 'native', 'computer-use-macos')
const binaryPath = path.join(packagePath, '.build', 'release', 'orca-computer-use-macos')
const appPath = path.join(packagePath, '.build', 'release', 'Orca Computer Use.app')
const entitlementsPath = path.join(
  repoRoot,
  'resources',
  'build',
  'entitlements.computer-use.mac.plist'
)
const bundleId = process.env.ORCA_COMPUTER_MACOS_BUNDLE_ID ?? 'com.stablyai.orca.computer-use'
const displayName = 'Orca Computer Use'
const universalSlices = [
  { architecture: 'arm64', triple: 'arm64-apple-macosx' },
  { architecture: 'x86_64', triple: 'x86_64-apple-macosx' }
]

class CommandFailure extends Error {
  constructor(command, result) {
    super(`${command} failed${result.status === null ? '' : ` with exit code ${result.status}`}`)
    this.status = result.status
    this.signal = result.signal
    this.stderr = result.stderr
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (shouldBuildComputerMacos(process.platform)) {
      buildComputerMacosArtifacts()
    }
  } catch (error) {
    if (!(error instanceof CommandFailure)) {
      throw error
    }
    if (error.stderr) {
      process.stderr.write(error.stderr)
    }
    if (error.signal) {
      process.kill(process.pid, error.signal)
    } else {
      process.exitCode = error.status ?? 1
    }
  }
}

export function shouldBuildComputerMacos(platform) {
  return platform === 'darwin'
}

export function buildComputerMacosArtifacts({
  packageDirectory = packagePath,
  outputBinary = binaryPath,
  outputApp = appPath,
  iconPath = path.join(repoRoot, 'resources', 'build', 'icon.icns'),
  signingIdentity = resolveSigningIdentity(),
  runCommand = run,
  captureCommand = capture,
  renameArtifact = renameSync
} = {}) {
  const buildDirectory = path.join(packageDirectory, '.build')
  mkdirSync(buildDirectory, { recursive: true })
  const releaseRoot = path.join(buildDirectory, 'release')
  mkdirSync(releaseRoot, { recursive: true })
  const canonicalOutputs = validateCanonicalOutputs(releaseRoot, outputBinary, outputApp)
  const scratchRoot = mkdtempSync(path.join(buildDirectory, 'orca-computer-use-universal-'))
  try {
    const builtBinaries = universalSlices.map((slice) =>
      buildSlice(packageDirectory, scratchRoot, slice, runCommand, captureCommand)
    )
    const stagedBinary = path.join(scratchRoot, 'staged', 'orca-computer-use-macos')
    mkdirSync(path.dirname(stagedBinary), { recursive: true })
    runCommand('lipo', ['-create', ...builtBinaries, '-output', stagedBinary])
    assertRegularNonSymlink(stagedBinary)
    assertExactArchitectures(
      stagedBinary,
      universalSlices.map(({ architecture }) => architecture),
      captureCommand
    )
    chmodSync(stagedBinary, 0o755)
    const stagedApp = path.join(scratchRoot, 'staged', 'Orca Computer Use.app')
    createHelperApp(stagedBinary, stagedApp, iconPath, signingIdentity, runCommand, captureCommand)
    publishArtifacts(
      {
        stagedBinary,
        stagedApp,
        outputBinary: canonicalOutputs.binary,
        outputApp: canonicalOutputs.app,
        scratchRoot
      },
      renameArtifact
    )
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function validateCanonicalOutputs(releaseRoot, outputBinary, outputApp) {
  if (!path.isAbsolute(outputBinary) || !path.isAbsolute(outputApp)) {
    throw new Error('Canonical computer helper outputs must use absolute paths')
  }
  const realReleaseRoot = realpathSync(releaseRoot)
  const binary = canonicalOutputPath(realReleaseRoot, outputBinary, 'binary')
  const app = canonicalOutputPath(realReleaseRoot, outputApp, 'app')
  if (binary === app) {
    throw new Error('Canonical computer helper binary and app outputs must be distinct')
  }
  return { binary, app }
}

function canonicalOutputPath(realReleaseRoot, output, label) {
  const realParent = realpathSync(path.dirname(output))
  assertContained(realReleaseRoot, realParent, `Canonical ${label} output`, 'release directory')
  return path.join(realParent, path.basename(output))
}

function buildSlice(packageDirectory, scratchRoot, slice, runCommand, captureCommand) {
  const scratchPath = path.join(scratchRoot, slice.architecture)
  const args = [
    'build',
    '-c',
    'release',
    '--package-path',
    packageDirectory,
    '--triple',
    slice.triple,
    '--scratch-path',
    scratchPath
  ]
  runCommand('swift', args)
  const rawBinPath = captureCommand('swift', [...args, '--show-bin-path'])
  const reportedBinPath = rawBinPath.trim()
  if (/\r|\n/.test(reportedBinPath)) {
    throw new Error('Swift binary output path must contain exactly one line')
  }
  if (!path.isAbsolute(reportedBinPath)) {
    throw new Error(`Swift binary output path is not absolute: ${reportedBinPath || '<empty>'}`)
  }
  const realScratchPath = realpathSync(scratchPath)
  const realBinPath = realpathSync(reportedBinPath)
  assertContained(realScratchPath, realBinPath, 'Swift binary output')
  const builtBinary = path.join(reportedBinPath, 'orca-computer-use-macos')
  assertRegularNonSymlink(builtBinary)
  assertContained(realScratchPath, realpathSync(builtBinary), 'Swift slice binary')
  assertExactArchitectures(builtBinary, [slice.architecture], captureCommand)
  return builtBinary
}

function assertContained(root, target, label, boundary = 'architecture scratch directory') {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its ${boundary}: ${target}`)
  }
}

function assertRegularNonSymlink(file) {
  const stat = lstatSync(file)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Expected a regular non-symlink file: ${file}`)
  }
}

function assertExactArchitectures(binary, expected, captureCommand) {
  const actual = captureCommand('lipo', ['-archs', binary]).trim().split(/\s+/).filter(Boolean)
  if (actual.length !== expected.length || expected.some((arch) => !actual.includes(arch))) {
    throw new Error(
      `Unexpected architectures for ${binary}: expected ${expected.join(' ')}, got ${actual.join(' ') || 'none'}`
    )
  }
}

function createHelperApp(binary, targetApp, icon, signingIdentity, runCommand, captureCommand) {
  const executable = path.join(targetApp, 'Contents', 'MacOS', 'orca-computer-use-macos')
  const targetIcon = path.join(targetApp, 'Contents', 'Resources', 'AppIcon.icns')
  mkdirSync(path.dirname(executable), { recursive: true })
  mkdirSync(path.dirname(targetIcon), { recursive: true })
  copyFileSync(binary, executable)
  copyFileSync(icon, targetIcon)
  chmodSync(executable, 0o755)
  writeFileSync(path.join(targetApp, 'Contents', 'Info.plist'), infoPlist(), 'utf8')
  assertRegularNonSymlink(executable)
  assertExactArchitectures(
    executable,
    universalSlices.map(({ architecture }) => architecture),
    captureCommand
  )
  runCommand('codesign', codesignArgs(signingIdentity, targetApp))
  runCommand('codesign', ['--verify', '--deep', '--strict', targetApp])
}

function publishArtifacts(artifacts, renameArtifact) {
  const backupDirectory = path.join(artifacts.scratchRoot, 'previous')
  mkdirSync(backupDirectory, { recursive: true })
  const previousBinary = path.join(backupDirectory, 'orca-computer-use-macos')
  const previousApp = path.join(backupDirectory, 'Orca Computer Use.app')
  const hadBinary = existsSync(artifacts.outputBinary)
  const hadApp = existsSync(artifacts.outputApp)
  let publishedBinary = false
  let publishedApp = false
  try {
    if (hadBinary) {
      renameArtifact(artifacts.outputBinary, previousBinary)
    }
    if (hadApp) {
      renameArtifact(artifacts.outputApp, previousApp)
    }
    renameArtifact(artifacts.stagedBinary, artifacts.outputBinary)
    publishedBinary = true
    renameArtifact(artifacts.stagedApp, artifacts.outputApp)
    publishedApp = true
  } catch (error) {
    if (publishedApp) {
      rmSync(artifacts.outputApp, { recursive: true, force: true })
    }
    if (publishedBinary) {
      rmSync(artifacts.outputBinary, { force: true })
    }
    if (hadBinary && existsSync(previousBinary)) {
      renameArtifact(previousBinary, artifacts.outputBinary)
    }
    if (hadApp && existsSync(previousApp)) {
      renameArtifact(previousApp, artifacts.outputApp)
    }
    throw error
  }
}

function codesignArgs(identity, targetPath) {
  const args = ['--force', '--deep', '--sign', identity]
  if (process.env.ORCA_MAC_RELEASE === '1' && identity !== '-') {
    args.push('--options', 'runtime', '--timestamp', '--entitlements', entitlementsPath)
  }
  args.push(targetPath)
  return args
}

function resolveSigningIdentity() {
  const explicitIdentity = process.env.ORCA_COMPUTER_MACOS_SIGN_IDENTITY ?? process.env.CSC_NAME
  if (explicitIdentity) {
    return explicitIdentity
  }
  const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })
  if (identities.status !== 0 || !identities.stdout) {
    return '-'
  }
  const developmentMatch = identities.stdout.match(/"([^"]*Apple Development:[^"]+)"/)
  if (process.env.ORCA_MAC_RELEASE !== '1' && developmentMatch) {
    return developmentMatch[1]
  }
  const releaseMatch =
    identities.stdout.match(/"([^"]*Developer ID Application:[^"]+)"/) ??
    identities.stdout.match(/"([^"]*Apple Distribution:[^"]+)"/)
  return releaseMatch?.[1] ?? developmentMatch?.[1] ?? '-'
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.signal || result.status !== 0) {
    throw new CommandFailure(command, result)
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.signal || result.status !== 0) {
    throw new CommandFailure(command, result)
  }
  return result.stdout
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>orca-computer-use-macos</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlist(bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>${escapePlist(displayName)}</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlist(displayName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAccessibilityUsageDescription</key>
  <string>Orca Computer Use needs Accessibility permission to read and interact with app interfaces when you ask Orca to use apps.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Orca Computer Use needs Screen Recording permission to capture app windows when you ask Orca to inspect your screen.</string>
</dict>
</plist>
`
}

function escapePlist(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
