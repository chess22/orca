import type { FileContents, SelectedLineRange, SupportedLanguages } from '@pierre/diffs/react'

const PIERRE_LANGUAGE_ALIASES: Record<string, SupportedLanguages> = {
  plain: 'text',
  plaintext: 'text',
  shell: 'bash',
  shellscript: 'bash',
  sh: 'bash'
}

export type PierreCommentTarget = {
  lineNumber: number
  startLine?: number
}

export function normalizePierreLanguage(language: string): SupportedLanguages {
  const normalized = language.trim().toLowerCase()
  if (!normalized) {
    return 'text'
  }
  return PIERRE_LANGUAGE_ALIASES[normalized] ?? (normalized as SupportedLanguages)
}

export function createPierreFileContents({
  filePath,
  contents,
  language
}: {
  filePath: string
  contents: string
  language: string
}): FileContents {
  return {
    name: filePath || 'diff.txt',
    contents,
    lang: normalizePierreLanguage(language)
  }
}

export function getPierreCommentTarget(
  range: SelectedLineRange,
  commentableLineNumbers?: readonly number[]
): PierreCommentTarget | null {
  const startSide = range.side ?? 'additions'
  const endSide = range.endSide ?? startSide
  if (startSide !== 'additions' || endSide !== 'additions') {
    return null
  }

  const startLine = Math.min(range.start, range.end)
  const lineNumber = Math.max(range.start, range.end)
  if (startLine < 1 || lineNumber < 1) {
    return null
  }

  if (commentableLineNumbers) {
    const allowed = new Set(commentableLineNumbers)
    for (let line = startLine; line <= lineNumber; line++) {
      if (!allowed.has(line)) {
        return null
      }
    }
  }

  return {
    lineNumber,
    startLine: startLine === lineNumber ? undefined : startLine
  }
}
