import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { shouldShutdownSimulatorForPaneUnmount } from '@/lib/ensure-simulator-tab'
import {
  deviceLabel,
  pickDefaultDevice,
  simulatorPreviewStreamUrl,
  type EmulatorPaneSession,
  type SimulatorDeviceRow
} from './emulator-pane-types'
import { markSimulatorDeviceBooted, markSimulatorDeviceShutdown } from './emulator-device-state'
import { useEmulatorPaneControls } from './use-emulator-pane-controls'
import {
  EMULATOR_LOCAL_SHUTDOWN_EVENT,
  useEmulatorPaneSessionEvents
} from './use-emulator-pane-session-events'

type UseEmulatorPaneSessionArgs = {
  worktreeId: string
  tabId?: string
  autoAttachOnMount: boolean
}

export function useEmulatorPaneSession({
  worktreeId,
  tabId,
  autoAttachOnMount
}: UseEmulatorPaneSessionArgs) {
  const [devices, setDevices] = useState<SimulatorDeviceRow[]>([])
  const configuredDefaultUdid = useAppStore(
    (state) => state.settings?.mobileEmulatorDefaultDeviceUdid ?? null
  )
  const [selectedUdid, setSelectedUdid] = useState<string | null>(configuredDefaultUdid)
  const [session, setSession] = useState<EmulatorPaneSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamKey, setStreamKey] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const liveTargetRef = useRef<string | null>(null)
  const suppressAutoAttachRef = useRef(false)
  const { sendTap, sendButton, sendGesture, sendRotate } = useEmulatorPaneControls(worktreeId)

  const refreshDevices = useCallback(async (bootedTarget?: string | null) => {
    try {
      const list = (await callRuntimeRpc(
        { kind: 'local' },
        'emulator.listSimulators',
        {}
      )) as SimulatorDeviceRow[]
      const next = markSimulatorDeviceBooted(list, bootedTarget)
      if (!mountedRef.current) {
        return next
      }
      setDevices(next)
      return next
    } catch {
      return []
    }
  }, [])

  const applySession = useCallback(
    (info: EmulatorPaneSession['info'], attached = true, deviceRows = devices) => {
      if (!mountedRef.current) {
        return
      }
      const target = info?.deviceUdid || info?.device
      const rows = attached ? markSimulatorDeviceBooted(deviceRows, target) : deviceRows
      if (attached && rows !== deviceRows) {
        setDevices(rows)
      }
      const row = rows.find((d) => d.udid === target || d.name === target)
      const displayName = row?.name || deviceLabel(info)
      const enriched = { ...info, displayName, state: attached ? 'Booted' : info?.state }
      setSession({ attached, info: enriched })
      liveTargetRef.current = attached ? target || null : null
      if (attached) {
        suppressAutoAttachRef.current = false
      }
      setError(null)
      if (attached && simulatorPreviewStreamUrl(enriched)) {
        setStreamKey(String(Date.now()))
      }
      if (info?.deviceUdid || info?.device) {
        setSelectedUdid(info.deviceUdid || info.device || null)
      }
      if (tabId) {
        useAppStore.getState().setTabLabel(tabId, displayName)
      }
    },
    [devices, tabId]
  )

  const clearSessionAfterShutdown = useCallback(
    (deviceTarget?: string | null) => {
      if (!mountedRef.current) {
        return
      }
      const target =
        deviceTarget || session?.info?.deviceUdid || session?.info?.device || selectedUdid
      setDevices((current) => markSimulatorDeviceShutdown(current, target))
      setSession(null)
      liveTargetRef.current = null
      suppressAutoAttachRef.current = true
      setStreamKey(null)
      setError(null)
      if (tabId) {
        const row = devices.find((device) => device.udid === target || device.name === target)
        useAppStore.getState().setTabLabel(tabId, row?.name || 'Mobile Emulator')
      }
    },
    [devices, selectedUdid, session, tabId]
  )

  const attach = useCallback(
    async (deviceTarget?: string) => {
      if (loading) {
        return
      }
      suppressAutoAttachRef.current = false
      setLoading(true)
      setError(null)
      if (tabId) {
        useAppStore.getState().setTabLabel(tabId, 'Starting…')
      }
      let requestedTarget: string | undefined
      try {
        let list = devices
        if (list.length === 0) {
          list = (await refreshDevices()) ?? []
        }
        let target = deviceTarget || selectedUdid || configuredDefaultUdid || undefined
        if (!target && list.length > 0) {
          const chosen = pickDefaultDevice(list)
          if (chosen) {
            target = chosen.udid
            setSelectedUdid(chosen.udid)
          }
        }
        if (!target) {
          throw new Error(
            'No simulators found. Open Xcode → Settings → Platforms and add an iOS simulator.'
          )
        }
        requestedTarget = target
        const res = (await callRuntimeRpc({ kind: 'local' }, 'emulator.attach', {
          device: target,
          worktree: worktreeId,
          focus: false
        })) as { attached?: boolean; info?: EmulatorPaneSession['info'] }
        if (!mountedRef.current) {
          return
        }
        const attached = !!res?.attached
        const bootedTarget = res?.info?.deviceUdid || res?.info?.device || target
        const nextList = attached ? markSimulatorDeviceBooted(list, bootedTarget) : list
        if (attached) {
          setDevices(nextList)
        }
        applySession(res?.info, attached, nextList)
        if (attached) {
          void refreshDevices(bootedTarget)
        }
      } catch (e: unknown) {
        if (requestedTarget && liveTargetRef.current === requestedTarget) {
          return
        }
        const msg =
          e instanceof Error
            ? e.message
            : 'Could not start the simulator. Check that Xcode is installed and try another device.'
        setError(msg)
        if (tabId) {
          useAppStore.getState().setTabLabel(tabId, 'Mobile Emulator')
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [
      applySession,
      configuredDefaultUdid,
      devices,
      loading,
      refreshDevices,
      selectedUdid,
      tabId,
      worktreeId
    ]
  )

  useEffect(() => {
    if (!selectedUdid && configuredDefaultUdid) {
      setSelectedUdid(configuredDefaultUdid)
    }
  }, [configuredDefaultUdid, selectedUdid])

  const shutdown = useCallback(
    async (deviceTarget?: string) => {
      if (loading) {
        return
      }
      setLoading(true)
      setError(null)
      if (tabId) {
        useAppStore.getState().setTabLabel(tabId, 'Shutting down…')
      }
      try {
        const res = (await callRuntimeRpc({ kind: 'local' }, 'emulator.shutdown', {
          ...(deviceTarget ? { device: deviceTarget } : {}),
          worktree: worktreeId
        })) as { deviceUdid?: string }
        const shutdownTarget = res?.deviceUdid || deviceTarget
        window.dispatchEvent(
          new CustomEvent(EMULATOR_LOCAL_SHUTDOWN_EVENT, {
            detail: { worktreeId, deviceUdid: shutdownTarget }
          })
        )
        void refreshDevices()
      } catch (e: unknown) {
        const msg =
          e instanceof Error
            ? e.message
            : 'Could not shut down the simulator. Try again from Xcode Simulator.'
        setError(msg)
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [loading, refreshDevices, tabId, worktreeId]
  )

  useEffect(() => {
    mountedRef.current = true
    void refreshDevices()
    return () => {
      mountedRef.current = false
      // Why: only the final simulator tab close should stop an Orca-owned device;
      // split peers, transient remounts, and external helpers must keep running.
      if (shouldShutdownSimulatorForPaneUnmount(worktreeId, tabId)) {
        void callRuntimeRpc({ kind: 'local' }, 'emulator.shutdown', {
          worktree: worktreeId,
          managedOnly: true
        }).catch(() => {})
      }
    }
  }, [refreshDevices, tabId, worktreeId])

  useEffect(() => {
    if (!autoAttachOnMount || session || loading || suppressAutoAttachRef.current) {
      return
    }
    void attach()
  }, [attach, autoAttachOnMount, loading, session])

  useEmulatorPaneSessionEvents({
    worktreeId,
    applySession,
    refreshDevices,
    clearSessionAfterShutdown
  })

  const selectedDevice = devices.find((d) => d.udid === selectedUdid) ?? null
  const sessionDisplayName = session?.info?.displayName
  const displayName =
    sessionDisplayName && sessionDisplayName !== 'Simulator'
      ? sessionDisplayName
      : selectedDevice?.name || sessionDisplayName || 'Mobile Emulator'
  const previewUrl = simulatorPreviewStreamUrl(session?.info)
  const wsUrl = session?.info?.wsUrl
  const isLive = Boolean(previewUrl && session?.attached)

  return {
    devices,
    selectedUdid,
    setSelectedUdid,
    session,
    loading,
    error,
    attach,
    shutdown,
    refreshDevices,
    sendTap,
    sendButton,
    sendGesture,
    sendRotate,
    displayName,
    previewUrl,
    wsUrl,
    streamKey: streamKey ?? undefined,
    isLive,
    selectedDevice
  }
}
