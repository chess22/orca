import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { showMessageBoxMock, startRecordingMock, stopRecordingMock, getPathMock } = vi.hoisted(
  () => ({
    showMessageBoxMock: vi.fn(),
    startRecordingMock: vi.fn(),
    stopRecordingMock: vi.fn(),
    getPathMock: vi.fn()
  })
)

vi.mock('electron', () => ({
  app: { getPath: getPathMock, getVersion: () => '1.2.3-test' },
  dialog: { showMessageBox: showMessageBoxMock },
  contentTracing: { startRecording: startRecordingMock, stopRecording: stopRecordingMock }
}))

// Why: the trace stage waits 10 s in production; tests must not.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))

vi.mock('./renderer-perf', () => ({
  collectRendererPerfMetrics: vi.fn(async () => ({
    type: 'renderer-perf',
    schema_version: 1,
    collected_at: '2026-01-01T00:00:00.000Z'
  }))
}))

vi.mock('../i18n/main-i18n', () => ({
  translateMain: (_key: string, fallback: string) => fallback
}))

import { captureRendererPerfDump } from './perf-dump'

let tempRoot: string
let downloadsDir: string

function makeRenderer(overrides: Record<string, unknown> = {}): unknown {
  return {
    isDestroyed: () => false,
    takeHeapSnapshot: vi.fn(async (filePath: string) => {
      await writeFile(filePath, '{"snapshot":true}', 'utf8')
    }),
    ...overrides
  }
}

function readTarEntries(archive: Buffer): Map<string, string> {
  const tar = gunzipSync(archive)
  const entries = new Map<string, string>()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const name = tar
      .subarray(offset, offset + 100)
      .toString('utf8')
      .split('\0')[0]
    if (!name) {
      break
    }
    const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString('ascii'), 8)
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size).toString('utf8'))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

describe('captureRendererPerfDump', () => {
  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'orca-perf-dump-test-'))
    downloadsDir = join(tempRoot, 'downloads')
    await mkdir(downloadsDir, { recursive: true })
    getPathMock.mockImplementation((name: string) =>
      name === 'downloads' ? downloadsDir : join(tempRoot, name)
    )
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    startRecordingMock.mockResolvedValue(undefined)
    stopRecordingMock.mockImplementation(async (filePath: string) => {
      await writeFile(filePath, '{"traceEvents":[]}', 'utf8')
      return filePath
    })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('produces a tar.gz containing metadata, metrics, trace, and heap snapshot', async () => {
    const result = await captureRendererPerfDump({
      getRendererWebContents: () => makeRenderer() as never
    })

    expect(result).not.toHaveProperty('canceled')
    const { filePath, bytes } = result as { filePath: string; bytes: number }
    expect(bytes).toBeGreaterThan(0)
    const names = [...readTarEntries(await readFile(filePath)).keys()]
    expect(names).toEqual([
      'metadata.json',
      'renderer-perf-metrics.json',
      'trace.json',
      'renderer-heap.heapsnapshot'
    ])
    // Temp capture directory is removed after packaging.
    expect(await readdir(join(tempRoot, 'temp', 'orca-perf-dumps'))).toEqual([])
  })

  it('returns canceled without touching tracing when the consent dialog is declined', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 })

    const result = await captureRendererPerfDump({
      getRendererWebContents: () => makeRenderer() as never
    })

    expect(result).toEqual({ canceled: true })
    expect(startRecordingMock).not.toHaveBeenCalled()
  })

  it('coalesces concurrent captures onto one consent dialog and one capture', async () => {
    const renderer = makeRenderer()
    const [first, second] = await Promise.all([
      captureRendererPerfDump({ getRendererWebContents: () => renderer as never }),
      captureRendererPerfDump({ getRendererWebContents: () => renderer as never })
    ])

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1)
    expect(startRecordingMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })

  it('still produces a dump with failure notes when trace and heap capture fail', async () => {
    startRecordingMock.mockRejectedValue(new Error('tracing busy'))
    const renderer = makeRenderer({
      takeHeapSnapshot: vi.fn(async () => {
        throw new Error('snapshot failed')
      })
    })

    const result = await captureRendererPerfDump({
      getRendererWebContents: () => renderer as never
    })

    const { filePath } = result as { filePath: string }
    const entries = readTarEntries(await readFile(filePath))
    expect([...entries.keys()]).toEqual(['metadata.json', 'renderer-perf-metrics.json'])
    const metadata = JSON.parse(entries.get('metadata.json')!) as {
      artifacts: Record<string, { status: string; reason?: string }>
    }
    expect(metadata.artifacts.trace.status).toBe('failed')
    expect(metadata.artifacts.trace.reason).toContain('tracing busy')
    expect(metadata.artifacts.heap.status).toBe('failed')
    expect(metadata.artifacts.heap.reason).toContain('snapshot failed')
  })

  it('reports progress stages in order', async () => {
    const stages: string[] = []
    await captureRendererPerfDump({
      getRendererWebContents: () => makeRenderer() as never,
      onProgress: (stage) => stages.push(stage)
    })
    expect(stages).toEqual(['metrics', 'trace', 'heap', 'compressing'])
  })
})
