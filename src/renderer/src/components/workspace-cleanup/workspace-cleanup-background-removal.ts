import { toast } from 'sonner'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import type {
  WorkspaceCleanupFailure,
  WorkspaceCleanupRemoveResult
} from '@/store/slices/workspace-cleanup'
import { translate } from '@/i18n/i18n'

export type WorkspaceCleanupRemovalProgress = {
  totalCount: number
  processedCount: number
  removedCount: number
  failedCount: number
}

export type WorkspaceCleanupBackgroundRemovalArgs = {
  candidates: readonly WorkspaceCleanupCandidate[]
  removeCandidates: (worktreeIds: readonly string[]) => Promise<WorkspaceCleanupRemoveResult>
  onProgress: (progress: WorkspaceCleanupRemovalProgress) => void
  onResult?: (result: WorkspaceCleanupRemoveResult) => void
  onError?: (error: unknown) => void
}

export function startWorkspaceCleanupBackgroundRemoval({
  candidates,
  removeCandidates,
  onProgress,
  onResult,
  onError
}: WorkspaceCleanupBackgroundRemovalArgs): void {
  if (candidates.length === 0) {
    return
  }

  const count = candidates.length
  const removedIds: string[] = []
  const failures: WorkspaceCleanupFailure[] = []
  let processedCount = 0

  const emitProgress = (): void => {
    onProgress({
      totalCount: count,
      processedCount,
      removedCount: removedIds.length,
      failedCount: failures.length
    })
  }

  emitProgress()

  void (async () => {
    for (const candidate of candidates) {
      try {
        const result = await removeCandidates([candidate.worktreeId])
        removedIds.push(...result.removedIds)
        failures.push(...result.failures)
      } catch (error: unknown) {
        failures.push({
          worktreeId: candidate.worktreeId,
          displayName: candidate.displayName,
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        processedCount += 1
        emitProgress()
      }
    }

    const result = { removedIds, failures }
    onResult?.(result)

    if (result.removedIds.length > 0) {
      toast.success(
        translate(
          'auto.components.workspace.cleanup.backgroundRemoval.removed',
          'Removed {{value0}} workspace{{value1}}',
          {
            value0: result.removedIds.length,
            value1: result.removedIds.length === 1 ? '' : 's'
          }
        )
      )
    }

    if (result.failures.length > 0) {
      toast.error(
        translate(
          'auto.components.workspace.cleanup.backgroundRemoval.failed',
          '{{value0}} workspace{{value1}} could not be removed',
          {
            value0: result.failures.length,
            value1: result.failures.length === 1 ? '' : 's'
          }
        ),
        {
          description: result.failures[0]?.message
        }
      )
    }
  })().catch((error: unknown) => {
    onError?.(error)
    toast.error(
      translate(
        'auto.components.workspace.cleanup.backgroundRemoval.error',
        'Workspace cleanup failed'
      ),
      {
        description: error instanceof Error ? error.message : String(error)
      }
    )
  })
}
