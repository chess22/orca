import { parsePlaneWorkItemUrl } from '../../shared/plane-links'
import type { PlaneWorkItemLink } from '../../shared/plane-types'
import { RuntimeClientError } from '../runtime-client'

export function getOptionalPlaneWorkItemLinkFlag(
  flags: Map<string, string | boolean>,
  name: string
): PlaneWorkItemLink | null | undefined {
  if (!flags.has(name)) {
    return undefined
  }
  const value = flags.get(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new RuntimeClientError('invalid_argument', `Missing value for --${name}`)
  }
  if (value.trim().toLowerCase() === 'null') {
    return null
  }
  const parsed = parsePlaneWorkItemUrl(value)
  if (!parsed) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass a Plane REST work-item URL, or a browse URL with ?project=<project-id>, or null.'
    )
  }
  return parsed
}
