import { buildPlaneWorkItemUrl } from '../../shared/plane-links'
import type {
  PlaneActorContext,
  PlaneComment,
  PlaneState,
  PlaneStateGroup,
  PlaneWorkItem,
  PlaneWorkItemCreate,
  PlaneWorkItemUpdate,
  PlaneWorkspaceMember
} from '../../shared/plane-types'
import type { PlaneApiClient } from './api-client'
import { assertPlaneStateChangeAllowed } from './state-policy'

type PlaneRecord = Record<string, unknown>

export class PlaneWorkItemService {
  constructor(
    private readonly client: PlaneApiClient,
    private readonly actor: PlaneActorContext,
    private readonly protectedStateNames?: readonly string[]
  ) {}

  async listWorkItems(limit = 50): Promise<PlaneWorkItem[]> {
    const states = await this.listStates()
    const url = new URL(this.client.workItemsPath())
    url.searchParams.set('per_page', String(clampLimit(limit)))
    url.searchParams.set('expand', 'state,assignees')
    const response = await this.client.request<unknown>(url.toString())
    return unwrapCollection(response).map((item) => mapWorkItem(this.client, item, states))
  }

  async getWorkItem(workItemId: string): Promise<PlaneWorkItem> {
    const [raw, states] = await Promise.all([
      this.client.request<unknown>(this.client.workItemsPath(`${encodeId(workItemId)}/`)),
      this.listStates()
    ])
    return mapWorkItem(this.client, asRecord(raw), states)
  }

  async createWorkItem(input: PlaneWorkItemCreate): Promise<PlaneWorkItem> {
    const states = await this.listStates()
    if (input.stateId) {
      await this.assertStateAllowed(input.stateId, states)
    }
    const raw = await this.client.request<unknown>(this.client.workItemsPath(), {
      method: 'POST',
      body: JSON.stringify({
        name: input.title,
        ...(input.descriptionHtml !== undefined ? { description_html: input.descriptionHtml } : {}),
        ...(input.stateId ? { state: input.stateId } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assigneeIds ? { assignees: input.assigneeIds } : {}),
        ...(input.labelIds ? { labels: input.labelIds } : {})
      })
    })
    return mapWorkItem(this.client, asRecord(raw), states)
  }

  async updateWorkItem(workItemId: string, update: PlaneWorkItemUpdate): Promise<PlaneWorkItem> {
    const raw = await this.client.request<unknown>(
      this.client.workItemsPath(`${encodeId(workItemId)}/`),
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...(update.title !== undefined ? { name: update.title } : {}),
          ...(update.descriptionHtml !== undefined
            ? { description_html: update.descriptionHtml }
            : {}),
          ...(update.priority !== undefined ? { priority: update.priority } : {}),
          ...(update.assigneeIds !== undefined ? { assignees: update.assigneeIds } : {}),
          ...(update.labelIds !== undefined ? { labels: update.labelIds } : {})
        })
      }
    )
    return mapWorkItem(this.client, asRecord(raw), await this.listStates())
  }

  async setWorkItemState(workItemId: string, stateId: string): Promise<PlaneWorkItem> {
    const states = await this.listStates()
    await this.assertStateAllowed(stateId, states)
    // Why: state is only writable here so direct update calls cannot bypass
    // the AI/Owner approval boundary.
    const raw = await this.client.request<unknown>(
      this.client.workItemsPath(`${encodeId(workItemId)}/`),
      { method: 'PATCH', body: JSON.stringify({ state: stateId }) }
    )
    return mapWorkItem(this.client, asRecord(raw), states)
  }

  private async assertStateAllowed(stateId: string, states: readonly PlaneState[]): Promise<void> {
    const targetState = states.find((state) => state.id === stateId)
    if (!targetState) {
      throw new Error(`Unknown Plane state "${stateId}"`)
    }

    const workspaceMembers =
      this.actor.kind === 'owner' ? await this.listWorkspaceMembers() : undefined
    assertPlaneStateChangeAllowed({
      actor: this.actor,
      targetState,
      workspaceMembers,
      protectedStateNames: this.protectedStateNames
    })
  }

  async listComments(workItemId: string): Promise<PlaneComment[]> {
    const response = await this.client.request<unknown>(
      this.client.workItemsPath(`${encodeId(workItemId)}/comments/`)
    )
    return unwrapCollection(response).map(mapComment)
  }

  async addComment(workItemId: string, commentHtml: string): Promise<PlaneComment> {
    const raw = await this.client.request<unknown>(
      this.client.workItemsPath(`${encodeId(workItemId)}/comments/`),
      {
        method: 'POST',
        body: JSON.stringify({ comment_html: commentHtml, access: 'INTERNAL' })
      }
    )
    return mapComment(asRecord(raw))
  }

  async listStates(): Promise<PlaneState[]> {
    const response = await this.client.request<unknown>(this.client.statesPath())
    return unwrapCollection(response)
      .map(mapState)
      .filter((state): state is PlaneState => !!state)
  }

  private async listWorkspaceMembers(): Promise<PlaneWorkspaceMember[]> {
    const response = await this.client.request<unknown>(this.client.workspacePath('members/'))
    return unwrapCollection(response)
      .map((raw) => {
        const id = asString(raw.id)
        const role = asNumber(raw.role)
        if (!id || role === null) {
          return null
        }
        return {
          id,
          displayName: asString(raw.display_name) || id,
          role
        }
      })
      .filter((member): member is PlaneWorkspaceMember => member !== null)
  }
}

function mapWorkItem(
  client: PlaneApiClient,
  raw: PlaneRecord,
  states: readonly PlaneState[]
): PlaneWorkItem {
  const id = asString(raw.id)
  const sequenceId = asNumber(raw.sequence_id)
  const project = asRecord(raw.project)
  const projectIdentifier = asString(project.identifier)
  const stateValue = raw.state
  const state =
    stateValue && typeof stateValue === 'object'
      ? mapState(asRecord(stateValue))
      : (states.find((candidate) => candidate.id === asString(stateValue)) ?? null)
  const identifier =
    projectIdentifier && sequenceId !== null ? `${projectIdentifier}-${sequenceId}` : id

  return {
    id,
    identifier,
    title: asString(raw.name) || identifier || 'Untitled work item',
    description: asString(raw.description_stripped) || undefined,
    url: buildPlaneWorkItemUrl({
      baseUrl: client.connection.baseUrl,
      workspaceSlug: client.connection.workspaceSlug,
      projectId: client.connection.projectId,
      workItemId: id
    }),
    priority: mapPriority(raw.priority),
    state,
    assigneeIds: mapIds(raw.assignees),
    labelIds: mapIds(raw.labels),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at)
  }
}

function mapState(raw: PlaneRecord): PlaneState | null {
  const id = asString(raw.id)
  const name = asString(raw.name)
  const group = asString(raw.group)
  if (!id || !name || !isStateGroup(group)) {
    return null
  }
  return { id, name, group, color: asString(raw.color) || undefined }
}

function mapComment(raw: PlaneRecord): PlaneComment {
  return {
    id: asString(raw.id),
    body: asString(raw.comment_stripped) || asString(raw.comment_html),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
    actorId: asString(raw.actor) || undefined
  }
}

function unwrapCollection(value: unknown): PlaneRecord[] {
  if (Array.isArray(value)) {
    return value.map(asRecord)
  }
  const record = asRecord(value)
  return Array.isArray(record.results) ? record.results.map(asRecord) : []
}

function mapIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((entry) => asString(asRecord(entry).id) || asString(entry)).filter(Boolean)
}

function mapPriority(value: unknown): PlaneWorkItem['priority'] {
  return value === 'urgent' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'none'
}

function isStateGroup(value: string): value is PlaneStateGroup {
  return ['backlog', 'unstarted', 'started', 'completed', 'cancelled'].includes(value)
}

function asRecord(value: unknown): PlaneRecord {
  return value && typeof value === 'object' ? (value as PlaneRecord) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function encodeId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Plane work item ID is required')
  }
  return encodeURIComponent(trimmed)
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50), 100)
}
