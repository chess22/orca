import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import type { UseWarpThemeImportReturn } from './useWarpThemeImport'

let themeTarget: 'dark' | 'light' = 'dark'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    useState: <T>(initial: T) => [
      themeTarget ?? initial,
      (value: T) => {
        themeTarget = value as 'dark' | 'light'
      }
    ]
  }
})

vi.mock('./TerminalSettingsPreview', () => ({
  TerminalSettingsPreview: function TerminalSettingsPreview() {
    return null
  }
}))

import { TerminalThemeCatalogSection, TerminalThemeImportSection } from './TerminalThemeSections'

type ReactElementLike = {
  type: unknown
  props?: Record<string, unknown>
}

const warpThemesMock: UseWarpThemeImportReturn = {
  open: false,
  mode: 'warp',
  preview: null,
  loading: false,
  desktopOnly: false,
  applyError: null,
  importSignal: 0,
  selectedThemeIds: new Set<string>(),
  handleClick: vi.fn(),
  handleImportYamlClick: vi.fn(),
  handlePreviewSource: vi.fn(),
  handleToggleTheme: vi.fn(),
  handleToggleAll: vi.fn(),
  handleApply: vi.fn(),
  handleOpenChange: vi.fn()
}

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    terminalUseSeparateLightTheme: false,
    terminalThemeDark: 'Ghostty Default Style Dark',
    terminalThemeLight: 'Builtin Tango Light',
    terminalDividerColorDark: '#3f3f46',
    terminalDividerColorLight: '#d4d4d8',
    terminalCustomThemes: [],
    ...overrides
  } as GlobalSettings
}

function renderCatalog(
  settings = makeSettings(),
  updateSettings = vi.fn(),
  target: 'dark' | 'light' = 'dark',
  preferredTarget?: 'dark' | 'light'
): React.JSX.Element {
  themeTarget = target
  return TerminalThemeCatalogSection({
    settings,
    systemPrefersDark: true,
    themeSearch: '',
    setThemeSearch: () => {},
    updateSettings,
    previewFontFamily: null,
    importedHighlightSignal: 7,
    preferredTarget
  })
}

function getTypeName(node: ReactElementLike): string {
  return typeof node.type === 'function' ? node.type.name : String(node.type)
}

function countElementsByTypeName(node: unknown, typeName: string): number {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return 0
  }
  if (Array.isArray(node)) {
    return node.reduce((total, child) => total + countElementsByTypeName(child, typeName), 0)
  }

  const element = node as ReactElementLike
  const childCount = countElementsByTypeName(element.props?.children, typeName)
  return getTypeName(element) === typeName ? childCount + 1 : childCount
}

function findElementByTypeName(node: unknown, typeName: string): ReactElementLike | null {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return null
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByTypeName(child, typeName)
      if (found) {
        return found
      }
    }
    return null
  }

  const element = node as ReactElementLike
  if (getTypeName(element) === typeName) {
    return element
  }
  return findElementByTypeName(element.props?.children, typeName)
}

function findButtonTexts(node: unknown): string[] {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return []
  }
  if (Array.isArray(node)) {
    return node.flatMap(findButtonTexts)
  }
  const element = node as ReactElementLike
  const typeName = getTypeName(element)
  if (typeName === 'WarpThemeImportButton') {
    return ['Import themes from Warp']
  }
  if (typeName === 'YamlThemeImportButton') {
    return ['Import from YAML']
  }
  return [...findButtonTexts(element.props?.children), ...findButtonTexts(element.props?.action)]
}

function hasText(node: unknown, text: string): boolean {
  if (node == null) {
    return false
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(text)
  }
  if (Array.isArray(node)) {
    return node.some((child) => hasText(child, text))
  }
  const element = node as ReactElementLike
  return hasText(element.props?.children, text) || hasText(element.props?.action, text)
}

function findActionByText(node: unknown, text: string): (() => void) | null {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return null
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findActionByText(child, text)
      if (found) {
        return found
      }
    }
    return null
  }

  const element = node as ReactElementLike
  if (typeof element.props?.onClick === 'function' && hasText(element.props.children, text)) {
    return element.props.onClick as () => void
  }
  return (
    findActionByText(element.props?.children, text) ?? findActionByText(element.props?.action, text)
  )
}

describe('TerminalThemeCatalogSection', () => {
  beforeEach(() => {
    themeTarget = 'dark'
    vi.clearAllMocks()
  })

  it('renders one theme picker and one preview for the active target', () => {
    const element = renderCatalog(makeSettings({ terminalUseSeparateLightTheme: false }), vi.fn())

    expect(countElementsByTypeName(element, 'ThemePicker')).toBe(1)
    expect(countElementsByTypeName(element, 'TerminalSettingsPreview')).toBe(1)
    expect(findElementByTypeName(element, 'TerminalSettingsPreview')?.props?.modeOverride).toBe(
      'dark'
    )
  })

  it('keeps the light target enabled while separate light theme is disabled', () => {
    const element = renderCatalog(makeSettings({ terminalUseSeparateLightTheme: false }), vi.fn())
    const targetControl = findElementByTypeName(element, 'SettingsSegmentedControl')
    const options = targetControl?.props?.options as readonly {
      value: string
      disabled?: boolean
    }[]

    expect(options.find((option) => option.value === 'light')?.disabled).toBeUndefined()
  })

  it('uses the preferred target when opened from a light-specific search', () => {
    const element = renderCatalog(
      makeSettings({ terminalUseSeparateLightTheme: true }),
      vi.fn(),
      'light',
      'light'
    )
    const picker = findElementByTypeName(element, 'ThemePicker')
    const preview = findElementByTypeName(element, 'TerminalSettingsPreview')

    expect(picker?.props?.selectedTheme).toBe('Builtin Tango Light')
    expect(preview?.props?.modeOverride).toBe('light')
  })

  it('updates the dark theme from the catalog when the dark target is active', () => {
    const updateSettings = vi.fn()
    const element = renderCatalog(makeSettings(), updateSettings, 'dark')
    const picker = findElementByTypeName(element, 'ThemePicker')
    const selectTheme = picker?.props?.onSelectTheme as (theme: string) => void

    selectTheme('Builtin Solarized Dark')

    expect(updateSettings).toHaveBeenCalledWith({ terminalThemeDark: 'Builtin Solarized Dark' })
  })

  it('updates the light theme from the catalog when the light target is active', () => {
    const updateSettings = vi.fn()
    const element = renderCatalog(
      makeSettings({ terminalUseSeparateLightTheme: true }),
      updateSettings,
      'light'
    )
    const picker = findElementByTypeName(element, 'ThemePicker')
    const selectTheme = picker?.props?.onSelectTheme as (theme: string) => void

    selectTheme('Builtin Tango Light')

    expect(updateSettings).toHaveBeenCalledWith({ terminalThemeLight: 'Builtin Tango Light' })
  })

  it('customizes light mode from the matching-dark state', () => {
    const updateSettings = vi.fn()
    const element = renderCatalog(
      makeSettings({ terminalUseSeparateLightTheme: false }),
      updateSettings,
      'light'
    )
    const customizeLightMode = findActionByText(element, 'Customize Light Mode')

    customizeLightMode?.()

    expect(updateSettings).toHaveBeenCalledWith({ terminalUseSeparateLightTheme: true })
  })

  it('matches the dark terminal theme from the customized light state', () => {
    const updateSettings = vi.fn()
    const element = renderCatalog(
      makeSettings({ terminalUseSeparateLightTheme: true }),
      updateSettings,
      'light'
    )
    const matchDarkMode = findActionByText(element, 'Match dark mode terminal theme')

    matchDarkMode?.()

    expect(updateSettings).toHaveBeenCalledWith({ terminalUseSeparateLightTheme: false })
  })

  it('shows the required inactive note and light preview while separate light theme is disabled', () => {
    const element = renderCatalog(
      makeSettings({ terminalUseSeparateLightTheme: false }),
      vi.fn(),
      'light'
    )
    const preview = findElementByTypeName(element, 'TerminalSettingsPreview')

    expect(hasText(element, 'Light mode matches the dark mode terminal theme')).toBe(true)
    expect(countElementsByTypeName(element, 'ThemePicker')).toBe(0)
    expect(countElementsByTypeName(element, 'ColorField')).toBe(0)
    expect(preview?.props?.modeOverride).toBe('light')
  })

  it('uses the active target for divider color updates', () => {
    const updateSettings = vi.fn()
    const lightElement = renderCatalog(
      makeSettings({ terminalUseSeparateLightTheme: true }),
      updateSettings,
      'light'
    )
    const lightColorField = findElementByTypeName(lightElement, 'ColorField')
    const updateLightDividerColor = lightColorField?.props?.onChange as (value: string) => void

    updateLightDividerColor('#ffffff')

    expect(updateSettings).toHaveBeenCalledWith({ terminalDividerColorLight: '#ffffff' })

    updateSettings.mockClear()
    const darkElement = renderCatalog(makeSettings(), updateSettings, 'dark')
    const darkColorField = findElementByTypeName(darkElement, 'ColorField')
    const updateDarkDividerColor = darkColorField?.props?.onChange as (value: string) => void

    updateDarkDividerColor('#000000')

    expect(updateSettings).toHaveBeenCalledWith({ terminalDividerColorDark: '#000000' })
  })

  it('passes imported theme highlight signals into the shared picker', () => {
    const element = renderCatalog()
    const picker = findElementByTypeName(element, 'ThemePicker')

    expect(picker?.props?.importedHighlightSignal).toBe(7)
  })
})

describe('TerminalThemeImportSection', () => {
  it('renders the Warp and YAML import buttons in the shared import section', () => {
    const buttonTexts = findButtonTexts(TerminalThemeImportSection({ warpThemes: warpThemesMock }))

    expect(buttonTexts).toContain('Import themes from Warp')
    expect(buttonTexts).toContain('Import from YAML')
  })

  it('keeps the import buttons out of the combined theme catalog', () => {
    expect(findButtonTexts(renderCatalog())).toEqual([])
  })
})
