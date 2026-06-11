import type { HostedReviewCreationEligibility } from '../../../../shared/hosted-review'

export function resolveChecksPanelHostedReviewBaseRef(input: {
  worktreeBaseRef?: string | null
  repoBaseRef?: string | null
}): string | null {
  return input.worktreeBaseRef?.trim() || input.repoBaseRef?.trim() || null
}

export function shouldOpenChecksPanelCreateComposer(input: {
  activeReview: unknown | null
  isFolder: boolean
  branch: string
  hostedReviewCreation: HostedReviewCreationEligibility | null
}): boolean {
  return (
    !input.activeReview &&
    !input.isFolder &&
    Boolean(input.branch) &&
    (input.hostedReviewCreation?.canCreate === true ||
      input.hostedReviewCreation?.blockedReason === 'needs_push')
  )
}
