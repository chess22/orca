import type {
  PlaneComment,
  PlaneRuntimeStatus,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemCreate,
  PlaneWorkItemUpdate
} from '../../shared/types'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

const format = (value: unknown): string => JSON.stringify(value, null, 2)

export const PLANE_HANDLERS: Record<string, CommandHandler> = {
  'plane status': async ({ client, json }) => {
    const result = await client.call<PlaneRuntimeStatus>('plane.status')
    printResult(result, json, format)
  },
  'plane list': async ({ flags, client, json }) => {
    const result = await client.call<PlaneWorkItem[]>('plane.listWorkItems', {
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, format)
  },
  'plane issue': async ({ flags, client, json }) => {
    const result = await client.call<PlaneWorkItem>('plane.getWorkItem', {
      workItemId: getRequiredStringFlag(flags, 'work-item-id')
    })
    printResult(result, json, format)
  },
  'plane create': async ({ flags, client, json }) => {
    const input: PlaneWorkItemCreate = {
      title: getRequiredStringFlag(flags, 'title'),
      descriptionHtml: getOptionalStringFlag(flags, 'description-html'),
      stateId: getOptionalStringFlag(flags, 'state'),
      priority: getPriority(flags)
    }
    const result = await client.call<PlaneWorkItem>('plane.createWorkItem', input)
    printResult(result, json, format)
  },
  'plane update': async ({ flags, client, json }) => {
    const update: PlaneWorkItemUpdate = {
      title: getOptionalStringFlag(flags, 'title'),
      descriptionHtml: getOptionalStringFlag(flags, 'description-html'),
      priority: getPriority(flags)
    }
    const result = await client.call<PlaneWorkItem>('plane.updateWorkItem', {
      workItemId: getRequiredStringFlag(flags, 'work-item-id'),
      update
    })
    printResult(result, json, format)
  },
  'plane state list': async ({ client, json }) => {
    const result = await client.call<PlaneState[]>('plane.listStates')
    printResult(result, json, format)
  },
  'plane state set': async ({ flags, client, json }) => {
    const result = await client.call<PlaneWorkItem>('plane.setWorkItemState', {
      workItemId: getRequiredStringFlag(flags, 'work-item-id'),
      stateId: getRequiredStringFlag(flags, 'to')
    })
    printResult(result, json, format)
  },
  'plane comment list': async ({ flags, client, json }) => {
    const result = await client.call<PlaneComment[]>('plane.listComments', {
      workItemId: getRequiredStringFlag(flags, 'work-item-id')
    })
    printResult(result, json, format)
  },
  'plane comment add': async ({ flags, client, json }) => {
    const result = await client.call<PlaneComment>('plane.addComment', {
      workItemId: getRequiredStringFlag(flags, 'work-item-id'),
      commentHtml: getRequiredStringFlag(flags, 'body-html')
    })
    printResult(result, json, format)
  }
}

function getPriority(flags: Map<string, string | boolean>): PlaneWorkItem['priority'] | undefined {
  const value = getOptionalStringFlag(flags, 'priority')
  if (value === undefined) {
    return undefined
  }
  if (
    value === 'none' ||
    value === 'urgent' ||
    value === 'high' ||
    value === 'medium' ||
    value === 'low'
  ) {
    return value
  }
  throw new RuntimeClientError(
    'invalid_argument',
    '--priority must be one of: none, urgent, high, medium, low'
  )
}
