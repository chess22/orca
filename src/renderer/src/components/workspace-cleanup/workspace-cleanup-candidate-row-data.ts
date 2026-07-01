import { translate } from '@/i18n/i18n'
import type {
  WorkspaceCleanupBlocker,
  WorkspaceCleanupCandidate
} from '../../../../shared/workspace-cleanup'
import {
  getWorkspaceCleanupGitLabel,
  hasWorkspaceCleanupLocalContext,
  type WorkspaceCleanupReviewInfo
} from './workspace-cleanup-presentation'

export type StatusPillTone = 'neutral' | 'ready' | 'review' | 'destructive'

const BLOCKER_LABELS: Record<WorkspaceCleanupBlocker, string> = {
  'main-worktree': 'Main workspace',
  'folder-repo': 'Folder project',
  pinned: 'Pinned',
  'active-workspace': 'Active workspace',
  'running-terminal': 'Running terminal process',
  'terminal-liveness-unknown': 'Terminal liveness unknown',
  'dirty-editor-buffer': 'Unsaved editor buffer',
  'volatile-local-context': 'Volatile local context',
  'recent-visible-context': 'Recently visited tabs',
  'live-agent': 'Active agent',
  'ssh-disconnected': 'Remote unavailable',
  'git-status-error': 'Git status unavailable',
  'dirty-files': 'Changed files',
  'unpushed-commits': 'Unpushed commits',
  'unknown-base': 'Could not verify unpushed commits',
  dismissed: 'Ignored'
}

export function getWorkspaceCleanupBlockerLabels(candidate: WorkspaceCleanupCandidate): string[] {
  return candidate.blockers.map((blocker) => BLOCKER_LABELS[blocker])
}

export function getCandidateStatus(candidate: WorkspaceCleanupCandidate): {
  label: string
  tone: StatusPillTone
} {
  if (candidate.blockers.includes('dismissed')) {
    return {
      label: translate(
        'auto.components.workspace.cleanup.WorkspaceCleanupDialog.e8b3741ff7',
        'Ignored'
      ),
      tone: 'neutral'
    }
  }
  if (candidate.tier === 'ready') {
    return {
      label: candidate.reasons.includes('archived')
        ? translate(
            'auto.components.workspace.cleanup.WorkspaceCleanupDialog.archivedStatus',
            'Archived'
          )
        : translate(
            'auto.components.workspace.cleanup.WorkspaceCleanupDialog.readyStatus',
            'Ready'
          ),
      tone: 'ready'
    }
  }
  if (candidate.blockers.length > 0) {
    return { label: BLOCKER_LABELS[candidate.blockers[0]], tone: 'neutral' }
  }
  if (candidate.git.upstreamAhead && candidate.git.upstreamAhead > 0) {
    return {
      label: translate(
        'auto.components.workspace.cleanup.WorkspaceCleanupDialog.9623a5107d',
        'Unpushed commits'
      ),
      tone: 'review'
    }
  }
  if (candidate.git.clean === false) {
    return {
      label: translate(
        'auto.components.workspace.cleanup.WorkspaceCleanupDialog.e97e4580c7',
        'Dirty'
      ),
      tone: 'review'
    }
  }
  if (candidate.tier === 'review') {
    return {
      label: translate(
        'auto.components.workspace.cleanup.WorkspaceCleanupDialog.0a2e3c7cba',
        'Review'
      ),
      tone: 'review'
    }
  }
  return {
    label: translate(
      'auto.components.workspace.cleanup.WorkspaceCleanupDialog.c4f4782c02',
      'Not suggested'
    ),
    tone: 'neutral'
  }
}

export function formatGitStatus(candidate: WorkspaceCleanupCandidate): string {
  const label = getWorkspaceCleanupGitLabel(candidate)
  switch (label) {
    case 'Clean':
      return 'Clean git'
    case 'Dirty':
      return 'Dirty git'
    case 'Unpushed':
      return 'Unpushed commits'
    case 'Unknown':
      return 'Git unknown'
  }
  return 'Git unknown'
}

export function formatBranchSafetyDetails(candidate: WorkspaceCleanupCandidate): string[] {
  const details: string[] = []
  if (candidate.git.upstreamAhead !== null) {
    details.push(
      candidate.git.upstreamAhead === 0
        ? 'No unpushed commits'
        : `${candidate.git.upstreamAhead} unpushed commit${
            candidate.git.upstreamAhead === 1 ? '' : 's'
          }`
    )
  }
  return details
}

export function formatContextDetails(candidate: WorkspaceCleanupCandidate): string | null {
  const parts: string[] = []
  if (candidate.localContext.terminalTabCount > 0) {
    parts.push(
      `${candidate.localContext.terminalTabCount} terminal tab${
        candidate.localContext.terminalTabCount === 1 ? '' : 's'
      }`
    )
  }
  if (candidate.localContext.cleanEditorTabCount > 0) {
    parts.push(
      `${candidate.localContext.cleanEditorTabCount} editor tab${
        candidate.localContext.cleanEditorTabCount === 1 ? '' : 's'
      }`
    )
  }
  if (candidate.localContext.browserTabCount > 0) {
    parts.push(
      `${candidate.localContext.browserTabCount} browser tab${
        candidate.localContext.browserTabCount === 1 ? '' : 's'
      }`
    )
  }
  if (candidate.localContext.diffCommentCount > 0) {
    parts.push(
      `${candidate.localContext.diffCommentCount} diff note${
        candidate.localContext.diffCommentCount === 1 ? '' : 's'
      }`
    )
  }
  if (candidate.localContext.retainedDoneAgentCount > 0) {
    parts.push(
      `${candidate.localContext.retainedDoneAgentCount} completed agent${
        candidate.localContext.retainedDoneAgentCount === 1 ? '' : 's'
      }`
    )
  }
  return parts.length > 0 ? parts.join(', ') : null
}

export function getDirtyGitLabel(candidate: WorkspaceCleanupCandidate): string | null {
  if (
    candidate.blockers.includes('unknown-base') ||
    candidate.blockers.includes('git-status-error')
  ) {
    return null
  }
  if (candidate.blockers.includes('unpushed-commits')) {
    if (candidate.git.upstreamAhead && candidate.git.upstreamAhead > 0) {
      return `${candidate.git.upstreamAhead} unpushed commit${
        candidate.git.upstreamAhead === 1 ? '' : 's'
      }`
    }
    return 'Unpushed commits'
  }
  if (candidate.git.upstreamAhead && candidate.git.upstreamAhead > 0) {
    return `${candidate.git.upstreamAhead} unpushed commit${
      candidate.git.upstreamAhead === 1 ? '' : 's'
    }`
  }
  if (candidate.git.clean === false) {
    return 'Uncommitted changes'
  }
  if (candidate.git.clean == null) {
    return 'Git status unknown'
  }
  return null
}

export function shouldShowGitMetadataChip(candidate: WorkspaceCleanupCandidate): boolean {
  return (
    !candidate.blockers.includes('unknown-base') && !candidate.blockers.includes('git-status-error')
  )
}

export function getReviewPillTone(reviewInfo: WorkspaceCleanupReviewInfo): StatusPillTone {
  if (reviewInfo.state === 'open' || reviewInfo.state === 'draft') {
    return 'review'
  }
  return 'neutral'
}

export function getContextPillLabel(candidate: WorkspaceCleanupCandidate): string | null {
  if (!hasWorkspaceCleanupLocalContext(candidate)) {
    return null
  }
  return `${getContextCount(candidate)} context`
}

export function getContextCount(candidate: WorkspaceCleanupCandidate): number {
  return (
    candidate.localContext.terminalTabCount +
    candidate.localContext.cleanEditorTabCount +
    candidate.localContext.browserTabCount +
    candidate.localContext.diffCommentCount +
    candidate.localContext.retainedDoneAgentCount
  )
}
