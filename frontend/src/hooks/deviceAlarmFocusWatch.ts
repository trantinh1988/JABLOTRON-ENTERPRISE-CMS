import type { CmsEvent, Device } from '../api/client'
import { effectiveDeviceStatus } from '../i18n/vi'
import { playAlertSound } from '../lib/alarmSounds'
import { appendAlarmTrailPoint } from './alarmTrailBus'
import {
  getAlarmFocusQueue,
  pruneAlarmFocusQueue,
  requestAlarmMapFocus,
} from './alarmMapFocusBus'

/** Mirror map_id + status — cập nhật sync từ REST / sau khi apply WS. */
const statusById: Record<string, string> = {}
const mapIdByDevice: Record<string, number | null | undefined> = {}
let primed = false

type PendingTrigger = { deviceId: string; mapId?: unknown; at: number; force: boolean }
let pendingTriggers: PendingTrigger[] = []
const PENDING_TTL_MS = 60_000

function playNonAlarmStatusSound(st: string, prev: string | undefined): void {
  if (prev == null || prev === st) return
  if (st !== 'tamper' && st !== 'fault' && st !== 'loss') return
  void playAlertSound(st)
}

function rememberPending(deviceId: string, mapId?: unknown, force = false): void {
  const id = String(deviceId)
  pendingTriggers = [
    { deviceId: id, mapId, at: Date.now(), force },
    ...pendingTriggers.filter((p) => p.deviceId !== id),
  ].slice(0, 32)
}

function mapIdOf(deviceId: string, eventMapId?: unknown): number | null {
  if (eventMapId != null && eventMapId !== '' && Number.isFinite(Number(eventMapId))) {
    const n = Number(eventMapId)
    mapIdByDevice[deviceId] = n
    return n
  }
  const mid = mapIdByDevice[deviceId]
  if (mid == null || !Number.isFinite(Number(mid))) return null
  return Number(mid)
}

function flushPendingTriggers(): void {
  if (!pendingTriggers.length) return
  const now = Date.now()
  const kept: PendingTrigger[] = []
  for (const p of pendingTriggers) {
    if (now - p.at > PENDING_TTL_MS) continue
    const mapId = mapIdOf(p.deviceId, p.mapId)
    if (mapId == null) {
      kept.push(p)
      continue
    }
    statusById[p.deviceId] = 'alarm'
    appendAlarmTrailPoint(p.deviceId, mapId)
    requestAlarmMapFocus(mapId, p.deviceId, { force: p.force })
  }
  pendingTriggers = kept
}

export function syncDeviceAlarmMirror(devices: Device[]): void {
  const stillAlarm = new Set<string>()
  const byId = new Map(devices.map((d) => [d.global_id, d]))
  for (const d of devices) {
    const st = effectiveDeviceStatus(d.state, d.disable)
    statusById[d.global_id] = st
    mapIdByDevice[d.global_id] = d.map_id
    if (st === 'alarm' && d.map_id != null) stillAlarm.add(d.global_id)
  }
  // 24h: cửa đóng nhưng UI còn sticky alarm → giữ hàng đợi. Tắt báo động (state hết alarm) → bỏ.
  for (const q of getAlarmFocusQueue()) {
    const d = byId.get(q.deviceId)
    if (!d) continue
    const st = effectiveDeviceStatus(d.state, d.disable)
    if (st === 'alarm') stillAlarm.add(q.deviceId)
  }
  primed = true
  flushPendingTriggers()
  pruneAlarmFocusQueue(stillAlarm)
}

/**
 * Gọi SAU khi đã apply state alarm lên devices (UI sẽ commit cùng lúc).
 * Instant lại khi đang alarm cũng gọi hàm này.
 */
export function focusAlarmAfterUiApply(
  deviceId: string,
  mapId?: unknown,
  opts?: { force?: boolean },
): void {
  const id = String(deviceId)
  statusById[id] = 'alarm'
  const mid = mapIdOf(id, mapId)
  if (mid == null) {
    rememberPending(id, mapId, opts?.force === true)
    return
  }
  appendAlarmTrailPoint(id, mid)
  requestAlarmMapFocus(mid, id, { force: opts?.force })
}

/**
 * Mirror + focus sớm trên device_alarm_trigger (không chờ React apply).
 * useCmsData vẫn focus lại sau apply — token mới vẫn navigate đúng map.
 *
 * Chỉ focus khi Status = Báo động. ACT (open) của 24h/Fire KHÔNG focus:
 * backend đã promote ACT → Báo động, focus theo ACT chỉ tạo focus giả rồi
 * bị prune về lưới sau ~2.5s.
 */
export function watchAlarmFocusFromEvent(event: CmsEvent): void {
  if (event.history_only === true) return
  if (event.type === 'device_alarm_trigger' && event.device_id) {
    const id = String(event.device_id)
    statusById[id] = 'alarm'
    if (event.map_id != null && Number.isFinite(Number(event.map_id))) {
      mapIdByDevice[id] = Number(event.map_id)
    }
    focusAlarmAfterUiApply(id, event.map_id ?? mapIdByDevice[id] ?? null, { force: true })
    return
  }

  if (event.type === 'device_state' && event.device_id && event.state) {
    const id = String(event.device_id)
    const disable = typeof event.disable === 'string' ? event.disable : undefined
    const st = effectiveDeviceStatus(String(event.state), disable)
    const prev = statusById[id]
    statusById[id] = st
    playNonAlarmStatusSound(st, prev)
    if (st === 'alarm' && prev !== 'alarm') {
      focusAlarmAfterUiApply(id, event.map_id ?? mapIdByDevice[id] ?? null)
    }
    return
  }

  if (event.type === 'devices_state_batch' || event.type === 'devices_state_snapshot') {
    const raw =
      (event.updates as Record<string, string> | undefined) ??
      ((event.payload as { updates?: Record<string, string> } | undefined)?.updates)
    if (!raw || typeof raw !== 'object') return
    for (const [deviceId, state] of Object.entries(raw)) {
      if (!state) continue
      const st = effectiveDeviceStatus(state)
      const prev = statusById[deviceId]
      statusById[deviceId] = st
      playNonAlarmStatusSound(st, prev)
      if (st === 'alarm' && prev !== 'alarm') {
        focusAlarmAfterUiApply(deviceId, mapIdByDevice[deviceId] ?? null)
      }
    }
  }

  void primed
}
