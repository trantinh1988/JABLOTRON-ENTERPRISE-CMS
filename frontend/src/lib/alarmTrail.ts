/** Điểm truy vết trên bản đồ — thứ tự thời gian, không trùng hàng đợi focus. */
export type AlarmTrailPoint = {
  deviceId: string
  mapId: number
  at: number
  seq: number
}

export type TrailPaintStop = {
  deviceId: string
  /** Số thứ tự toàn phiên (mọi map). */
  seq: number
  at: number
  x: number
  y: number
  label: string
  /** Bán kính halo icon — line dừng sát mép, mũi tên không chui vào tâm. */
  r: number
}

export type TrailSegment = {
  x1: number
  y1: number
  /** Đáy mũi tên — đường đứt khúc dừng tại đây. */
  x2: number
  y2: number
  /** Tam giác mũi tên, đỉnh vừa chạm mép icon đích. */
  arrowPoints: string
  opacity: number
  animated: boolean
}

export const TRAIL_HOLD_MS = 150_000
export const TRAIL_MAX_POINTS = 48
/** Halo mặc định (icon size 2 × 1.52). */
export const TRAIL_DEFAULT_ICON_R = 3.04
/** Chạm sát mép halo — không chui vào tâm. */
export const TRAIL_ARROW_PAD = 0.06
export const TRAIL_ARROW_LEN = 2.25
export const TRAIL_ARROW_HALF_W = 1.05
export const TRAIL_ARROW_LEN_COMPACT = 1.45
export const TRAIL_ARROW_HALF_W_COMPACT = 0.68

export type AlarmTrailSnapshot = {
  points: AlarmTrailPoint[]
  recording: boolean
  holdUntil: number
  hidden: boolean
}

export function shouldAppendTrailPoint(
  last: AlarmTrailPoint | null,
  next: { deviceId: string; mapId: number; at: number },
): boolean {
  const id = String(next.deviceId || '')
  if (!id || !Number.isFinite(next.mapId)) return false
  if (!last) return true
  // HID / Instant phát lại ngay trên điểm vừa ghi — không nhân số.
  // Quay lại thiết bị sau khi đã đi nơi khác (9 → 2 → 7 → 9) thì vẫn ghi.
  if (last.deviceId === id) return false
  return true
}

export function appendTrailPoint(
  points: readonly AlarmTrailPoint[],
  next: { deviceId: string; mapId: number; at: number },
  opts?: { maxPoints?: number },
): AlarmTrailPoint[] {
  const last = points[points.length - 1] ?? null
  if (!shouldAppendTrailPoint(last, next)) return points.slice()
  const seq = (last?.seq ?? 0) + 1
  const max = opts?.maxPoints ?? TRAIL_MAX_POINTS
  return [...points, { ...next, deviceId: String(next.deviceId), seq }].slice(-max)
}

export function isAlarmTrailActive(snap: AlarmTrailSnapshot, now = Date.now()): boolean {
  if (snap.hidden) return false
  if (snap.points.length < 2) return false
  if (snap.recording) return true
  return snap.holdUntil > now
}

export function resolveTrailStops(
  points: readonly AlarmTrailPoint[],
  mapId: number,
  getPos: (deviceId: string) => { x: number; y: number; label: string; r?: number } | null,
): TrailPaintStop[] {
  const out: TrailPaintStop[] = []
  for (const p of points) {
    if (p.mapId !== mapId) continue
    const pos = getPos(p.deviceId)
    if (!pos) continue
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue
    const r = pos.r != null && Number.isFinite(pos.r) && pos.r > 0 ? pos.r : TRAIL_DEFAULT_ICON_R
    out.push({
      deviceId: p.deviceId,
      seq: p.seq,
      at: p.at,
      x: pos.x,
      y: pos.y,
      label: pos.label,
      r,
    })
  }
  return out
}

/** Rút đoạn để hai đầu dừng sát mép icon. */
export function shortenTrailSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  inset1: number,
  inset2: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const a = Math.max(0, inset1)
  const b = Math.max(0, inset2)
  if (len < a + b + 0.2) return null
  const ux = dx / len
  const uy = dy / len
  return {
    x1: x1 + ux * a,
    y1: y1 + uy * a,
    x2: x2 - ux * b,
    y2: y2 - uy * b,
  }
}

/** Tam giác mũi tên: đỉnh tại (tipX, tipY), đường đứt khúc dừng ở đáy. */
export function buildTrailArrow(
  fromX: number,
  fromY: number,
  tipX: number,
  tipY: number,
  len: number,
  halfW: number,
): { x2: number; y2: number; arrowPoints: string } | null {
  const dx = tipX - fromX
  const dy = tipY - fromY
  const dist = Math.hypot(dx, dy)
  if (dist < 0.4) return null
  const useLen = Math.min(Math.max(0.55, len), dist * 0.45)
  const useW = halfW * (useLen / Math.max(len, 0.01))
  const ux = dx / dist
  const uy = dy / dist
  const bx = tipX - ux * useLen
  const by = tipY - uy * useLen
  const px = -uy * useW
  const py = ux * useW
  return {
    x2: bx,
    y2: by,
    arrowPoints: `${tipX},${tipY} ${bx + px},${by + py} ${bx - px},${by - py}`,
  }
}

/** Chỉ nối hai điểm seq liền kề (không nhảy cóc qua map khác). */
export function buildTrailSegments(
  stops: readonly TrailPaintStop[],
  lastSeq = 0,
  opts?: { compact?: boolean },
): TrailSegment[] {
  const segs: TrailSegment[] = []
  const span = Math.max(1, lastSeq)
  const arrowLen = opts?.compact ? TRAIL_ARROW_LEN_COMPACT : TRAIL_ARROW_LEN
  const arrowW = opts?.compact ? TRAIL_ARROW_HALF_W_COMPACT : TRAIL_ARROW_HALF_W
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (b.seq !== a.seq + 1) continue
    const cut = shortenTrailSegment(a.x, a.y, b.x, b.y, a.r, b.r + TRAIL_ARROW_PAD)
    if (!cut) continue
    const arrow = buildTrailArrow(cut.x1, cut.y1, cut.x2, cut.y2, arrowLen, arrowW)
    if (!arrow) continue
    segs.push({
      x1: cut.x1,
      y1: cut.y1,
      x2: arrow.x2,
      y2: arrow.y2,
      arrowPoints: arrow.arrowPoints,
      opacity: 0.38 + 0.55 * (b.seq / span),
      animated: b.seq === lastSeq,
    })
  }
  return segs
}

export function formatTrailClock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ''
  }
}

export function alarmTrailSelfCheck(): string[] {
  const errors: string[] = []
  const check = (ok: boolean, msg: string) => {
    if (!ok) errors.push(msg)
  }

  check(shouldAppendTrailPoint(null, { deviceId: 'D1', mapId: 1, at: 10 }), 'first point')
  check(!shouldAppendTrailPoint(null, { deviceId: '', mapId: 1, at: 10 }), 'empty device')
  check(!shouldAppendTrailPoint(null, { deviceId: 'D1', mapId: Number.NaN, at: 10 }), 'bad map')

  const a: AlarmTrailPoint = { deviceId: 'D1', mapId: 1, at: 1000, seq: 1 }
  check(!shouldAppendTrailPoint(a, { deviceId: 'D1', mapId: 1, at: 2500 }), 'consecutive same device')
  check(!shouldAppendTrailPoint(a, { deviceId: 'D1', mapId: 1, at: 9000 }), 'sticky retrigger')
  check(shouldAppendTrailPoint(a, { deviceId: 'D2', mapId: 1, at: 1100 }), 'other device')

  const p1 = appendTrailPoint([], { deviceId: 'D1', mapId: 2, at: 1 })
  const p2 = appendTrailPoint(p1, { deviceId: 'D2', mapId: 2, at: 4000 })
  const echo = appendTrailPoint(p2, { deviceId: 'D1', mapId: 2, at: 7000 })
  check(echo.length === 3 && echo[2]?.deviceId === 'D1', 'return to D1 after other device')

  const back = echo
  const same = appendTrailPoint(p1, { deviceId: 'D1', mapId: 2, at: 5000 })
  check(same.length === 1, 'consecutive skip')

  let loop = appendTrailPoint([], { deviceId: 'Dev_9', mapId: 1, at: 1 })
  loop = appendTrailPoint(loop, { deviceId: 'Dev_2', mapId: 1, at: 2 })
  loop = appendTrailPoint(loop, { deviceId: 'Dev_7', mapId: 1, at: 3 })
  loop = appendTrailPoint(loop, { deviceId: 'Dev_9', mapId: 1, at: 4 })
  check(loop.length === 4 && loop[3]?.seq === 4 && loop[3]?.deviceId === 'Dev_9', '9→2→7→9 records return')
  const loopStops = resolveTrailStops(loop, 1, (id) =>
    id === 'Dev_9'
      ? { x: 10, y: 10, label: '9' }
      : id === 'Dev_2'
        ? { x: 30, y: 10, label: '2' }
        : id === 'Dev_7'
          ? { x: 30, y: 30, label: '7' }
          : null,
  )
  check(loopStops.length === 4, 'return visit is a second stop on same icon')
  check(buildTrailSegments(loopStops, 4).length === 3, 'line Dev_7 → Dev_9 is drawn')

  const mixed = [
    { deviceId: 'A', mapId: 1, at: 1, seq: 1 },
    { deviceId: 'B', mapId: 2, at: 2, seq: 2 },
    { deviceId: 'C', mapId: 1, at: 3, seq: 3 },
  ]
  const map1 = resolveTrailStops(mixed, 1, (id) =>
    id === 'A' ? { x: 10, y: 10, label: 'A' } : id === 'C' ? { x: 20, y: 20, label: 'C' } : null,
  )
  check(map1.length === 2 && map1[0].seq === 1 && map1[1].seq === 3, 'global seq on map')
  check(buildTrailSegments(map1, 3).length === 0, 'no skip line across other map')

  const sameMap = [
    { deviceId: 'A', mapId: 1, at: 1, seq: 1 },
    { deviceId: 'B', mapId: 1, at: 2, seq: 2 },
    { deviceId: 'C', mapId: 2, at: 3, seq: 3 },
  ]
  const floor1 = resolveTrailStops(sameMap, 1, (id) =>
    id === 'A' ? { x: 10, y: 10, label: 'A' } : id === 'B' ? { x: 20, y: 20, label: 'B' } : null,
  )
  const segs = buildTrailSegments(floor1, 3)
  check(segs.length === 1 && segs[0].animated === false, 'same-map consecutive, not last seq')
  const liveSegs = buildTrailSegments(floor1, 2)
  check(liveSegs.length === 1 && liveSegs[0].animated === true, 'last seq on this map animates')
  check(
    Math.hypot(liveSegs[0].x1 - 10, liveSegs[0].y1 - 10) > 2.5,
    'line starts outside source icon',
  )
  const tipNums = (liveSegs[0].arrowPoints.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))) as number[]
  check(tipNums.length >= 2, 'arrow has tip')
  check(Math.hypot(20 - tipNums[0], 20 - tipNums[1]) < 3.2, 'arrow tip just touches dest halo')
  check(Math.hypot(20 - liveSegs[0].x2, 20 - liveSegs[0].y2) > Math.hypot(20 - tipNums[0], 20 - tipNums[1]), 'dashed line stops before arrow tip')
  const floor2 = resolveTrailStops(sameMap, 2, (id) =>
    id === 'C' ? { x: 5, y: 5, label: 'C' } : null,
  )
  check(floor2.length === 1 && floor2[0].seq === 3, 'other map keeps global 3')

  check(
    isAlarmTrailActive({ points: back, recording: true, holdUntil: 0, hidden: false }),
    'recording visible',
  )
  check(
    !isAlarmTrailActive({ points: back, recording: false, holdUntil: 0, hidden: false }, 10),
    'expired hold hidden',
  )
  check(
    isAlarmTrailActive({ points: back, recording: false, holdUntil: 50, hidden: false }, 10),
    'hold visible',
  )
  check(
    !isAlarmTrailActive({ points: back, recording: true, holdUntil: 0, hidden: true }),
    'operator hide',
  )
  check(
    !isAlarmTrailActive({ points: p1, recording: true, holdUntil: 0, hidden: false }),
    'single point no trail',
  )

  return errors
}
