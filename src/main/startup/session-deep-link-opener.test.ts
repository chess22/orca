import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { openSessionDeepLink } from './session-deep-link-opener'

function status(sessionId: string, paneKey: string, receivedAt = 1): AgentStatusIpcPayload {
  return {
    state: 'done',
    prompt: '',
    paneKey,
    connectionId: null,
    receivedAt,
    stateStartedAt: receivedAt,
    providerSession: { key: 'session_id', id: sessionId }
  }
}

describe('openSessionDeepLink', () => {
  it('dynamically resolves and focuses the active runtime handle', async () => {
    const focusHandle = vi.fn().mockResolvedValue(undefined)
    const result = await openSessionDeepLink('session-live', [status('session-live', 'pane:1')], {
      getHandleForPaneKey: () => 'term_current',
      isHandleActive: async () => true,
      focusHandle
    })

    expect(result).toEqual({ status: 'active', handle: 'term_current' })
    expect(focusHandle).toHaveBeenCalledWith('term_current')
  })

  it('re-resolves once when a handle rotates during focus', async () => {
    const handles = ['term_stale', 'term_current']
    const focusHandle = vi
      .fn()
      .mockRejectedValueOnce(new Error('terminal_handle_stale'))
      .mockResolvedValueOnce(undefined)
    const result = await openSessionDeepLink('session-live', [status('session-live', 'pane:1')], {
      getHandleForPaneKey: () => handles.shift(),
      isHandleActive: async () => true,
      focusHandle
    })

    expect(result).toEqual({ status: 'active', handle: 'term_current' })
    expect(focusHandle.mock.calls).toEqual([['term_stale'], ['term_current']])
  })

  it('reports a known closed session as inactive', async () => {
    const focusHandle = vi.fn()
    const result = await openSessionDeepLink(
      'session-closed',
      [status('session-closed', 'pane:closed')],
      {
        getHandleForPaneKey: () => undefined,
        isHandleActive: async () => false,
        focusHandle
      }
    )

    expect(result).toEqual({ status: 'inactive' })
    expect(focusHandle).not.toHaveBeenCalled()
  })

  it('refuses an unsafe switch when one session maps to multiple active terminals', async () => {
    const focusHandle = vi.fn()
    const result = await openSessionDeepLink(
      'session-duplicate',
      [status('session-duplicate', 'pane:1', 2), status('session-duplicate', 'pane:2', 1)],
      {
        getHandleForPaneKey: (paneKey) => (paneKey === 'pane:1' ? 'term_1' : 'term_2'),
        isHandleActive: async () => true,
        focusHandle
      }
    )

    expect(result).toEqual({ status: 'ambiguous' })
    expect(focusHandle).not.toHaveBeenCalled()
  })
})
