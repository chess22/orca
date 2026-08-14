import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LOCAL_ORCA_PROFILE_ID } from '../../shared/orca-profiles'
import { migrateLegacyClaudeLivePtyIds } from './legacy-claude-live-pty-migration'

const testState = vi.hoisted(() => ({ directory: '' }))

beforeEach(() => {
  testState.directory = mkdtempSync(join(tmpdir(), 'orca-legacy-claude-live-pty-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testState.directory, { recursive: true, force: true })
})

function writeLegacyState(state: Record<string, unknown>): string {
  const dataFile = join(testState.directory, 'orca-data.json')
  writeFileSync(dataFile, JSON.stringify(state), 'utf-8')
  return dataFile
}

describe('migrateLegacyClaudeLivePtyIds', () => {
  it('moves exact legacy ids into local-default without replacing unrelated root state', () => {
    const dataFile = writeLegacyState({
      settings: { theme: 'dark' },
      claudeLivePtySessionIds: ['pty-one', 'pty-two', 'pty-one', '', 42]
    })
    const ids: string[] = []
    const store = {
      addClaudeLivePtySessionId: vi.fn((id: string) => {
        if (!ids.includes(id)) {
          ids.push(id)
        }
      }),
      getClaudeLivePtySessionIds: () => [...ids],
      flushOrThrow: vi.fn()
    }

    expect(
      migrateLegacyClaudeLivePtyIds({
        profileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
        store,
        userDataPath: testState.directory
      })
    ).toBe(2)
    expect(ids).toEqual(['pty-one', 'pty-two'])
    expect(store.flushOrThrow).toHaveBeenCalledOnce()
    expect(JSON.parse(readFileSync(dataFile, 'utf-8'))).toEqual({
      settings: { theme: 'dark' },
      claudeLivePtySessionIds: []
    })
  })

  it('does not import legacy ids into another profile authority', () => {
    const dataFile = writeLegacyState({ claudeLivePtySessionIds: ['pty-one'] })
    const store = {
      addClaudeLivePtySessionId: vi.fn(),
      getClaudeLivePtySessionIds: vi.fn(() => []),
      flushOrThrow: vi.fn()
    }

    expect(
      migrateLegacyClaudeLivePtyIds({
        profileId: 'another-profile',
        store,
        userDataPath: testState.directory
      })
    ).toBe(0)
    expect(store.addClaudeLivePtySessionId).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(dataFile, 'utf-8')).claudeLivePtySessionIds).toEqual(['pty-one'])
  })

  it('keeps legacy ids when the profile cannot be flushed', () => {
    const dataFile = writeLegacyState({ claudeLivePtySessionIds: ['pty-one'] })
    const store = {
      addClaudeLivePtySessionId: vi.fn(),
      getClaudeLivePtySessionIds: vi.fn(() => ['pty-one']),
      flushOrThrow: vi.fn(() => {
        throw new Error('profile write failed')
      })
    }

    expect(() =>
      migrateLegacyClaudeLivePtyIds({
        profileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
        store,
        userDataPath: testState.directory
      })
    ).toThrow('profile write failed')
    expect(JSON.parse(readFileSync(dataFile, 'utf-8')).claudeLivePtySessionIds).toEqual(['pty-one'])
  })
})
