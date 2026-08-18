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

  for (let i = 0; i < Math.min(layout, current.length); i++) {
    const id = current[i]
    if (id != null && valid.has(id) && !used.has(id)) {
      next.push(id)
      used.add(id)
    } else if (id == null) {
      next.push(null)
    } else {
      next.push(null)
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
  if (!slots.length) return slots
  if (slots.includes(mapId)) return slots
  return assignSlot(slots, 0, mapId)
}
