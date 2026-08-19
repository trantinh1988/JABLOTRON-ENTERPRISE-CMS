/** Bố cục lưới bản đồ kiểu multi-camera (NVR). */

export const MAP_GRID_LAYOUTS = [1, 2, 4, 6, 9] as const
export type MapGridLayout = (typeof MAP_GRID_LAYOUTS)[number]

export const MAP_GRID_STATE_KEY = 'cms.mapGridLayout'

export type MapGridState = {
  layout: MapGridLayout
  slots: (number | null)[]
}

export function isMapGridLayout(value: unknown): value is MapGridLayout {
  return value === 1 || value === 2 || value === 4 || value === 6 || value === 9
}

export function layoutCols(layout: MapGridLayout): number {
  if (layout === 1) return 1
  if (layout === 2 || layout === 4) return 2
  return 3
}

export function layoutRows(layout: MapGridLayout): number {
  if (layout === 1 || layout === 2) return 1
  if (layout === 4 || layout === 6) return 2
  return 3
}

export function readMapGridState(): MapGridState {
  try {
    const raw = localStorage.getItem(MAP_GRID_STATE_KEY)
    if (!raw) return { layout: 1, slots: [] }
    const parsed = JSON.parse(raw) as Partial<MapGridState>
    const layout = isMapGridLayout(parsed.layout) ? parsed.layout : 1
    const slots = Array.isArray(parsed.slots)
      ? parsed.slots.map((id) => (typeof id === 'number' && Number.isFinite(id) ? id : null))
      : []
    return { layout, slots }
  } catch {
    return { layout: 1, slots: [] }
  }
}

export function writeMapGridState(state: MapGridState): void {
  try {
    localStorage.setItem(MAP_GRID_STATE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function validMapIds(maps: { id: number }[]): number[] {
  return maps.map((m) => m.id)
}

/** Gán mặc định: preferId vào ô 1, phần còn lại theo thứ tự khai báo. */
export function filledSlotIds(slots: (number | null)[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const id of slots) {
    if (id == null || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Số cột/hàng theo số ô đang có bản đồ — không chừa ô xám trống. */
export function autoGridSize(count: number): { cols: number; rows: number } {
  const n = Math.max(1, count)
  if (n === 1) return { cols: 1, rows: 1 }
  if (n === 2) return { cols: 2, rows: 1 }
  if (n <= 4) return { cols: 2, rows: 2 }
  if (n <= 6) return { cols: 3, rows: 2 }
  return { cols: 3, rows: 3 }
}

export function minLayoutForCount(count: number): MapGridLayout {
  if (count <= 1) return 1
  if (count <= 2) return 2
  if (count <= 4) return 4
  if (count <= 6) return 6
  return 9
}

export function defaultSlots(
  layout: MapGridLayout,
  maps: { id: number }[],
  preferId?: number | null,
): (number | null)[] {
  const ids = validMapIds(maps)
  const ordered =
    preferId != null && ids.includes(preferId)
      ? [preferId, ...ids.filter((id) => id !== preferId)]
      : ids
  const next: (number | null)[] = ordered.slice(0, layout)
  while (next.length < layout) next.push(null)
  return next
}

/**
 * Đổi số ô: giữ slot cũ (kể cả ô trống), ô mới tự điền map chưa dùng.
 * Bỏ id không còn tồn tại / trùng.
 */
export function resizeSlots(
  layout: MapGridLayout,
  maps: { id: number }[],
  current: (number | null)[],
): (number | null)[] {
  const valid = new Set(validMapIds(maps))
  const used = new Set<number>()
  const next: (number | null)[] = []

  for (let i = 0; i < current.length && next.length < layout; i++) {
    const id = current[i]
    if (id != null && valid.has(id) && !used.has(id)) {
      next.push(id)
      used.add(id)
    }
  }

  while (next.length < layout) {
    const unused = maps.find((m) => !used.has(m.id))
    if (unused) {
      next.push(unused.id)
      used.add(unused.id)
    } else {
      next.push(null)
    }
  }
  return next
}

export function addMapToSlots(
  slots: (number | null)[],
  mapId: number,
  max: MapGridLayout,
): (number | null)[] {
  const filled = filledSlotIds(slots)
  if (filled.includes(mapId) || filled.length >= max) return filled
  return [...filled, mapId]
}

export function removeSlotAt(slots: (number | null)[], index: number): (number | null)[] {
  const next = slots.slice()
  if (index < 0 || index >= next.length) return filledSlotIds(next)
  next.splice(index, 1)
  return filledSlotIds(next)
}

/** Gán map vào ô. Nếu map đang ở ô khác → đổi chỗ (kiểu NVR). `null` = để trống. */
export function assignSlot(
  slots: (number | null)[],
  index: number,
  mapId: number | null,
): (number | null)[] {
  if (index < 0 || index >= slots.length) return slots
  const next = slots.slice()
  if (mapId == null) {
    next[index] = null
    return next
  }
  const other = next.findIndex((id, i) => i !== index && id === mapId)
  const prev = next[index]
  next[index] = mapId
  if (other >= 0) next[other] = prev ?? null
  return next
}

/** Đảm bảo map nằm trong lưới — nếu chưa có thì đưa vào ô đầu (đổi chỗ). */
export function ensureMapInSlots(slots: (number | null)[], mapId: number): (number | null)[] {
  if (slots.includes(mapId)) return slots
  if (!slots.length) return [mapId]
  return assignSlot(slots, 0, mapId)
}
