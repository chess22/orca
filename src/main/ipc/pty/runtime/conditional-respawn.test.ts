import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderForPty = vi.hoisted(() => vi.fn())
vi.mock('../provider/registry', () => ({ getProviderForPty }))

import { respawnPtyIfMatch } from './conditional-respawn'

const replacement = { cols: 80, rows: 24 }

describe('respawnPtyIfMatch', () => {
  beforeEach(() => getProviderForPty.mockReset())

  it('returns unsupported when the resolved owner lacks conditional respawn', async () => {
    getProviderForPty.mockReturnValue({})

    await expect(
      respawnPtyIfMatch('pty', 'incarnation', 4242, 'mutation', replacement)
    ).resolves.toEqual({
      outcome: 'unsupported',
      mutationId: 'mutation',
      reason: 'provider'
    })
  })

  it('reports a lost provider response as indeterminate without invented facts', async () => {
    getProviderForPty.mockReturnValue({
      respawnIfMatch: vi.fn().mockRejectedValue(new Error('connection lost'))
    })

    await expect(
      respawnPtyIfMatch('pty', 'incarnation', 4242, 'mutation', replacement)
    ).resolves.toEqual({
      outcome: 'indeterminate',
      mutationId: 'mutation',
      reason: 'provider_response_lost'
    })
  })
})
