import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  createAgentInterruptInference,
  isCtrlCKeyEvent,
  isPlainEscapeKeyEvent
} from './agent-interrupt-inference'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function makeEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'write tests',
    updatedAt: 1_000,
    stateStartedAt: 900,
    agentType: 'codex',
    paneKey: PANE_KEY,
    terminalTitle: 'Codex',
    stateHistory: [],
    ...overrides
  }
}

describe('agent interrupt inference', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['plain-escape', 'gemini'],
    ['ctrl-c', 'custom-agent']
  ] as const)('emits a strict baseline request for %s from %s', (intent, agentType) => {
    vi.useFakeTimers()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType })
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent(intent)
    vi.advanceTimersByTime(499)
    expect(inferInterrupt).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(inferInterrupt).toHaveBeenCalledWith({
      paneKey: PANE_KEY,
      baselineUpdatedAt: 1_000,
      baselineStateStartedAt: 900,
      baselinePrompt: 'write tests',
      baselineAgentType: agentType,
      intent
    })
    tracker.dispose()
    entry = undefined
  })

  it('emits when the working row has no agent type', () => {
    vi.useFakeTimers()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType: undefined })
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('ctrl-c')
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).toHaveBeenCalledWith({
      paneKey: PANE_KEY,
      baselineUpdatedAt: 1_000,
      baselineStateStartedAt: 900,
      baselinePrompt: 'write tests',
      baselineAgentType: undefined,
      intent: 'ctrl-c'
    })
    tracker.dispose()
    entry = undefined
  })

  it('requires double Escape on the same turn for OpenCode', () => {
    vi.useFakeTimers()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType: 'opencode' })
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    vi.runOnlyPendingTimers()
    expect(inferInterrupt).not.toHaveBeenCalled()

    tracker.observeInputIntent('plain-escape')
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).toHaveBeenCalledWith({
      paneKey: PANE_KEY,
      baselineUpdatedAt: 1_000,
      baselineStateStartedAt: 900,
      baselinePrompt: 'write tests',
      baselineAgentType: 'opencode',
      intent: 'plain-escape',
      inputCount: 2
    })
    tracker.dispose()
    entry = undefined
  })

  it('does not count an OpenCode Escape across a new turn', () => {
    vi.useFakeTimers()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType: 'opencode' })
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    entry = makeEntry({ agentType: 'opencode', prompt: 'second task', stateStartedAt: 1_050 })
    tracker.observeInputIntent('plain-escape')
    vi.runOnlyPendingTimers()

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
    entry = undefined
  })

  it('does not emit again for a third OpenCode Escape after the row is already done', () => {
    vi.useFakeTimers()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType: 'opencode' })
    const inferInterrupt = vi.fn((request) => {
      entry = makeEntry({
        state: 'done',
        agentType: request.baselineAgentType,
        prompt: request.baselinePrompt,
        updatedAt: 1_500,
        stateStartedAt: 1_500
      })
    })
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    tracker.observeInputIntent('plain-escape')
    vi.advanceTimersByTime(500)
    tracker.observeInputIntent('plain-escape')
    vi.runOnlyPendingTimers()

    expect(inferInterrupt).toHaveBeenCalledTimes(1)
    tracker.dispose()
    entry = undefined
  })

  it('still infers Ctrl+C for OpenCode', () => {
    vi.useFakeTimers()
    let entry: AgentStatusEntry | undefined = makeEntry({ agentType: 'opencode' })
    const inferInterrupt = vi.fn()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('ctrl-c')
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).toHaveBeenCalledWith({
      paneKey: PANE_KEY,
      baselineUpdatedAt: 1_000,
      baselineStateStartedAt: 900,
      baselinePrompt: 'write tests',
      baselineAgentType: 'opencode',
      intent: 'ctrl-c'
    })
    tracker.dispose()
    entry = undefined
  })

  it('does not emit for non-working states', () => {
    vi.useFakeTimers()
    const inferInterrupt = vi.fn()
    let entry: AgentStatusEntry | undefined = makeEntry({ state: 'waiting', agentType: 'codex' })
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    vi.runOnlyPendingTimers()

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('cancels when a newer hook update arrives during the settle window', () => {
    vi.useFakeTimers()
    const inferInterrupt = vi.fn()
    let entry: AgentStatusEntry | undefined = makeEntry()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    entry = makeEntry({ updatedAt: 1_001 })
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('cancels when the status disappears during the settle window', () => {
    vi.useFakeTimers()
    const inferInterrupt = vi.fn()
    let entry: AgentStatusEntry | undefined = makeEntry()
    const tracker = createAgentInterruptInference({
      paneKey: PANE_KEY,
      getStatusEntry: () => entry,
      inferInterrupt,
      now: () => 1_100
    })

    tracker.observeInputIntent('plain-escape')
    entry = undefined
    vi.advanceTimersByTime(500)

    expect(inferInterrupt).not.toHaveBeenCalled()
    tracker.dispose()
  })

  it('requires exact plain Escape and Ctrl+C key events', () => {
    expect(
      isPlainEscapeKeyEvent({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(true)
    expect(
      isPlainEscapeKeyEvent({
        key: 'Escape',
        ctrlKey: false,
        metaKey: false,
        altKey: true,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(false)
    expect(
      isPlainEscapeKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(false)
    expect(
      isCtrlCKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(true)
    expect(
      isCtrlCKeyEvent({
        key: 'C',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(true)
    expect(
      isCtrlCKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        repeat: false
      } as KeyboardEvent)
    ).toBe(false)
    expect(
      isCtrlCKeyEvent({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: true
      } as KeyboardEvent)
    ).toBe(false)
  })
})
