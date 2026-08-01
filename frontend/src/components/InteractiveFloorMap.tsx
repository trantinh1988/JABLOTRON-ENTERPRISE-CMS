import { useCallback, useRef, useState } from 'react'
import { DeviceMapGlyph } from './DeviceTypeIcon'
import type { Device, FloorMap, Panel } from '../api/client'
import { deviceStateLabel, deviceTypeLabel, labelOf, vi } from '../i18n/vi'

type Props = {
  map: FloorMap
  devices: Device[]
  panels: Panel[]
  editable?: boolean
  onPlace?: (x: number, y: number) => void
  onMove?: (globalId: string, x: number, y: number) => void
}

export function InteractiveFloorMap({
  map,
  devices,
  panels,
  editable = false,
  onPlace,
  onMove,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)

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

  const alarmCount = devices.filter((d) => d.state === 'alarm').length
  const openCount = devices.filter((d) => d.state === 'open').length

  return (
    <section className="panel-card flex min-h-[480px] flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{map.name}</h2>
          <p className="font-mono text-[11px] text-steel/55">
            {devices.length} {vi.sensors} · {panels.length} {vi.panels}
          </p>
        </div>
        <div className="flex gap-3 font-mono text-[11px]">
          <span className="text-danger">
            {alarmCount} {vi.alarm}
          </span>
          <span className="text-warn">
            {openCount} {vi.open}
          </span>
        </div>
      </div>

      <div className="relative flex-1 map-grid bg-[linear-gradient(160deg,#121a24_0%,#0f161f_100%)] p-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${map.width} ${map.height}`}
          className={`h-full w-full overflow-visible ${editable ? 'cursor-crosshair' : ''}`}
          role="img"
          aria-label={vi.floorAria}
          onClick={(e) => {
            if (!editable || !onPlace || dragging) return
            const coords = toMapCoords(e.clientX, e.clientY)
            if (coords) onPlace(coords.x, coords.y)
          }}
        >
          {map.background_url && (
            <image
              href={map.background_url}
              x={0}
              y={0}
              width={map.width}
              height={map.height}
              opacity={0.45}
              preserveAspectRatio="xMidYMid slice"
            />
          )}
          <rect
            x="1"
            y="1"
            width={map.width - 2}
            height={map.height - 2}
            rx="1.2"
            fill="rgba(20,28,39,0.55)"
            stroke="rgba(157,176,194,0.25)"
            strokeWidth="0.35"
          />
          <text
            x="3"
            y="6"
            fill="rgba(157,176,194,0.45)"
            style={{ fontSize: 2.4, fontFamily: 'IBM Plex Mono' }}
          >
            {vi.floorLabel}
          </text>

          {devices.map((d) => {
            const x = d.map_x ?? map.width / 2
            const y = d.map_y ?? map.height / 2
            const color =
              d.state === 'alarm' ? '#ef5350' : d.state === 'open' ? '#e3a227' : '#3dcb7a'
            return (
              <g
                key={d.global_id}
                transform={`translate(${x} ${y})`}
                style={{ cursor: editable ? 'grab' : 'default' }}
                onPointerDown={(e) => {
                  if (!editable || !onMove) return
                  e.stopPropagation()
                  ;(e.target as Element).setPointerCapture?.(e.pointerId)
                  setDragging(d.global_id)
                }}
                onPointerMove={(e) => {
                  if (dragging !== d.global_id) return
                  e.stopPropagation()
                }}
                onPointerUp={(e) => {
                  if (dragging !== d.global_id || !onMove) return
                  e.stopPropagation()
                  const coords = toMapCoords(e.clientX, e.clientY)
                  setDragging(null)
                  if (coords) onMove(d.global_id, coords.x, coords.y)
                }}
              >
                {d.state === 'alarm' && (
                  <circle r="3.2" fill={color} opacity="0.2">
                    <animate attributeName="r" values="2.2;4.2;2.2" dur="1.4s" repeatCount="indefinite" />
                  </circle>
                )}
                <DeviceMapGlyph type={d.device_type} color={color} size={2.1} />
                <text
                  y="4"
                  textAnchor="middle"
                  fill="rgba(232,238,244,0.9)"
                  style={{ fontSize: 1.8, fontFamily: 'IBM Plex Mono' }}
                >
                  {d.device_id}
                </text>
                <title>
                  {d.global_id} · {d.label} · {labelOf(deviceTypeLabel, d.device_type)} ·{' '}
                  {labelOf(deviceStateLabel, d.state)}
                </title>
              </g>
            )
          })}
        </svg>
      </div>
    </section>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
