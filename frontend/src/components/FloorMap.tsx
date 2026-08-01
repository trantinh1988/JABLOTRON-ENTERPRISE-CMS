import { useMemo } from 'react'
import { DeviceMapGlyph } from './DeviceTypeIcon'
import type { Device, Panel } from '../api/client'
import { deviceStateLabel, deviceTypeLabel, labelOf, vi } from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  focusPanelId: string | null
}

const MAP_W = 100
const MAP_H = 70

export function FloorMapView({ panels, devices, focusPanelId }: Props) {
  const visible = useMemo(() => {
    const list = focusPanelId
      ? devices.filter((d) => d.panel_id === focusPanelId)
      : devices
    return list.map((d, idx) => {
      const x = d.map_x ?? 8 + ((idx * 13) % 84)
      const y = d.map_y ?? 10 + Math.floor(idx / 6) * 18
      return { ...d, x, y }
    })
  }, [devices, focusPanelId])

  const alarmCount = visible.filter((d) => d.state === 'alarm').length
  const openCount = visible.filter((d) => d.state === 'open').length

  return (
    <section className="panel-card flex min-h-[420px] flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{vi.mapTitle}</h2>
          <p className="font-mono text-[11px] text-steel/55">
            {focusPanelId ?? vi.allPanels} · {visible.length} {vi.sensors} · {panels.length}{' '}
            {vi.panels}
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

      <div className="relative flex-1 map-grid bg-[linear-gradient(160deg,#121a24_0%,#0f161f_100%)] p-4">
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={vi.floorAria}
        >
          <rect
            x="2"
            y="2"
            width={MAP_W - 4}
            height={MAP_H - 4}
            rx="1.2"
            fill="rgba(20,28,39,0.7)"
            stroke="rgba(157,176,194,0.25)"
            strokeWidth="0.35"
          />
          <text
            x="4"
            y="7"
            fill="rgba(157,176,194,0.45)"
            style={{ fontSize: 2.4, fontFamily: 'IBM Plex Mono' }}
          >
            {vi.floorLabel}
          </text>

          {visible.map((d) => {
            const color =
              d.state === 'alarm' ? '#ef5350' : d.state === 'open' ? '#e3a227' : '#3dcb7a'
            const pulse = d.state === 'alarm'
            return (
              <g key={d.global_id} transform={`translate(${clamp(d.x, 4, 96)} ${clamp(d.y, 6, 64)})`}>
                {pulse && (
                  <circle r="3.2" fill={color} opacity="0.2">
                    <animate attributeName="r" values="2.2;4.2;2.2" dur="1.4s" repeatCount="indefinite" />
                    <animate
                      attributeName="opacity"
                      values="0.35;0.05;0.35"
                      dur="1.4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                <DeviceMapGlyph type={d.device_type} color={color} size={1.9} />
                <text
                  y="3.6"
                  textAnchor="middle"
                  fill="rgba(232,238,244,0.85)"
                  style={{ fontSize: 1.7, fontFamily: 'IBM Plex Mono' }}
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

        <Legend />
      </div>
    </section>
  )
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded-md bg-panel/90 px-2.5 py-1.5 font-mono text-[10px] text-steel/80 ring-1 ring-line">
      <span className="inline-flex items-center gap-1">
        <i className="size-2 rounded-full bg-ok" /> {vi.legendOk}
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="size-2 rounded-full bg-warn" /> {vi.legendOpen}
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="size-2 rounded-full bg-danger" /> {vi.legendAlarm}
      </span>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
