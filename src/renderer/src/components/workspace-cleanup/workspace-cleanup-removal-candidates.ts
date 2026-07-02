import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'

type DeleteState = {
  isDeleting?: boolean
}

export function filterWorkspaceCleanupRemovalCandidates(
  candidates: readonly WorkspaceCleanupCandidate[],
  deleteStateByWorktreeId: Record<string, DeleteState | undefined>
): WorkspaceCleanupCandidate[] {
  return candidates.filter(
    (candidate) => deleteStateByWorktreeId[candidate.worktreeId]?.isDeleting !== true
  )
}
