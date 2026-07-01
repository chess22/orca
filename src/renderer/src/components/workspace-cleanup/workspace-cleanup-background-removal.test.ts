import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  startWorkspaceCleanupBackgroundRemoval,
  type WorkspaceCleanupBackgroundRemovalArgs
} from './workspace-cleanup-background-removal'
import { makeCandidate } from './workspace-cleanup-presentation-fixtures'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

describe('startWorkspaceCleanupBackgroundRemoval', () => {
  it('reports deletion progress while the slow removal promise is pending', async () => {
    let resolveRemoval: (
      result: Awaited<ReturnType<WorkspaceCleanupBackgroundRemovalArgs['removeCandidates']>>
    ) => void
    const removeCandidates = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<WorkspaceCleanupBackgroundRemovalArgs['removeCandidates']>>>(
          (resolve) => {
            resolveRemoval = resolve
          }
        )
    )
    const onProgress = vi.fn()
    const onResult = vi.fn()
    const candidate = makeCandidate()

    startWorkspaceCleanupBackgroundRemoval({
      candidates: [candidate],
      removeCandidates,
      onProgress,
      onResult
    })

    expect(removeCandidates).toHaveBeenCalledWith([candidate.worktreeId])
    expect(onProgress).toHaveBeenCalledWith({
      totalCount: 1,
      processedCount: 0,
      removedCount: 0,
      failedCount: 0
    })
    expect(onResult).not.toHaveBeenCalled()

    resolveRemoval!({ removedIds: [candidate.worktreeId], failures: [] })
    await Promise.resolve()
    await Promise.resolve()

    expect(onProgress).toHaveBeenLastCalledWith({
      totalCount: 1,
      processedCount: 1,
      removedCount: 1,
      failedCount: 0
    })
    expect(toast.success).toHaveBeenCalled()
    expect(onResult).toHaveBeenCalledWith({ removedIds: [candidate.worktreeId], failures: [] })
  })

  it('removes candidates one at a time for per-row progress', async () => {
    const first = makeCandidate()
    const second = makeCandidate({
      worktreeId: 'repo-1::/repo/beta',
      displayName: 'beta',
      branch: 'beta',
      path: '/repo/beta'
    })
    const removeCandidates = vi
      .fn()
      .mockResolvedValueOnce({ removedIds: [first.worktreeId], failures: [] })
      .mockResolvedValueOnce({ removedIds: [second.worktreeId], failures: [] })
    const onProgress = vi.fn()

    startWorkspaceCleanupBackgroundRemoval({
      candidates: [first, second],
      removeCandidates,
      onProgress
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(removeCandidates).toHaveBeenNthCalledWith(1, [first.worktreeId])
    expect(removeCandidates).toHaveBeenNthCalledWith(2, [second.worktreeId])
    expect(onProgress).toHaveBeenLastCalledWith({
      totalCount: 2,
      processedCount: 2,
      removedCount: 2,
      failedCount: 0
    })
  })

  it('reports removal failures after dismissing the pending toast', async () => {
    const candidate = makeCandidate()

    startWorkspaceCleanupBackgroundRemoval({
      candidates: [candidate],
      removeCandidates: vi.fn().mockResolvedValue({
        removedIds: [],
        failures: [
          { worktreeId: candidate.worktreeId, displayName: candidate.displayName, message: 'busy' }
        ]
      }),
      onProgress: vi.fn()
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(toast.error).toHaveBeenCalledWith(
      '1 workspace could not be removed',
      expect.objectContaining({ description: 'busy' })
    )
  })
})
