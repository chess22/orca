import { describe, expect, it } from 'vitest'
import {
  resolveChecksPanelHostedReviewBaseRef,
  shouldOpenChecksPanelCreateComposer
} from './checks-panel-review-creation'

describe('resolveChecksPanelHostedReviewBaseRef', () => {
  it('prefers the worktree base ref over the repo default', () => {
    expect(
      resolveChecksPanelHostedReviewBaseRef({
        worktreeBaseRef: ' release/1.4 ',
        repoBaseRef: 'main'
      })
    ).toBe('release/1.4')
  })

  it('falls back to the repo base ref when the worktree has no override', () => {
    expect(
      resolveChecksPanelHostedReviewBaseRef({
        worktreeBaseRef: null,
        repoBaseRef: ' main '
      })
    ).toBe('main')
  })
})

describe('shouldOpenChecksPanelCreateComposer', () => {
  it('opens for GitLab MR creation eligibility', () => {
    expect(
      shouldOpenChecksPanelCreateComposer({
        activeReview: null,
        isFolder: false,
        branch: 'feature/gitlab-mr',
        hostedReviewCreation: {
          provider: 'gitlab',
          review: null,
          canCreate: true,
          blockedReason: null,
          nextAction: null
        }
      })
    ).toBe(true)
  })

  it('opens for push-before-create recovery', () => {
    expect(
      shouldOpenChecksPanelCreateComposer({
        activeReview: null,
        isFolder: false,
        branch: 'feature/gitlab-mr',
        hostedReviewCreation: {
          provider: 'gitlab',
          review: null,
          canCreate: false,
          blockedReason: 'needs_push',
          nextAction: 'push'
        }
      })
    ).toBe(true)
  })
})
