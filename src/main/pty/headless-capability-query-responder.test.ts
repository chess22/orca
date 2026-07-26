import { describe, expect, it, vi } from 'vitest'
import { HeadlessCapabilityQueryResponder } from './headless-capability-query-responder'

// Why: matches chess22/orca#12 — a daemon PTY with no renderer pane mounted
// (CLI-created, or not yet remounted right after an app restart) has nothing
// to answer DA1/DSR queries an interactive TUI blocks on. This responder is
// the fallback; these tests assert it actually answers those queries.
describe('HeadlessCapabilityQueryResponder', () => {
  it('answers a primary device attributes (DA1) query', async () => {
    const sendInput = vi.fn<(ptyId: string, data: string) => void>()
    const responder = new HeadlessCapabilityQueryResponder(sendInput)

    await responder.feed('pty-1', '\x1b[c', { cols: 80, rows: 24 })

    expect(sendInput).toHaveBeenCalledWith('pty-1', '\x1b[?1;2c')
    responder.disposeAll()
  })

  it('answers a cursor position report (DSR) query via built-in xterm handling', async () => {
    const sendInput = vi.fn<(ptyId: string, data: string) => void>()
    const responder = new HeadlessCapabilityQueryResponder(sendInput)

    await responder.feed('pty-1', '\x1b[6n', { cols: 80, rows: 24 })

    expect(sendInput).toHaveBeenCalledTimes(1)
    const [ptyId, reply] = sendInput.mock.calls[0]!
    expect(ptyId).toBe('pty-1')
    expect(reply.startsWith('\x1b[')).toBe(true)
    expect(reply.endsWith('R')).toBe(true)
    responder.disposeAll()
  })

  it('tracks separate ptyIds independently', async () => {
    const sendInput = vi.fn<(ptyId: string, data: string) => void>()
    const responder = new HeadlessCapabilityQueryResponder(sendInput)

    await responder.feed('pty-1', '\x1b[c', { cols: 80, rows: 24 })
    await responder.feed('pty-2', '\x1b[c', { cols: 80, rows: 24 })

    expect(sendInput).toHaveBeenCalledWith('pty-1', '\x1b[?1;2c')
    expect(sendInput).toHaveBeenCalledWith('pty-2', '\x1b[?1;2c')
    responder.disposeAll()
  })

  it('stops answering for a ptyId after dispose', async () => {
    const sendInput = vi.fn<(ptyId: string, data: string) => void>()
    const responder = new HeadlessCapabilityQueryResponder(sendInput)

    await responder.feed('pty-1', 'no query yet', { cols: 80, rows: 24 })
    responder.dispose('pty-1')
    sendInput.mockClear()

    // Why: after dispose, feed() must transparently recreate a fresh headless
    // terminal (mirrors the daemon side reattaching) rather than throwing.
    await responder.feed('pty-1', '\x1b[c', { cols: 80, rows: 24 })
    expect(sendInput).toHaveBeenCalledWith('pty-1', '\x1b[?1;2c')
    responder.disposeAll()
  })

  it('is a no-op disposing a ptyId that was never fed', () => {
    const sendInput = vi.fn<(ptyId: string, data: string) => void>()
    const responder = new HeadlessCapabilityQueryResponder(sendInput)

    expect(() => responder.dispose('never-created')).not.toThrow()
  })

  it('does not answer ordinary output that contains no query sequences', async () => {
    const sendInput = vi.fn<(ptyId: string, data: string) => void>()
    const responder = new HeadlessCapabilityQueryResponder(sendInput)

    await responder.feed('pty-1', 'hello world\r\n', { cols: 80, rows: 24 })

    expect(sendInput).not.toHaveBeenCalled()
    responder.disposeAll()
  })
})
