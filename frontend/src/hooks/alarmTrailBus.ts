import {
  appendTrailPoint,
  TRAIL_HOLD_MS,
  type AlarmTrailPoint,
  type AlarmTrailSnapshot,
} from '../lib/alarmTrail'

const TRAIL_EVENT = 'cms:alarm-trail'

let points: AlarmTrailPoint[] = []
let recording = false
let holdUntil = 0
let hidden = false
let holdTimer: number | null = null
/** Thiết bị đang còn alarm trong phiên — không gắn số lần hai. */
const openIds = new Set<string>()

function clearHoldTimer(): void {
  if (holdTimer == null) return
  try {
    window.clearTimeout(holdTimer)
  } catch {
    /* ignore */
  }
  holdTimer = null
}

function pruneExpired(now = Date.now()): boolean {
  if (recording) return false
  if (holdUntil && now >= holdUntil) {
    points = []
    holdUntil = 0
    hidden = false
    openIds.clear()
    clearHoldTimer()
    return true
  }
  return false
}

function snapshot(): AlarmTrailSnapshot {
  pruneExpired()
  return {
    points: points.slice(),
    recording,
    holdUntil,
    hidden,
  }
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent(TRAIL_EVENT, { detail: snapshot() }))
  } catch {
    /* ignore */
  }
}

function scheduleHoldClear(until: number): void {
  clearHoldTimer()
  const delay = Math.max(0, until - Date.now())
  try {
    holdTimer = window.setTimeout(() => {
      holdTimer = null
      if (pruneExpired()) emit()
    }, delay)
  } catch {
    holdTimer = null
  }
}

export function getAlarmTrailSnapshot(): AlarmTrailSnapshot {
  return snapshot()
}

export function appendAlarmTrailPoint(
  deviceId: string,
  mapId: number | string,
  at = Date.now(),
): void {
  const mid = typeof mapId === 'number' ? mapId : Number(mapId)
  const id = String(deviceId || '')
  if (!id || !Number.isFinite(mid)) return
  const next = appendTrailPoint(points, { deviceId: id, mapId: mid, at }, { openIds })
  if (next.length === points.length && next[next.length - 1]?.seq === points[points.length - 1]?.seq) {
    return
  }
  points = next
  openIds.add(id)
  recording = true
  holdUntil = 0
  hidden = false
  clearHoldTimer()
  emit()
}

/** Hết phiên báo động — giữ overlay một lúc để xem luồng đi. */
export function endAlarmTrailRecording(now = Date.now()): void {
  if (!recording && !points.length) return
  recording = false
  if (points.length < 2) {
    points = []
    holdUntil = 0
    hidden = false
    openIds.clear()
    clearHoldTimer()
    emit()
    return
  }
  holdUntil = now + TRAIL_HOLD_MS
  scheduleHoldClear(holdUntil)
  emit()
}

export function setAlarmTrailHidden(value: boolean): void {
  if (hidden === value) return
  hidden = value
  emit()
}

export function releaseTrailDevices(deviceIds: readonly string[]): void {
  let changed = false
  for (const id of deviceIds) {
    if (openIds.delete(String(id))) changed = true
  }
  if (changed) emit()
}

export function clearAlarmTrail(): void {
  if (!points.length && !recording && !holdUntil && !hidden && !openIds.size) return
  points = []
  recording = false
  holdUntil = 0
  hidden = false
  openIds.clear()
  clearHoldTimer()
  emit()
}

export function subscribeAlarmTrail(handler: (snap: AlarmTrailSnapshot) => void): () => void {
  const onEvent = (e: Event) => {
    handler((e as CustomEvent<AlarmTrailSnapshot>).detail ?? snapshot())
  }
  window.addEventListener(TRAIL_EVENT, onEvent)
  handler(snapshot())
  return () => window.removeEventListener(TRAIL_EVENT, onEvent)
}
