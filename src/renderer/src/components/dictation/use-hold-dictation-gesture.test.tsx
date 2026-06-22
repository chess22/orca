// @vitest-environment happy-dom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DictationState } from '../../../../shared/speech-types'
import type { GlobalSettings } from '../../../../shared/types'
import { useHoldDictationGesture } from './use-hold-dictation-gesture'

type HarnessProps = {
  dictationStateRef: React.MutableRefObject<DictationState>
  holdGestureActiveRef: React.MutableRefObject<boolean>
  startDictation: () => void
  stopDictation: () => void
}

function Harness({
  dictationStateRef,
  holdGestureActiveRef,
  startDictation,
  stopDictation
}: HarnessProps): null {
  useHoldDictationGesture({
    dictationStateRef,
    holdGestureActiveRef,
    insertionTargetRef: { current: null },
    intentionalTargetCancellationRef: { current: false },
    keybindings: {},
    settings: {
      voice: {
        enabled: true,
        sttModel: 'test-model',
        dictationMode: 'hold'
      }
    } as GlobalSettings,
    startDictation,
    stopDictation
  })
  return null
}

function dispatchDictationEvent(type: 'keydown' | 'keyup', init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      key: 'e',
      code: 'KeyE',
      metaKey: true,
      bubbles: true,
      cancelable: true,
      ...init
    })
  )
}

describe('useHoldDictationGesture', () => {
  const originalUserAgent = navigator.userAgent
  let container: HTMLDivElement
  let root: Root
  let dictationStateRef: React.MutableRefObject<DictationState>
  let holdGestureActiveRef: React.MutableRefObject<boolean>
  let startDictation: ReturnType<typeof vi.fn<() => void>>
  let stopDictation: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Macintosh'
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    dictationStateRef = { current: 'idle' }
    holdGestureActiveRef = { current: false }
    startDictation = vi.fn<() => void>(() => {
      dictationStateRef.current = 'listening'
    })
    stopDictation = vi.fn<() => void>(() => {
      dictationStateRef.current = 'idle'
    })
    act(() => {
      root.render(
        <Harness
          dictationStateRef={dictationStateRef}
          holdGestureActiveRef={holdGestureActiveRef}
          startDictation={startDictation}
          stopDictation={stopDictation}
        />
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent
    })
  })

  it('stops when the primary dictation key is released after the modifier flag has dropped', () => {
    act(() => {
      dispatchDictationEvent('keydown', {})
    })

    expect(startDictation).toHaveBeenCalledTimes(1)

    act(() => {
      dispatchDictationEvent('keyup', { metaKey: false })
    })

    expect(stopDictation).toHaveBeenCalledTimes(1)
    expect(holdGestureActiveRef.current).toBe(false)
  })

  it('stops when a held dictation modifier is released before the primary key', () => {
    act(() => {
      dispatchDictationEvent('keydown', {})
    })

    expect(startDictation).toHaveBeenCalledTimes(1)

    act(() => {
      dispatchDictationEvent('keyup', {
        key: 'Meta',
        code: 'MetaLeft',
        metaKey: false
      })
    })

    expect(stopDictation).toHaveBeenCalledTimes(1)
    expect(holdGestureActiveRef.current).toBe(false)
  })

  it('ignores unrelated key releases while the dictation chord is held', () => {
    act(() => {
      dispatchDictationEvent('keydown', {})
    })

    act(() => {
      dispatchDictationEvent('keyup', {
        key: 'a',
        code: 'KeyA'
      })
    })

    expect(stopDictation).not.toHaveBeenCalled()
    expect(holdGestureActiveRef.current).toBe(true)
  })
})
