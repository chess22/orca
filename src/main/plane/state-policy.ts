import type { PlaneActorContext, PlaneState, PlaneWorkspaceMember } from '../../shared/plane-types'

export const PLANE_OWNER_ROLE = 20
export const DEFAULT_PLANE_APPROVAL_STATE_NAMES = ['承認済'] as const

export class PlaneStatePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaneStatePolicyError'
  }
}

export function assertPlaneStateChangeAllowed(args: {
  actor: PlaneActorContext
  targetState: PlaneState
  workspaceMembers?: readonly PlaneWorkspaceMember[]
  protectedStateNames?: readonly string[]
}): void {
  const protectedNames = new Set(
    (args.protectedStateNames ?? DEFAULT_PLANE_APPROVAL_STATE_NAMES).map(normalizeStateName)
  )
  const isProtected = protectedNames.has(normalizeStateName(args.targetState.name))

  if (args.actor.kind === 'ai') {
    if (isProtected) {
      throw new PlaneStatePolicyError(
        `AI actors may not move Plane work items to protected state "${args.targetState.name}"`
      )
    }
    return
  }

  if (!isProtected) {
    return
  }
  const ownerUserId = args.actor.userId
  const member = args.workspaceMembers?.find((candidate) => candidate.id === ownerUserId)
  if (member?.role !== PLANE_OWNER_ROLE) {
    throw new PlaneStatePolicyError(
      `Only a Plane workspace Owner may move work items to protected state "${args.targetState.name}"`
    )
  }
}

function normalizeStateName(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}
