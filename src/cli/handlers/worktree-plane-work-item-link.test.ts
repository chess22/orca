import { describe, expect, it } from 'vitest'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalPlaneWorkItemLinkFlag } from './worktree-plane-work-item-link'

describe('Plane work item link flag', () => {
  it('parses an API resource URL into persisted provider identity', () => {
    expect(
      getOptionalPlaneWorkItemLinkFlag(
        new Map([
          [
            'plane-work-item',
            'https://plane.example/api/v1/workspaces/team/projects/project/work-items/item/'
          ]
        ]),
        'plane-work-item'
      )
    ).toMatchObject({
      provider: 'plane',
      workspaceSlug: 'team',
      projectId: 'project',
      workItemId: 'item'
    })
  })

  it('supports explicit clear and rejects ambiguous browse URLs', () => {
    expect(
      getOptionalPlaneWorkItemLinkFlag(new Map([['plane-work-item', 'null']]), 'plane-work-item')
    ).toBeNull()
    expect(() =>
      getOptionalPlaneWorkItemLinkFlag(
        new Map([['plane-work-item', 'https://plane.example/team/browse/item']]),
        'plane-work-item'
      )
    ).toThrow(RuntimeClientError)
  })
})
