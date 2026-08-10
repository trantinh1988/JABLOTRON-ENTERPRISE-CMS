import { useCallback, useEffect, useState } from 'react'
import {
  getHealth,
  getLicenseStatus,
  listAllDevices,
  listMaps,
  listPanels,
  type Device,
  type FloorMap,
  type LicenseStatus,
  type Panel,
} from '../api/client'
import { LICENSE_FEATURE_ENABLED } from '../config/features'
import { useEventStream } from './useEventStream'
import {
  applyDeviceEvent,
  deviceIdsFromEvent,
  isDeviceStateEvent,
  isLiveSignalEvent,
  shouldRefreshOnEvent,
} from './deviceEventSync'

const FULL_REFRESH_MS = 30000
const FLASH_MS = 1600

export function useCmsData() {
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [panels, setPanels] = useState<Panel[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [maps, setMaps] = useState<FloorMap[]>([])
  const [mockMode, setMockMode] = useState<boolean | null>(null)
  const [usbHint, setUsbHint] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveSyncAt, setLiveSyncAt] = useState<number | null>(null)
  const [liveActive, setLiveActive] = useState(false)
  const [liveFlashIds, setLiveFlashIds] = useState<Set<string>>(() => new Set())

  const { connected, events, lastEvent, eventSeq } = useEventStream(true)

  const refresh = useCallback(async () => {
    try {
      const [lic, pnl, health, allDevices, allMaps] = await Promise.all([
        getLicenseStatus(),
        listPanels(),
        getHealth().catch(() => null),
        listAllDevices().catch(() => [] as Device[]),
        listMaps().catch(() => [] as FloorMap[]),
      ])
      setLicense(lic)
      setPanels(pnl)
      setDevices(allDevices)
      setMaps(allMaps)
      if (health) {
        setMockMode(health.usb_mock_mode)
        setUsbHint(health.usb_hint)
      }
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), FULL_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!lastEvent) return

    if (isDeviceStateEvent(lastEvent)) {
      let flashIds: string[] = []
      setDevices((prev) => {
        const patched = applyDeviceEvent(prev, lastEvent)
        if (patched === 'refresh') {
          void refresh()
          return prev
        }
        if (lastEvent.type !== 'devices_state_snapshot' && patched !== prev) {
          flashIds = deviceIdsFromEvent(lastEvent).filter((id) => {
            const before = prev.find((d) => d.global_id === id)?.state
            const after = patched.find((d) => d.global_id === id)?.state
            return before !== after
          })
        }
        return patched
      })
      if (flashIds.length) {
        setLiveFlashIds((old) => {
          const next = new Set(old)
          for (const id of flashIds) next.add(id)
          return next
        })
      }
    }

    if (lastEvent.type === 'panel_live' && lastEvent.panel_id) {
      setPanels((prev) =>
        prev.map((p) =>
          p.panel_id === lastEvent.panel_id
            ? {
                ...p,
                connection: p.connection === 'disconnected' ? 'usb' : p.connection,
                last_seen_at:
                  typeof lastEvent.last_seen_at === 'string'
                    ? lastEvent.last_seen_at
                    : p.last_seen_at,
              }
            : p,
        ),
      )
    }

    if (lastEvent.type === 'panel_armed' && lastEvent.panel_id && lastEvent.armed_state) {
      setPanels((prev) =>
        prev.map((p) =>
          p.panel_id === lastEvent.panel_id
            ? { ...p, armed_state: String(lastEvent.armed_state) }
            : p,
        ),
      )
    }

    if (isLiveSignalEvent(lastEvent)) {
      const receiving =
        lastEvent.type !== 'panel_live' || lastEvent.receiving !== false
      if (receiving) {
        setLiveSyncAt(Date.now())
        setLiveActive(true)
      }
    }

    if (
      lastEvent.type === 'panel_connected' &&
      lastEvent.panel_id &&
      typeof lastEvent.usb_path === 'string'
    ) {
      setPanels((prev) =>
        prev.map((p) =>
          p.panel_id === lastEvent.panel_id
            ? { ...p, connection: 'usb', usb_path: String(lastEvent.usb_path) }
            : p,
        ),
      )
      void refresh()
    }

    if (lastEvent.type === 'panel_disconnected' && lastEvent.panel_id) {
      setPanels((prev) =>
        prev.map((p) =>
          p.panel_id === lastEvent.panel_id
            ? { ...p, connection: 'disconnected', usb_path: null }
            : p,
        ),
      )
    }

    if (lastEvent.type === 'usb_error' && lastEvent.detail) {
      setUsbHint(String(lastEvent.detail))
      void refresh()
    }

    if (shouldRefreshOnEvent(lastEvent)) {
      void refresh()
    }
  }, [lastEvent, eventSeq, refresh])

  useEffect(() => {
    if (!liveFlashIds.size) return
    const id = window.setTimeout(() => setLiveFlashIds(new Set()), FLASH_MS)
    return () => window.clearTimeout(id)
  }, [liveFlashIds])

  useEffect(() => {
    if (!liveSyncAt) return
    setLiveActive(true)
    const id = window.setTimeout(() => setLiveActive(false), 8000)
    return () => window.clearTimeout(id)
  }, [liveSyncAt])

  const writeAllowed = !LICENSE_FEATURE_ENABLED || license?.mode === 'full'

  return {
    license,
    panels,
    devices,
    maps,
    mockMode,
    usbHint,
    loadError,
    connected,
    events,
    lastEvent,
    liveSyncAt,
    liveActive,
    liveFlashIds,
    writeAllowed,
    refresh,
    setDevices,
    setMaps,
    setPanels,
  }
}
