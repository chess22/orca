import type { PlaneConnection } from '../../shared/plane-types'

export type PlaneFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class PlaneApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'PlaneApiError'
    this.status = status
    this.body = body
  }
}

export class PlaneApiClient {
  private readonly apiRoot: string

  constructor(
    readonly connection: PlaneConnection,
    private readonly fetchImpl: PlaneFetch = fetch
  ) {
    this.apiRoot = normalizePlaneApiRoot(connection.baseUrl)
  }

  workItemsPath(suffix = ''): string {
    return this.projectPath(`work-items/${suffix}`)
  }

  statesPath(suffix = ''): string {
    return this.projectPath(`states/${suffix}`)
  }

  workspacePath(suffix = ''): string {
    return `${this.apiRoot}/workspaces/${encodeURIComponent(this.connection.workspaceSlug)}/${suffix}`
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('X-API-Key', this.connection.apiKey)
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await this.fetchImpl(path, { ...init, headers })
    const body = await readResponseBody(response)
    if (!response.ok) {
      throw new PlaneApiError(response.status, describePlaneError(response.status, body), body)
    }
    return body as T
  }

  private projectPath(suffix: string): string {
    return this.workspacePath(`projects/${encodeURIComponent(this.connection.projectId)}/${suffix}`)
  }
}

export function normalizePlaneApiRoot(baseUrl: string): string {
  const url = new URL(baseUrl.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Plane base URL must use http or https')
  }
  url.search = ''
  url.hash = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`
  return url.toString().replace(/\/$/, '')
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function describePlaneError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const detail = record.detail ?? record.error ?? record.message
    if (typeof detail === 'string' && detail.trim()) {
      return `Plane API ${status}: ${detail.trim()}`
    }
  }
  return `Plane API request failed with status ${status}`
}
