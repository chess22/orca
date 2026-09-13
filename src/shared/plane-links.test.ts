import { describe, expect, it } from 'vitest'
import { buildPlaneWorkItemUrl, parsePlaneWorkItemUrl } from './plane-links'

describe('Plane work item links', () => {
  it('round-trips a self-hosted browse URL with an explicit project identity', () => {
    const url = buildPlaneWorkItemUrl({
      baseUrl: 'https://plane.example.test/',
      workspaceSlug: 'orca team',
      projectId: 'project-id',
      workItemId: 'work-item-id'
    })

    expect(url).toBe(
      'https://plane.example.test/orca%20team/browse/work-item-id?project=project-id'
    )
    expect(parsePlaneWorkItemUrl(url)).toEqual({
      provider: 'plane',
      baseUrl: 'https://plane.example.test',
      workspaceSlug: 'orca team',
      projectId: 'project-id',
      workItemId: 'work-item-id',
      url
    })
  })

  it('rejects links without enough identity to make an unambiguous API request', () => {
    expect(parsePlaneWorkItemUrl('https://plane.example.test/team/browse/item')).toBeNull()
    expect(parsePlaneWorkItemUrl('file:///team/browse/item?project=project-id')).toBeNull()
    expect(
      parsePlaneWorkItemUrl(
        'https://plane.example.test/api/v1/workspaces/team/projects/project-id/work-items/item-id/comments/'
      )
    ).toBeNull()
  })

  it('accepts a self-hosted REST resource URL as an unambiguous locator', () => {
    expect(
      parsePlaneWorkItemUrl(
        'https://plane.example.test/api/v1/workspaces/orca/projects/project-id/work-items/item-id/'
      )
    ).toMatchObject({
      workspaceSlug: 'orca',
      projectId: 'project-id',
      workItemId: 'item-id',
      url: 'https://plane.example.test/orca/browse/item-id?project=project-id'
    })
  })
})
