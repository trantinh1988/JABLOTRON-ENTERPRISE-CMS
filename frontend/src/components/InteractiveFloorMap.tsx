import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Camera, ImageOff, Loader2, Route, X } from 'lucide-react'
import { DeviceMapGlyph } from './DeviceTypeIcon'
import type { Device, FloorMap, Panel } from '../api/client'
import {
  clampMapIconSize,
  computeMapBgLayout,
  formatMapDeviceCaption,
  formatMapMarkerText,
  isMapMarkerLabelMode,
  MAP_MARKER_LABEL_MODE_KEY,
  MAP_MARKER_LABEL_MODES,
  mapStatusColor,
  mapStatusGlow,
  mapStatusShouldPulse,
  MAP_STATUS_LEGEND,
  resizeMapBgRect,
  resolveDeviceIconKey,
  resolveMapBgRect,
  type MapBgFitState,
  type MapBgHandle,
  type MapBgRect,
  type MapMarkerLabelMode,
} from '../lib/deviceIconLibrary'
import {
  deviceIconLabel,
  deviceStateLabel,
  deviceTypeLabel,
  effectiveDeviceStatus,
  labelOf,
  vi,
} from '../i18n/vi'
import { MapReactionChip } from './ReactionBadge'
import { reactionChipLabel, reactionShowsMapChip } from '../lib/deviceReaction'
import {
  buildTrailSegments,
  formatTrailClock,
  resolveTrailStops,
  type AlarmTrailPoint,
} from '../lib/alarmTrail'
import { captureSvgJpeg } from '../lib/mapCapture'

type Props = {
  map: FloorMap
  devices: Device[]
  panels: Panel[]
  editable?: boolean
  placing?: boolean
  selectedId?: string | null
  /** Ẩn thanh tiêu đề map (dùng khi trang cha đã có toolbar). */
  hideChrome?: boolean
  /** Ô lưới: bỏ khung panel-card, legend, overlay trống. */
  embedded?: boolean
  /** Chỉ pulse alarm/tamper — nhẹ hơn khi render nhiều map. */
  compactPulse?: boolean
  hideLegend?: boolean
  labelMode?: MapMarkerLabelMode
  bgFit?: MapBgFitState
  onLabelModeChange?: (mode: MapMarkerLabelMode) => void
  onBgFitChange?: (next: MapBgFitState) => void
  onSelect?: (globalId: string | null) => void
  onPlace?: (x: number, y: number) => void
  onMove?: (globalId: string, x: number, y: number) => void
  /** Device IDs vừa đổi trạng thái — nháy trên map. */
  liveFlashIds?: Set<string>
  /** Điểm truy vết phiên báo động — vẽ dưới marker, không chặn kéo/click. */
  trailPoints?: AlarmTrailPoint[]
  onHideTrail?: () => void
  onClearTrail?: () => void
  onTrailSnap?: (blob: Blob) => void | Promise<void>
  onTrailSnapError?: (message: string) => void
  trailSnapBusy?: boolean
}

type DragState = {
  id: string
  x: number
  y: number
  pointerId: number
}

type BgResizeDrag = {
  handle: MapBgHandle
  pointerId: number
  startClient: { x: number; y: number }
  startRect: MapBgRect
}

const BG_HANDLES: { id: MapBgHandle; cursor: string }[] = [
  { id: 'nw', cursor: 'nwse-resize' },
  { id: 'n', cursor: 'ns-resize' },
  { id: 'ne', cursor: 'nesw-resize' },
  { id: 'e', cursor: 'ew-resize' },
  { id: 'se', cursor: 'nwse-resize' },
  { id: 's', cursor: 'ns-resize' },
  { id: 'sw', cursor: 'nesw-resize' },
  { id: 'w', cursor: 'ew-resize' },
]

const MODE_LABEL: Record<MapMarkerLabelMode, string> = {
  id: vi.mapLabelModeId,
  label: vi.mapLabelModeLabel,
  id_label: vi.mapLabelModeIdLabel,
  icon: vi.mapLabelModeIcon,
}

function readStoredLabelMode(): MapMarkerLabelMode {
  try {
    const raw = localStorage.getItem(MAP_MARKER_LABEL_MODE_KEY)
    if (isMapMarkerLabelMode(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'id_label'
}

export function InteractiveFloorMap({
  map,
  devices,
  panels,
  editable = false,
  placing = false,
  selectedId = null,
  hideChrome = false,
  embedded = false,
  compactPulse = false,
  hideLegend = false,
  labelMode: labelModeProp,
  bgFit,
  onLabelModeChange,
  onBgFitChange,
  onSelect,
  onPlace,
  onMove,
  liveFlashIds,
  trailPoints,
  onHideTrail,
  onClearTrail,
  onTrailSnap,
  onTrailSnapError,
  trailSnapBusy = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const bgResizeRef = useRef<BgResizeDrag | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; y: number }>>({})
  const [localLabelMode, setLocalLabelMode] = useState<MapMarkerLabelMode>(readStoredLabelMode)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [liveBgRect, setLiveBgRect] = useState<MapBgRect | null>(null)
  const [localSnapBusy, setLocalSnapBusy] = useState(false)
  const movedRef = useRef(false)

  const labelMode = labelModeProp ?? localLabelMode
  const showCaption = labelMode !== 'icon'
  const fitState: MapBgFitState = bgFit ?? {
    mode: 'fill',
    scale: 100,
    offsetX: 0,
    offsetY: 0,
    rect: null,
  }

  useEffect(() => {
    const url = map.background_url
    if (!url) {
      setNaturalSize(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      }
    }
    img.onerror = () => {
      if (!cancelled) setNaturalSize(null)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [map.background_url])

  function setLabelMode(mode: MapMarkerLabelMode) {
    setLocalLabelMode(mode)
    try {
      localStorage.setItem(MAP_MARKER_LABEL_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
    onLabelModeChange?.(mode)
  }

  useEffect(() => {
    setPosOverride((prev) => {
      let changed = false
      const next = { ...prev }
      for (const d of devices) {
        const o = next[d.global_id]
        if (!o) continue
        if (
          d.map_x != null &&
          d.map_y != null &&
          Math.abs(d.map_x - o.x) < 0.05 &&
          Math.abs(d.map_y - o.y) < 0.05
        ) {
          delete next[d.global_id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [devices])

  const toMapCoords = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return null
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      const local = pt.matrixTransform(ctm.inverse())
      return {
        x: clamp(local.x, 2, map.width - 2),
        y: clamp(local.y, 2, map.height - 2),
      }
    },
    [map.width, map.height],
  )

  const clientToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const local = pt.matrixTransform(ctm.inverse())
    return { x: local.x, y: local.y }
  }, [])

  const commitBgRect = useCallback(
    (rect: MapBgRect) => {
      onBgFitChange?.({
        ...fitState,
        mode: 'manual',
        rect: { ...rect },
      })
    },
    [fitState, onBgFitChange],
  )

  const beginBgResize = useCallback(
    (handle: MapBgHandle, e: ReactPointerEvent) => {
      if (!editable || !onBgFitChange || placing) return
      e.stopPropagation()
      e.preventDefault()
      const seed = resolveMapBgRect(map.width, map.height, fitState, naturalSize)
      bgResizeRef.current = {
        handle,
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startRect: seed,
      }
      setLiveBgRect(seed)
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    },
    [editable, onBgFitChange, placing, map.width, map.height, fitState, naturalSize],
  )

  useEffect(() => {
    const onMoveWin = (e: PointerEvent) => {
      const bg = bgResizeRef.current
      if (bg && e.pointerId === bg.pointerId) {
        const start = clientToSvg(bg.startClient.x, bg.startClient.y)
        const cur = clientToSvg(e.clientX, e.clientY)
        if (!start || !cur) return
        const next = resizeMapBgRect(bg.startRect, bg.handle, cur.x - start.x, cur.y - start.y)
        setLiveBgRect(next)
        return
      }

      const deviceDrag = dragRef.current
      if (!deviceDrag || e.pointerId !== deviceDrag.pointerId) return
      const coords = toMapCoords(e.clientX, e.clientY)
      if (!coords) return
      movedRef.current = true
      const next = { ...deviceDrag, x: coords.x, y: coords.y }
      dragRef.current = next
      setDrag(next)
    }

    const onUpWin = (e: PointerEvent) => {
      const bg = bgResizeRef.current
      if (bg && e.pointerId === bg.pointerId) {
        const start = clientToSvg(bg.startClient.x, bg.startClient.y)
        const cur = clientToSvg(e.clientX, e.clientY)
        const rect =
          start && cur
            ? resizeMapBgRect(bg.startRect, bg.handle, cur.x - start.x, cur.y - start.y)
            : bg.startRect
        bgResizeRef.current = null
        setLiveBgRect(null)
        commitBgRect(rect)
        return
      }

      const deviceDrag = dragRef.current
      if (!deviceDrag || e.pointerId !== deviceDrag.pointerId) return
      const coords = toMapCoords(e.clientX, e.clientY)
      dragRef.current = null
      setDrag(null)
      if (coords && movedRef.current) {
        setPosOverride((prev) => ({ ...prev, [deviceDrag.id]: { x: coords.x, y: coords.y } }))
        onMove?.(deviceDrag.id, coords.x, coords.y)
      }
      movedRef.current = false
    }

    window.addEventListener('pointermove', onMoveWin)
    window.addEventListener('pointerup', onUpWin)
    window.addEventListener('pointercancel', onUpWin)
    return () => {
      window.removeEventListener('pointermove', onMoveWin)
      window.removeEventListener('pointerup', onUpWin)
      window.removeEventListener('pointercancel', onUpWin)
    }
  }, [toMapCoords, clientToSvg, onMove, commitBgRect])

  const alarmCount = hideChrome
    ? 0
    : devices.filter((d) => effectiveDeviceStatus(d.state, d.disable) === 'alarm').length
  const troubleCount = hideChrome
    ? 0
    : devices.filter((d) => {
        const st = effectiveDeviceStatus(d.state, d.disable)
        return st === 'tamper' || st === 'loss' || st === 'fault'
      }).length
  const openCount = hideChrome
    ? 0
    : devices.filter((d) => effectiveDeviceStatus(d.state, d.disable) === 'open').length
  const okCount = hideChrome ? 0 : devices.length - alarmCount - troubleCount - openCount

  const hasBg = Boolean(map.background_url)
  const baseBgLayout = hasBg
    ? computeMapBgLayout(map.width, map.height, fitState, naturalSize)
    : null
  const bgLayout =
    hasBg && liveBgRect
      ? { x: liveBgRect.x, y: liveBgRect.y, width: liveBgRect.width, height: liveBgRect.height, preserveAspectRatio: 'none' as const }
      : baseBgLayout
  const showBgHandles = Boolean(
    editable && hasBg && bgLayout && onBgFitChange && !placing && fitState.mode === 'manual',
  )
  // Giãn / Tay: viewBox phủ kín panel để kéo giãn ảnh tới mép workspace.
  // Vừa / Phủ: giữ tỉ lệ viewBox (meet) — không cắt nội dung khi đổi fullscreen.
  const svgPreserveAspect =
    fitState.mode === 'stretch' || fitState.mode === 'manual' ? 'none' : 'xMidYMid meet'
  const handleSize = Math.max(1.4, Math.min(map.width, map.height) * 0.028)
  const hideFooterLegend = hideLegend || embedded
  const deviceById = useMemo(() => new Map(devices.map((d) => [d.global_id, d])), [devices])
  const trailStops = useMemo(() => {
    if (editable || !trailPoints?.length) return []
    return resolveTrailStops(trailPoints, map.id, (deviceId) => {
      const d = deviceById.get(deviceId)
      if (!d) return null
      const live = drag?.id === deviceId
      const override = posOverride[deviceId]
      const x = live && drag ? drag.x : (override?.x ?? d.map_x)
      const y = live && drag ? drag.y : (override?.y ?? d.map_y)
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null
      const size = clampMapIconSize(d.map_icon_size)
      return { x, y, label: formatMapDeviceCaption(d), r: size * 1.52 }
    })
  }, [editable, trailPoints, map.id, deviceById, drag, posOverride])
  const lastTrailSeq = trailPoints?.[trailPoints.length - 1]?.seq ?? 0
  const trailSegs = useMemo(
    () => buildTrailSegments(trailStops, lastTrailSeq, { compact: compactPulse }),
    [trailStops, lastTrailSeq, compactPulse],
  )
  const trailByDevice = useMemo(() => {
    const m = new Map<string, (typeof trailStops)[number]>()
    for (const stop of trailStops) m.set(stop.deviceId, stop)
    return m
  }, [trailStops])
  const trailCompact = compactPulse
  const showTrail = trailCompact ? trailSegs.length > 0 : trailStops.length > 0
  const snapBusy = trailSnapBusy || localSnapBusy
  const showTrailChrome = trailStops.length > 0 && Boolean(onHideTrail || onClearTrail || onTrailSnap)

  const captureTrail = async () => {
    if (!svgRef.current || !onTrailSnap || snapBusy) return
    setLocalSnapBusy(true)
    try {
      const blob = await captureSvgJpeg(svgRef.current)
      await onTrailSnap(blob)
    } catch (err) {
      onTrailSnapError?.(err instanceof Error ? err.message : vi.alarmTrailSnapFail)
    } finally {
      setLocalSnapBusy(false)
    }
  }
  const trailStroke = trailCompact ? 0.32 : 0.52
  const trailDash = `${trailStroke * 2.6} ${trailStroke * 1.7}`
  return (
    <section
      className={
        embedded
          ? 'flex h-full min-h-0 flex-col overflow-hidden'
          : 'panel-card flex h-full min-h-0 flex-1 flex-col overflow-hidden'
      }
    >
      {!hideChrome && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 sm:px-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{map.name}</h2>
            <p className="font-mono text-[11px] text-steel/55">
              {devices.length} {vi.sensors} · {panels.length} {vi.panels}
              {editable && (
                <span className="ml-2 text-steel/40">· {placing ? vi.placeModeHint : vi.dragHint}</span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className="inline-flex items-center rounded-lg bg-mist/80 p-0.5 ring-1 ring-line/70"
              role="group"
              aria-label={vi.mapLabelModeHint}
              title={vi.mapLabelModeHint}
            >
              <span className="hidden px-1.5 font-mono text-[10px] text-steel/55 sm:inline">
                {vi.mapLabelMode}
              </span>
              {MAP_MARKER_LABEL_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLabelMode(mode)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                    labelMode === mode
                      ? 'bg-accent text-panel shadow-sm'
                      : 'text-steel hover:bg-fog/80 hover:text-ink'
                  }`}
                >
                  {MODE_LABEL[mode]}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 font-mono text-[10px] sm:gap-2 sm:text-[11px]">
              <StatChip tone="ok" label={`OK ${Math.max(0, okCount)}`} />
              <StatChip tone="warn" label={`ACT ${openCount}`} />
              <StatChip tone="danger" label={`${vi.alarm} ${alarmCount}`} />
              {troubleCount > 0 && <StatChip tone="trouble" label={`Sự cố ${troubleCount}`} />}
            </div>
          </div>
        </div>
      )}

      <div
        className={`relative min-h-0 flex-1 overflow-hidden ${
          hasBg ? 'bg-[#0b1017]' : 'map-grid bg-[linear-gradient(160deg,#121a24_0%,#0f161f_100%)]'
        } ${placing ? 'cursor-crosshair' : ''}`}
      >
        {!hasBg && !embedded && (
          <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
            <div className="flex max-w-xs flex-col items-center gap-2 rounded-xl bg-panel/70 px-4 py-3 text-center ring-1 ring-line/60 backdrop-blur-sm">
              <ImageOff className="size-5 text-steel/50" />
              <p className="text-xs text-steel/70">{vi.mapEmptyBg}</p>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${map.width} ${map.height}`}
          preserveAspectRatio={svgPreserveAspect}
          className="absolute inset-0 h-full w-full touch-none select-none"
          role="img"
          aria-label={vi.floorAria}
          onClick={(e) => {
            if (!editable || !onPlace || !placing || dragRef.current) return
            const coords = toMapCoords(e.clientX, e.clientY)
            if (coords) onPlace(coords.x, coords.y)
          }}
        >
          {hasBg && bgLayout && (
            <image
              href={map.background_url!}
              x={bgLayout.x}
              y={bgLayout.y}
              width={bgLayout.width}
              height={bgLayout.height}
              preserveAspectRatio={bgLayout.preserveAspectRatio}
              opacity={1}
            />
          )}
          {showBgHandles && bgLayout && (
            <g className="map-bg-handles">
              <rect
                x={bgLayout.x}
                y={bgLayout.y}
                width={bgLayout.width}
                height={bgLayout.height}
                fill="rgba(96,165,250,0.06)"
                stroke="rgba(96,165,250,0.85)"
                strokeWidth={0.35}
                strokeDasharray="1.2 0.7"
                style={{ cursor: 'move' }}
                onPointerDown={(e) => beginBgResize('move', e)}
              />
              {BG_HANDLES.map((h) => {
                const cx =
                  h.id.includes('w')
                    ? bgLayout.x
                    : h.id.includes('e')
                      ? bgLayout.x + bgLayout.width
                      : bgLayout.x + bgLayout.width / 2
                const cy =
                  h.id.includes('n')
                    ? bgLayout.y
                    : h.id.includes('s')
                      ? bgLayout.y + bgLayout.height
                      : bgLayout.y + bgLayout.height / 2
                const isCorner = h.id.length === 2
                const hw = isCorner ? handleSize : h.id === 'n' || h.id === 's' ? handleSize * 1.6 : handleSize
                const hh = isCorner ? handleSize : h.id === 'e' || h.id === 'w' ? handleSize * 1.6 : handleSize
                return (
                  <rect
                    key={h.id}
                    x={cx - hw / 2}
                    y={cy - hh / 2}
                    width={hw}
                    height={hh}
                    rx={isCorner ? 0.25 : 0.2}
                    fill="#60a5fa"
                    stroke="#0b1220"
                    strokeWidth={0.2}
                    style={{ cursor: h.cursor }}
                    onPointerDown={(e) => beginBgResize(h.id, e)}
                  />
                )
              })}
            </g>
          )}
          {!hasBg && (
            <rect
              x="1"
              y="1"
              width={map.width - 2}
              height={map.height - 2}
              rx="1.2"
              fill="rgba(20,28,39,0.55)"
              stroke="rgba(157,176,194,0.22)"
              strokeWidth="0.35"
            />
          )}

          {devices.map((d) => {
            const live = drag?.id === d.global_id
            const override = posOverride[d.global_id]
            const x = live ? drag.x : (override?.x ?? d.map_x ?? map.width / 2)
            const y = live ? drag.y : (override?.y ?? d.map_y ?? map.height / 2)
            const status = effectiveDeviceStatus(d.state, d.disable)
            const color = mapStatusColor(status)
            const glow = mapStatusGlow(status)
            const pulse = compactPulse
              ? status === 'alarm' || status === 'tamper'
              : mapStatusShouldPulse(status)
            const isAlarm = status === 'alarm'
            const icon = resolveDeviceIconKey(d)
            const size = clampMapIconSize(d.map_icon_size)
            const selected = selectedId === d.global_id
            const flashing = liveFlashIds?.has(d.global_id) ?? false
            const statusText = labelOf(deviceStateLabel, status)
            const caption = formatMapMarkerText(d, labelMode)
            const fullCaption = formatMapDeviceCaption(d)
            // Toàn bộ vòng tròn / chấm status tỉ lệ theo size icon
            const ringR = size * 1.14
            const haloR = size * 1.52
            const glowR = size * 1.34
            const strokeW = Math.max(0.22, size * 0.28)
            const dotR = size * 0.38
            const dotX = size * 0.75
            const dotY = size * 0.75
            const pulseMax = isAlarm ? size * 3.6 : size * 2.35
            const pulseMin = isAlarm ? size * 1.35 : size * 1.1
            const trailStop = trailCompact ? undefined : trailByDevice.get(d.global_id)
            const trailBadgeR = size * 0.5

            return (
              <g
                key={d.global_id}
                transform={`translate(${x} ${y})`}
                style={{
                  cursor: editable ? (live ? 'grabbing' : 'grab') : 'pointer',
                  transition: live ? 'none' : 'transform 80ms linear',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect?.(d.global_id)
                  if (!editable || !onMove || placing) return
                  e.preventDefault()
                  movedRef.current = false
                  const coords = toMapCoords(e.clientX, e.clientY)
                  const next: DragState = {
                    id: d.global_id,
                    x: coords?.x ?? x,
                    y: coords?.y ?? y,
                    pointerId: e.pointerId,
                  }
                  dragRef.current = next
                  setDrag(next)
                  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
                }}
              >
                {/* Halo trắng giúp nổi trên mặt bằng sáng */}
                <circle r={haloR} fill="#ffffff" opacity={0.88} />
                <circle r={glowR} fill={glow} />
                {selected && (
                  <circle
                    r={size * 1.72}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={strokeW * 0.85}
                    strokeDasharray={`${size * 0.45} ${size * 0.28}`}
                  />
                )}
                {flashing && (
                  <circle r={size * 1.9} fill="none" stroke="#f8fafc" strokeWidth={strokeW * 0.85} opacity={0.95}>
                    <animate attributeName="opacity" values="1;0.2;1" dur="0.45s" repeatCount="3" />
                    <animate
                      attributeName="r"
                      values={`${size * 1.4};${size * 2.2};${size * 1.4}`}
                      dur="0.45s"
                      repeatCount="3"
                    />
                  </circle>
                )}
                {pulse && (
                  <>
                    <circle r={pulseMin} fill={color} opacity={isAlarm ? 0.4 : 0.28}>
                      <animate
                        attributeName="r"
                        values={`${pulseMin};${pulseMax};${pulseMin}`}
                        dur={isAlarm ? '0.75s' : '1.25s'}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values={isAlarm ? '0.55;0.04;0.55' : '0.45;0.05;0.45'}
                        dur={isAlarm ? '0.75s' : '1.25s'}
                        repeatCount="indefinite"
                      />
                    </circle>
                    {isAlarm && (
                      <circle
                        r={size * 1.6}
                        fill="none"
                        stroke={color}
                        strokeWidth={strokeW}
                        opacity={0.85}
                      >
                        <animate
                          attributeName="r"
                          values={`${size * 1.5};${size * 4.2};${size * 1.5}`}
                          dur="1.05s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.9;0;0.9"
                          dur="1.05s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                  </>
                )}
                {/* Nền icon mỏng + viền màu status dày để đọc trạng thái */}
                <circle r={ringR * 0.92} fill="#0b1220" opacity={0.35} />
                <circle r={ringR} fill="none" stroke={color} strokeWidth={strokeW} />
                {status === 'loss' && (
                  <circle
                    r={size * 1.3}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW * 0.65}
                    strokeDasharray={`${size * 0.35} ${size * 0.22}`}
                    opacity={0.95}
                  />
                )}
                <DeviceMapGlyph icon={icon} color={color} size={size} />
                <MapReactionChip reaction={d.reaction} size={size} />
                <circle cx={dotX} cy={dotY} r={dotR + strokeW * 0.35} fill="#ffffff" />
                <circle cx={dotX} cy={dotY} r={dotR} fill={color} />
                {trailStop && (
                  <g transform={`translate(0 ${-size * 1.48})`}>
                    <circle
                      r={trailBadgeR}
                      fill="#ef5350"
                      stroke="#0b1220"
                      strokeWidth={Math.max(0.12, trailBadgeR * 0.18)}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      style={{
                        fontSize: trailBadgeR * 1.2,
                        fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
                        fontWeight: 800,
                      }}
                    >
                      {trailStop.seq}
                    </text>
                  </g>
                )}
                {showCaption && caption && (
                  <text
                    y={size + Math.max(1.6, size * 0.95)}
                    textAnchor="middle"
                    fill="#ffffff"
                    style={{
                      fontSize: Math.max(1.05, size * 0.64),
                      fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
                      fontWeight: 700,
                      paintOrder: 'stroke',
                    }}
                    stroke="#0a0f16"
                    strokeWidth={Math.max(0.35, size * 0.22)}
                  >
                    {caption}
                  </text>
                )}
                <title>
                  {fullCaption} · {d.global_id} ·{' '}
                  {labelOf(deviceIconLabel, icon) || labelOf(deviceTypeLabel, d.device_type)}
                  {d.model ? ` · ${d.model}` : ''}
                  {d.link === 'rf' ? ' · RF' : d.link === 'bus' ? ' · Bus' : ''} ·{' '}
                  {statusText}
                  {trailStop ? ` · ${vi.alarmTrailStopTitle(trailStop.seq, fullCaption, formatTrailClock(trailStop.at))}` : ''}
                  {reactionShowsMapChip(d.reaction)
                    ? ` · ${reactionChipLabel(d.reaction)}`
                    : ''}
                </title>
              </g>
            )
          })}

          {showTrail && (
            <g className="alarm-trail" pointerEvents="none" aria-label={vi.alarmTrailAria}>
              {trailSegs.map((seg, i) => (
                <g key={`seg-${i}`} opacity={seg.opacity}>
                  <line
                    x1={seg.x1}
                    y1={seg.y1}
                    x2={seg.x2}
                    y2={seg.y2}
                    fill="none"
                    stroke="#ef5350"
                    strokeWidth={trailStroke}
                    strokeLinecap="butt"
                    strokeLinejoin="round"
                    strokeDasharray={trailDash}
                    className={seg.animated ? 'alarm-trail-flow' : undefined}
                  />
                  <polygon
                    points={seg.arrowPoints}
                    fill="#ef5350"
                    stroke="#7f1d1d"
                    strokeWidth={trailCompact ? 0.1 : 0.14}
                    strokeLinejoin="round"
                  />
                </g>
              ))}
            </g>
          )}
        </svg>

        {showTrailChrome && (
          <div className="pointer-events-none absolute top-2 left-2 z-[3] flex items-center gap-1">
            <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger ring-1 ring-danger/35 backdrop-blur-sm">
              {!embedded && (
                <>
                  <Route className="size-3 shrink-0" aria-hidden />
                  <span>{vi.alarmTrailChip(trailPoints?.length ?? trailStops.length)}</span>
                </>
              )}
              {onTrailSnap && (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-danger/90 hover:bg-danger/20 hover:text-danger disabled:opacity-50"
                  title={vi.alarmTrailSnap}
                  aria-label={vi.alarmTrailSnap}
                  disabled={snapBusy}
                  onClick={() => void captureTrail()}
                >
                  {snapBusy ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
                  {!embedded && <span>{vi.alarmTrailSnap}</span>}
                </button>
              )}
              {!embedded && onHideTrail && (
                <button
                  type="button"
                  className="rounded px-1 py-0.5 text-danger/80 hover:bg-danger/20 hover:text-danger"
                  title={vi.alarmTrailHide}
                  onClick={onHideTrail}
                >
                  {vi.alarmTrailHide}
                </button>
              )}
              {!embedded && onClearTrail && (
                <button
                  type="button"
                  className="rounded p-0.5 text-danger/80 hover:bg-danger/20 hover:text-danger"
                  title={vi.alarmTrailClear}
                  aria-label={vi.alarmTrailClear}
                  onClick={onClearTrail}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {!hideFooterLegend && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-[2] flex max-w-[min(100%,28rem)] flex-col gap-1 rounded-md bg-panel/92 px-2.5 py-1.5 font-mono text-[10px] text-steel/80 ring-1 ring-line backdrop-blur-sm">
            <div className="flex flex-wrap gap-2">
              {MAP_STATUS_LEGEND.map((item) => (
                <LegendDot key={item.key} color={item.color} label={item.label} />
              ))}
            </div>
            {devices.some((d) => reactionShowsMapChip(d.reaction)) && (
              <p className="text-[9px] leading-tight text-steel/65">{vi.mapReactionLegend}</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function StatChip({
  tone,
  label,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'trouble'
  label: string
}) {
  const styles = {
    ok: 'bg-ok/10 text-ok ring-ok/25',
    warn: 'bg-warn/10 text-warn ring-warn/25',
    danger: 'bg-danger/10 text-danger ring-danger/25',
    trouble: 'bg-[#f97316]/12 text-[#f97316] ring-[#f97316]/25',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 ring-1 ${styles}`}>{label}</span>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-2.5 rounded-full ring-1 ring-white/80"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="font-semibold text-ink/90">{label}</span>
    </span>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
