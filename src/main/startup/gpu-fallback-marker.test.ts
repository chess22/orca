import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GPU_FALLBACK_MARKER_FILE,
  consumeGpuFallbackMarker,
  readGpuFallbackMarker,
  writeGpuFallbackMarker
} from './gpu-fallback-marker'

describe('gpu-fallback-marker', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(os.tmpdir(), 'orca-gpu-fallback-test-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('round-trips a written marker', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 123, crashesInWindow: 3 })
    expect(readGpuFallbackMarker(userDataPath)).toEqual({
      schemeVersion: 1,
      engagedAt: 123,
      crashesInWindow: 3
    })
  })

  it('returns null when no marker exists', () => {
    expect(readGpuFallbackMarker(userDataPath)).toBeNull()
    expect(consumeGpuFallbackMarker(userDataPath)).toBeNull()
  })

  it('consume reads then clears the marker so it applies to exactly one launch', () => {
    writeGpuFallbackMarker(userDataPath, { engagedAt: 1, crashesInWindow: 4 })
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(true)

    const consumed = consumeGpuFallbackMarker(userDataPath)
    expect(consumed?.crashesInWindow).toBe(4)
    // Cleared — a second launch must not auto-fallback again.
    expect(existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))).toBe(false)
    expect(consumeGpuFallbackMarker(userDataPath)).toBeNull()
  })

  it('ignores a corrupt or wrong-version marker', () => {
    writeFileSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), '{ not json')
    expect(readGpuFallbackMarker(userDataPath)).toBeNull()

    writeFileSync(
      join(userDataPath, GPU_FALLBACK_MARKER_FILE),
      JSON.stringify({ schemeVersion: 999, engagedAt: 1, crashesInWindow: 1 })
    )
    expect(readGpuFallbackMarker(userDataPath)).toBeNull()
  })
})
