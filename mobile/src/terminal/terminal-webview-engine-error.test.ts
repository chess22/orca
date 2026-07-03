import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalWebView } from './TerminalWebView'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0
    },
    create: (styles: unknown) => styles
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-webview', () => ({
  WebView: 'WebView',
  default: 'WebView'
}))

vi.mock('lucide-react-native', () => ({
  RefreshCw: 'RefreshCw'
}))

function suppressReactTestRendererDeprecationWarning(): () => void {
  const originalConsoleError = console.error
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    const firstArg = args[0]
    if (typeof firstArg === 'string' && firstArg.includes('react-test-renderer is deprecated')) {
      return
    }
    originalConsoleError(...args)
  })
  return () => consoleErrorSpy.mockRestore()
}

function createTerminalWebViewRenderer(onEngineError = vi.fn()) {
  let renderer: ReactTestRenderer | null = null
  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(TerminalWebView, { onEngineError }))
    })
  } finally {
    restoreConsoleError()
  }
  if (!renderer) {
    throw new Error('TerminalWebView did not render')
  }
  return { onEngineError, renderer }
}

function postWebViewMessage(renderer: ReactTestRenderer, payload: Record<string, unknown>) {
  const webView = renderer.root.findByType('WebView')
  act(() => {
    webView.props.onMessage({ nativeEvent: { data: JSON.stringify(payload) } })
  })
}

function renderedText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.props.children)
    .join(' ')
}

describe('TerminalWebView engine errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the reload overlay for fatal engine errors from the WebView', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onEngineError, renderer } = createTerminalWebViewRenderer()

    postWebViewMessage(renderer, {
      fatal: true,
      message: 'terminal engine missing - SyntaxError - Chrome 74',
      type: 'error'
    })

    expect(onEngineError).toHaveBeenCalledWith('terminal engine missing - SyntaxError - Chrome 74')
    expect(renderedText(renderer)).toContain('Terminal failed to load')
    expect(renderedText(renderer)).toContain('terminal engine missing - SyntaxError - Chrome 74')
    expect(renderedText(renderer)).toContain('Reload')
  })

  it('reports non-fatal engine errors without covering a live terminal', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { onEngineError, renderer } = createTerminalWebViewRenderer()

    postWebViewMessage(renderer, {
      fatal: false,
      message: 'terminal message failed - malformed chunk',
      type: 'error'
    })

    expect(onEngineError).toHaveBeenCalledWith('terminal message failed - malformed chunk')
    expect(renderedText(renderer)).not.toContain('Terminal failed to load')
  })
})
