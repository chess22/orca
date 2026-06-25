import { useState, type Dispatch, type SetStateAction } from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import {
  ColorField,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  ThemePicker
} from './SettingsFormControls'
import { SearchableSetting } from './SearchableSetting'
import { TerminalSettingsPreview } from './TerminalSettingsPreview'
import { WarpThemeImportButton } from './WarpThemeImportButton'
import { YamlThemeImportButton } from './YamlThemeImportButton'
import type { UseWarpThemeImportReturn } from './useWarpThemeImport'
import { getAvailableTerminalThemeOptions } from '@/lib/terminal-theme'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'

type TerminalThemeTarget = 'dark' | 'light'

type TerminalThemeCatalogSectionProps = {
  settings: GlobalSettings
  systemPrefersDark: boolean
  themeSearch: string
  setThemeSearch: Dispatch<SetStateAction<string>>
  updateSettings: (updates: Partial<GlobalSettings>) => void
  previewFontFamily: string | null
  importedHighlightSignal: number
  preferredTarget?: TerminalThemeTarget
}

/** Shared import affordance for terminal themes. Why: imported themes land in
 *  one pool used by both the dark and light targets, so the buttons live above
 *  the catalog rather than implying a mode-specific import. */
export function TerminalThemeImportSection({
  warpThemes
}: {
  warpThemes: UseWarpThemeImportReturn
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.TerminalThemeSections.import_themes_title',
          'Import Themes'
        )}
        description={translate(
          'auto.components.settings.TerminalThemeSections.import_themes_description',
          'Imported themes are available in both the dark and light theme targets.'
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <WarpThemeImportButton warpThemes={warpThemes} />
        <YamlThemeImportButton warpThemes={warpThemes} />
      </div>
    </section>
  )
}

export function TerminalThemeCatalogSection({
  settings,
  systemPrefersDark,
  themeSearch,
  setThemeSearch,
  updateSettings,
  previewFontFamily,
  importedHighlightSignal,
  preferredTarget
}: TerminalThemeCatalogSectionProps): React.JSX.Element {
  const [target, setTarget] = useState<TerminalThemeTarget>(preferredTarget ?? 'dark')
  const themeOptions = getAvailableTerminalThemeOptions(settings)
  const isLightTarget = target === 'light'
  const lightModeMatchesDark = isLightTarget && !settings.terminalUseSeparateLightTheme
  const selectedTheme = isLightTarget ? settings.terminalThemeLight : settings.terminalThemeDark
  const pickerTitle = isLightTarget
    ? translate('auto.components.settings.TerminalThemeSections.8273bc75d7', 'Light Theme')
    : translate('auto.components.settings.TerminalThemeSections.9499ad1dc4', 'Dark Theme')
  const pickerDescription = isLightTarget
    ? translate(
        'auto.components.settings.TerminalThemeSections.d56af60e6f',
        'Choose the theme used when Orca is in light mode.'
      )
    : translate(
        'auto.components.settings.TerminalThemeSections.7add204bd5',
        'Choose the terminal theme used in dark mode.'
      )
  const dividerTitle = isLightTarget
    ? translate('auto.components.settings.TerminalThemeSections.ec2e33ad80', 'Light Divider Color')
    : translate('auto.components.settings.TerminalThemeSections.b739d2abfe', 'Dark Divider Color')
  const dividerDescription = isLightTarget
    ? translate(
        'auto.components.settings.TerminalThemeSections.5e0c24b5c8',
        'Controls the split divider line between panes in light mode.'
      )
    : translate(
        'auto.components.settings.TerminalThemeSections.cbe56a0f79',
        'Controls the split divider line between panes in dark mode.'
      )

  return (
    <section className="space-y-5">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.TerminalThemeSections.catalog_title',
          'Terminal Themes'
        )}
        description={translate(
          'auto.components.settings.TerminalThemeSections.catalog_description',
          'Choose terminal themes and divider colors for dark and light mode.'
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="space-y-3">
            <SearchableSetting
              title={translate(
                'auto.components.settings.TerminalThemeSections.target_title',
                'Theme Mode'
              )}
              keywords={['terminal', 'theme', 'dark', 'light']}
              forceVisible
            >
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {translate(
                    'auto.components.settings.TerminalThemeSections.target_title',
                    'Theme Mode'
                  )}
                </p>
                <SettingsSegmentedControl
                  value={target}
                  onChange={setTarget}
                  ariaLabel={translate(
                    'auto.components.settings.TerminalThemeSections.target_aria',
                    'Terminal theme mode'
                  )}
                  equalWidth
                  options={[
                    {
                      value: 'dark',
                      label: translate(
                        'auto.components.settings.TerminalThemeSections.target_dark',
                        'Dark'
                      )
                    },
                    {
                      value: 'light',
                      label: translate(
                        'auto.components.settings.TerminalThemeSections.target_light',
                        'Light'
                      )
                    }
                  ]}
                />
              </div>
            </SearchableSetting>

            {isLightTarget ? (
              <SearchableSetting
                title={translate(
                  'auto.components.settings.TerminalThemeSections.customize_light_mode',
                  'Customize Light Mode'
                )}
                keywords={['terminal', 'light mode', 'theme', 'match dark']}
                forceVisible
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {settings.terminalUseSeparateLightTheme
                      ? translate(
                          'auto.components.settings.TerminalThemeSections.light_custom_note',
                          'Light mode has its own terminal theme.'
                        )
                      : translate(
                          'auto.components.settings.TerminalThemeSections.light_inactive_note',
                          'Light mode matches the dark mode terminal theme.'
                        )}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant={settings.terminalUseSeparateLightTheme ? 'outline' : 'default'}
                    onClick={() =>
                      updateSettings({
                        terminalUseSeparateLightTheme: !settings.terminalUseSeparateLightTheme
                      })
                    }
                  >
                    {settings.terminalUseSeparateLightTheme
                      ? translate(
                          'auto.components.settings.TerminalThemeSections.match_dark_mode_terminal_theme',
                          'Match dark mode terminal theme'
                        )
                      : translate(
                          'auto.components.settings.TerminalThemeSections.customize_light_mode',
                          'Customize Light Mode'
                        )}
                  </Button>
                </div>
              </SearchableSetting>
            ) : null}
          </div>

          {lightModeMatchesDark ? null : (
            <>
              <SearchableSetting
                title={pickerTitle}
                description={pickerDescription}
                keywords={['terminal', 'theme', 'dark', 'light', 'preview']}
                forceVisible
              >
                <ThemePicker
                  label={pickerTitle}
                  description={pickerDescription}
                  selectedTheme={selectedTheme}
                  themeOptions={themeOptions}
                  query={themeSearch}
                  onQueryChange={setThemeSearch}
                  onSelectTheme={(theme) =>
                    updateSettings(
                      isLightTarget ? { terminalThemeLight: theme } : { terminalThemeDark: theme }
                    )
                  }
                  importedHighlightSignal={importedHighlightSignal}
                />
              </SearchableSetting>

              <SearchableSetting
                title={dividerTitle}
                description={dividerDescription}
                keywords={['terminal', 'divider', 'dark', 'light', 'color']}
                forceVisible
              >
                <ColorField
                  label={dividerTitle}
                  description={dividerDescription}
                  value={
                    isLightTarget
                      ? settings.terminalDividerColorLight
                      : settings.terminalDividerColorDark
                  }
                  fallback={isLightTarget ? '#d4d4d8' : '#3f3f46'}
                  onChange={(value) =>
                    updateSettings(
                      isLightTarget
                        ? { terminalDividerColorLight: value }
                        : { terminalDividerColorDark: value }
                    )
                  }
                />
              </SearchableSetting>
            </>
          )}
        </div>

        <TerminalSettingsPreview
          title={
            isLightTarget
              ? translate(
                  'auto.components.settings.TerminalThemeSections.db210115c5',
                  'Light Mode Preview'
                )
              : translate(
                  'auto.components.settings.TerminalThemeSections.bc8e8a251a',
                  'Dark Mode Preview'
                )
          }
          description={
            isLightTarget
              ? translate(
                  'auto.components.settings.TerminalThemeSections.light_preview_description',
                  'Shows the effective light terminal appearance.'
                )
              : translate(
                  'auto.components.settings.TerminalThemeSections.dark_preview_description',
                  'Shows the effective dark terminal appearance.'
                )
          }
          settings={settings}
          systemPrefersDark={systemPrefersDark}
          previewFontFamily={previewFontFamily}
          modeOverride={target}
        />
      </div>
    </section>
  )
}
