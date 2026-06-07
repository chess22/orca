import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { SettingsBadge, SettingsRow, SettingsSwitchRow } from './SettingsFormControls'
import { MOBILE_EMULATOR_SEARCH_ENTRIES } from './mobile-emulator-search'

type SimulatorDeviceRow = {
  name: string
  udid: string
  state: string
  runtime?: string
  isAvailable?: boolean
}

type EmulatorAvailability = {
  available: boolean
  devices: SimulatorDeviceRow[]
  simctl: { ok: boolean; message?: string }
  serveSim: { ok: boolean; message?: string }
  message: string
}

type MobileEmulatorSettingsPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const AUTOMATIC_DEVICE_VALUE = '__orca_automatic_emulator_device__'
const AUTOMATIC_DEVICE_LABEL = 'Auto-select device'
const SIMULATOR_STATE_SUFFIX_RE =
  /\s+\((Booted|Booting|Creating|Shutdown|Shutting Down|Unavailable|Unknown)\)\s*$/i

function statusText(availability: EmulatorAvailability | null, enabled: boolean): string {
  if (!enabled) {
    return 'Disabled'
  }
  return availability?.message ?? 'Checking'
}

function statusTone(
  availability: EmulatorAvailability | null,
  enabled: boolean
): 'neutral' | 'accent' | 'muted' {
  if (!enabled) {
    return 'muted'
  }
  return availability?.available ? 'accent' : 'neutral'
}

function deviceLabel(device: SimulatorDeviceRow): string {
  const state = device.state.trim()
  const name = device.name.replace(SIMULATOR_STATE_SUFFIX_RE, '').trim()
  if (device.isAvailable === false) {
    return `${name} (Unavailable)`
  }
  if (!state || state.toLowerCase() === 'shutdown') {
    return name
  }
  return `${name} (${state})`
}

function availabilityDetail(availability: EmulatorAvailability | null): string {
  if (!availability) {
    return 'Checking Xcode, simctl, serve-sim, and installed simulator devices.'
  }
  if (availability.available) {
    return `${availability.devices.length} simulator${
      availability.devices.length === 1 ? '' : 's'
    } detected.`
  }
  return availability.simctl.message || availability.serveSim.message || availability.message
}

export function MobileEmulatorSettingsPane({
  settings,
  updateSettings
}: MobileEmulatorSettingsPaneProps): React.JSX.Element {
  const [availability, setAvailability] = useState<EmulatorAvailability | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const enabled = settings.mobileEmulatorEnabled !== false

  const refreshAvailability = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const result = (await callRuntimeRpc(
        { kind: 'local' },
        'emulator.availability',
        {}
      )) as EmulatorAvailability
      setAvailability(result)
    } catch (error) {
      setAvailability({
        available: false,
        devices: [],
        simctl: { ok: false },
        serveSim: { ok: false },
        message: error instanceof Error ? error.message : 'Could not check emulator availability.'
      })
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  const devices = availability?.devices ?? []
  const selectedDeviceKnown = devices.some(
    (device) => device.udid === settings.mobileEmulatorDefaultDeviceUdid
  )
  const selectValue =
    settings.mobileEmulatorDefaultDeviceUdid && selectedDeviceKnown
      ? settings.mobileEmulatorDefaultDeviceUdid
      : AUTOMATIC_DEVICE_VALUE

  const defaultDeviceDescription = useMemo(() => {
    if (devices.length === 0) {
      return 'Orca will auto-select a simulator after devices are detected.'
    }
    return 'When no device is specified, Orca prefers a booted iPhone, then another booted simulator, then an available iPhone.'
  }, [devices.length])

  return (
    <div className="space-y-4">
      <SearchableSetting
        title="Mobile Emulator"
        description="Configure iOS Simulator support for Orca and coding agents."
        keywords={MOBILE_EMULATOR_SEARCH_ENTRIES.flatMap((entry) => entry.keywords ?? [])}
        className="divide-y divide-border/40"
      >
        <SettingsSwitchRow
          label="Enable Mobile Emulator"
          description="Shows the New Mobile Emulator action and allows agents to attach to iOS Simulator."
          checked={enabled}
          onChange={() => updateSettings({ mobileEmulatorEnabled: !enabled })}
        />

        <SettingsRow
          alignTop
          label="Availability"
          description={availabilityDetail(availability)}
          control={
            <div className="flex items-center gap-2">
              <SettingsBadge tone={statusTone(availability, enabled)}>
                {refreshing ? <Loader2 className="size-3 animate-spin" /> : null}
                {statusText(availability, enabled)}
              </SettingsBadge>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Refresh emulator availability"
                onClick={() => void refreshAvailability()}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </div>
          }
        />

        <SettingsRow
          alignTop
          label="Default Device"
          description={defaultDeviceDescription}
          control={
            <Select
              value={selectValue}
              disabled={!enabled}
              onValueChange={(value) =>
                updateSettings({
                  mobileEmulatorDefaultDeviceUdid: value === AUTOMATIC_DEVICE_VALUE ? null : value
                })
              }
            >
              <SelectTrigger size="sm" className="w-72 max-w-full">
                <SelectValue placeholder={AUTOMATIC_DEVICE_LABEL} />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value={AUTOMATIC_DEVICE_VALUE}>{AUTOMATIC_DEVICE_LABEL}</SelectItem>
                {devices.map((device) => (
                  <SelectItem
                    key={device.udid}
                    value={device.udid}
                    disabled={device.isAvailable === false}
                  >
                    {deviceLabel(device)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SearchableSetting>
    </div>
  )
}
