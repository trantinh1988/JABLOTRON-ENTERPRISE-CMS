import type { AutomationSnap, CmsEvent, Device, Panel, Zone } from '../api/client'
import {
  formatEventTime,
  formatZoneCaption,
  zoneCaptionFromEvent,
} from '../components/EventFeed'
import { parseSnapAt } from '../hooks/alarmCameraSnapBus'
import { armedStateLabel, deviceStateLabel, eventTypeLabel, labelOf, vi } from '../i18n/vi'

export type EventSnap = {
  imageUrl: string
  cameraName: string
  createdAt: string | null
}

export type HistoryRow = {
  key: string
  event: CmsEvent
  tsLabel: string
  tsSort: number
  panelId: string
  panelName: string
  deviceId: string
  idLabel: string
  label: string
  section: string
  zoneId: string
  status: string
  statusKey: string
  eventType: string
  snap: EventSnap | null
}

const SNAP_MATCH_MS = 2 * 60 * 1000

/** Lịch sử: Báo động / TMP / Lỗi (Fault) — không gồm OK, ACT, Loss. */
const HISTORY_PAGE_STATES = new Set(['alarm', 'tamper', 'fault'])
const HISTORY_PAGE_TYPES = new Set(['device_alarm_trigger', 'map_trail_snap', 'panel_updated'])

const SMART_ALIASES: Record<string, string[]> = {
  alarm: ['alarm', 'baodong', 'bao dong', 'canh bao'],
  tamper: ['tamper', 'tmp', 'sabotage'],
  fault: ['fault', 'faul', 'loi'],
  photo: ['anh', 'photo', 'snap', 'camera', 'hinh', 'truy vet'],
  panel: ['cap nhat tu', 'tu'],
}

export function payloadOf(event: CmsEvent): Record<string, unknown> {
  const p = event.payload
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

export function isAlarmLike(e: CmsEvent): boolean {
  if (e.type === 'device_alarm_trigger' || e.type === 'automation_fired' || e.type === 'map_trail_snap') {
    return true
  }
  if (e.type !== 'device_state') return false
  const st = String(e.state || '').toLowerCase()
  return st === 'alarm' || st === 'tamper' || st === 'loss' || st === 'fault' || st === 'open'
}

export function snapFromEvent(e: CmsEvent): EventSnap | null {
  const p = payloadOf(e)
  const imageUrl = asString(e.image_url) || asString(p.image_url)
  if (!imageUrl) return null
  return {
    imageUrl,
    cameraName:
      asString(e.camera_name) ||
      asString(p.camera_name) ||
      asString(e.map_name) ||
      asString(p.map_name) ||
      'Camera',
    createdAt: e.ts || asString(p.ts) || null,
  }
}

export function eventSnap(e: CmsEvent, snaps: AutomationSnap[]): EventSnap | null {
  const direct = snapFromEvent(e)
  if (direct) return direct
  if (!isAlarmLike(e)) return null
  const deviceId = e.device_id || asString(payloadOf(e).device_id) || null
  if (!deviceId) return null
  const at = parseSnapAt(e.ts, 0)
  if (!at) return null
  let best: AutomationSnap | null = null
  let bestDelta = Infinity
  for (const s of snaps) {
    if (!s.image_url || s.device_id !== deviceId) continue
    const sat = parseSnapAt(s.created_at, 0)
    if (!sat) continue
    const delta = sat - at
    if (delta < -15_000 || delta > SNAP_MATCH_MS) continue
    const abs = Math.abs(delta)
    if (abs < bestDelta) {
      bestDelta = abs
      best = s
    }
  }
  if (!best) return null
  return {
    imageUrl: best.image_url,
    cameraName: best.camera_name || 'Camera',
    createdAt: best.created_at,
  }
}

export function upsertLiveSnap(
  prev: AutomationSnap[],
  event: CmsEvent,
  snap: EventSnap,
): AutomationSnap[] {
  const path = snap.imageUrl.split('?')[0]
  if (prev.some((s) => s.image_url.split('?')[0] === path)) return prev
  const p = payloadOf(event)
  const row: AutomationSnap = {
    id: asString(event.id) || `live-${event.ts || Date.now()}`,
    rule_id: asString(event.rule_id) || asString(p.rule_id),
    camera_id: asString(event.camera_id) || asString(p.camera_id) || null,
    camera_name: snap.cameraName,
    device_id: event.device_id || asString(p.device_id) || null,
    image_url: snap.imageUrl,
    created_at: snap.createdAt,
  }
  return [row, ...prev].slice(0, 200)
}

function shortDeviceToken(deviceId: string | undefined): string {
  if (!deviceId) return ''
  const m = /(?:^|_)DEV_(\d+)$/i.exec(String(deviceId))
  if (m) return String(Number(m[1]))
  return String(deviceId)
}

function deviceIdLabel(e: CmsEvent, device?: Device): string {
  if (device?.device_num != null && device.device_num >= 0) return String(device.device_num)
  return shortDeviceToken(e.device_id) || '—'
}

function statusKeyOf(e: CmsEvent): string {
  if (e.type === 'device_alarm_trigger') return 'alarm'
  if (e.armed_state) return String(e.armed_state).toLowerCase()
  if (e.state) return String(e.state).toLowerCase()
  return e.type || ''
}

function statusTextOf(e: CmsEvent): string {
  if (e.type === 'device_state' || e.type === 'device_alarm_trigger' || e.type === 'device_disable') {
    return labelOf(deviceStateLabel, statusKeyOf(e))
  }
  if (e.type === 'panel_armed' || e.type === 'zone_armed') {
    return e.armed_state ? labelOf(armedStateLabel, String(e.armed_state)) : labelOf(eventTypeLabel, e.type)
  }
  return labelOf(eventTypeLabel, e.type)
}

function sectionOf(e: CmsEvent, device: Device | undefined, zoneMap: Map<string, Zone>): string {
  if (device?.zone_id) {
    const zone = zoneMap.get(device.zone_id)
    if (zone) return formatZoneCaption(zone) || vi.eventsNoSection
  }
  const fromEvent = zoneCaptionFromEvent(e, zoneMap)
  if (fromEvent) return fromEvent
  return e.device_id ? vi.eventsNoSection : '—'
}

export function buildHistoryRow(
  e: CmsEvent,
  index: number,
  panels: Panel[],
  devices: Device[],
  zoneMap: Map<string, Zone>,
  snaps: AutomationSnap[],
): HistoryRow {
  const p = payloadOf(e)
  const deviceId = e.device_id || asString(p.device_id) || ''
  const device = deviceId ? devices.find((d) => d.global_id === deviceId) : undefined
  const panelId = e.panel_id || asString(p.panel_id) || device?.panel_id || ''
  const panel = panelId ? panels.find((x) => x.panel_id === panelId) : undefined
  const tsSort = parseSnapAt(e.ts, 0) || 0
  const zoneId = device?.zone_id || asString(e.zone_id) || asString(p.zone_id) || ''
  const mapName = asString(e.map_name) || asString(p.map_name)
  const isMapSnap = e.type === 'map_trail_snap'
  return {
    key: `${e.id ?? 'live'}-${e.ts}-${e.type}-${deviceId}-${index}`,
    event: e,
    tsLabel: formatEventTime(e.ts),
    tsSort,
    panelId,
    panelName: isMapSnap ? mapName || vi.alarmTrailAria : panel?.display_name || panelId || '—',
    deviceId,
    idLabel: isMapSnap
      ? mapName
        ? `#${asString(e.map_id) || asString(p.map_id) || '—'}`
        : deviceIdLabel(e, device)
      : deviceIdLabel(e, device),
    label: isMapSnap
      ? asString(e.detail) || asString(p.detail) || mapName || vi.alarmTrailSnap
      : (device?.label || asString(e.camera_name) || asString(p.camera_name) || '').trim() || '—',
    section: isMapSnap ? vi.alarmTrailAria : sectionOf(e, device, zoneMap),
    zoneId,
    status: statusTextOf(e),
    statusKey: statusKeyOf(e),
    eventType: e.type,
    snap: eventSnap(e, snaps),
  }
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function aliasHit(token: string): string | null {
  const t = fold(token)
  for (const [key, aliases] of Object.entries(SMART_ALIASES)) {
    if (t === key || aliases.some((a) => t === a || t.includes(a))) return key
  }
  return null
}

export function matchSmartQuery(row: HistoryRow, query: string): boolean {
  const raw = query.trim()
  if (!raw) return true
  const tokens = raw.split(/\s+/).filter(Boolean)
  const hay = fold(
    [
      row.tsLabel,
      row.panelName,
      row.panelId,
      row.idLabel,
      row.deviceId,
      row.label,
      row.section,
      row.status,
      row.statusKey,
      row.eventType,
      labelOf(eventTypeLabel, row.eventType),
      row.snap?.cameraName || '',
    ].join(' '),
  )
  return tokens.every((token) => {
    const alias = aliasHit(token)
    if (alias === 'photo') return Boolean(row.snap) || row.eventType === 'map_trail_snap'
    if (alias === 'panel') return row.eventType === 'panel_updated' || hay.includes(fold(token))
    if (alias === 'alarm' && row.eventType === 'map_trail_snap') return true
    if (alias && HISTORY_PAGE_STATES.has(alias)) {
      return row.statusKey === alias || fold(row.status).includes(alias) || hay.includes(fold(token))
    }
    return hay.includes(fold(token))
  })
}

export function statusTone(statusKey: string, eventType: string): string {
  const st = statusKey.toLowerCase()
  if (st === 'alarm' || eventType === 'command_error' || eventType === 'device_deleted') return 'text-danger'
  if (st === 'open' || st === 'tamper' || st === 'loss' || st === 'fault' || st === 'armed' || st === 'partial') {
    return 'text-warn'
  }
  if (st === 'ok' || st === 'disarmed') return 'text-ok'
  if (eventType === 'device_state' || eventType === 'automation_fired' || eventType === 'map_trail_snap') {
    return 'text-accent'
  }
  return 'text-ink'
}

export function rowTone(statusKey: string, eventType: string): string {
  const st = statusKey.toLowerCase()
  if (st === 'alarm' || eventType === 'command_error') return 'bg-danger/5'
  if (st === 'open' || st === 'tamper' || st === 'loss' || st === 'fault') return 'bg-warn/5'
  return 'hover:bg-mist/30'
}

export function isHistoryAuditEvent(e: CmsEvent): boolean {
  if (e.history === false || e.derived === true) return false
  if (
    e.type === 'panel_live' ||
    e.type === 'devices_state_snapshot' ||
    e.type === 'connected' ||
    e.type === 'devices_disable_batch'
  ) {
    return false
  }
  return true
}

export function isHistoryPageEvent(e: CmsEvent): boolean {
  if (HISTORY_PAGE_TYPES.has(e.type)) return true
  if (e.type === 'device_state') {
    return HISTORY_PAGE_STATES.has(String(e.state || '').toLowerCase())
  }
  return false
}

export function expandHistoryEvents(events: CmsEvent[]): CmsEvent[] {
  const out: CmsEvent[] = []
  for (const e of events) {
    if (!isHistoryAuditEvent(e)) continue
    if (e.type === 'devices_state_batch') {
      const raw = e.updates ?? payloadOf(e).updates
      if (raw && typeof raw === 'object') {
        for (const [deviceId, state] of Object.entries(raw as Record<string, unknown>)) {
          const row: CmsEvent = {
            ...e,
            type: 'device_state',
            device_id: deviceId,
            state: String(state),
            updates: undefined,
          }
          if (isHistoryPageEvent(row)) out.push(row)
        }
        continue
      }
    }
    if (!isHistoryPageEvent(e)) continue
    out.push(e)
  }
  return out
}

export function eventTypeOptions(events: CmsEvent[]): string[] {
  const set = new Set(events.map((e) => e.type).filter(Boolean))
  ;['device_state', 'device_alarm_trigger', 'map_trail_snap', 'panel_updated'].forEach((t) => set.add(t))
  return [...set].sort()
}

export function formatSnapTs(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(parseSnapAt(iso))
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('vi-VN')
}

export function startOfDayVn(d = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return new Date(`${parts}T00:00:00+07:00`)
}

export function dateInputVn(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export function rangeBounds(preset: string, fromDate: string, toDate: string): { since?: string; until?: string } {
  const now = new Date()
  if (preset === '24h') return { since: new Date(now.getTime() - 86_400_000).toISOString() }
  if (preset === 'today') {
    return { since: startOfDayVn(now).toISOString(), until: now.toISOString() }
  }
  if (preset === '7d') return { since: new Date(now.getTime() - 7 * 86_400_000).toISOString() }
  const since = fromDate ? `${fromDate}T00:00:00+07:00` : undefined
  const until = toDate ? `${toDate}T23:59:59.999+07:00` : undefined
  return { since, until }
}
