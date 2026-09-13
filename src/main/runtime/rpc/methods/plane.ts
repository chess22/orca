import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import {
  OptionalFiniteNumber,
  OptionalPlainString,
  OptionalString,
  requiredString
} from '../schemas'

const WorkItemId = z.object({
  workItemId: requiredString('Plane work item ID is required')
})

const CreateWorkItem = z.object({
  title: requiredString('Title is required'),
  descriptionHtml: OptionalPlainString,
  stateId: OptionalString,
  priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
  assigneeIds: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional()
})

const UpdateWorkItem = WorkItemId.extend({
  update: z
    .object({
      title: OptionalString,
      descriptionHtml: OptionalPlainString,
      priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
      assigneeIds: z.array(z.string()).optional(),
      labelIds: z.array(z.string()).optional()
    })
    .strict()
})

export const PLANE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'plane.status',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeStatus()
  }),
  defineMethod({
    name: 'plane.listWorkItems',
    params: z.object({ limit: OptionalFiniteNumber }).optional(),
    handler: async (params, { runtime }) => runtime.planeListWorkItems(params?.limit)
  }),
  defineMethod({
    name: 'plane.getWorkItem',
    params: WorkItemId,
    handler: async (params, { runtime }) => runtime.planeGetWorkItem(params.workItemId.trim())
  }),
  defineMethod({
    name: 'plane.createWorkItem',
    params: CreateWorkItem,
    handler: async (params, { runtime }) => runtime.planeCreateWorkItem(params)
  }),
  defineMethod({
    name: 'plane.updateWorkItem',
    params: UpdateWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeUpdateWorkItem(params.workItemId.trim(), params.update)
  }),
  defineMethod({
    name: 'plane.setWorkItemState',
    params: WorkItemId.extend({ stateId: requiredString('Plane state ID is required') }),
    handler: async (params, { runtime }) =>
      runtime.planeSetWorkItemState(params.workItemId.trim(), params.stateId.trim())
  }),
  defineMethod({
    name: 'plane.listStates',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeListStates()
  }),
  defineMethod({
    name: 'plane.listComments',
    params: WorkItemId,
    handler: async (params, { runtime }) => runtime.planeListComments(params.workItemId.trim())
  }),
  defineMethod({
    name: 'plane.addComment',
    params: WorkItemId.extend({ commentHtml: requiredString('Comment HTML is required') }),
    handler: async (params, { runtime }) =>
      runtime.planeAddComment(params.workItemId.trim(), params.commentHtml)
  })
]
