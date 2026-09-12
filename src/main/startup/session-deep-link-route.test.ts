import { describe, expect, it, vi } from 'vitest'
import { registerSessionDeepLinkRoute } from './session-deep-link-route'

describe('registerSessionDeepLinkRoute', () => {
  it('claims a valid session route and dispatches it', () => {
    let listener: ((event: { preventDefault: () => void }, url: string) => void) | undefined
    const onSessionUrl = vi.fn()
    registerSessionDeepLinkRoute(
      {
        on: (_event, callback) => {
          listener = callback
        }
      },
      onSessionUrl
    )
    const event = { preventDefault: vi.fn() }

    listener?.(event, 'orca://session/session_abc')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(onSessionUrl).toHaveBeenCalledWith('orca://session/session_abc')
  })

  it('leaves the existing skills/share route untouched', () => {
    let listener: ((event: { preventDefault: () => void }, url: string) => void) | undefined
    const onSessionUrl = vi.fn()
    registerSessionDeepLinkRoute(
      {
        on: (_event, callback) => {
          listener = callback
        }
      },
      onSessionUrl
    )
    const event = { preventDefault: vi.fn() }

    listener?.(event, 'orca://skills/share/share_existing')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(onSessionUrl).not.toHaveBeenCalled()
  })
})
