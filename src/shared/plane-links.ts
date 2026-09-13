import type { PlaneWorkItemLink } from './plane-types'

export function parsePlaneWorkItemUrl(value: string): PlaneWorkItemLink | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const apiWorkItemIndex = segments.indexOf('work-items')
  if (
    segments[0] === 'api' &&
    segments[1] === 'v1' &&
    segments[2] === 'workspaces' &&
    segments[4] === 'projects' &&
    apiWorkItemIndex === 6 &&
    segments.length === apiWorkItemIndex + 2
  ) {
    const workspaceSlug = decodeURIComponent(segments[3])
    const projectId = decodeURIComponent(segments[5])
    const workItemId = decodeURIComponent(segments[apiWorkItemIndex + 1])
    return {
      provider: 'plane',
      baseUrl: url.origin,
      workspaceSlug,
      projectId,
      workItemId,
      url: buildPlaneWorkItemUrl({ baseUrl: url.origin, workspaceSlug, projectId, workItemId })
    }
  }
  const browseIndex = segments.indexOf('browse')
  if (browseIndex !== 1 || segments.length !== browseIndex + 2) {
    return null
  }
  const workspaceSlug = decodeURIComponent(segments[0])
  const workItemId = decodeURIComponent(segments[browseIndex + 1])
  const projectId = url.searchParams.get('project')?.trim()
  if (!workspaceSlug || !workItemId || !projectId) {
    return null
  }

  return {
    provider: 'plane',
    baseUrl: url.origin,
    workspaceSlug,
    projectId,
    workItemId,
    url: url.toString()
  }
}

export function buildPlaneWorkItemUrl(link: {
  baseUrl: string
  workspaceSlug: string
  projectId: string
  workItemId: string
}): string {
  const baseUrl = new URL(link.baseUrl)
  baseUrl.pathname = [
    '',
    encodeURIComponent(link.workspaceSlug),
    'browse',
    encodeURIComponent(link.workItemId)
  ].join('/')
  baseUrl.search = new URLSearchParams({ project: link.projectId }).toString()
  baseUrl.hash = ''
  return baseUrl.toString()
}
