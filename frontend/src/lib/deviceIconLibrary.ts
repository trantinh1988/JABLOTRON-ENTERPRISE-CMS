import {
  mdiAccessPoint,
  mdiAlarmBell,
  mdiAlarmLight,
  mdiAlarmPanel,
  mdiCctv,
  mdiDialpad,
  mdiDoorClosed,
  mdiElectricSwitch,
  mdiFireAlert,
  mdiGlassFragile,
  mdiHarddisk,
  mdiHelpCircle,
  mdiLan,
  mdiLightningBolt,
  mdiMagnetOn,
  mdiMotionSensor,
  mdiNas,
  mdiRadar,
  mdiRouterNetwork,
  mdiSecurityNetwork,
  mdiServer,
  mdiSmokeDetectorVariant,
  mdiThermometer,
  mdiVideoWireless,
  mdiWalk,
  mdiWaterAlert,
  mdiWebcam,
  mdiWifi,
} from '@mdi/js'

export type DeviceIconCategory = 'alarm' | 'cctv' | 'network' | 'other'

export type DeviceIconDef = {
  key: string
  category: DeviceIconCategory
  /** SVG path 24×24 (Material Design Icons / Pictogrammers). */
  mdi: string
}

/**
 * Thư viện icon CMS — Material Design Icons (cùng bộ Home Assistant dùng).
 * Silhouette đặc, đúng thiết bị an ninh: PIR, đầu báo khói, CCTV, dialpad, tủ báo…
 */
export const DEVICE_ICON_LIBRARY: DeviceIconDef[] = [
  // Báo động / cảm biến
  { key: 'sensor', category: 'alarm', mdi: mdiRadar },
  { key: 'pir', category: 'alarm', mdi: mdiMotionSensor },
  { key: 'motion', category: 'alarm', mdi: mdiWalk },
  { key: 'door', category: 'alarm', mdi: mdiDoorClosed },
  { key: 'magnet', category: 'alarm', mdi: mdiMagnetOn },
  { key: 'smoke', category: 'alarm', mdi: mdiSmokeDetectorVariant },
  { key: 'glass', category: 'alarm', mdi: mdiGlassFragile },
  { key: 'siren', category: 'alarm', mdi: mdiAlarmBell },
  { key: 'panic', category: 'alarm', mdi: mdiAlarmLight },
  { key: 'flood', category: 'alarm', mdi: mdiWaterAlert },
  { key: 'heat', category: 'alarm', mdi: mdiFireAlert },
  { key: 'temp', category: 'alarm', mdi: mdiThermometer },
  { key: 'keypad', category: 'alarm', mdi: mdiDialpad },
  { key: 'panel', category: 'alarm', mdi: mdiAlarmPanel },
  // CCTV
  { key: 'camera', category: 'cctv', mdi: mdiCctv },
  { key: 'dome', category: 'cctv', mdi: mdiWebcam },
  { key: 'ptz', category: 'cctv', mdi: mdiVideoWireless },
  { key: 'nvr', category: 'cctv', mdi: mdiNas },
  { key: 'dvr', category: 'cctv', mdi: mdiHarddisk },
  // Network
  { key: 'router', category: 'network', mdi: mdiRouterNetwork },
  { key: 'switch', category: 'network', mdi: mdiLan },
  { key: 'wifi', category: 'network', mdi: mdiWifi },
  { key: 'ap', category: 'network', mdi: mdiAccessPoint },
  { key: 'server', category: 'network', mdi: mdiServer },
  { key: 'firewall', category: 'network', mdi: mdiSecurityNetwork },
  // Other
  { key: 'power', category: 'other', mdi: mdiLightningBolt },
  { key: 'relay', category: 'other', mdi: mdiElectricSwitch },
  { key: 'other', category: 'other', mdi: mdiHelpCircle },
]

export const DEVICE_ICON_BY_KEY: Record<string, DeviceIconDef> = Object.fromEntries(
  DEVICE_ICON_LIBRARY.map((d) => [d.key, d]),
)

export function resolveDeviceIconPath(key: string | null | undefined): string {
  const k = (key || '').trim()
  return DEVICE_ICON_BY_KEY[k]?.mdi ?? DEVICE_ICON_BY_KEY.other.mdi
}

export const DEVICE_ICON_CATEGORIES: DeviceIconCategory[] = [
  'alarm',
  'cctv',
  'network',
  'other',
]

export const DEFAULT_MAP_ICON_SIZE = 2.0
export const MIN_MAP_ICON_SIZE = 0.5
export const MAX_MAP_ICON_SIZE = 5.0

/** Icon hiệu lực: map_icon tùy chọn, không có thì dùng device_type. */
export function resolveDeviceIconKey(device: {
  map_icon?: string | null
  device_type?: string | null
}): string {
  const custom = (device.map_icon || '').trim()
  if (custom) return custom
  return (device.device_type || 'sensor').trim() || 'sensor'
}

export function clampMapIconSize(size: number | null | undefined): number {
  const n = typeof size === 'number' && Number.isFinite(size) ? size : DEFAULT_MAP_ICON_SIZE
  return Math.max(MIN_MAP_ICON_SIZE, Math.min(MAX_MAP_ICON_SIZE, n))
}

/** Màu marker — bão hòa cao, dễ phân biệt trên nền mặt bằng sáng/tối. */
export function mapStatusColor(status: string): string {
  switch (status) {
    case 'alarm':
      return '#ff2d2d'
    case 'tamper':
      return '#ff8a00'
    case 'loss':
      return '#b24bff'
    case 'fault':
      return '#ff2d7a'
    case 'open':
      return '#ffcc00'
    default:
      return '#12e86a'
  }
}

/** Vầng sáng / halo theo trạng thái (SVG fill). */
export function mapStatusGlow(status: string): string {
  switch (status) {
    case 'alarm':
      return 'rgba(255,45,45,0.45)'
    case 'tamper':
      return 'rgba(255,138,0,0.4)'
    case 'loss':
      return 'rgba(178,75,255,0.4)'
    case 'fault':
      return 'rgba(255,45,122,0.4)'
    case 'open':
      return 'rgba(255,204,0,0.4)'
    default:
      return 'rgba(18,232,106,0.35)'
  }
}

export function mapStatusShouldPulse(status: string): boolean {
  return status === 'alarm' || status === 'tamper' || status === 'loss' || status === 'fault'
}

/** Tất cả màu legend/status (đồng bộ UI). */
export const MAP_STATUS_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'ok', label: 'OK', color: mapStatusColor('ok') },
  { key: 'open', label: 'ACT', color: mapStatusColor('open') },
  { key: 'alarm', label: 'Alarm', color: mapStatusColor('alarm') },
  { key: 'tamper', label: 'TMP', color: mapStatusColor('tamper') },
  { key: 'loss', label: 'Loss', color: mapStatusColor('loss') },
  { key: 'fault', label: 'Fault', color: mapStatusColor('fault') },
]

/** Số địa chỉ thiết bị: device_num hoặc parse từ global_id (…_DEV_01 → 1). */
export function resolveDeviceAddressNum(device: {
  device_num?: number | null
  device_id?: string | null
  global_id?: string | null
}): number | null {
  if (device.device_num != null && Number.isFinite(device.device_num) && device.device_num >= 0) {
    return device.device_num
  }
  const fromGlobal = /_DEV_(\d+)$/i.exec(device.global_id || '')
  if (fromGlobal) return Number(fromGlobal[1])
  const fromId = /(?:^|_)(\d+)$/.exec((device.device_id || '').trim())
  if (fromId) return Number(fromId[1])
  return null
}

/**
 * Nhãn trên bản đồ: "1. Cửa 1" (ID + nhãn).
 * Không có nhãn → chỉ số ID; không parse được ID → dùng label hoặc device_id.
 */
export function formatMapDeviceCaption(device: {
  device_num?: number | null
  device_id?: string | null
  global_id?: string | null
  label?: string | null
}): string {
  const num = resolveDeviceAddressNum(device)
  const label = (device.label || '').trim()
  if (num != null && label) return `${num}. ${label}`
  if (num != null) return String(num)
  if (label) return label
  return (device.device_id || device.global_id || '—').trim() || '—'
}

/** Chế độ hiển thị marker trên bản đồ. */
export type MapMarkerLabelMode = 'id' | 'label' | 'id_label' | 'icon'

export const MAP_MARKER_LABEL_MODES: MapMarkerLabelMode[] = ['id', 'label', 'id_label', 'icon']

export const MAP_MARKER_LABEL_MODE_KEY = 'cms.mapMarkerLabelMode'

export function isMapMarkerLabelMode(value: unknown): value is MapMarkerLabelMode {
  return value === 'id' || value === 'label' || value === 'id_label' || value === 'icon'
}

/** Caption theo chế độ; `icon` → không hiện chữ (trả về ''). */
export function formatMapMarkerText(
  device: {
    device_num?: number | null
    device_id?: string | null
    global_id?: string | null
    label?: string | null
  },
  mode: MapMarkerLabelMode = 'id_label',
): string {
  if (mode === 'icon') return ''
  const num = resolveDeviceAddressNum(device)
  const label = (device.label || '').trim()
  if (mode === 'id') {
    if (num != null) return String(num)
    return (device.device_id || device.global_id || '—').trim() || '—'
  }
  if (mode === 'label') {
    if (label) return label
    if (num != null) return String(num)
    return (device.device_id || device.global_id || '—').trim() || '—'
  }
  return formatMapDeviceCaption(device)
}

/** Cách ảnh nền khớp khung bản đồ. */
export type MapBgFitMode = 'fit' | 'fill' | 'stretch' | 'manual'

/** Hộp ảnh trong toạ độ viewBox bản đồ (kéo cạnh / góc). */
export type MapBgRect = {
  x: number
  y: number
  width: number
  height: number
}

export type MapBgFitState = {
  mode: MapBgFitMode
  /** % phóng (legacy / seed) */
  scale: number
  /** Lệch ngang % khung (legacy / seed) */
  offsetX: number
  /** Lệch dọc % khung (legacy / seed) */
  offsetY: number
  /** Hộp tự do khi mode === 'manual' */
  rect: MapBgRect | null
}

export const MAP_BG_FIT_MODES: MapBgFitMode[] = ['fit', 'fill', 'stretch', 'manual']

export const DEFAULT_MAP_BG_FIT: MapBgFitState = {
  mode: 'fill',
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  rect: null,
}

export function mapBgFitStorageKey(mapId: number): string {
  return `cms.mapBgFit.${mapId}`
}

export function isMapBgFitMode(value: unknown): value is MapBgFitMode {
  return value === 'fit' || value === 'fill' || value === 'stretch' || value === 'manual'
}

function parseRect(raw: unknown): MapBgRect | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = typeof r.x === 'number' ? r.x : NaN
  const y = typeof r.y === 'number' ? r.y : NaN
  const width = typeof r.width === 'number' ? r.width : NaN
  const height = typeof r.height === 'number' ? r.height : NaN
  if (![x, y, width, height].every(Number.isFinite)) return null
  if (width < 0.5 || height < 0.5) return null
  return { x, y, width, height }
}

export function readMapBgFit(mapId: number): MapBgFitState {
  try {
    const raw = localStorage.getItem(mapBgFitStorageKey(mapId))
    if (!raw) return { ...DEFAULT_MAP_BG_FIT }
    const parsed = JSON.parse(raw) as Partial<MapBgFitState>
    return {
      mode: isMapBgFitMode(parsed.mode) ? parsed.mode : DEFAULT_MAP_BG_FIT.mode,
      scale: clampNum(parsed.scale, 50, 250, DEFAULT_MAP_BG_FIT.scale),
      offsetX: clampNum(parsed.offsetX, -50, 50, 0),
      offsetY: clampNum(parsed.offsetY, -50, 50, 0),
      rect: parseRect(parsed.rect),
    }
  } catch {
    return { ...DEFAULT_MAP_BG_FIT }
  }
}

export function writeMapBgFit(mapId: number, state: MapBgFitState): void {
  try {
    localStorage.setItem(mapBgFitStorageKey(mapId), JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export type MapBgImageLayout = {
  x: number
  y: number
  width: number
  height: number
  preserveAspectRatio: string
}

function layoutFromScaleOffset(
  mapW: number,
  mapH: number,
  fit: MapBgFitState,
  natural?: { w: number; h: number } | null,
): MapBgImageLayout {
  const scale = clampNum(fit.scale, 50, 250, 100) / 100
  const ox = (clampNum(fit.offsetX, -50, 50, 0) / 100) * mapW
  const oy = (clampNum(fit.offsetY, -50, 50, 0) / 100) * mapH

  if (natural && natural.w > 0 && natural.h > 0) {
    const imgAspect = natural.w / natural.h
    const mapAspect = mapW / mapH
    let baseW: number
    let baseH: number
    if (imgAspect > mapAspect) {
      baseW = mapW
      baseH = mapW / imgAspect
    } else {
      baseH = mapH
      baseW = mapH * imgAspect
    }
    const w = baseW * scale
    const h = baseH * scale
    return {
      x: (mapW - w) / 2 + ox,
      y: (mapH - h) / 2 + oy,
      width: w,
      height: h,
      preserveAspectRatio: 'none',
    }
  }

  const w = mapW * scale
  const h = mapH * scale
  return {
    x: (mapW - w) / 2 + ox,
    y: (mapH - h) / 2 + oy,
    width: w,
    height: h,
    preserveAspectRatio: 'none',
  }
}

/**
 * Tính vị trí ảnh nền trong viewBox bản đồ.
 * naturalW/H giúp seed chế độ manual.
 */
export function computeMapBgLayout(
  mapW: number,
  mapH: number,
  fit: MapBgFitState,
  natural?: { w: number; h: number } | null,
): MapBgImageLayout {
  if (fit.mode === 'stretch') {
    return { x: 0, y: 0, width: mapW, height: mapH, preserveAspectRatio: 'none' }
  }
  if (fit.mode === 'fit') {
    return { x: 0, y: 0, width: mapW, height: mapH, preserveAspectRatio: 'xMidYMid meet' }
  }
  if (fit.mode === 'fill') {
    return { x: 0, y: 0, width: mapW, height: mapH, preserveAspectRatio: 'xMidYMid slice' }
  }

  if (fit.rect) {
    return {
      x: fit.rect.x,
      y: fit.rect.y,
      width: fit.rect.width,
      height: fit.rect.height,
      preserveAspectRatio: 'none',
    }
  }

  return layoutFromScaleOffset(mapW, mapH, fit, natural)
}

/** Lấy / tạo hộp ảnh để kéo resize. */
export function resolveMapBgRect(
  mapW: number,
  mapH: number,
  fit: MapBgFitState,
  natural?: { w: number; h: number } | null,
): MapBgRect {
  if (fit.mode === 'manual' && fit.rect) return { ...fit.rect }
  if (fit.mode === 'stretch') return { x: 0, y: 0, width: mapW, height: mapH }

  const seeded = layoutFromScaleOffset(
    mapW,
    mapH,
    {
      mode: 'manual',
      scale: fit.mode === 'manual' ? fit.scale : 100,
      offsetX: fit.mode === 'manual' ? fit.offsetX : 0,
      offsetY: fit.mode === 'manual' ? fit.offsetY : 0,
      rect: null,
    },
    natural,
  )
  return { x: seeded.x, y: seeded.y, width: seeded.width, height: seeded.height }
}

export type MapBgHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'move'

export function resizeMapBgRect(
  start: MapBgRect,
  handle: MapBgHandle,
  dx: number,
  dy: number,
  minSize = 8,
): MapBgRect {
  let { x, y, width, height } = start

  switch (handle) {
    case 'move':
      x += dx
      y += dy
      break
    case 'e':
      width += dx
      break
    case 'w':
      x += dx
      width -= dx
      break
    case 's':
      height += dy
      break
    case 'n':
      y += dy
      height -= dy
      break
    case 'se':
      width += dx
      height += dy
      break
    case 'sw':
      x += dx
      width -= dx
      height += dy
      break
    case 'ne':
      width += dx
      y += dy
      height -= dy
      break
    case 'nw':
      x += dx
      y += dy
      width -= dx
      height -= dy
      break
  }

  if (width < minSize) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') x = start.x + start.width - minSize
    width = minSize
  }
  if (height < minSize) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') y = start.y + start.height - minSize
    height = minSize
  }

  return { x, y, width, height }
}

/** Khung viewBox theo tỉ lệ ảnh (giữ cạnh dài ≈ 100). */
export function mapSizeFromImageAspect(naturalW: number, naturalH: number): { width: number; height: number } {
  if (!(naturalW > 0 && naturalH > 0)) return { width: 100, height: 70 }
  const aspect = naturalW / naturalH
  if (aspect >= 1) {
    return { width: 100, height: Number((100 / aspect).toFixed(2)) }
  }
  return { width: Number((100 * aspect).toFixed(2)), height: 100 }
}

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.max(min, Math.min(max, v))
}
