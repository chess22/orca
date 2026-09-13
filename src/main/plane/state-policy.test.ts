import { describe, expect, it } from 'vitest'
import type { PlaneState } from '../../shared/plane-types'
import { assertPlaneStateChangeAllowed, PlaneStatePolicyError } from './state-policy'

const completedState = (name: string): PlaneState => ({ id: name, name, group: 'completed' })

describe('Plane state transition policy', () => {
  it('allows an AI actor to move through Done', () => {
    expect(() =>
      assertPlaneStateChangeAllowed({
        actor: { kind: 'ai', source: 'trusted-runtime' },
        targetState: completedState('Done')
      })
    ).not.toThrow()
  })

  it('rejects an AI actor before sending a protected approval transition', () => {
    expect(() =>
      assertPlaneStateChangeAllowed({
        actor: { kind: 'ai', source: 'trusted-runtime' },
        targetState: completedState(' 承認済 ')
      })
    ).toThrow(PlaneStatePolicyError)
  })

  it('requires Plane role 20 for an Owner approval transition', () => {
    expect(() =>
      assertPlaneStateChangeAllowed({
        actor: { kind: 'owner', source: 'trusted-runtime', userId: 'owner' },
        targetState: completedState('承認済'),
        workspaceMembers: [{ id: 'owner', displayName: 'Owner', role: 15 }]
      })
    ).toThrow('Only a Plane workspace Owner')

    expect(() =>
      assertPlaneStateChangeAllowed({
        actor: { kind: 'owner', source: 'trusted-runtime', userId: 'owner' },
        targetState: completedState('承認済'),
        workspaceMembers: [{ id: 'owner', displayName: 'Owner', role: 20 }]
      })
    ).not.toThrow()
  })
})
