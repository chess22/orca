import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyHeadlessLocalBuildRelaunchPreflight,
  consumeHeadlessLocalBuildRelaunch,
  stageHeadlessLocalBuildRelaunch
} from './headless-local-build-relaunch'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('headless local build relaunch marker', () => {
  it('carries background launch policy across the native updater process boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    const env: NodeJS.ProcessEnv = {}

    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', env)).toEqual({
      state: 'accepted'
    })
    expect(env.ORCA_BACKGROUND_LAUNCH).toBe('1')
    expect(() => readFileSync(join(directory, 'headless-local-build-relaunch.json'))).toThrow()
    expect(
      statSync(join(directory, 'headless-local-build-relaunch.claimed.json')).mode & 0o777
    ).toBe(0o600)
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toEqual({
      state: 'rejected',
      reason: 'already_claimed'
    })
  })

  it('rejects a version mismatch without falling through to a foreground launch', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    const now = Date.now()
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.2', {}, now)).toEqual({
      state: 'rejected',
      reason: 'version_mismatch'
    })
    expect(() => readFileSync(join(directory, 'headless-local-build-relaunch.json'))).toThrow()
  })

  it('rejects a stale marker without falling through to a foreground launch', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    const now = Date.now()
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {}, now + 16 * 60_000)).toEqual({
      state: 'rejected',
      reason: 'stale'
    })
    expect(() => readFileSync(join(directory, 'headless-local-build-relaunch.json'))).toThrow()
  })

  it('atomically gives a staged marker to only one consumer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')

    expect([
      consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {}),
      consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})
    ]).toEqual([{ state: 'accepted' }, { state: 'rejected', reason: 'already_claimed' }])
  })

  it('replaces an existing permissive temp file and keeps the marker and claim private', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    const marker = join(directory, 'headless-local-build-relaunch.json')
    const temporary = `${marker}.${process.pid}.tmp`
    writeFileSync(temporary, 'old', { mode: 0o644 })

    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    expect(statSync(marker).mode & 0o777).toBe(0o600)
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toEqual({
      state: 'accepted'
    })
    expect(
      statSync(join(directory, 'headless-local-build-relaunch.claimed.json')).mode & 0o777
    ).toBe(0o600)
  })

  it('consumes and rejects malformed or old-format markers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    const marker = join(directory, 'headless-local-build-relaunch.json')
    writeFileSync(marker, '{not-json')
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toEqual({
      state: 'rejected',
      reason: 'malformed'
    })
    expect(() => readFileSync(marker)).toThrow()
    rmSync(join(directory, 'headless-local-build-relaunch.claimed.json'), { force: true })
    writeFileSync(marker, JSON.stringify({ version: '1.2.3', createdAt: Date.now() }))
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toEqual({
      state: 'rejected',
      reason: 'malformed'
    })
    expect(() => readFileSync(marker)).toThrow()
  })

  it('keeps an ordinary launch unchanged when no marker or fresh claim exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)

    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toEqual({ state: 'missing' })
  })

  it.each([
    ['missing', false],
    ['accepted', true]
  ] as const)('continues preflight for a %s marker result', (_state, staged) => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    if (staged) {
      stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    }
    const env: NodeJS.ProcessEnv = {}
    const exit = vi.fn()
    const record = vi.fn()

    expect(
      applyHeadlessLocalBuildRelaunchPreflight(directory, '1.2.3', exit, { env, record })
    ).toBe(true)
    expect(env.ORCA_BACKGROUND_LAUNCH).toBe(staged ? '1' : undefined)
    expect(exit).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed', '{not-json', '1.2.3', Date.now()],
    ['malformed', 'null', '1.2.3', Date.now()],
    [
      'stale',
      JSON.stringify({ formatVersion: 1, version: '1.2.3', createdAt: 1 }),
      '1.2.3',
      16 * 60_000
    ],
    [
      'version_mismatch',
      JSON.stringify({ formatVersion: 1, version: '1.2.3', createdAt: 1 }),
      '1.2.2',
      1
    ]
  ] as const)(
    'exits windowless before startup after a %s marker',
    (reason, contents, version, now) => {
      const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
      directories.push(directory)
      writeFileSync(join(directory, 'headless-local-build-relaunch.json'), contents, {
        mode: 0o600
      })
      const env: NodeJS.ProcessEnv = {}
      const exits: number[] = []
      const records: string[] = []

      expect(
        applyHeadlessLocalBuildRelaunchPreflight(directory, version, (code) => exits.push(code), {
          env,
          now,
          record: (message) => records.push(message)
        })
      ).toBe(false)
      expect(env.ORCA_BACKGROUND_LAUNCH).toBe('1')
      expect(exits).toEqual([78])
      expect(records).toEqual([expect.stringContaining(reason)])
    }
  )

  it('consumes the marker in main-process preflight rather than after app ready', () => {
    const preflight = readFileSync(
      join(process.cwd(), 'src/main/startup/main-process-preflight.ts'),
      'utf8'
    )
    const ready = readFileSync(
      join(process.cwd(), 'src/main/startup/main-process-ready-foundation.ts'),
      'utf8'
    )
    const initIndex = preflight.indexOf('initDataPath()')
    const consumeIndex = preflight.indexOf('applyHeadlessLocalBuildRelaunchAppPreflight(')
    expect(initIndex).toBeGreaterThan(-1)
    expect(consumeIndex).toBeGreaterThan(initIndex)
    expect(ready).not.toContain('applyHeadlessLocalBuildRelaunchPreflight')
  })
})
