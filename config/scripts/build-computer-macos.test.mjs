import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildComputerMacosArtifacts, shouldBuildComputerMacos } from './build-computer-macos.mjs'

const directories = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createHarness(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-computer-macos-'))
  directories.push(root)
  const packageDirectory = path.join(root, options.packageName ?? 'package')
  const release = path.join(packageDirectory, '.build', 'release')
  const outputBinary = path.join(release, 'orca-computer-use-macos')
  const outputApp = path.join(release, 'Orca Computer Use.app')
  const iconPath = path.join(root, 'AppIcon.icns')
  mkdirSync(outputApp, { recursive: true })
  writeFileSync(outputBinary, 'old-binary')
  writeFileSync(path.join(outputApp, 'old-app'), 'old-app')
  writeFileSync(iconPath, 'icon')
  const scratchRoots = []
  const runCommand = vi.fn((command, args) => {
    if (command === 'swift') {
      const scratch = args[args.indexOf('--scratch-path') + 1]
      scratchRoots.push(path.dirname(scratch))
      const binPath = path.join(scratch, 'out', 'Products', 'Release')
      mkdirSync(binPath, { recursive: true })
      writeFileSync(path.join(binPath, 'orca-computer-use-macos'), path.basename(scratch))
      options.onSwift?.({ args, scratch, binPath })
      return
    }
    if (command === 'lipo') {
      options.onLipo?.({ args })
      writeFileSync(args[args.indexOf('-output') + 1], 'new-universal')
      return
    }
    if (command === 'codesign') {
      options.onCodesign?.({ args })
    }
  })
  const captureCommand = vi.fn((command, args) => {
    if (command === 'swift') {
      const scratch = args[args.indexOf('--scratch-path') + 1]
      return (
        options.showBinPath?.({ args, scratch }) ?? path.join(scratch, 'out', 'Products', 'Release')
      )
    }
    const binary = args[1]
    return (
      options.architectures?.(binary) ??
      (binary.includes(`${path.sep}arm64${path.sep}`)
        ? 'arm64'
        : binary.includes(`${path.sep}x86_64${path.sep}`)
          ? 'x86_64'
          : 'arm64 x86_64')
    )
  })
  const build = (overrides = {}) =>
    buildComputerMacosArtifacts({
      packageDirectory,
      outputBinary,
      outputApp,
      iconPath,
      signingIdentity: '-',
      runCommand,
      captureCommand,
      ...overrides
    })
  return {
    root,
    packageDirectory,
    outputBinary,
    outputApp,
    iconPath,
    scratchRoots,
    runCommand,
    build
  }
}

function expectCanonicalPreserved(harness) {
  expect(readFileSync(harness.outputBinary, 'utf8')).toBe('old-binary')
  expect(readFileSync(path.join(harness.outputApp, 'old-app'), 'utf8')).toBe('old-app')
  expectScratchClean(harness)
}

function expectScratchClean(harness) {
  expect(
    readdirSync(path.join(harness.packageDirectory, '.build')).filter((entry) =>
      entry.startsWith('orca-computer-use-universal-')
    )
  ).toEqual([])
}

describe('build-computer-macos artifacts', () => {
  it('uses unique per-build and per-architecture scratch, then publishes signed artifacts', () => {
    const harness = createHarness()

    harness.build()

    expect(new Set(harness.scratchRoots).size).toBe(1)
    expect(readFileSync(harness.outputBinary, 'utf8')).toBe('new-universal')
    expect(
      readFileSync(
        path.join(harness.outputApp, 'Contents', 'MacOS', 'orca-computer-use-macos'),
        'utf8'
      )
    ).toBe('new-universal')
    expect(harness.runCommand).toHaveBeenCalledWith(
      'codesign',
      expect.arrayContaining(['--sign', '-', expect.stringContaining('Orca Computer Use.app')])
    )
    expect(harness.runCommand).toHaveBeenCalledWith('codesign', [
      '--verify',
      '--deep',
      '--strict',
      expect.stringContaining('Orca Computer Use.app')
    ])
    expectScratchClean(harness)

    harness.build()
    expect(new Set(harness.scratchRoots).size).toBe(2)
    expectScratchClean(harness)
  })

  it('rejects a relative Swift output path before reading a slice', () => {
    const harness = createHarness({ showBinPath: () => 'out/Products/Release' })
    expect(() => harness.build()).toThrow(/not absolute/)
    expectCanonicalPreserved(harness)
  })

  it('rejects multiline Swift output instead of choosing a path', () => {
    const harness = createHarness({
      showBinPath: ({ scratch }) => {
        const binPath = path.join(scratch, 'out', 'Products', 'Release')
        return `${binPath}\n${binPath}`
      }
    })
    expect(() => harness.build()).toThrow(/exactly one line/)
    expectCanonicalPreserved(harness)
  })

  it('rejects an absolute Swift output path outside its architecture scratch', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'orca-computer-outside-'))
    directories.push(outside)
    writeFileSync(path.join(outside, 'orca-computer-use-macos'), 'outside')
    const harness = createHarness({ showBinPath: () => outside })
    expect(() => harness.build()).toThrow(/escapes its architecture scratch directory/)
    expectCanonicalPreserved(harness)
  })

  it('rejects a nonexistent Swift output path', () => {
    const harness = createHarness({
      showBinPath: ({ scratch }) => path.join(scratch, 'missing', 'Products', 'Release')
    })
    expect(() => harness.build()).toThrow(/ENOENT/)
    expectCanonicalPreserved(harness)
  })

  it('rejects a Swift output-directory symlink that escapes scratch', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'orca-computer-outside-'))
    directories.push(outside)
    writeFileSync(path.join(outside, 'orca-computer-use-macos'), 'outside')
    const harness = createHarness({
      onSwift: ({ scratch }) => symlinkSync(outside, path.join(scratch, 'escaped')),
      showBinPath: ({ scratch }) => path.join(scratch, 'escaped')
    })
    expect(() => harness.build()).toThrow(/escapes its architecture scratch directory/)
    expectCanonicalPreserved(harness)
  })

  it('rejects a symlink slice even when its target stays under scratch', () => {
    const harness = createHarness({
      onSwift: ({ scratch, binPath }) => {
        const realSlice = path.join(scratch, 'real-slice')
        writeFileSync(realSlice, 'slice')
        const slice = path.join(binPath, 'orca-computer-use-macos')
        rmSync(slice)
        symlinkSync(realSlice, slice)
      }
    })
    expect(() => harness.build()).toThrow(/regular non-symlink file/)
    expectCanonicalPreserved(harness)
  })

  it('rejects a slice with the wrong architecture', () => {
    const harness = createHarness({ architectures: () => 'arm64 x86_64' })
    expect(() => harness.build()).toThrow(/expected arm64, got arm64 x86_64/)
    expectCanonicalPreserved(harness)
  })

  it('rejects an x86 slice whose binary reports arm64', () => {
    const harness = createHarness({
      architectures: (binary) =>
        binary.includes(`${path.sep}x86_64${path.sep}`) ? 'arm64' : 'arm64'
    })
    expect(() => harness.build()).toThrow(/expected x86_64, got arm64/)
    expectCanonicalPreserved(harness)
  })

  it('rejects a universal output with an extra architecture', () => {
    const harness = createHarness({
      architectures: (binary) =>
        binary.includes(`${path.sep}arm64${path.sep}`)
          ? 'arm64'
          : binary.includes(`${path.sep}x86_64${path.sep}`)
            ? 'x86_64'
            : 'arm64 x86_64 i386'
    })
    expect(() => harness.build()).toThrow(/expected arm64 x86_64, got arm64 x86_64 i386/)
    expectCanonicalPreserved(harness)
  })

  it('rejects a missing slice binary', () => {
    const harness = createHarness({
      onSwift: ({ binPath }) => rmSync(path.join(binPath, 'orca-computer-use-macos'))
    })
    expect(() => harness.build()).toThrow(/ENOENT/)
    expectCanonicalPreserved(harness)
  })

  it.each(['outputBinary', 'outputApp'])('rejects an injected %s outside release', (key) => {
    const harness = createHarness()
    const outside = path.join(harness.root, 'outside')
    mkdirSync(outside)
    const target = path.join(outside, key === 'outputBinary' ? 'helper' : 'Helper.app')
    expect(() => harness.build({ [key]: target })).toThrow(/escapes its release directory/)
    expectCanonicalPreserved(harness)
  })

  it('rejects an output parent symlink that escapes release', () => {
    const harness = createHarness()
    const outside = path.join(harness.root, 'outside')
    mkdirSync(outside)
    const linkedParent = path.join(harness.packageDirectory, '.build', 'release', 'linked')
    symlinkSync(outside, linkedParent)
    expect(() => harness.build({ outputBinary: path.join(linkedParent, 'helper') })).toThrow(
      /escapes its release directory/
    )
    expectCanonicalPreserved(harness)
  })

  it('builds when the package and scratch paths contain spaces', () => {
    const harness = createHarness({ packageName: 'package with spaces' })
    harness.build()
    expect(readFileSync(harness.outputBinary, 'utf8')).toBe('new-universal')
    expectScratchClean(harness)
  })

  it('runs only on Darwin', () => {
    expect(shouldBuildComputerMacos('darwin')).toBe(true)
    expect(shouldBuildComputerMacos('linux')).toBe(false)
    expect(shouldBuildComputerMacos('win32')).toBe(false)
  })

  it('preserves both canonical targets and cleans scratch when lipo fails', () => {
    const harness = createHarness({
      onLipo: () => {
        throw new Error('lipo failed')
      }
    })
    expect(() => harness.build()).toThrow('lipo failed')
    expectCanonicalPreserved(harness)
  })

  it('preserves both canonical targets and cleans scratch when app copy fails', () => {
    const harness = createHarness()
    rmSync(harness.iconPath)
    expect(() => harness.build()).toThrow(/ENOENT/)
    expectCanonicalPreserved(harness)
  })

  it('preserves both canonical targets and cleans scratch when signing fails', () => {
    const harness = createHarness({
      onCodesign: ({ args }) => {
        if (args[0] === '--force') {
          throw new Error('codesign failed')
        }
      }
    })
    expect(() => harness.build()).toThrow('codesign failed')
    expectCanonicalPreserved(harness)
  })

  it('restores both canonical targets if the second publish rename fails', () => {
    const harness = createHarness()
    const renameArtifact = vi.fn((source, target) => {
      if (source.includes(`${path.sep}staged${path.sep}Orca Computer Use.app`)) {
        throw new Error('app publish failed')
      }
      renameSync(source, target)
    })
    expect(() => harness.build({ renameArtifact })).toThrow('app publish failed')
    expectCanonicalPreserved(harness)
  })
})
