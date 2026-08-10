import type { CmsEvent, Device } from '../api/client'

function batchUpdates(event: CmsEvent): Record<string, string> | null {
  const raw =
    (event.updates as Record<string, string> | undefined) ??
    ((event.payload as { updates?: Record<string, string> } | undefined)?.updates)
  if (!raw || typeof raw !== 'object') return null
  return raw
}

/** Apply realtime device-state events to a device list; return 'refresh' if a full reload is needed. */
export function applyDeviceEvent(
  devices: Device[],
  event: CmsEvent,
): Device[] | 'refresh' {
  if (
    event.type === 'devices_state_batch' ||
    event.type === 'devices_state_snapshot'
  ) {
    const updates = batchUpdates(event)
    if (!updates) return devices
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

/** Device IDs touched by a state event (for UI flash). Snapshot = no flash. */
export function deviceIdsFromEvent(event: CmsEvent): string[] {
  if (event.type === 'device_state' && event.device_id) {
    return [String(event.device_id)]
  }
  if (event.type === 'devices_state_batch') {
    const updates = batchUpdates(event)
    if (!updates) return []
    // Only flash IDs whose state actually matters visually; caller may filter further.
    return Object.keys(updates)
  }
  return []
}

export function isDeviceStateEvent(event: CmsEvent | null | undefined): boolean {
  return (
    !!event &&
    (event.type === 'device_state' ||
      event.type === 'devices_state_batch' ||
      event.type === 'devices_state_snapshot')
  )
}

export function isLiveSignalEvent(event: CmsEvent | null | undefined): boolean {
  return (
    !!event &&
    (event.type === 'panel_live' ||
      event.type === 'device_state' ||
      event.type === 'devices_state_batch' ||
      event.type === 'devices_state_snapshot' ||
      event.type === 'panel_armed' ||
      event.type === 'zone_armed' ||
      event.type === 'pg_state')
  )
}

export function shouldRefreshOnEvent(event: CmsEvent): boolean {
  return (
    event.type === 'device_declared' ||
    event.type === 'device_updated' ||
    event.type === 'device_deleted' ||
    event.type === 'panel_declared' ||
    event.type === 'panel_deleted' ||
    event.type === 'panel_config_imported'
  )
}
