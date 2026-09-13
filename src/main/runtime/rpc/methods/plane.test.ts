import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PLANE_METHODS } from './plane'

const makeRequest = (method: string, params?: unknown): RpcRequest => ({
  id: 'request-id',
  authToken: 'token',
  method,
  params
})

describe('Plane RPC methods', () => {
  it('routes all work-item operations through the runtime boundary', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeStatus: vi.fn().mockReturnValue({ configured: false }),
      planeListWorkItems: vi.fn().mockResolvedValue([]),
      planeGetWorkItem: vi.fn().mockResolvedValue({ id: 'item' }),
      planeCreateWorkItem: vi.fn().mockResolvedValue({ id: 'created' }),
      planeUpdateWorkItem: vi.fn().mockResolvedValue({ id: 'updated' }),
      planeSetWorkItemState: vi.fn().mockResolvedValue({ id: 'moved' }),
      planeListStates: vi.fn().mockResolvedValue([]),
      planeListComments: vi.fn().mockResolvedValue([]),
      planeAddComment: vi.fn().mockResolvedValue({ id: 'comment' })
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    await dispatcher.dispatch(makeRequest('plane.status'))
    await dispatcher.dispatch(makeRequest('plane.listWorkItems', { limit: 25 }))
    await dispatcher.dispatch(makeRequest('plane.getWorkItem', { workItemId: ' item ' }))
    await dispatcher.dispatch(makeRequest('plane.createWorkItem', { title: 'New item' }))
    await dispatcher.dispatch(
      makeRequest('plane.updateWorkItem', {
        workItemId: 'item',
        update: { priority: 'high' }
      })
    )
    await dispatcher.dispatch(
      makeRequest('plane.setWorkItemState', { workItemId: 'item', stateId: ' done ' })
    )
    await dispatcher.dispatch(makeRequest('plane.listStates'))
    await dispatcher.dispatch(makeRequest('plane.listComments', { workItemId: 'item' }))
    await dispatcher.dispatch(
      makeRequest('plane.addComment', { workItemId: 'item', commentHtml: '<p>Done</p>' })
    )

    expect(runtime.planeListWorkItems).toHaveBeenCalledWith(25)
    expect(runtime.planeGetWorkItem).toHaveBeenCalledWith('item')
    expect(runtime.planeSetWorkItemState).toHaveBeenCalledWith('item', 'done')
    expect(runtime.planeAddComment).toHaveBeenCalledWith('item', '<p>Done</p>')
  })

  it('does not expose state inside the generic update schema', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      planeUpdateWorkItem: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: PLANE_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('plane.updateWorkItem', {
        workItemId: 'item',
        update: { state: 'approved' }
      })
    )

    expect(response).toMatchObject({ error: { code: 'invalid_argument' } })
    expect(runtime.planeUpdateWorkItem).not.toHaveBeenCalled()
  })
})
