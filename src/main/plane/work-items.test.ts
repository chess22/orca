import { describe, expect, it, vi } from 'vitest'
import type { PlaneConnection } from '../../shared/plane-types'
import { PlaneApiClient } from './api-client'
import { PlaneStatePolicyError } from './state-policy'
import { PlaneWorkItemService } from './work-items'

const connection: PlaneConnection = {
  baseUrl: 'https://plane.example.test',
  workspaceSlug: 'orca',
  projectId: 'project-id',
  apiKey: 'secret'
}

const states = [
  { id: 'done', name: 'Done', group: 'completed' },
  { id: 'approved', name: '承認済', group: 'completed' }
]

const workItem = {
  id: 'item-id',
  sequence_id: 42,
  name: 'Plane parity',
  description_stripped: 'Description',
  priority: 'high',
  state: 'done',
  assignees: ['user-id'],
  labels: [{ id: 'label-id' }],
  project: { identifier: 'ORCA' },
  created_at: '2026-09-13T00:00:00Z',
  updated_at: '2026-09-13T01:00:00Z'
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

describe('Plane work item service', () => {
  it('lists and maps work items using the non-deprecated work-items endpoint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(states))
      .mockResolvedValueOnce(json({ results: [workItem], next_cursor: null }))
    const service = new PlaneWorkItemService(new PlaneApiClient(connection, fetchImpl), {
      kind: 'ai',
      source: 'trusted-runtime'
    })

    await expect(service.listWorkItems(25)).resolves.toEqual([
      expect.objectContaining({
        id: 'item-id',
        identifier: 'ORCA-42',
        title: 'Plane parity',
        state: states[0],
        assigneeIds: ['user-id'],
        labelIds: ['label-id']
      })
    ])
    expect(fetchImpl.mock.calls[1][0]).toContain(
      '/work-items/?per_page=25&expand=state%2Cassignees'
    )
    expect(fetchImpl.mock.calls[1][0]).not.toContain('/issues/')
  })

  it('creates, updates, and comments through the documented REST shapes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(states))
      .mockResolvedValueOnce(json(workItem))
      .mockResolvedValueOnce(json(states))
      .mockResolvedValueOnce(json(workItem))
      .mockResolvedValueOnce(
        json({
          id: 'comment-id',
          comment_stripped: 'Started',
          created_at: '2026-09-13T01:00:00Z',
          updated_at: '2026-09-13T01:00:00Z'
        })
      )
    const service = new PlaneWorkItemService(new PlaneApiClient(connection, fetchImpl), {
      kind: 'ai',
      source: 'trusted-runtime'
    })

    await service.createWorkItem({ title: 'Plane parity', stateId: 'done' })
    await service.updateWorkItem('item-id', { priority: 'low' })
    await service.addComment('item-id', '<p>Started</p>')

    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      name: 'Plane parity',
      state: 'done'
    })
    expect(fetchImpl.mock.calls[2][1].method).toBe('PATCH')
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ priority: 'low' })
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toEqual({
      comment_html: '<p>Started</p>',
      access: 'INTERNAL'
    })
  })

  it('allows AI Done but blocks approval before issuing the work-item PATCH', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(states))
      .mockResolvedValueOnce(json(workItem))
      .mockResolvedValueOnce(json(states))
    const service = new PlaneWorkItemService(new PlaneApiClient(connection, fetchImpl), {
      kind: 'ai',
      source: 'trusted-runtime'
    })

    await expect(service.setWorkItemState('item-id', 'done')).resolves.toMatchObject({
      state: states[0]
    })
    await expect(service.setWorkItemState('item-id', 'approved')).rejects.toBeInstanceOf(
      PlaneStatePolicyError
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('blocks creation directly in the protected approval state', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(states))
    const service = new PlaneWorkItemService(new PlaneApiClient(connection, fetchImpl), {
      kind: 'ai',
      source: 'trusted-runtime'
    })

    await expect(
      service.createWorkItem({ title: 'Bypass attempt', stateId: 'approved' })
    ).rejects.toBeInstanceOf(PlaneStatePolicyError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('requires role 20 before an Owner approval transition', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(states))
      .mockResolvedValueOnce(json([{ id: 'owner-id', display_name: 'Owner', role: 15 }]))
    const service = new PlaneWorkItemService(new PlaneApiClient(connection, fetchImpl), {
      kind: 'owner',
      source: 'trusted-runtime',
      userId: 'owner-id'
    })

    await expect(service.setWorkItemState('item-id', 'approved')).rejects.toThrow(
      'Only a Plane workspace Owner'
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
