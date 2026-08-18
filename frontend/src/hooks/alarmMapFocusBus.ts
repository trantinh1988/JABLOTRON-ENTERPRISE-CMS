import { beginAlarmSnapSession, endAlarmSnapSession } from './alarmCameraSnapBus'
import { endAlarmTrailRecording, releaseTrailDevices } from './alarmTrailBus'

export type AlarmMapFocusRequest = {
  mapId: number
  deviceId: string
  token: number
  at: number
}

const FOCUS_EVENT = 'cms:alarm-map-focus'
const QUEUE_EVENT = 'cms:alarm-focus-queue'
const RELEASE_EVENT = 'cms:alarm-map-release'
const CLEARED_EVENT = 'cms:alarm-cleared'
/** REST/snapshot cũ không được gỡ báo động vừa kích (focus → lưới → focus). */
const PRUNE_GRACE_MS = 2500
const SUPPRESS_MS = 5000

let tokenSeq = 0
/** Hàng đợi báo động đang/đã kích hoạt gần đây (mới nhất trước). */
let queue: AlarmMapFocusRequest[] = []
/** Emit trước khi có listener — giao lại khi subscribe. */
let pendingFocus: AlarmMapFocusRequest | null = null
/** Focus mới nhất — MapsPage mount sau navigate vẫn áp ngay, không chờ URL. */
let lastFocus: AlarmMapFocusRequest | null = null
const focusListeners = new Set<(req: AlarmMapFocusRequest) => void>()

export function getLastAlarmMapFocus(): AlarmMapFocusRequest | null {
  return lastFocus
}

export function getAlarmFocusQueue(): AlarmMapFocusRequest[] {
  return queue.slice()
}

function emitQueue(): void {
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: getAlarmFocusQueue() }))
  } catch {
    /* ignore */
  }
}

function emitRelease(): void {
  try {
    window.dispatchEvent(new CustomEvent(RELEASE_EVENT))
  } catch {
    /* ignore */
  }
}

function emitCleared(ids: string[]): void {
  if (!ids.length) return
  try {
    window.dispatchEvent(new CustomEvent(CLEARED_EVENT, { detail: ids }))
  } catch {
    /* ignore */
  }
}

function emptyQueueSideEffects(): void {
  lastFocus = null
  pendingFocus = null
  endAlarmSnapSession()
  endAlarmTrailRecording()
  emitQueue()
  emitRelease()
}

/** Bỏ thiết bị khỏi hàng đợi khi hết alarm — giữ mục mới hơn PRUNE_GRACE_MS. */
export function pruneAlarmFocusQueue(stillAlarmIds: ReadonlySet<string>): void {
  const now = Date.now()
  const next = queue.filter(
    (q) => stillAlarmIds.has(q.deviceId) || now - q.at < PRUNE_GRACE_MS,
  )
  if (next.length === queue.length) return
  const removed = queue.filter((q) => !next.some((n) => n.deviceId === q.deviceId)).map((q) => q.deviceId)
  queue = next
  if (removed.length) releaseTrailDevices(removed)
  if (!queue.length) {
    emptyQueueSideEffects()
    return
  }
  if (lastFocus && !queue.some((q) => q.deviceId === lastFocus!.deviceId)) {
    lastFocus = queue[0]
  }
  if (pendingFocus && !queue.some((q) => q.deviceId === pendingFocus!.deviceId)) {
    pendingFocus = queue[0]
  }
  emitQueue()
}

let suppressUntil = 0
const suppressedIds = new Set<string>()

export function isAlarmFocusSuppressed(deviceId: string): boolean {
  return Date.now() < suppressUntil && suppressedIds.has(deviceId)
}

/**
 * Tắt báo động — bỏ đúng thiết bị khỏi hàng đợi.
 * `undefined` = cả hàng đợi. `[]` = không làm gì (không được hiểu là “tất cả”).
 * Chỉ về lưới khi hàng đợi trống.
 */
export function releaseAlarmMapFocus(deviceIds?: readonly string[]): void {
  const ids = deviceIds === undefined ? queue.map((q) => q.deviceId) : [...deviceIds]
  if (!ids.length) return
  const idSet = new Set(ids)
  for (const id of ids) suppressedIds.add(id)
  suppressUntil = Date.now() + SUPPRESS_MS
  queue = queue.filter((q) => !idSet.has(q.deviceId))
  if (lastFocus && idSet.has(lastFocus.deviceId)) lastFocus = queue[0] ?? null
  if (pendingFocus && idSet.has(pendingFocus.deviceId)) pendingFocus = queue[0] ?? null
  emitCleared(ids)
  releaseTrailDevices(ids)
  if (!queue.length) {
    emptyQueueSideEffects()
    return
  }
  emitQueue()
}

export function clearAlarmFocusQueue(): void {
  releaseAlarmMapFocus()
}

/**
 * Focus map theo báo động mới nhất (latest wins).
 * Cùng thiết bị + map đã có trong hàng đợi → không emit lại (tránh flicker).
 * `force` = báo động mới từ backend (device_alarm_trigger) — bỏ qua cửa sổ chặn
 * sau khi Tắt báo động để kích lại lần nữa vẫn focus.
 */
export function requestAlarmMapFocus(
  mapId: number | string,
  deviceId: string,
  opts?: { force?: boolean },
): AlarmMapFocusRequest {
  const mid = typeof mapId === 'number' ? mapId : Number(mapId)
  const id = String(deviceId)
  const invalid: AlarmMapFocusRequest = {
    mapId: mid,
    deviceId: id,
    token: tokenSeq,
    at: Date.now(),
  }
  if (!Number.isFinite(mid) || !id) return invalid
  if (opts?.force) {
    suppressedIds.delete(id)
  } else if (Date.now() < suppressUntil && suppressedIds.has(id)) {
    return lastFocus ?? invalid
  }
  if (
    lastFocus &&
    lastFocus.deviceId === id &&
    lastFocus.mapId === mid &&
    queue.some((q) => q.deviceId === id)
  ) {
    return lastFocus
  }

  tokenSeq += 1
  const req: AlarmMapFocusRequest = {
    mapId: mid,
    deviceId: id,
    token: tokenSeq,
    at: Date.now(),
  }

  lastFocus = req
  queue = [req, ...queue.filter((q) => q.deviceId !== req.deviceId)].slice(0, 24)
  beginAlarmSnapSession(req.at)

  if (focusListeners.size) {
    pendingFocus = null
    for (const handler of focusListeners) {
      try {
        handler(req)
      } catch {
        /* listener lỗi không chặn các listener khác */
      }
    }
  } else {
    pendingFocus = req
  }

  try {
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: req }))
  } catch {
    /* ignore */
  }
  emitQueue()
  return req
}

export function subscribeAlarmMapFocus(handler: (req: AlarmMapFocusRequest) => void): () => void {
  focusListeners.add(handler)
  const queued = pendingFocus
  pendingFocus = null
  const replay = queued ?? (queue.length ? lastFocus : null)
  if (replay) {
    try {
      handler(replay)
    } catch {
      pendingFocus = replay
    }
  }
  return () => {
    focusListeners.delete(handler)
  }
}

export function subscribeAlarmMapRelease(handler: () => void): () => void {
  const onEvent = () => handler()
  window.addEventListener(RELEASE_EVENT, onEvent)
  return () => window.removeEventListener(RELEASE_EVENT, onEvent)
}

export function subscribeAlarmCleared(handler: (ids: string[]) => void): () => void {
  const onEvent = (e: Event) => {
    handler((e as CustomEvent<string[]>).detail ?? [])
  }
  window.addEventListener(CLEARED_EVENT, onEvent)
  return () => window.removeEventListener(CLEARED_EVENT, onEvent)
}

export function subscribeAlarmFocusQueue(handler: (items: AlarmMapFocusRequest[]) => void): () => void {
  const onEvent = (e: Event) => {
    handler((e as CustomEvent<AlarmMapFocusRequest[]>).detail ?? [])
  }
  window.addEventListener(QUEUE_EVENT, onEvent)
  handler(getAlarmFocusQueue())
  return () => window.removeEventListener(QUEUE_EVENT, onEvent)
}
