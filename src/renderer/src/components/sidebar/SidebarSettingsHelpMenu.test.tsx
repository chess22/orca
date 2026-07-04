// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'

const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  appRestart: vi.fn(),
  updaterCheck: vi.fn(),
  shellOpenUrl: vi.fn(),
  useShortcutKeyDetails: vi.fn(),
  setupProgress: {
    ready: true,
    coreDoneCount: 2,
    coreTotal: 5,
    stepDone: {}
  }
}))

let updateStatus = { state: 'idle' } as const
const roots: Root[] = []

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      openModal: mocks.openModal,
      openSettingsPage: mocks.openSettingsPage,
      openSettingsTarget: mocks.openSettingsTarget,
      updateStatus
    })
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyDetails: mocks.useShortcutKeyDetails
}))

vi.mock('@/hooks/useMountedRef', () => ({
  useMountedRef: () => ({ current: true })
}))

vi.mock('../onboarding/show-onboarding-event', () => ({
  showOnboardingFromRenderer: vi.fn()
}))

vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: () => mocks.setupProgress
}))

vi.mock('../setup-guide/SetupGuideProgressRing', () => ({
  SetupGuideProgressRing: () => <span data-testid="setup-guide-progress-ring" />
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  // Why: the real Radix item composes props.onClick (a real MouseEvent) before
  // its own select/close, and its onSelect fires with a modifier-less
  // CustomEvent. Mirror that: forward onClick when present, else onSelect.
  DropdownMenuItem: ({
    children,
    onSelect,
    onClick,
    disabled
  }: {
    children: ReactNode
    onSelect?: () => void
    onClick?: (event: React.MouseEvent) => void
    disabled?: boolean
  }) => (
    <button data-testid="menu-item" disabled={disabled} onClick={onClick ?? onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel
  }: {
    children: ReactNode
    onClick?: (event: React.MouseEvent) => void
    'aria-label'?: string
  }) => (
    <button data-testid="trigger-button" aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('./SidebarFeedbackDialog', () => ({
  SidebarFeedbackDialog: () => <div data-testid="feedback-dialog" />
}))

function installWindowApi(): void {
  Object.assign(window, {
    api: {
      app: {
        restart: mocks.appRestart
      },
      shell: {
        openUrl: mocks.shellOpenUrl
      },
      updater: {
        check: mocks.updaterCheck
      }
    }
  })
}

async function renderMenu(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SidebarSettingsHelpMenu />)
  })

  return container
}

function findMenuItem(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-testid="menu-item"]')
  ).find((element) => element.textContent?.includes(label))
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

describe('SidebarSettingsHelpMenu', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    installWindowApi()
    mocks.useShortcutKeyDetails.mockReturnValue({ keys: ['⌘', ','], doubleTap: false })
    updateStatus = { state: 'idle' }
    mocks.setupProgress = {
      ready: true,
      coreDoneCount: 2,
      coreTotal: 5,
      stepDone: {}
    }
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
  })

  it('renders the help button with correct aria-label', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Help')
  })

  it('renders the settings button with correct aria-label', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('aria-label="Settings"')
  })

  it('renders the settings button before the help button', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    const settingsIndex = html.indexOf('lucide-settings')
    const helpIndex = html.indexOf('lucide-circle-question-mark')
    expect(settingsIndex).toBeGreaterThanOrEqual(0)
    expect(helpIndex).toBeGreaterThan(settingsIndex)
  })

  it('renders Send Feedback menu item', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Send Feedback')
  })

  it('renders Keyboard Shortcuts menu item', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Keyboard Shortcuts')
  })

  it('renders Milestones with progress when setup is incomplete', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Milestones')
    expect(html).toContain('data-testid="setup-guide-progress-ring"')
  })

  it('hides Milestones when setup is complete', () => {
    mocks.setupProgress = {
      ready: true,
      coreDoneCount: 5,
      coreTotal: 5,
      stepDone: {}
    }
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).not.toContain('Milestones')
  })

  it('hides the Onboarding admin entry by default', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).not.toContain('Onboarding')
  })

  it('renders Docs link', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Docs')
  })

  it('renders Changelog link', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Changelog')
  })

  it('renders GitHub link', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('GitHub')
  })

  it('renders Discord link', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Discord')
    expect(html).toContain('viewBox="0 0 20 20"')
    expect(html).toContain('M16.0742 4.45014C14.9244 3.92097 13.7106 3.54556 12.4638 3.3335')
  })

  it('opens Discord invite through the shell bridge', async () => {
    const container = await renderMenu()
    const discordButton = findMenuItem(container, 'Discord')

    await act(async () => {
      discordButton.click()
    })

    expect(mocks.shellOpenUrl).toHaveBeenCalledWith('https://discord.gg/fzjDKHxv8Q')
  })

  it('renders X link', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('>X<')
  })

  it('renders Check for Updates menu item', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Check for Updates')
  })

  it('routes Check for Updates modifiers to the RC and perf-RC channels', async () => {
    const container = await renderMenu()
    const item = findMenuItem(container, 'Check for Updates')
    // Why: Cmd (macOS) / Ctrl (Win/Linux) with Shift is the perf-RC escalation.
    const perfModifier = navigator.userAgent.includes('Mac') ? { metaKey: true } : { ctrlKey: true }

    const clickWith = async (init: MouseEventInit): Promise<void> => {
      await act(async () => {
        item.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }))
      })
    }

    await clickWith({})
    await clickWith({ shiftKey: true })
    await clickWith({ shiftKey: true, ...perfModifier })

    expect(mocks.updaterCheck.mock.calls).toEqual([
      [{ includePrerelease: false, includePerfPrerelease: false }],
      [{ includePrerelease: true, includePerfPrerelease: false }],
      [{ includePrerelease: true, includePerfPrerelease: true }]
    ])
  })

  it('renders shortcut keys in the settings tooltip', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('⌘')
    expect(html).toContain('>,</span>')
  })
})
