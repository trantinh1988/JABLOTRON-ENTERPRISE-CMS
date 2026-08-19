/** Khung nhìn pan/zoom trên bản đồ. zoom = 1 phủ toàn bộ mặt bằng. */

export type MapViewport = {
  zoom: number
  cx: number
  cy: number
}

export const MIN_MAP_ZOOM = 1
export const MAX_MAP_ZOOM = 8

export function defaultViewport(mapW: number, mapH: number): MapViewport {
  return { zoom: 1, cx: mapW / 2, cy: mapH / 2 }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM)
}

export type MapViewBox = { x: number; y: number; w: number; h: number }

export function viewBoxFromViewport(
  mapW: number,
  mapH: number,
  vp: MapViewport,
): MapViewBox {
  const zoom = clampZoom(vp.zoom)
  const w = mapW / zoom
  const h = mapH / zoom
  const x = clamp(vp.cx - w / 2, 0, Math.max(0, mapW - w))
  const y = clamp(vp.cy - h / 2, 0, Math.max(0, mapH - h))
  return { x, y, w, h }
}

export function zoomViewportAt(
  vp: MapViewport,
  mapW: number,
  mapH: number,
  svgX: number,
  svgY: number,
  factor: number,
): MapViewport {
  const before = viewBoxFromViewport(mapW, mapH, vp)
  const zoom = clampZoom(vp.zoom * factor)
  if (zoom === vp.zoom) return vp
  const w = mapW / zoom
  const h = mapH / zoom
  const rx = before.w <= 0 ? 0.5 : (svgX - before.x) / before.w
  const ry = before.h <= 0 ? 0.5 : (svgY - before.y) / before.h
  const x = clamp(svgX - rx * w, 0, Math.max(0, mapW - w))
  const y = clamp(svgY - ry * h, 0, Math.max(0, mapH - h))
  return { zoom, cx: x + w / 2, cy: y + h / 2 }
}

export function panViewport(
  vp: MapViewport,
  mapW: number,
  mapH: number,
  dx: number,
  dy: number,
): MapViewport {
  const box = viewBoxFromViewport(mapW, mapH, vp)
  const x = clamp(box.x + dx, 0, Math.max(0, mapW - box.w))
  const y = clamp(box.y + dy, 0, Math.max(0, mapH - box.h))
  return { zoom: vp.zoom, cx: x + box.w / 2, cy: y + box.h / 2 }
}

export function zoomToBounds(
  mapW: number,
  mapH: number,
  xs: number[],
  ys: number[],
  padding = 1.35,
): MapViewport {
  if (!xs.length || !ys.length) return defaultViewport(mapW, mapH)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const bw = Math.max(maxX - minX, mapW / MAX_MAP_ZOOM)
  const bh = Math.max(maxY - minY, mapH / MAX_MAP_ZOOM)
  const zoom = clampZoom(Math.min(mapW / (bw * padding), mapH / (bh * padding)))
  return { zoom, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

export function formatZoomPct(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`
}
