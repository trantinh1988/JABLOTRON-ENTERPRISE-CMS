import type { AutomationSnap, CmsEvent } from '../api/client'

export type AlarmCameraSnap = {
  id: string
  cameraId: string
  cameraName: string
  deviceId: string | null
  imageUrl: string
  ruleId: string
  ruleName: string
  ok: boolean
  detail: string
  at: number
  createdAt: string | null
}

const SNAP_EVENT = 'cms:alarm-camera-snap'
const MAX_SNAPS = 48
/** Trần an toàn — cột focus chỉ lấy ảnh trong phiên báo động hiện tại. */
export const SNAP_FRESH_MS = 15 * 60 * 1000
const SESSION_LOOKBACK_MS = 4000
const NO_SESSION_MS = 120_000

let snaps: AlarmCameraSnap[] = []
/** Mốc phiên focus (alarm đầu tiên). 0 = không còn focus. */
let sessionAt = 0

export function beginAlarmSnapSession(at = Date.now()): void {
  if (!sessionAt) sessionAt = at
}

export function endAlarmSnapSession(): void {
  sessionAt = 0
}

export function getAlarmSnapSessionAt(): number {
  return sessionAt
}

export function getAlarmCameraSnaps(): AlarmCameraSnap[] {
  return snaps.slice()
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent(SNAP_EVENT, { detail: getAlarmCameraSnaps() }))
  } catch {
    /* ignore */
  }
}

function sameSnap(a: AlarmCameraSnap, b: AlarmCameraSnap): boolean {
  if (a.id && b.id && a.id === b.id && !a.id.startsWith('ws-')) return true
  if (a.imageUrl && b.imageUrl && a.imageUrl.split('?')[0] === b.imageUrl.split('?')[0]) return true
  return false
}

function upsertSnap(row: AlarmCameraSnap): void {
  if (!row.cameraId && !row.imageUrl) return
  snaps = [row, ...snaps.filter((s) => !sameSnap(s, row))]
}

export function ingestAlarmCameraSnap(row: AlarmCameraSnap): void {
  upsertSnap(row)
  snaps = snaps.sort((a, b) => b.at - a.at).slice(0, MAX_SNAPS)
  emit()
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function payloadOf(event: CmsEvent): Record<string, unknown> {
  const p = event.payload
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
}

/** ISO không timezone (SQLite) → UTC. */
export function parseSnapAt(iso: string | null | undefined, fallback = Date.now()): number {
  if (!iso) return fallback
  const raw = iso.trim()
  if (!raw) return fallback
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
  const n = Date.parse(hasTz ? raw : `${raw}Z`)
  return Number.isFinite(n) ? n : fallback
}

export function ingestAutomationFiredEvent(event: CmsEvent): void {
  if (event.type !== 'automation_fired') return
  const p = payloadOf(event)
  const thenType = asString(event.then_type) || asString(p.then_type)
  if (thenType && thenType !== 'camera_snapshot') return
  const imageUrl = asString(event.image_url) || asString(p.image_url)
  const cameraId = asString(event.camera_id) || asString(p.camera_id)
  if (!imageUrl && !cameraId) return
  const createdAt = asString(event.ts) || asString(p.ts) || null
  ingestAlarmCameraSnap({
    id: asString(event.id) || `ws-${asString(event.rule_id) || asString(p.rule_id)}-${createdAt || Date.now()}-${cameraId}`,
    cameraId,
    cameraName: asString(event.camera_name) || asString(p.camera_name),
    deviceId: asString(event.device_id) || asString(p.device_id) || null,
    imageUrl,
    ruleId: asString(event.rule_id) || asString(p.rule_id),
    ruleName: asString(event.rule_name) || asString(p.rule_name),
    ok: event.ok !== false && p.ok !== false,
    detail: asString(event.detail) || asString(p.detail),
    at: parseSnapAt(createdAt),
    createdAt,
  })
}

export function ingestAutomationSnapRows(rows: AutomationSnap[]): void {
  for (const row of rows) {
    if (!row.image_url && !row.camera_id) continue
    upsertSnap({
      id: row.id,
      cameraId: row.camera_id || '',
      cameraName: row.camera_name || '',
      deviceId: row.device_id,
      imageUrl: row.image_url,
      ruleId: row.rule_id,
      ruleName: '',
      ok: Boolean(row.image_url),
      detail: '',
      at: parseSnapAt(row.created_at),
      createdAt: row.created_at,
    })
  }
  snaps = snaps.sort((a, b) => b.at - a.at).slice(0, MAX_SNAPS)
  emit()
}

export function subscribeAlarmCameraSnaps(handler: (items: AlarmCameraSnap[]) => void): () => void {
  const onEvent = (e: Event) => {
    handler((e as CustomEvent<AlarmCameraSnap[]>).detail ?? [])
  }
  window.addEventListener(SNAP_EVENT, onEvent)
  handler(getAlarmCameraSnaps())
  return () => window.removeEventListener(SNAP_EVENT, onEvent)
}

export const ALARM_SNAP_STACK = 3

/**
 * Tối đa 3 ảnh sự kiện liên tiếp khi chưa tắt báo động (không gộp 1 camera).
 * Thứ tự cột: mới nhất trên cùng; ưu tiên camera của thiết bị đang focus,
 * rồi hàng đợi báo động, rồi camera khớp luật automation.
 */
export function snapsForAlarmFocus(
  items: AlarmCameraSnap[],
  deviceId: string | null,
  queueDeviceIds: ReadonlySet<string>,
  pendingCameraIds: ReadonlySet<string> = new Set(),
  now = Date.now(),
): AlarmCameraSnap[] {
  const since = sessionAt ? sessionAt - SESSION_LOOKBACK_MS : now - NO_SESSION_MS
  const fresh = items.filter(
    (s) => (s.imageUrl || !s.ok) && s.at >= since && now - s.at <= SNAP_FRESH_MS,
  )
  const rank = (s: AlarmCameraSnap) => {
    if (deviceId && s.deviceId === deviceId) return 3
    if (s.deviceId && queueDeviceIds.has(s.deviceId)) return 2
    if (s.cameraId && pendingCameraIds.has(s.cameraId)) return 1
    return 0
  }
  const preferred = fresh.filter((s) => rank(s) > 0 || !s.deviceId)
  const pool = preferred.length ? preferred : fresh
  return pool
    .filter((s) => s.imageUrl)
    .sort((a, b) => b.at - a.at || rank(b) - rank(a))
    .slice(0, ALARM_SNAP_STACK)
}
