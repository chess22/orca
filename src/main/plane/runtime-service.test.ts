import { describe, expect, it } from 'vitest'
import { createPlaneRuntimeService, getPlaneRuntimeStatus } from './runtime-service'

describe('Plane runtime service', () => {
  it('reports missing configuration without exposing API keys', () => {
    expect(getPlaneRuntimeStatus({ ORCA_PLANE_API_KEY: 'secret' })).toEqual({
      configured: false,
      baseUrl: null,
      workspaceSlug: null,
      projectId: null,
      missing: ['ORCA_PLANE_BASE_URL', 'ORCA_PLANE_WORKSPACE_SLUG', 'ORCA_PLANE_PROJECT_ID'],
      actor: 'ai'
    })
  })

  it('constructs an AI-only service from complete runtime configuration', () => {
    expect(() =>
      createPlaneRuntimeService({
        ORCA_PLANE_BASE_URL: 'https://plane.example.test',
        ORCA_PLANE_WORKSPACE_SLUG: 'orca',
        ORCA_PLANE_PROJECT_ID: 'project-id',
        ORCA_PLANE_API_KEY: 'secret'
      })
    ).not.toThrow()
  })

  it('fails closed when the credential is missing', () => {
    expect(() =>
      createPlaneRuntimeService({
        ORCA_PLANE_BASE_URL: 'https://plane.example.test',
        ORCA_PLANE_WORKSPACE_SLUG: 'orca',
        ORCA_PLANE_PROJECT_ID: 'project-id'
      })
    ).toThrow('ORCA_PLANE_API_KEY')
  })

  it('keeps 承認済 protected when extra approval names are configured', async () => {
    const service = createPlaneRuntimeService(
      {
        ORCA_PLANE_BASE_URL: 'https://plane.example.test',
        ORCA_PLANE_WORKSPACE_SLUG: 'orca',
        ORCA_PLANE_PROJECT_ID: 'project-id',
        ORCA_PLANE_API_KEY: 'secret',
        ORCA_PLANE_APPROVAL_STATE_NAMES: 'Approved'
      },
      async () =>
        new Response(JSON.stringify([{ id: 'approved', name: '承認済', group: 'completed' }]))
    )

    await expect(service.setWorkItemState('item', 'approved')).rejects.toThrow(
      'AI actors may not move Plane work items to protected state'
    )
  })
})
