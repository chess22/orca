import {
  MultiFileDiff,
  WorkerPoolContextProvider,
  type DiffLineAnnotation,
  type SelectedLineRange
} from '@pierre/diffs/react'
import type { FileDiffOptions } from '@pierre/diffs'
import PierreDiffWorker from '@pierre/diffs/worker/worker.js?worker'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffCommentCard } from '../diff-comments/DiffCommentCard'
import type { DecoratedDiffComment } from '../diff-comments/useDiffCommentDecorator'
import { cn } from '@/lib/utils'
import { createPierreFileContents, getPierreCommentTarget } from './pierre-diff-model'
import { DiffCommentPopover } from '../diff-comments/DiffCommentPopover'

type PierreTextDiffProps = {
  originalContent: string
  modifiedContent: string
  filePath: string
  language: string
  sideBySide: boolean
  isDark: boolean
  fontSize: number
  fontFamily?: string
  scrollable?: boolean
  className?: string
  style?: React.CSSProperties
  comments?: readonly DecoratedDiffComment[]
  commentableLineNumbers?: readonly number[]
  addLineCommentLabel?: string
  addLineCommentPlaceholder?: string
  onAddLineComment?: (args: {
    lineNumber: number
    startLine?: number
    body: string
  }) => Promise<boolean>
  onDeleteComment?: (commentId: string) => void
  onUpdateComment?: (commentId: string, body: string) => Promise<boolean>
  pendingScrollCommentId?: string | null
  onPendingScrollConsumed?: () => void
  onContentHeightChange?: (height: number) => void
}

type PierreDiffStyle = React.CSSProperties & Record<`--${string}`, string | number>

type PendingPopover = {
  lineNumber: number
  startLine?: number
  top: number
}

const PIERRE_WORKER_POOL_SIZE =
  typeof navigator === 'undefined'
    ? 2
    : Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))
const PIERRE_RENDER_RETRY_DELAYS_MS = [50, 150, 300, 600, 1_000]

function createPierreWorker(): Worker {
  return new PierreDiffWorker()
}

function hasRenderedDiffLines(container: HTMLElement | null): boolean {
  if (!container) {
    return false
  }
  return Array.from(container.querySelectorAll('diffs-container')).some((host) =>
    host.shadowRoot?.querySelector('[data-line]')
  )
}

function findRenderedLine(container: HTMLElement, lineNumber: number): HTMLElement | null {
  const hosts = Array.from(container.querySelectorAll('diffs-container'))
  const selectors = [
    `[data-additions] [data-line="${lineNumber}"]`,
    `[data-line="${lineNumber}"][data-line-type="change-addition"]`,
    `[data-line="${lineNumber}"][data-line-type="context"]`,
    `[data-line="${lineNumber}"]`
  ]

  for (const host of hosts) {
    const shadowRoot = host.shadowRoot
    if (!shadowRoot) {
      continue
    }
    for (const selector of selectors) {
      const match = shadowRoot.querySelector(selector)
      if (match instanceof HTMLElement) {
        return match
      }
    }
  }

  return null
}

function getLineTop(container: HTMLElement, lineNumber: number): number | null {
  const line = findRenderedLine(container, lineNumber)
  if (!line) {
    return null
  }
  const lineRect = line.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return Math.max(0, lineRect.top - containerRect.top + container.scrollTop)
}

export function PierreTextDiff({
  originalContent,
  modifiedContent,
  filePath,
  language,
  sideBySide,
  isDark,
  fontSize,
  fontFamily,
  scrollable = false,
  className,
  style,
  comments = [],
  commentableLineNumbers,
  addLineCommentLabel,
  addLineCommentPlaceholder,
  onAddLineComment,
  onDeleteComment,
  onUpdateComment,
  pendingScrollCommentId,
  onPendingScrollConsumed,
  onContentHeightChange
}: PierreTextDiffProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [popover, setPopover] = useState<PendingPopover | null>(null)
  const [renderRetry, setRenderRetry] = useState(0)

  const oldFile = useMemo(
    () =>
      createPierreFileContents({
        filePath,
        contents: originalContent,
        language
      }),
    [filePath, language, originalContent]
  )
  const newFile = useMemo(
    () =>
      createPierreFileContents({
        filePath,
        contents: modifiedContent,
        language
      }),
    [filePath, language, modifiedContent]
  )

  const reportContentHeight = useCallback(() => {
    const content = contentRef.current
    if (!content || !onContentHeightChange) {
      return
    }
    onContentHeightChange(content.scrollHeight)
  }, [onContentHeightChange])

  useEffect(() => {
    if (!onContentHeightChange || !contentRef.current) {
      return
    }
    const content = contentRef.current
    const report = (): void => reportContentHeight()
    report()
    const observer = new ResizeObserver(report)
    observer.observe(content)
    return () => observer.disconnect()
  }, [onContentHeightChange, reportContentHeight])

  const lineAnnotations = useMemo<DiffLineAnnotation<DecoratedDiffComment>[]>(
    () =>
      comments.map((comment) => ({
        side: 'additions',
        lineNumber: comment.lineNumber,
        metadata: comment
      })),
    [comments]
  )

  const handleAddTarget = useCallback(
    (range: SelectedLineRange) => {
      if (!onAddLineComment) {
        return
      }
      const target = getPierreCommentTarget(range, commentableLineNumbers)
      if (!target || !containerRef.current) {
        return
      }
      const top = getLineTop(containerRef.current, target.lineNumber)
      if (top == null) {
        return
      }
      setPopover({ ...target, top })
    },
    [commentableLineNumbers, onAddLineComment]
  )

  const options = useMemo<FileDiffOptions<DecoratedDiffComment>>(
    () => ({
      theme: isDark ? 'github-dark' : 'github-light',
      themeType: isDark ? 'dark' : 'light',
      diffStyle: sideBySide ? 'split' : 'unified',
      diffIndicators: 'classic',
      disableFileHeader: true,
      hunkSeparators: 'line-info',
      overflow: 'scroll',
      lineDiffType: 'word',
      maxLineDiffLength: 1_000,
      tokenizeMaxLineLength: 1_000,
      unsafeCSS:
        renderRetry === 0 ? undefined : `:host{--orca-pierre-render-retry:${renderRetry};}`,
      lineHoverHighlight: onAddLineComment ? 'both' : 'disabled',
      enableGutterUtility: Boolean(onAddLineComment),
      enableLineSelection: Boolean(onAddLineComment),
      onGutterUtilityClick: onAddLineComment ? handleAddTarget : undefined,
      onPostRender: () => {
        requestAnimationFrame(reportContentHeight)
      }
    }),
    [handleAddTarget, isDark, onAddLineComment, renderRetry, reportContentHeight, sideBySide]
  )

  const diffStyle = useMemo<PierreDiffStyle>(
    () => ({
      '--diffs-font-size': `${fontSize}px`,
      '--diffs-line-height': `${Math.max(18, Math.round(fontSize * 1.45))}px`,
      '--diffs-font-family': fontFamily || 'var(--font-mono)',
      '--diffs-header-font-family': 'var(--font-sans)',
      '--diffs-light-bg': 'var(--editor-surface)',
      '--diffs-dark-bg': 'var(--editor-surface)',
      '--diffs-light': 'var(--foreground)',
      '--diffs-dark': 'var(--foreground)',
      '--diffs-addition-color': 'var(--git-decoration-added)',
      '--diffs-deletion-color': 'var(--git-decoration-deleted)',
      '--diffs-modified-color': 'var(--git-decoration-modified)',
      '--diffs-bg-hover-override': 'var(--accent)',
      ...style
    }),
    [fontFamily, fontSize, style]
  )

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<DecoratedDiffComment>): React.ReactNode => {
      const comment = annotation.metadata
      if (!comment) {
        return null
      }
      return (
        <div className="orca-diff-comment-inline">
          <DiffCommentCard
            lineNumber={comment.lineNumber}
            startLine={comment.startLine}
            body={comment.body}
            sentAt={comment.sentAt}
            author={comment.author}
            authorAvatarUrl={comment.authorAvatarUrl}
            createdAtLabel={comment.createdAtLabel}
            url={comment.url}
            onDelete={
              comment.canDelete === false || !onDeleteComment
                ? undefined
                : () => onDeleteComment(comment.id)
            }
            onSubmitEdit={
              onUpdateComment && comment.canEdit !== false
                ? (body) => onUpdateComment(comment.id, body)
                : undefined
            }
            onContentResize={() => requestAnimationFrame(reportContentHeight)}
          />
        </div>
      )
    },
    [onDeleteComment, onUpdateComment, reportContentHeight]
  )

  useEffect(() => {
    setRenderRetry(0)
  }, [filePath, language, modifiedContent, originalContent, sideBySide])

  useEffect(() => {
    if (originalContent === modifiedContent || hasRenderedDiffLines(containerRef.current)) {
      return
    }
    const delay = PIERRE_RENDER_RETRY_DELAYS_MS[renderRetry]
    if (delay === undefined) {
      return
    }

    // Why: @pierre/diffs 1.2.2 can complete async highlighting without
    // scheduling a rerender. A no-op option revision flushes the cached result.
    const timeout = window.setTimeout(() => {
      if (!hasRenderedDiffLines(containerRef.current)) {
        setRenderRetry((prev) => Math.min(prev + 1, PIERRE_RENDER_RETRY_DELAYS_MS.length))
      }
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [filePath, language, modifiedContent, originalContent, renderRetry, sideBySide])

  useEffect(() => {
    if (!pendingScrollCommentId || !containerRef.current) {
      return
    }
    const comment = comments.find((candidate) => candidate.id === pendingScrollCommentId)
    if (!comment) {
      return
    }

    let cancelled = false
    let attempts = 0
    const scrollToComment = (): void => {
      if (cancelled || !containerRef.current) {
        return
      }
      const line = findRenderedLine(containerRef.current, comment.lineNumber)
      if (!line) {
        if (attempts++ < 30) {
          requestAnimationFrame(scrollToComment)
        }
        return
      }
      line.scrollIntoView({ block: 'center' })
      onPendingScrollConsumed?.()
    }

    requestAnimationFrame(scrollToComment)
    return () => {
      cancelled = true
    }
  }, [comments, onPendingScrollConsumed, pendingScrollCommentId])

  const workerPoolOptions = useMemo(
    () => ({
      workerFactory: createPierreWorker,
      poolSize: PIERRE_WORKER_POOL_SIZE,
      totalASTLRUCacheSize: 80
    }),
    []
  )
  const highlighterOptions = useMemo(
    () => ({
      langs: [oldFile.lang ?? 'text', newFile.lang ?? 'text'],
      theme: options.theme,
      lineDiffType: options.lineDiffType,
      maxLineDiffLength: options.maxLineDiffLength,
      tokenizeMaxLineLength: options.tokenizeMaxLineLength
    }),
    [
      newFile.lang,
      oldFile.lang,
      options.lineDiffType,
      options.maxLineDiffLength,
      options.theme,
      options.tokenizeMaxLineLength
    ]
  )

  const handleSubmitComment = async (body: string): Promise<void> => {
    if (!popover || !onAddLineComment) {
      return
    }
    const ok = await onAddLineComment({
      lineNumber: popover.lineNumber,
      startLine: popover.startLine,
      body
    })
    if (ok) {
      setPopover(null)
    }
  }

  return (
    <div
      ref={containerRef}
      data-diff-renderer="pierre"
      className={cn(
        'relative min-h-0 bg-editor-surface',
        scrollable ? 'h-full overflow-auto scrollbar-editor' : 'overflow-visible',
        className
      )}
      style={diffStyle}
    >
      {popover && onAddLineComment && (
        <DiffCommentPopover
          key={`${popover.startLine ?? popover.lineNumber}:${popover.lineNumber}`}
          lineNumber={popover.lineNumber}
          startLine={popover.startLine}
          top={popover.top}
          placeholder={addLineCommentPlaceholder}
          submitLabel={addLineCommentLabel}
          submittingLabel="Posting..."
          onCancel={() => setPopover(null)}
          onSubmit={handleSubmitComment}
        />
      )}
      <WorkerPoolContextProvider
        poolOptions={workerPoolOptions}
        highlighterOptions={highlighterOptions}
      >
        <div ref={contentRef}>
          <MultiFileDiff
            oldFile={oldFile}
            newFile={newFile}
            options={options}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            className="block min-w-full"
          />
        </div>
      </WorkerPoolContextProvider>
    </div>
  )
}
