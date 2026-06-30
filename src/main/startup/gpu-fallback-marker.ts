import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Persisted "disable hardware acceleration on next launch" marker.
 *
 * Why a standalone file (not the Store): app.disableHardwareAcceleration() must
 * be called before app.whenReady() resolves, but the settings Store is only
 * constructed inside whenReady. A tiny JSON marker in userData can be read
 * synchronously at module load, mirroring windows-user-data-acl.ts.
 */

export const GPU_FALLBACK_MARKER_FILE = 'gpu-fallback.json'
export const GPU_FALLBACK_SCHEME_VERSION = 1

type GpuFallbackMarker = {
  schemeVersion: number
  engagedAt: number
  crashesInWindow: number
}

export function readGpuFallbackMarker(userDataPath: string): GpuFallbackMarker | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), 'utf-8')
    ) as Partial<GpuFallbackMarker>
    if (parsed.schemeVersion === GPU_FALLBACK_SCHEME_VERSION) {
      return {
        schemeVersion: GPU_FALLBACK_SCHEME_VERSION,
        engagedAt: typeof parsed.engagedAt === 'number' ? parsed.engagedAt : 0,
        crashesInWindow: typeof parsed.crashesInWindow === 'number' ? parsed.crashesInWindow : 0
      }
    }
  } catch {
    // missing or corrupt → no fallback requested
  }
  return null
}

export function writeGpuFallbackMarker(
  userDataPath: string,
  info: { engagedAt: number; crashesInWindow: number }
): void {
  const marker: GpuFallbackMarker = {
    schemeVersion: GPU_FALLBACK_SCHEME_VERSION,
    engagedAt: info.engagedAt,
    crashesInWindow: info.crashesInWindow
  }
  writeFileSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), JSON.stringify(marker))
}

/**
 * Consume the marker: returns whether it was present and clears it.
 *
 * Why clear immediately: the marker applies to exactly one launch. If software
 * rendering still crashes, we must not relaunch-loop — clearing up front means
 * the next launch tries hardware acceleration again unless a fresh GPU crash
 * burst re-arms the marker.
 */
export function consumeGpuFallbackMarker(userDataPath: string): GpuFallbackMarker | null {
  const marker = readGpuFallbackMarker(userDataPath)
  if (!existsSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE))) {
    return null
  }
  try {
    rmSync(join(userDataPath, GPU_FALLBACK_MARKER_FILE), { force: true })
  } catch {
    // best effort; a stale marker only costs one extra software-render launch
  }
  return marker
}
