import { describe, expect, it } from 'vitest'
import {
  buildSessionDeepLink,
  parseSessionDeepLink,
  sessionIdFromArguments
} from './session-deep-link'

describe('session deep links', () => {
  it('round-trips a canonical provider session id', () => {
    const sessionId = '01a094cc-7cf7-7e80-8246-7c45326fcbcf'
    const link = buildSessionDeepLink(sessionId)

    expect(link).toBe(`orca://session/${sessionId}`)
    expect(parseSessionDeepLink(link!)).toBe(sessionId)
  })

  it('finds the deep link in process arguments', () => {
    expect(sessionIdFromArguments(['Orca', '--opened-from-os', 'orca://session/session_abc'])).toBe(
      'session_abc'
    )
  })

  it('does not claim the existing skill-share route', () => {
    expect(parseSessionDeepLink('orca://skills/share/share_abc')).toBeNull()
    expect(sessionIdFromArguments(['Orca', 'orca://skills/share/share_abc'])).toBeNull()
  })

  it.each([
    'https://app.orca.dev/session/abc',
    'orca://terminal/term_abc',
    'orca://session/',
    'orca://session/a/b',
    'orca://session/--last',
    'orca://session/abc?terminal=term_stale',
    'orca://session/abc#fragment',
    'orca://user:pass@session/abc'
  ])('rejects malformed or ambiguous input: %s', (value) => {
    expect(parseSessionDeepLink(value)).toBeNull()
  })
})
