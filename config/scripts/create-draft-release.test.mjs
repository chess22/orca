import { describe, expect, it, vi } from 'vitest'
import { createDraftRelease, truncateReleaseBody } from './create-draft-release.mjs'

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: vi.fn(async () => body),
    text: vi.fn(async () => (typeof body === 'string' ? body : JSON.stringify(body)))
  }
}

describe('truncateReleaseBody', () => {
  it('leaves short release notes unchanged', () => {
    expect(truncateReleaseBody('short notes', 120_000)).toBe('short notes')
  })

  it('caps long release notes and appends an explanation', () => {
    const body = truncateReleaseBody('a'.repeat(130_000), 1_000)

    expect(body).toHaveLength(1_000)
    expect(body).toContain('Release notes were truncated')
  })
})

describe('createDraftRelease', () => {
  it('creates a draft release with bounded generated notes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ name: 'v1.4.36', body: 'a'.repeat(130_000) }))
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v1.4.36', draft: true }))

    await createDraftRelease({
      repo: 'stablyai/orca',
      tag: 'v1.4.36',
      token: 'token',
      previousTag: 'v1.4.35',
      fetchImpl,
      log: vi.fn()
    })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/stablyai/orca/releases/generate-notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tag_name: 'v1.4.36',
          target_commitish: 'v1.4.36',
          previous_tag_name: 'v1.4.35'
        })
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/stablyai/orca/releases',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String)
      })
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const createBody = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(createBody).toMatchObject({
      tag_name: 'v1.4.36',
      name: 'v1.4.36',
      draft: true,
      prerelease: false
    })
    expect(createBody.body).toHaveLength(120_000)
    expect(createBody.body).toContain('Release notes were truncated')
  })

  it('marks rc tags as prereleases', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ name: 'v1.4.36-rc.1', body: 'notes' }))
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v1.4.36-rc.1', draft: true }))

    await createDraftRelease({
      repo: 'stablyai/orca',
      tag: 'v1.4.36-rc.1',
      token: 'token',
      previousTag: 'v1.4.36',
      fetchImpl,
      log: vi.fn()
    })

    const createBody = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(createBody.prerelease).toBe(true)
  })

  it('omits previous_tag_name when no previous desktop release exists', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ name: 'v1.0.0', body: 'notes' }))
      .mockResolvedValueOnce(jsonResponse({ tag_name: 'v1.0.0', draft: true }))

    await createDraftRelease({
      repo: 'stablyai/orca',
      tag: 'v1.0.0',
      token: 'token',
      previousTag: '',
      fetchImpl,
      log: vi.fn()
    })

    const generateNotesBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(generateNotesBody).toEqual({
      tag_name: 'v1.0.0',
      target_commitish: 'v1.0.0'
    })
  })

  it('rejects a non-desktop previous tag', async () => {
    await expect(
      createDraftRelease({
        repo: 'stablyai/orca',
        tag: 'v1.4.36',
        token: 'token',
        previousTag: 'mobile-v0.0.12',
        fetchImpl: vi.fn(),
        log: vi.fn()
      })
    ).rejects.toThrow('previousTag must be a desktop release tag')
  })
})
