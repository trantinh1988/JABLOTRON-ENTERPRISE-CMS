import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Map as MapIcon } from 'lucide-react'
import type { Device, FloorMap, Panel } from '../api/client'
import { InteractiveFloorMap } from './InteractiveFloorMap'
import { readMapBgFit, type MapMarkerLabelMode } from '../lib/deviceIconLibrary'
import type { AlarmTrailPoint } from '../lib/alarmTrail'
import { effectiveDeviceStatus, vi } from '../i18n/vi'

type StatusCounts = {
  alarm: number
  tamper: number
  loss: number
  fault: number
  open: number
}

function countStatuses(devices: Device[]): StatusCounts {
  const counts: StatusCounts = { alarm: 0, tamper: 0, loss: 0, fault: 0, open: 0 }
  for (const d of devices) {
    const st = effectiveDeviceStatus(d.state, d.disable)
    if (st === 'alarm') counts.alarm += 1
    else if (st === 'tamper') counts.tamper += 1
    else if (st === 'loss') counts.loss += 1
    else if (st === 'fault') counts.fault += 1
    else if (st === 'open') counts.open += 1
  }
  return counts
}

type Props = {
  maps: FloorMap[]
  map: FloorMap | null
  devices: Device[]
  panels: Panel[]
  selectedId: string | null
  labelMode: MapMarkerLabelMode
  liveFlashIds?: Set<string>
  trailPoints?: AlarmTrailPoint[]
  canTrailSnap?: boolean
  trailSnapBusy?: boolean
  onTrailSnap?: (blob: Blob) => void | Promise<void>
  onTrailSnapError?: (message: string) => void
  alarmFocus: boolean
  onAssign: (mapId: number | null) => void
  onSelectDevice: (globalId: string | null) => void
  onExpand: () => void
}

export const MapTile = memo(function MapTile({
  maps,
  map,
  devices,
  panels,
  selectedId,
  labelMode,
  liveFlashIds,
  trailPoints,
  canTrailSnap = false,
  trailSnapBusy = false,
  onTrailSnap,
  onTrailSnapError,
  alarmFocus,
  onAssign,
  onSelectDevice,
  onExpand,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const bgFit = useMemo(() => (map ? readMapBgFit(map.id) : null), [map])
  const counts = useMemo(() => countStatuses(devices), [devices])
  const hasAlarm = counts.alarm > 0
  const trouble = counts.tamper + counts.loss + counts.fault

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <article
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-fog/40 ring-1 transition ${
        hasAlarm || alarmFocus
          ? 'map-tile-alarm ring-danger/80'
          : 'ring-line/70 hover:ring-accent/35'
      }`}
      onDoubleClick={(e) => {
        if (!map) return
        const t = e.target as HTMLElement
        if (t.closest('[data-map-tile-chrome]')) return
        onExpand()
      }}
    >
      <header
        data-map-tile-chrome
        className="flex shrink-0 items-center gap-1 border-b border-line/70 bg-panel/70 px-1.5 py-1"
      >
        <div ref={menuRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold text-ink hover:bg-mist/80"
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            title={vi.mapGridPickMap}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MapIcon className="size-3 shrink-0 text-steel/70" />
            <span className="min-w-0 flex-1 truncate">{map?.name ?? vi.mapGridSlotEmpty}</span>
            <ChevronDown className={`size-3 shrink-0 text-steel/60 transition ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {menuOpen && (
            <div
              role="listbox"
              className="absolute top-[calc(100%+2px)] left-0 z-50 max-h-56 min-w-[12rem] overflow-auto rounded-md bg-panel py-1 shadow-lg ring-1 ring-line"
            >
              <button
                type="button"
                role="option"
                className="flex w-full px-2.5 py-1.5 text-left text-[11px] text-steel hover:bg-fog hover:text-ink"
                onClick={() => {
                  onAssign(null)
                  setMenuOpen(false)
                }}
              >
                {vi.mapGridSlotNone}
              </button>
              {maps.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={map?.id === m.id}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] font-medium ${
                    map?.id === m.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-ink hover:bg-fog'
                  }`}
                  onClick={() => {
                    onAssign(m.id)
                    setMenuOpen(false)
                  }}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-steel/50">{m.device_count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {map && (
          <div className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] font-semibold">
            {hasAlarm && (
              <span className="rounded px-1 py-px text-danger" title={vi.alarm}>
                {counts.alarm} {vi.alarm}
              </span>
            )}
            {trouble > 0 && (
              <span className="rounded px-1 py-px text-[#f97316]" title={vi.mapGridTrouble}>
                {trouble}
              </span>
            )}
            {counts.open > 0 && (
              <span className="rounded px-1 py-px text-warn" title="ACT">
                {counts.open} ACT
              </span>
            )}
            {!hasAlarm && !trouble && !counts.open && (
              <span className="px-1 py-px text-ok/80">OK</span>
            )}
          </div>
        )}

        {map && (
          <button
            type="button"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-steel hover:bg-mist hover:text-ink"
            title={vi.mapGridExpand}
            onClick={onExpand}
          >
            <Maximize2 className="size-3" />
          </button>
        )}
      </header>

      <div className="relative h-full min-h-0 flex-1">
        {map ? (
          <InteractiveFloorMap
            map={map}
            devices={devices}
            panels={panels}
            editable={false}
            selectedId={selectedId}
            hideChrome
            embedded
            compactPulse
            hideLegend
            labelMode={labelMode}
            bgFit={bgFit ?? undefined}
            onSelect={onSelectDevice}
            liveFlashIds={liveFlashIds}
            trailPoints={trailPoints}
            onTrailSnap={canTrailSnap ? onTrailSnap : undefined}
            onTrailSnapError={onTrailSnapError}
            trailSnapBusy={trailSnapBusy}
          />
        ) : (
          <button
            type="button"
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-mist/30 text-steel/50 hover:bg-mist/50 hover:text-steel"
            onClick={() => setMenuOpen(true)}
          >
            <MapIcon className="size-6" />
            <span className="text-[11px] font-medium">{vi.mapGridSlotEmpty}</span>
          </button>
        )}
      </div>
    </article>
  )
})
