import { describe, expect, it } from 'vitest'
import {
  createPierreFileContents,
  getPierreCommentTarget,
  normalizePierreLanguage
} from './pierre-diff-model'

describe('pierre-diff-model', () => {
  it('normalizes Monaco language names for Pierre', () => {
    expect(normalizePierreLanguage('plaintext')).toBe('text')
    expect(normalizePierreLanguage('shellscript')).toBe('bash')
    expect(normalizePierreLanguage('TypeScript')).toBe('typescript')
  })

  it('creates Pierre file contents with a display path and language', () => {
    expect(
      createPierreFileContents({
        filePath: 'src/App.tsx',
        contents: 'export const App = () => null\n',
        language: 'typescript'
      })
    ).toEqual({
      name: 'src/App.tsx',
      contents: 'export const App = () => null\n',
      lang: 'typescript'
    })
  })

  it('maps addition-side selections to comment targets', () => {
    expect(getPierreCommentTarget({ start: 7, end: 5, side: 'additions' })).toEqual({
      startLine: 5,
      lineNumber: 7
    })
    expect(getPierreCommentTarget({ start: 4, end: 4, side: 'additions' })).toEqual({
      lineNumber: 4
    })
  })

  it('rejects deletion-side and uncommentable selections', () => {
    expect(getPierreCommentTarget({ start: 3, end: 3, side: 'deletions' })).toBeNull()
    expect(getPierreCommentTarget({ start: 2, end: 4, side: 'additions' }, [2, 4])).toBeNull()
    expect(getPierreCommentTarget({ start: 2, end: 4, side: 'additions' }, [2, 3, 4])).toEqual({
      startLine: 2,
      lineNumber: 4
    })
  })
})
