const SESSION_DEEP_LINK_HOST = 'session'
const SESSION_ID_MAX_LENGTH = 512

function isSafeSessionId(value: string): boolean {
  const hasControlOrWhitespace = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x20 || codePoint === 0x7f
  })
  return (
    value.length > 0 &&
    value.length <= SESSION_ID_MAX_LENGTH &&
    !value.startsWith('-') &&
    !hasControlOrWhitespace
  )
}

/** Parse Orca's stable, provider-session deep link without claiming other orca:// routes. */
export function parseSessionDeepLink(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (
    url.protocol !== 'orca:' ||
    url.hostname !== SESSION_DEEP_LINK_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null
  }
  const pathSegments = url.pathname.split('/').filter(Boolean)
  if (pathSegments.length !== 1) {
    return null
  }
  let sessionId: string
  try {
    sessionId = decodeURIComponent(pathSegments[0]!)
  } catch {
    return null
  }
  return isSafeSessionId(sessionId) && !sessionId.includes('/') ? sessionId : null
}

export function sessionIdFromArguments(argv: readonly string[]): string | null {
  for (const argument of argv) {
    const sessionId = parseSessionDeepLink(argument)
    if (sessionId) {
      return sessionId
    }
  }
  return null
}

export function buildSessionDeepLink(sessionId: string): string | null {
  if (!isSafeSessionId(sessionId) || sessionId.includes('/')) {
    return null
  }
  return `orca://${SESSION_DEEP_LINK_HOST}/${encodeURIComponent(sessionId)}`
}
