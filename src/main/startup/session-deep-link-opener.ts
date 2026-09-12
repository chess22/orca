import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'

export type SessionDeepLinkOpenResult =
  | { status: 'active'; handle: string }
  | { status: 'inactive' | 'not_found' | 'ambiguous' }

type SessionDeepLinkRuntime = {
  getHandleForPaneKey: (paneKey: string) => string | undefined
  isHandleActive: (handle: string) => Promise<boolean>
  focusHandle: (handle: string) => Promise<void>
}

function matchingPaneKeys(sessionId: string, statuses: readonly AgentStatusIpcPayload[]): string[] {
  return [
    ...new Set(
      statuses
        .filter((status) => status.providerSession?.id === sessionId)
        .sort((left, right) => right.receivedAt - left.receivedAt)
        .map((status) => status.paneKey)
    )
  ]
}

async function resolveActiveHandles(
  paneKeys: readonly string[],
  runtime: SessionDeepLinkRuntime
): Promise<string[]> {
  const handles = [
    ...new Set(paneKeys.flatMap((paneKey) => runtime.getHandleForPaneKey(paneKey) ?? []))
  ]
  const active = await Promise.all(
    handles.map(async (handle) => ((await runtime.isHandleActive(handle)) ? handle : null))
  )
  return active.filter((handle): handle is string => handle !== null)
}

/** Resolve the runtime-scoped handle at click time; never trust a persisted handle hint. */
export async function openSessionDeepLink(
  sessionId: string,
  statuses: readonly AgentStatusIpcPayload[],
  runtime: SessionDeepLinkRuntime
): Promise<SessionDeepLinkOpenResult> {
  const paneKeys = matchingPaneKeys(sessionId, statuses)
  if (paneKeys.length === 0) {
    return { status: 'not_found' }
  }
  let activeHandles = await resolveActiveHandles(paneKeys, runtime)
  if (activeHandles.length === 0) {
    return { status: 'inactive' }
  }
  if (activeHandles.length > 1) {
    return { status: 'ambiguous' }
  }

  try {
    await runtime.focusHandle(activeHandles[0]!)
    return { status: 'active', handle: activeHandles[0]! }
  } catch {
    // Why: handles are runtime-scoped and may rotate between lookup and focus.
    // Resolve once more from the canonical session before declaring it inactive.
    activeHandles = await resolveActiveHandles(paneKeys, runtime)
    if (activeHandles.length !== 1) {
      return { status: activeHandles.length > 1 ? 'ambiguous' : 'inactive' }
    }
    try {
      await runtime.focusHandle(activeHandles[0]!)
      return { status: 'active', handle: activeHandles[0]! }
    } catch {
      return { status: 'inactive' }
    }
  }
}
