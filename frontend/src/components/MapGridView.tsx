import { useMemo } from 'react'
import type { Device, FloorMap, Panel } from '../api/client'
import { MapTile } from './MapTile'
import { assignSlot, layoutCols, layoutRows, type MapGridLayout } from '../lib/mapGridLayout'
import type { MapMarkerLabelMode } from '../lib/deviceIconLibrary'
import type { AlarmTrailPoint } from '../lib/alarmTrail'
import { vi } from '../i18n/vi'

type Props = {
  maps: FloorMap[]
  devices: Device[]
  panels: Panel[]
  layout: MapGridLayout
  slots: (number | null)[]
  selectedId: string | null
  labelMode: MapMarkerLabelMode
  liveFlashIds?: Set<string>
  trailPoints?: AlarmTrailPoint[]
  alarmMapId?: number | null
  canTrailSnap?: boolean
  trailSnapBusyMapId?: number | null
  onTrailSnap?: (mapId: number, blob: Blob) => void | Promise<void>
  onTrailSnapError?: (message: string) => void
  onSlotsChange?: (slots: (number | null)[]) => void
  assignable?: boolean
  onSelectDevice: (globalId: string | null) => void
  onExpandMap: (mapId: number) => void
}

export function MapGridView({
  maps,
  devices,
  panels,
  layout,
  slots,
  selectedId,
  labelMode,
  liveFlashIds,
  trailPoints,
  alarmMapId = null,
  canTrailSnap = false,
  trailSnapBusyMapId = null,
  onTrailSnap,
  onTrailSnapError,
  onSlotsChange,
  assignable = true,
  onSelectDevice,
  onExpandMap,
}: Props) {
  const cols = layoutCols(layout)
  const rows = layoutRows(layout)
  const byMap = useMemo(() => {
    const grouped = new Map<number, Device[]>()
    for (const d of devices) {
      if (d.map_id == null) continue
      const list = grouped.get(d.map_id)
      if (list) list.push(d)
      else grouped.set(d.map_id, [d])
    }
    return grouped
  }, [devices])

  const mapById = useMemo(() => new Map(maps.map((m) => [m.id, m])), [maps])
  const cells = useMemo(() => {
    const next: (number | null)[] = slots.slice(0, layout)
    while (next.length < layout) next.push(null)
    return next
  }, [slots, layout])

  return (
    <div
      className="map-wall grid h-full min-h-0 flex-1 gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
      role="group"
      aria-label={vi.mapGridLayoutHint}
    >
      {cells.map((mapId, index) => {
        const floor = mapId != null ? (mapById.get(mapId) ?? null) : null
        const tileDevices = floor ? (byMap.get(floor.id) ?? []) : []
        return (
          <MapTile
            key={`slot-${index}`}
            maps={maps}
            map={floor}
            devices={tileDevices}
            panels={panels}
            selectedId={selectedId}
            labelMode={labelMode}
            liveFlashIds={liveFlashIds}
            trailPoints={trailPoints}
            canTrailSnap={canTrailSnap}
            trailSnapBusy={floor != null && trailSnapBusyMapId === floor.id}
            onTrailSnap={onTrailSnap && floor ? (blob) => onTrailSnap(floor.id, blob) : undefined}
            onTrailSnapError={onTrailSnapError}
            alarmFocus={floor != null && alarmMapId === floor.id}
            onAssign={
              assignable && onSlotsChange
                ? (id) => onSlotsChange(assignSlot(cells, index, id))
                : undefined
            }
            onSelectDevice={onSelectDevice}
            onExpand={() => {
              if (floor) onExpandMap(floor.id)
            }}
          />
        )
      })}
    </div>
  )
}

/** Nút chọn 1 / 2 / 4 / 6 / 9 — glyph lưới nhỏ. */
export function MapLayoutPicker({
  layout,
  onChange,
  btnClass,
}: {
  layout: MapGridLayout
  onChange: (next: MapGridLayout) => void
  btnClass: (active: boolean) => string
}) {
  return (
    <div className="inline-flex items-center gap-0.5" role="group" aria-label={vi.mapGridLayoutHint}>
      {([1, 2, 4, 6, 9] as const).map((n) => {
        const active = layout === n
        return (
          <button
            key={n}
            type="button"
            title={vi.mapGridLayoutN(n)}
            aria-pressed={active}
            className={`${btnClass(active)} inline-flex h-7 min-w-7 items-center justify-center gap-1 px-1.5`}
            onClick={() => onChange(n)}
          >
            <LayoutGlyph n={n} active={active} />
            <span className="hidden tabular-nums sm:inline">{n}</span>
          </button>
        )
      })}
    </div>
  )
}

function LayoutGlyph({ n, active }: { n: 1 | 2 | 4 | 6 | 9; active: boolean }) {
  const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3
  const rows = n === 1 || n === 2 ? 1 : n === 9 ? 3 : 2
  const cell = active ? 'bg-panel' : 'bg-steel/55'
  return (
    <span
      className="grid shrink-0 gap-px"
      style={{
        width: 13,
        height: n === 2 ? 8 : 13,
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
      aria-hidden
    >
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`rounded-[1px] ${cell}`} />
      ))}
    </span>
  )
}
