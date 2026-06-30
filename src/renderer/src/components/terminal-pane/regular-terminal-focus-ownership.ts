export type TerminalInputFocusSync = (focused: boolean) => void
export type RefocusScheduler = (callback: () => void) => void
export const REGULAR_TERMINAL_INPUT_FOCUSED_ATTRIBUTE = 'data-regular-terminal-input-focused'

function isMacUserAgent(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
}

function scheduleNextFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
  } else {
    setTimeout(callback, 0)
  }
}

export function isXtermHelperTextarea(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.classList.contains('xterm-helper-textarea')
}

export function setRegularTerminalInputFocusAttribute(focused: boolean): void {
  if (typeof document === 'undefined') {
    return
  }
  document.documentElement.toggleAttribute(REGULAR_TERMINAL_INPUT_FOCUSED_ATTRIBUTE, focused)
}

export function getPaneOwnedActiveHelperTextarea(
  container: HTMLElement,
  activeElement: Element | null
): HTMLElement | null {
  if (!isXtermHelperTextarea(activeElement) || !container.contains(activeElement)) {
    return null
  }
  return activeElement
}

function getPaneHelperTextarea(container: HTMLElement): HTMLElement | null {
  const helper = container.querySelector('.xterm-helper-textarea')
  return helper instanceof HTMLElement ? helper : null
}

function isDocumentBodyOrNull(activeElement: Element | null, ownerDocument: Document): boolean {
  return activeElement === null || activeElement === ownerDocument.body
}

export function releaseTerminalFocusForOutsidePointerDown(args: {
  container: HTMLElement
  activeElement: Element | null
  pointerTarget: EventTarget | null
  syncFocused: TerminalInputFocusSync
}): boolean {
  const activeHelper = getPaneOwnedActiveHelperTextarea(args.container, args.activeElement)
  if (!activeHelper) {
    return false
  }

  if (isNode(args.pointerTarget) && args.container.contains(args.pointerTarget)) {
    return false
  }

  args.syncFocused(false)
  activeHelper.blur()
  return true
}

export function releaseTerminalFocusForWindowBlur(args: {
  container: HTMLElement
  activeElement: Element | null
  syncFocused: TerminalInputFocusSync
}): boolean {
  if (!getPaneOwnedActiveHelperTextarea(args.container, args.activeElement)) {
    return false
  }

  args.syncFocused(false)
  return true
}

export function resyncTerminalFocusForWindowFocus(args: {
  container: HTMLElement
  activeElement: Element | null
  syncFocused: TerminalInputFocusSync
  /**
   * Set when this pane cleared the shortcut mirror on window blur while the
   * helper was still (or had been) the typing surface — allows reclaim after
   * Chromium moves focus to body/null on app reactivation.
   */
  releasedMirrorOnWindowBlur?: boolean
  /** Override the macOS check (tests). Defaults to the navigator user agent. */
  isMac?: boolean
  /** Override the refocus scheduler (tests). Defaults to requestAnimationFrame. */
  scheduleRefocus?: RefocusScheduler
}): boolean {
  const ownedActive = getPaneOwnedActiveHelperTextarea(args.container, args.activeElement)
  let helper = ownedActive
  let needsProgrammaticFocus = false

  if (!helper) {
    const ownerDocument = args.container.ownerDocument
    if (
      args.releasedMirrorOnWindowBlur &&
      isDocumentBodyOrNull(args.activeElement, ownerDocument)
    ) {
      helper = getPaneHelperTextarea(args.container)
      if (!helper) {
        return false
      }
      needsProgrammaticFocus = true
    } else {
      return false
    }
  }

  args.syncFocused(true)

  if (needsProgrammaticFocus) {
    helper.focus()
  }

  // Why: on macOS, reactivating the app leaves Chromium's NSTextInputContext
  // stale on the still-focused helper textarea, so the IME is stranded in ASCII
  // with no way to switch back to CJK (electron#32307/#34952). Forcing a
  // blur → next-frame refocus rebuilds the input context so the IME works again.
  // Other platforms don't hit this and shouldn't pay the flicker cost.
  const isMac = args.isMac ?? isMacUserAgent()
  if (isMac) {
    helper.blur()
    const schedule = args.scheduleRefocus ?? scheduleNextFrame
    schedule(() => {
      // Why: only reclaim focus if nothing else grabbed it during the frame, so
      // a click into another field mid-reactivation isn't yanked back.
      const active = helper.ownerDocument.activeElement
      if (active === helper || active === helper.ownerDocument.body || active === null) {
        helper.focus()
      }
    })
  }

  return true
}

function isNode(value: EventTarget | null): value is Node {
  return typeof Node !== 'undefined' && value instanceof Node
}
