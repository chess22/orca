import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfigFromFile } from 'electron-vite'
import {
  resolveElectronViteBuildInvocation,
  verifyRendererAfterElectronViteBuild
} from './electron-vite-build-invocation.mjs'

const require = createRequire(import.meta.url)
const packageJson = require('../../package.json')
const directories = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('electron-vite build config', () => {
  it('routes the normal build through one all-target config and clears an ambient target', () => {
    const defaultConfig = resolve('config/electron-vite-build.config.cts')
    const invocation = resolveElectronViteBuildInvocation(
      ['--mode', 'production'],
      { ORCA_ELECTRON_VITE_TARGET: 'main', KEEP: 'yes' },
      defaultConfig
    )

    expect(packageJson.scripts['build:electron-vite']).toBe(
      'pnpm run build:packages && node config/scripts/run-electron-vite-build.mjs'
    )
    expect(invocation.args).toEqual([
      '--config',
      defaultConfig,
      '--ignoreConfigWarning',
      '--mode',
      'production'
    ])
    expect(invocation.env).toEqual({ KEEP: 'yes' })
    expect(invocation.usesDefaultConfig).toBe(true)
    const verify = vi.fn(() => 0)
    expect(verifyRendererAfterElectronViteBuild(invocation.env, true, verify)).toBe(0)
    expect(verify).toHaveBeenCalledOnce()
  })

  it.each([
    ['main', false],
    ['preload', false],
    ['renderer', true]
  ])('applies the renderer verifier to an explicit %s target: %s', (target, expected) => {
    const verify = vi.fn(() => 0)
    expect(
      verifyRendererAfterElectronViteBuild({ ORCA_ELECTRON_VITE_TARGET: target }, true, verify)
    ).toBe(0)
    expect(verify).toHaveBeenCalledTimes(expected ? 1 : 0)
  })

  it('loads all targets from the normal wrapper despite an ambient target', async () => {
    const previous = process.env.ORCA_ELECTRON_VITE_TARGET
    process.env.ORCA_ELECTRON_VITE_TARGET = 'main'
    let loaded
    try {
      loaded = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        resolve('config/electron-vite-build.config.cts'),
        process.cwd(),
        'silent',
        true
      )
    } finally {
      if (previous === undefined) {
        delete process.env.ORCA_ELECTRON_VITE_TARGET
      } else {
        process.env.ORCA_ELECTRON_VITE_TARGET = previous
      }
    }

    expect(loaded?.config).toHaveProperty('main')
    expect(loaded?.config).toHaveProperty('preload')
    expect(loaded?.config).toHaveProperty('renderer')
  })

  it.each(['main', 'preload', 'renderer'])('loads only the selected %s target', async (target) => {
    const previous = process.env.ORCA_ELECTRON_VITE_TARGET
    process.env.ORCA_ELECTRON_VITE_TARGET = target
    try {
      const loaded = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        resolve('config/electron-vite-target.config.cts'),
        process.cwd(),
        'silent',
        true
      )
      expect(Object.keys(loaded?.config ?? {})).toEqual([target])
    } finally {
      if (previous === undefined) {
        delete process.env.ORCA_ELECTRON_VITE_TARGET
      } else {
        process.env.ORCA_ELECTRON_VITE_TARGET = previous
      }
    }
  })

  it('rejects an invalid selected target', async () => {
    const previous = process.env.ORCA_ELECTRON_VITE_TARGET
    process.env.ORCA_ELECTRON_VITE_TARGET = 'invalid'
    try {
      await expect(
        loadConfigFromFile(
          { command: 'build', mode: 'production' },
          resolve('config/electron-vite-target.config.cts'),
          process.cwd(),
          'silent',
          true
        )
      ).rejects.toThrow('Invalid ORCA_ELECTRON_VITE_TARGET: invalid')
    } finally {
      if (previous === undefined) {
        delete process.env.ORCA_ELECTRON_VITE_TARGET
      } else {
        process.env.ORCA_ELECTRON_VITE_TARGET = previous
      }
    }
  })

  it.each([
    ['long', ['--config', 'custom.cts']],
    ['long equals', ['--config=custom.cts']],
    ['short', ['-c', 'custom.cts']],
    ['short attached', ['-ccustom.cts']]
  ])('preserves one explicit config in %s form', (_label, args) => {
    const invocation = resolveElectronViteBuildInvocation(
      args,
      { ORCA_ELECTRON_VITE_TARGET: 'renderer' },
      'default.cts'
    )
    expect(invocation.args).toEqual(args)
    expect(invocation.env.ORCA_ELECTRON_VITE_TARGET).toBe('renderer')
    expect(invocation.usesDefaultConfig).toBe(false)
  })

  it('rejects repeated explicit configs before electron-vite can array-coerce them', () => {
    expect(() =>
      resolveElectronViteBuildInvocation(
        ['--config', 'first.cts', '-csecond.cts'],
        {},
        'default.cts'
      )
    ).toThrow('exactly one explicit config')
  })

  it.each(['--config', '-c', '--config='])(
    'rejects an explicit config without a path: %s',
    (argument) => {
      expect(() => resolveElectronViteBuildInvocation([argument], {}, 'default.cts')).toThrow(
        'requires one config path'
      )
    }
  )

  it('loads a caller-supplied config without adding the default', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-electron-vite-explicit-'))
    directories.push(directory)
    const configPath = join(directory, 'custom.cts')
    writeFileSync(configPath, "export default { preload: { define: { EXPLICIT: 'yes' } } }\n")
    const invocation = resolveElectronViteBuildInvocation(
      ['--config', configPath],
      {},
      'default.cts'
    )
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      invocation.args[1],
      directory,
      'silent',
      true
    )
    expect(loaded?.config).toEqual({ preload: { define: { EXPLICIT: 'yes' } } })
  })

  it.each([
    ['clean', false, 'attested'],
    ['dirty', true, 'unattested']
  ])(
    'reports a %s checkout through CommonJS config loading',
    async (_label, dirty, attestation) => {
      const repository = mkdtempSync(join(tmpdir(), 'orca-electron-vite-config-'))
      const resultFile = join(
        tmpdir(),
        `orca-electron-vite-config-${process.pid}-${Date.now()}.json`
      )
      directories.push(repository, resultFile)
      const configPath = join(repository, 'electron.vite.config.cts')
      const sourceStateModule = resolve('config/scripts/build-source-commit.mjs')
      const provenanceModule = resolve('config/scripts/build-runtime-provenance.mjs')
      writeFileSync(
        configPath,
        `import { resolveBuildSourceState } from ${JSON.stringify(sourceStateModule)}
import { resolveRuntimeBuildProvenance } from ${JSON.stringify(provenanceModule)}
import { writeFileSync } from 'node:fs'
const source = resolveBuildSourceState()
const provenance = resolveRuntimeBuildProvenance({
  sourceCommit: source.commit,
  sourceDirty: source.dirty,
  packageName: 'orca',
  packageVersion: '1.0.0',
  env: {}
})
writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ source, provenance }))
export default { main: {} }
`
      )
      execFileSync('git', ['init', '--quiet'], { cwd: repository })
      execFileSync('git', ['add', 'electron.vite.config.cts'], { cwd: repository })
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Orca Test',
          '-c',
          'user.email=orca@example.invalid',
          'commit',
          '--quiet',
          '-m',
          'fixture'
        ],
        { cwd: repository }
      )
      if (dirty) {
        writeFileSync(join(repository, 'dirty.txt'), 'dirty\n')
      }

      const originalCwd = process.cwd()
      try {
        process.chdir(repository)
        await loadConfigFromFile(
          { command: 'build', mode: 'production' },
          configPath,
          repository,
          'silent',
          true
        )
      } finally {
        process.chdir(originalCwd)
      }

      const result = JSON.parse(readFileSync(resultFile, 'utf8'))
      expect(result.source.dirty).toBe(dirty)
      expect(result.provenance.attestation).toBe(attestation)
      expect(readdirSync(repository).filter((name) => name.includes('.cts.'))).toEqual([])
    }
  )
})
