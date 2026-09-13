import { describe, expect, it, vi } from 'vitest'
import type { PlaneConnection } from '../../shared/plane-types'
import { normalizePlaneApiRoot, PlaneApiClient } from './api-client'
import type { PlaneApiError } from './api-client'

const connection: PlaneConnection = {
  baseUrl: 'https://plane.example.test/',
  workspaceSlug: 'orca team',
  projectId: 'project/id',
  apiKey: 'secret'
}

describe('Plane API client', () => {
  it('normalizes cloud and self-hosted API roots', () => {
    expect(normalizePlaneApiRoot('https://api.plane.so')).toBe('https://api.plane.so/api/v1')
    expect(normalizePlaneApiRoot('http://plane.local/api/v1/')).toBe('http://plane.local/api/v1')
  })

  it('encodes tenant path segments and sends the API key only as a header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'item' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    const client = new PlaneApiClient(connection, fetchImpl)

    await client.request(client.workItemsPath())

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://plane.example.test/api/v1/workspaces/orca%20team/projects/project%2Fid/work-items/'
    )
    expect(new Headers(init.headers).get('X-API-Key')).toBe('secret')
    expect(String(url)).not.toContain('secret')
  })

  it('surfaces structured API errors without exposing the credential', async () => {
    const client = new PlaneApiClient(
      connection,
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 }))
    )

    await expect(client.request(client.statesPath())).rejects.toMatchObject({
      status: 403,
      message: 'Plane API 403: Forbidden'
    } satisfies Partial<PlaneApiError>)
  })
})
