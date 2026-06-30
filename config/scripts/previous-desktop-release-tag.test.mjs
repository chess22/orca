import { describe, expect, it, vi } from 'vitest'
import {
  gitTagNames,
  latestPreviousDesktopReleaseTag,
  parseDesktopReleaseTag,
  previousDesktopReleaseTagFromGit
} from './previous-desktop-release-tag.mjs'

describe('parseDesktopReleaseTag', () => {
  it('parses stable and rc desktop release tags only', () => {
    expect(parseDesktopReleaseTag('v1.4.36')).toMatchObject({
      tag: 'v1.4.36',
      major: 1,
      minor: 4,
      patch: 36,
      rc: null
    })
    expect(parseDesktopReleaseTag('v1.4.36-rc.2')).toMatchObject({
      tag: 'v1.4.36-rc.2',
      major: 1,
      minor: 4,
      patch: 36,
      rc: 2
    })
    expect(parseDesktopReleaseTag('mobile-v0.0.12')).toBeNull()
  })
})

describe('latestPreviousDesktopReleaseTag', () => {
  it('bounds stable notes to the previous rc when one exists', () => {
    expect(latestPreviousDesktopReleaseTag(['v1.4.35', 'v1.4.36-rc.0', 'v1.4.36'], 'v1.4.36')).toBe(
      'v1.4.36-rc.0'
    )
  })

  it('bounds the first rc notes to the previous stable release', () => {
    expect(
      latestPreviousDesktopReleaseTag(['v1.4.35', 'v1.4.36-rc.0', 'mobile-v0.0.12'], 'v1.4.36-rc.0')
    ).toBe('v1.4.35')
  })

  it('bounds later rc notes to the prior rc', () => {
    expect(latestPreviousDesktopReleaseTag(['v1.4.36-rc.0', 'v1.4.36-rc.1'], 'v1.4.36-rc.1')).toBe(
      'v1.4.36-rc.0'
    )
  })

  it('orders rc numbers numerically', () => {
    expect(latestPreviousDesktopReleaseTag(['v1.4.36-rc.2', 'v1.4.36-rc.10'], 'v1.4.36')).toBe(
      'v1.4.36-rc.10'
    )
  })
})

describe('gitTagNames', () => {
  it('reads local git tag names without network access', () => {
    const execFileSyncImpl = vi.fn(() => 'v1.4.35\n\nv1.4.36-rc.0\n')

    expect(gitTagNames({ cwd: '/repo', execFileSyncImpl })).toEqual(['v1.4.35', 'v1.4.36-rc.0'])
    expect(execFileSyncImpl).toHaveBeenCalledWith(
      'git',
      ['tag', '--list'],
      expect.objectContaining({
        cwd: '/repo',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )
  })
})

describe('previousDesktopReleaseTagFromGit', () => {
  it('selects the previous desktop tag from local git tags', () => {
    const execFileSyncImpl = vi.fn(() => 'mobile-v0.0.12\nv1.4.35\nv1.4.36-rc.0\nv1.4.36\n')

    expect(previousDesktopReleaseTagFromGit('v1.4.36', { execFileSyncImpl })).toBe('v1.4.36-rc.0')
  })

  it('does not inspect git for non-desktop tags', () => {
    const execFileSyncImpl = vi.fn(() => {
      throw new Error('git should not be called')
    })

    expect(previousDesktopReleaseTagFromGit('mobile-v0.0.12', { execFileSyncImpl })).toBe('')
    expect(execFileSyncImpl).not.toHaveBeenCalled()
  })
})
