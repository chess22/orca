import { isWorkspaceKey } from '../../shared/workspace-scope'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { getOptionalWorktreeSelector } from '../selectors'

export type CreateParentSelector = {
  parentWorktree?: string
  parentWorkspace?: string
}

const CREATE_PARENT_CONFLICT_MESSAGE = 'Choose either one parent selector or --no-parent.'

export function assertCreateParentFlagsCompatible(flags: Map<string, string | boolean>): void {
  if (
    (flags.has('parent-worktree') || flags.has('parent-workspace')) &&
    flags.get('no-parent') === true
  ) {
    throw new RuntimeClientError('invalid_argument', CREATE_PARENT_CONFLICT_MESSAGE)
  }
  if (flags.has('parent-workspace') && flags.has('parent-worktree')) {
    throw new RuntimeClientError('invalid_argument', CREATE_PARENT_CONFLICT_MESSAGE)
  }
  assertParentFlagValue(flags, 'parent-worktree')
  assertParentFlagValue(flags, 'parent-workspace')
}

function assertParentFlagValue(flags: Map<string, string | boolean>, name: string): void {
  const value = flags.get(name)
  if (flags.has(name) && (typeof value !== 'string' || value === '')) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --parent-worktree')
  }
}

function getLegacyParentWorkspace(flags: Map<string, string | boolean>): string | undefined {
  if (!flags.has('parent-workspace')) {
    return undefined
  }
  const value = flags.get('parent-workspace')
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  throw new RuntimeClientError('invalid_argument', 'Missing required --parent-worktree')
}

function getWorkspaceKeyParentSelector(selector: string): string | undefined {
  const rawSelector = selector.startsWith('id:') ? selector.slice('id:'.length) : selector
  return isWorkspaceKey(rawSelector) ? rawSelector : undefined
}

export async function resolveCreateParentSelector(
  flags: Map<string, string | boolean>,
  cwd: string,
  client: RuntimeClient
): Promise<CreateParentSelector> {
  const legacyParentWorkspace = getLegacyParentWorkspace(flags)
  if (legacyParentWorkspace) {
    return { parentWorkspace: legacyParentWorkspace }
  }

  const rawParentWorktree = getOptionalStringFlag(flags, 'parent-worktree')
  if (!rawParentWorktree) {
    return {}
  }

  const parentWorkspace = getWorkspaceKeyParentSelector(rawParentWorktree)
  if (parentWorkspace) {
    // Why: create exposes one public parent flag, while the runtime still needs
    // workspace keys to preserve folder/worktree lineage accurately.
    return { parentWorkspace }
  }

  return {
    parentWorktree: await getOptionalWorktreeSelector(flags, 'parent-worktree', cwd, client)
  }
}
