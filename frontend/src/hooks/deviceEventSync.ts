import type { CmsEvent, Device } from '../api/client'
import { reactionAlarmsWhenDisarmed } from '../lib/deviceReaction'
import { isAlarmFocusSuppressed } from './alarmMapFocusBus'

function eventClearsAlwaysAlarm(event: CmsEvent, deviceId: string): boolean {
  if (event.clear_alarm === true) return true
  const ids = event.clear_alarm_ids
  if (Array.isArray(ids) && ids.includes(deviceId)) return true
  return isAlarmFocusSuppressed(deviceId)
}

/** 24h/Fire sticky: HID OK/ACT must not drop CMS Báo động unless PIN/disarm. */
function keepAlwaysAlarm(device: Device, nextState: string, event: CmsEvent): boolean {
  if (!reactionAlarmsWhenDisarmed(device.reaction)) return false
  if ((device.state || '').toLowerCase() !== 'alarm') return false
  const nxt = nextState.toLowerCase()
  if (nxt !== 'ok' && nxt !== 'open' && nxt !== 'fault') return false
  return !eventClearsAlwaysAlarm(event, device.global_id)
}

function batchUpdates(event: CmsEvent): Record<string, string> | null {
  const raw =
    (event.updates as Record<string, string> | undefined) ??
    ((event.payload as { updates?: Record<string, string> } | undefined)?.updates)
  if (!raw || typeof raw !== 'object') return null
  return raw
}

/** Apply realtime device-state / disable events to a device list; return 'refresh' if a full reload is needed. */
export function applyDeviceEvent(
  devices: Device[],
  event: CmsEvent,
): Device[] | 'refresh' {
  if (event.history_only === true) return devices
  if (
    event.type === 'devices_state_batch' ||
    event.type === 'devices_state_snapshot'
  ) {
    const updates = batchUpdates(event)
    if (!updates) return devices
    // Live batches may reference newly declared devices not yet in the UI list.
    if (event.type === 'devices_state_batch') {
      const known = new Set(devices.map((d) => d.global_id))
      for (const id of Object.keys(updates)) {
        if (!known.has(id)) return 'refresh'
      }
    }
    let changed = false
    const next = devices.map((d) => {
      const state = updates[d.global_id]
      if (state && state !== d.state) {
        if (keepAlwaysAlarm(d, state, event)) return d
        changed = true
        return { ...d, state }
      }
      return d
    })
    return changed ? next : devices
  }

  if (event.type === 'devices_disable_batch') {
    const updates = batchUpdates(event)
    if (!updates) return devices
    const known = new Set(devices.map((d) => d.global_id))
    for (const id of Object.keys(updates)) {
      if (!known.has(id)) return 'refresh'
    }
    let changed = false
    const next = devices.map((d) => {
      const disable = updates[d.global_id]
      if (disable && disable !== (d.disable || 'none')) {
        changed = true
        return { ...d, disable }
      }
      return d
    })
    return changed ? next : devices
  }

  if (event.type === 'device_state' && event.device_id && event.state) {
    const idx = devices.findIndex((d) => d.global_id === event.device_id)
    if (idx < 0) return 'refresh'
    const state = String(event.state)
    const disable =
      typeof event.disable === 'string' ? event.disable : devices[idx].disable
    if (keepAlwaysAlarm(devices[idx], state, event)) {
      return devices
    }
    if (devices[idx].state === state && (devices[idx].disable || 'none') === (disable || 'none')) {
      return devices
    }
    const next = [...devices]
    next[idx] = { ...next[idx], state, disable: disable || 'none' }
    return next
  }

  /** Ép UI sang alarm trước khi focus map (kể cả Instant lại khi đang alarm). */
  if (event.type === 'device_alarm_trigger' && event.device_id) {
    const idx = devices.findIndex((d) => d.global_id === event.device_id)
    if (idx < 0) return 'refresh'
    const cur = devices[idx]
    const mapId =
      event.map_id != null && Number.isFinite(Number(event.map_id))
        ? Number(event.map_id)
        : cur.map_id
    const disable =
      typeof event.disable === 'string' ? event.disable : cur.disable || 'none'
    if (
      cur.state === 'alarm' &&
      (cur.disable || 'none') === (disable || 'none') &&
      cur.map_id === mapId
    ) {
      return devices
    }
    const next = [...devices]
    next[idx] = {
      ...cur,
      state: 'alarm',
      disable: disable || 'none',
      map_id: mapId ?? cur.map_id,
    }
    return next
  }

  if (event.type === 'device_disable' && event.device_id && event.disable) {
    const idx = devices.findIndex((d) => d.global_id === event.device_id)
    if (idx < 0) return 'refresh'
    const disable = String(event.disable)
    if ((devices[idx].disable || 'none') === disable) return devices
    const next = [...devices]
    next[idx] = { ...next[idx], disable }
    return next
  }

  return devices
}

/** Device IDs touched by a state event (for UI flash / alarm focus). */
export function deviceIdsFromEvent(event: CmsEvent): string[] {
  if (event.history_only === true) return []
  if (
    (event.type === 'device_state' ||
      event.type === 'device_disable' ||
      event.type === 'device_alarm_trigger') &&
    event.device_id
  ) {
    return [String(event.device_id)]
  }
  if (
    event.type === 'devices_state_batch' ||
    event.type === 'devices_disable_batch' ||
    event.type === 'devices_state_snapshot'
  ) {
    const updates = batchUpdates(event)
    if (!updates) return []
    return Object.keys(updates)
  }
  return []
}

export function isDeviceStateEvent(event: CmsEvent | null | undefined): boolean {
  return (
    !!event &&
    (event.type === 'device_state' ||
      event.type === 'device_disable' ||
      event.type === 'device_alarm_trigger' ||
      event.type === 'devices_state_batch' ||
      event.type === 'devices_disable_batch' ||
      event.type === 'devices_state_snapshot')
  )
}

export function isLiveSignalEvent(event: CmsEvent | null | undefined): boolean {
  return (
    !!event &&
    (event.type === 'panel_live' ||
      event.type === 'device_state' ||
      event.type === 'device_disable' ||
      event.type === 'device_alarm_trigger' ||
      event.type === 'devices_state_batch' ||
      event.type === 'devices_disable_batch' ||
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
    event.type === 'panel_config_imported' ||
    event.type === 'devices_inventory_updated' ||
    event.type === 'system_backup_restored'
  )
}
