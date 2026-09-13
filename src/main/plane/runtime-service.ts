import type { PlaneConnection, PlaneRuntimeStatus } from '../../shared/plane-types'
import { PlaneApiClient, type PlaneFetch } from './api-client'
import { DEFAULT_PLANE_APPROVAL_STATE_NAMES } from './state-policy'
import { PlaneWorkItemService } from './work-items'

const REQUIRED_PLANE_ENV = [
  'ORCA_PLANE_BASE_URL',
  'ORCA_PLANE_WORKSPACE_SLUG',
  'ORCA_PLANE_PROJECT_ID',
  'ORCA_PLANE_API_KEY'
] as const

export function getPlaneRuntimeStatus(
  environment: NodeJS.ProcessEnv = process.env
): PlaneRuntimeStatus {
  const missing = REQUIRED_PLANE_ENV.filter((name) => !environment[name]?.trim())
  return {
    configured: missing.length === 0,
    baseUrl: environment.ORCA_PLANE_BASE_URL?.trim() || null,
    workspaceSlug: environment.ORCA_PLANE_WORKSPACE_SLUG?.trim() || null,
    projectId: environment.ORCA_PLANE_PROJECT_ID?.trim() || null,
    missing,
    // Why: agent-facing RPC never accepts a caller-supplied actor claim.
    // Owner approval needs a separate trusted human boundary.
    actor: 'ai'
  }
}

export function createPlaneRuntimeService(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl?: PlaneFetch
): PlaneWorkItemService {
  const status = getPlaneRuntimeStatus(environment)
  if (!status.configured) {
    throw new Error(`Plane is not configured; missing ${status.missing.join(', ')}`)
  }
  const connection: PlaneConnection = {
    baseUrl: status.baseUrl!,
    workspaceSlug: status.workspaceSlug!,
    projectId: status.projectId!,
    apiKey: environment.ORCA_PLANE_API_KEY!.trim()
  }
  return new PlaneWorkItemService(
    new PlaneApiClient(connection, fetchImpl),
    { kind: 'ai', source: 'trusted-runtime' },
    parseProtectedStateNames(environment.ORCA_PLANE_APPROVAL_STATE_NAMES)
  )
}

function parseProtectedStateNames(value: string | undefined): string[] | undefined {
  const additionalNames = value
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (!additionalNames || additionalNames.length === 0) {
    return undefined
  }
  // Why: configuration may add localized approval names, but must never remove
  // the mandatory Owner-only boundary for 承認済.
  return [...new Set([...DEFAULT_PLANE_APPROVAL_STATE_NAMES, ...additionalNames])]
}
