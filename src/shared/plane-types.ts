export type PlaneStateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

export type PlaneConnection = {
  baseUrl: string
  workspaceSlug: string
  projectId: string
  apiKey: string
}

export type PlaneState = {
  id: string
  name: string
  group: PlaneStateGroup
  color?: string
}

export type PlaneWorkItem = {
  id: string
  identifier: string
  title: string
  description?: string
  url: string
  priority: 'none' | 'urgent' | 'high' | 'medium' | 'low'
  state: PlaneState | null
  assigneeIds: string[]
  labelIds: string[]
  createdAt: string
  updatedAt: string
}

export type PlaneWorkItemCreate = {
  title: string
  descriptionHtml?: string
  stateId?: string
  priority?: PlaneWorkItem['priority']
  assigneeIds?: string[]
  labelIds?: string[]
}

// State is intentionally absent: all transitions must pass the actor guard.
export type PlaneWorkItemUpdate = {
  title?: string
  descriptionHtml?: string
  priority?: PlaneWorkItem['priority']
  assigneeIds?: string[]
  labelIds?: string[]
}

export type PlaneComment = {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  actorId?: string
}

export type PlaneWorkspaceMember = {
  id: string
  displayName: string
  role: number
}

export type PlaneActorContext =
  | { kind: 'ai'; source: 'trusted-runtime' }
  | { kind: 'owner'; source: 'trusted-runtime'; userId: string }

export type PlaneWorkItemLink = {
  provider: 'plane'
  baseUrl: string
  workspaceSlug: string
  projectId: string
  workItemId: string
  identifier?: string
  url: string
}

export type PlaneRuntimeStatus = {
  configured: boolean
  baseUrl: string | null
  workspaceSlug: string | null
  projectId: string | null
  missing: string[]
  actor: 'ai'
}
