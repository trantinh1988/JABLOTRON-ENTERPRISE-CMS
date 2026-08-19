import { Lock, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import type { MapBgFitMode } from '../lib/deviceIconLibrary'
import { MAP_BG_FIT_MODES } from '../lib/deviceIconLibrary'
import { formatZoomPct } from '../lib/mapViewport'
import { vi } from '../i18n/vi'

const FIT_LABEL: Record<MapBgFitMode, string> = {
  fit: vi.mapBgFitFit,
  fill: vi.mapBgFitFill,
  stretch: vi.mapBgFitStretch,
  manual: vi.mapBgFitManual,
}

type Props = {
  bgMode: MapBgFitMode
  onBgModeChange?: (mode: MapBgFitMode) => void
  showBgFit: boolean
  allowManualFit: boolean
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  locked: boolean
  onLockedChange: (locked: boolean) => void
}

export function MapCanvasOverlay({
  bgMode,
  onBgModeChange,
  showBgFit,
  allowManualFit,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  locked,
  onLockedChange,
}: Props) {
  const fitModes = allowManualFit
    ? MAP_BG_FIT_MODES
    : MAP_BG_FIT_MODES.filter((m) => m !== 'manual')

  return (
    <div
      className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-panel/90 p-0.5 shadow-lg ring-1 ring-line/80 backdrop-blur-md"
      role="toolbar"
      aria-label={vi.mapCanvasTools}
    >
      {showBgFit && onBgModeChange && (
        <>
          <div className="flex items-center gap-px" role="group" aria-label={vi.mapBgFit}>
            {fitModes.map((mode) => (
              <button
                key={mode}
                type="button"
                title={mode === 'manual' ? vi.mapBgFitHint : FIT_LABEL[mode]}
                onClick={() => onBgModeChange(mode)}
                className={`h-7 rounded-md px-1.5 text-[10px] font-semibold transition ${
                  bgMode === mode
                    ? 'bg-accent text-panel'
                    : 'text-steel hover:bg-mist/80 hover:text-ink'
                }`}
              >
                {FIT_LABEL[mode]}
              </button>
            ))}
          </div>
          <span className="mx-0.5 h-4 w-px bg-line/80" aria-hidden />
        </>
      )}

      <div className="flex items-center" role="group" aria-label={vi.mapViewZoom}>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-steel hover:bg-mist/80 hover:text-ink"
          title={vi.mapViewZoomOut}
          onClick={onZoomOut}
        >
          <ZoomOut className="size-3.5" />
        </button>
        <button
          type="button"
          className="h-7 min-w-[2.6rem] rounded-md px-1 font-mono text-[10px] font-semibold text-ink/90 hover:bg-mist/80"
          title={vi.mapViewZoomReset}
          onClick={onZoomReset}
        >
          {formatZoomPct(zoom)}
        </button>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-steel hover:bg-mist/80 hover:text-ink"
          title={vi.mapViewZoomIn}
          onClick={onZoomIn}
        >
          <ZoomIn className="size-3.5" />
        </button>
      </div>

      <span className="mx-0.5 h-4 w-px bg-line/80" aria-hidden />

      <button
        type="button"
        className={`inline-flex size-7 items-center justify-center rounded-md transition ${
          locked
            ? 'bg-accent/15 text-accent'
            : 'text-steel hover:bg-mist/80 hover:text-ink'
        }`}
        title={locked ? vi.mapViewUnlock : vi.mapViewLock}
        aria-pressed={locked}
        onClick={() => onLockedChange(!locked)}
      >
        {locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
      </button>
    </div>
  )
}
