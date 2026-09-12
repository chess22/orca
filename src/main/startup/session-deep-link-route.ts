import { parseSessionDeepLink } from '../../shared/session-deep-link'

type OpenUrlEvent = { preventDefault: () => void }
type OpenUrlApp = {
  on: (event: 'open-url', listener: (event: OpenUrlEvent, url: string) => void) => unknown
}

export function registerSessionDeepLinkRoute(
  app: OpenUrlApp,
  onSessionUrl: (url: string) => void
): void {
  app.on('open-url', (event, url) => {
    // Why: another handler owns skills/share. Claim only a fully validated
    // session route so adding this listener cannot shadow existing deep links.
    if (!parseSessionDeepLink(url)) {
      return
    }
    event.preventDefault()
    onSessionUrl(url)
  })
}
