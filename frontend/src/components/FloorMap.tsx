import { useMemo } from 'react'
import { DeviceMapGlyph } from './DeviceTypeIcon'
import type { Device, Panel } from '../api/client'
import {
  clampMapIconSize,
  formatMapDeviceCaption,
  mapStatusColor,
  mapStatusGlow,
  mapStatusShouldPulse,
  MAP_STATUS_LEGEND,
  resolveDeviceIconKey,
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

  const alarmCount = visible.filter(
    (d) => effectiveDeviceStatus(d.state, d.disable) === 'alarm',
  ).length
  const openCount = visible.filter(
    (d) => effectiveDeviceStatus(d.state, d.disable) === 'open',
  ).length

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
            const status = effectiveDeviceStatus(d.state, d.disable)
            const color = mapStatusColor(status)
            const glow = mapStatusGlow(status)
            const pulse = mapStatusShouldPulse(status)
            const isAlarm = status === 'alarm'
            const icon = resolveDeviceIconKey(d)
            const size = clampMapIconSize(d.map_icon_size)
            const ringR = size * 1.14
            const strokeW = Math.max(0.22, size * 0.28)
            const pulseMax = isAlarm ? size * 3.6 : size * 2.2
            return (
              <g key={d.global_id} transform={`translate(${clamp(d.x, 4, 96)} ${clamp(d.y, 6, 64)})`}>
                <circle r={size * 1.52} fill="#ffffff" opacity={0.88} />
                <circle r={size * 1.34} fill={glow} />
                {pulse && (
                  <>
                    <circle r={size * 1.2} fill={color} opacity={isAlarm ? 0.4 : 0.28}>
                      <animate
                        attributeName="r"
                        values={`${size};${pulseMax};${size}`}
                        dur={isAlarm ? '0.75s' : '1.2s'}
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values={isAlarm ? '0.55;0.04;0.55' : '0.4;0.05;0.4'}
                        dur={isAlarm ? '0.75s' : '1.2s'}
                        repeatCount="indefinite"
                      />
                    </circle>
                    {isAlarm && (
                      <circle r={size * 1.5} fill="none" stroke={color} strokeWidth={strokeW}>
                        <animate
                          attributeName="r"
                          values={`${size * 1.4};${size * 4};${size * 1.4}`}
                          dur="1.05s"
                          repeatCount="indefinite"
                        />
                        <animate attributeName="opacity" values="0.9;0;0.9" dur="1.05s" repeatCount="indefinite" />
                      </circle>
                    )}
                  </>
                )}
                <circle r={ringR * 0.92} fill="#0b1220" opacity={0.35} />
                <circle r={ringR} fill="none" stroke={color} strokeWidth={strokeW} />
                <DeviceMapGlyph icon={icon} color={color} size={size} />
                <MapReactionChip reaction={d.reaction} size={size} />
                <circle cx={size * 0.75} cy={size * 0.75} r={size * 0.38 + strokeW * 0.35} fill="#ffffff" />
                <circle cx={size * 0.75} cy={size * 0.75} r={size * 0.38} fill={color} />
                <text
                  y={size + Math.max(1.5, size * 0.9)}
                  textAnchor="middle"
                  fill="#ffffff"
                  style={{
                    fontSize: Math.max(1.05, size * 0.62),
                    fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
                    fontWeight: 700,
                    paintOrder: 'stroke',
                  }}
                  stroke="#0a0f16"
                  strokeWidth={Math.max(0.35, size * 0.2)}
                >
                  {formatMapDeviceCaption(d)}
                </text>
                <title>
                  {formatMapDeviceCaption(d)} · {d.global_id} ·{' '}
                  {labelOf(deviceIconLabel, icon) || labelOf(deviceTypeLabel, d.device_type)}
                  {d.model ? ` · ${d.model}` : ''}
                  {d.link === 'rf' ? ' · RF' : d.link === 'bus' ? ' · Bus' : ''} ·{' '}
                  {labelOf(deviceStateLabel, status)}
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
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2.5 rounded-md bg-panel/90 px-2.5 py-1.5 font-mono text-[10px] text-steel/80 ring-1 ring-line">
      {MAP_STATUS_LEGEND.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full ring-1 ring-white/80"
            style={{ background: item.color, boxShadow: `0 0 6px ${item.color}` }}
          />
          <span className="font-semibold text-ink/90">{item.label}</span>
        </span>
      ))}
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}
