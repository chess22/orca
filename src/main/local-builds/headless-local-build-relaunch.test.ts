import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
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

    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', env)).toBe(true)
    expect(env.ORCA_BACKGROUND_LAUNCH).toBe('1')
    expect(() => readFileSync(join(directory, 'headless-local-build-relaunch.json'))).toThrow()
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toBe(false)
  })

  it('does not hide a different or stale app launch', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    const now = Date.now()
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.2', {}, now)).toBe(false)
    expect(() => readFileSync(join(directory, 'headless-local-build-relaunch.json'))).toThrow()
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {}, now + 16 * 60_000)).toBe(false)
    expect(() => readFileSync(join(directory, 'headless-local-build-relaunch.json'))).toThrow()
  })

  it('atomically gives a staged marker to only one consumer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    stageHeadlessLocalBuildRelaunch(directory, '1.2.3')

    expect([
      consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {}),
      consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})
    ]).toEqual([true, false])
  })

  it('consumes and rejects malformed or old-format markers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-headless-relaunch-'))
    directories.push(directory)
    const marker = join(directory, 'headless-local-build-relaunch.json')
    writeFileSync(marker, '{not-json')
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toBe(false)
    expect(() => readFileSync(marker)).toThrow()
    writeFileSync(marker, JSON.stringify({ version: '1.2.3', createdAt: Date.now() }))
    expect(consumeHeadlessLocalBuildRelaunch(directory, '1.2.3', {})).toBe(false)
    expect(() => readFileSync(marker)).toThrow()
  })

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
    const consumeIndex = preflight.indexOf('consumeHeadlessLocalBuildRelaunch(')
    expect(initIndex).toBeGreaterThan(-1)
    expect(consumeIndex).toBeGreaterThan(initIndex)
    expect(ready).not.toContain('consumeHeadlessLocalBuildRelaunch')
  })
})
