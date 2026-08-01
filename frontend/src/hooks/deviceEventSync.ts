import type { CmsEvent, Device } from '../api/client'

/** Apply realtime device-state events to a device list; return 'refresh' if a full reload is needed. */
export function applyDeviceEvent(
  devices: Device[],
  event: CmsEvent,
): Device[] | 'refresh' {
  if (event.type === 'devices_state_batch' && event.updates && typeof event.updates === 'object') {
    const updates = event.updates as Record<string, string>
    let changed = false
    const next = devices.map((d) => {
      const state = updates[d.global_id]
      if (state && state !== d.state) {
        changed = true
        return { ...d, state }
      }
      return d
    })
    return changed ? next : devices
  }

  if (event.type === 'device_state' && event.device_id && event.state) {
    const idx = devices.findIndex((d) => d.global_id === event.device_id)
    if (idx < 0) return 'refresh'
    const state = String(event.state)
    if (devices[idx].state === state) return devices
    const next = [...devices]
    next[idx] = { ...next[idx], state }
    return next
  }

  return devices
}

export function shouldRefreshOnEvent(event: CmsEvent): boolean {
  return (
    event.type === 'device_declared' ||
    event.type === 'device_updated' ||
    event.type === 'device_deleted' ||
    event.type === 'panel_declared' ||
    event.type === 'panel_deleted'
  )
}
