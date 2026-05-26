import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import { computeEditorFontSize } from '@/lib/editor-font-zoom'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { isDiffComment } from '@/lib/diff-comment-compat'
import type { DiffComment } from '../../../../shared/types'
import { PierreTextDiff } from './PierreTextDiff'

type PierreDiffViewerProps = {
  originalContent: string
  modifiedContent: string
  language: string
  filePath: string
  relativePath: string
  sideBySide: boolean
  worktreeId?: string
  onAddLineComment?: (args: {
    lineNumber: number
    startLine?: number
    body: string
  }) => Promise<boolean>
  commentableLineNumbers?: readonly number[]
  addLineCommentLabel?: string
  addLineCommentPlaceholder?: string
}

export function PierreDiffViewer({
  originalContent,
  modifiedContent,
  language,
  filePath,
  relativePath,
  sideBySide,
  worktreeId,
  onAddLineComment,
  commentableLineNumbers,
  addLineCommentLabel,
  addLineCommentPlaceholder
}: PierreDiffViewerProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    worktreeId ? findWorktreeById(s.worktreesByRepo, worktreeId)?.diffComments : undefined
  )
  const diffComments = useMemo(
    () => (allDiffComments ?? []).filter((c) => c.filePath === relativePath && isDiffComment(c)),
    [allDiffComments, relativePath]
  )
  const editorFontSize = computeEditorFontSize(
    settings?.terminalFontSize ?? 13,
    editorFontZoomLevel
  )
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const pendingScrollForThisViewer =
    worktreeId && scrollToDiffCommentId && diffComments.some((c) => c.id === scrollToDiffCommentId)
      ? scrollToDiffCommentId
      : null

  const handleAddLineComment = async (args: {
    lineNumber: number
    startLine?: number
    body: string
  }): Promise<boolean> => {
    if (onAddLineComment) {
      return onAddLineComment(args)
    }
    if (!worktreeId) {
      return false
    }
    const result = await addDiffComment({
      worktreeId,
      filePath: relativePath,
      source: 'diff',
      startLine: args.startLine,
      lineNumber: args.lineNumber,
      body: args.body,
      side: 'modified'
    })
    if (!result) {
      console.error('Failed to add diff comment - draft preserved')
    }
    return Boolean(result)
  }

  return (
    <PierreTextDiff
      originalContent={originalContent}
      modifiedContent={modifiedContent}
      filePath={filePath || relativePath}
      language={language}
      sideBySide={sideBySide}
      isDark={isDark}
      fontSize={editorFontSize}
      fontFamily={settings?.terminalFontFamily}
      scrollable
      comments={worktreeId ? diffComments : []}
      commentableLineNumbers={commentableLineNumbers}
      addLineCommentLabel={addLineCommentLabel}
      addLineCommentPlaceholder={addLineCommentPlaceholder}
      onAddLineComment={worktreeId || onAddLineComment ? handleAddLineComment : undefined}
      onDeleteComment={worktreeId ? (id) => void deleteDiffComment(worktreeId, id) : undefined}
      onUpdateComment={
        worktreeId ? (id, body) => updateDiffComment(worktreeId, id, body) : undefined
      }
      pendingScrollCommentId={pendingScrollForThisViewer}
      onPendingScrollConsumed={() => setScrollToDiffCommentId(null)}
    />
  )
}
