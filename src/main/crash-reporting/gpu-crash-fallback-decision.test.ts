import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD,
  DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS,
  GpuCrashFallbackTracker,
  isGpuChildProcessType
} from './gpu-crash-fallback-decision'

describe('GpuCrashFallbackTracker', () => {
  it('engages fallback once GPU crashes hit the threshold inside the window', () => {
    const tracker = new GpuCrashFallbackTracker({ windowMs: 30_000, threshold: 3 })
    // F0BDNADU79Q / F0BDNRZ5MDG: GPU child dies within seconds of launch.
    expect(tracker.recordGpuCrash(500)).toEqual({
      shouldEngageFallback: false,
      crashesInWindow: 1
    })
    expect(tracker.recordGpuCrash(8_000)).toEqual({
      shouldEngageFallback: false,
      crashesInWindow: 2
    })
    expect(tracker.recordGpuCrash(16_000)).toEqual({
      shouldEngageFallback: true,
      crashesInWindow: 3
    })
  })

  it('engages at most once so the relaunch cannot loop', () => {
    const tracker = new GpuCrashFallbackTracker({ windowMs: 30_000, threshold: 2 })
    tracker.recordGpuCrash(100)
    expect(tracker.recordGpuCrash(200).shouldEngageFallback).toBe(true)
    expect(tracker.hasEngaged()).toBe(true)
    expect(tracker.recordGpuCrash(300)).toEqual({
      shouldEngageFallback: false,
      crashesInWindow: 2
    })
  })

  it('ignores GPU crashes after the post-launch window', () => {
    const tracker = new GpuCrashFallbackTracker({ windowMs: 30_000, threshold: 3 })
    tracker.recordGpuCrash(1_000)
    tracker.recordGpuCrash(2_000)
    // A late hiccup well into the session is normal Chromium churn.
    expect(tracker.recordGpuCrash(45_000)).toEqual({
      shouldEngageFallback: false,
      crashesInWindow: 2
    })
    expect(tracker.hasEngaged()).toBe(false)
  })

  it('classifies GPU child process types case-insensitively', () => {
    expect(isGpuChildProcessType('GPU')).toBe(true)
    expect(isGpuChildProcessType('gpu')).toBe(true)
    expect(isGpuChildProcessType('Utility')).toBe(false)
    expect(isGpuChildProcessType(undefined)).toBe(false)
  })

  it('ships conservative defaults', () => {
    expect(DEFAULT_GPU_CRASH_FALLBACK_WINDOW_MS).toBe(30_000)
    expect(DEFAULT_GPU_CRASH_FALLBACK_THRESHOLD).toBe(3)
  })
})
