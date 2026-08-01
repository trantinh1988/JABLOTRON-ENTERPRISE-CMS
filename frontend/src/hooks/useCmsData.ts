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
import { useEventStream } from './useEventStream'

export function useCmsData() {
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [panels, setPanels] = useState<Panel[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [maps, setMaps] = useState<FloorMap[]>([])
  const [mockMode, setMockMode] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const { connected, events, lastEvent } = useEventStream(true)

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
      if (health) setMockMode(health.usb_mock_mode)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 10000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!lastEvent) return

    if (lastEvent.type === 'device_state' && lastEvent.device_id && lastEvent.state) {
      setDevices((prev) =>
        prev.map((d) =>
          d.global_id === lastEvent.device_id ? { ...d, state: String(lastEvent.state) } : d,
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

    if (
      lastEvent.type === 'device_declared' ||
      lastEvent.type === 'device_updated' ||
      lastEvent.type === 'device_deleted'
    ) {
      void refresh()
    }
  }, [lastEvent, refresh])

  const writeAllowed = license?.mode === 'full'

  return {
    license,
    panels,
    devices,
    maps,
    mockMode,
    loadError,
    connected,
    events,
    lastEvent,
    writeAllowed,
    refresh,
    setDevices,
    setMaps,
    setPanels,
  }
}
