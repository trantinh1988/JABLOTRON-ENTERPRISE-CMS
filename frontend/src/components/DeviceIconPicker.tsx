import { useState } from 'react'
import {
  DEVICE_ICON_CATEGORIES,
  DEVICE_ICON_LIBRARY,
  DEFAULT_MAP_ICON_SIZE,
  MAX_MAP_ICON_SIZE,
  MIN_MAP_ICON_SIZE,
  type DeviceIconCategory,
} from '../lib/deviceIconLibrary'
import { deviceIconCategoryLabel, deviceIconLabel, vi } from '../i18n/vi'

type Props = {
  value: string
  size: number
  onChange: (icon: string) => void
  onSizeChange: (size: number) => void
  /** Hidden inputs for native form submit */
  nameIcon?: string
  nameSize?: string
  compact?: boolean
}

export function DeviceIconPicker({
  value,
  size,
  onChange,
  onSizeChange,
  nameIcon = 'map_icon',
  nameSize = 'map_icon_size',
  compact = false,
}: Props) {
  const [category, setCategory] = useState<DeviceIconCategory>(() => {
    const found = DEVICE_ICON_LIBRARY.find((i) => i.key === value)
    return found?.category ?? 'alarm'
  })

  const icons = DEVICE_ICON_LIBRARY.filter((i) => i.category === category)

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3 sm:col-span-2 lg:col-span-4'}>
      <input type="hidden" name={nameIcon} value={value} />
      <input type="hidden" name={nameSize} value={String(size)} />

      <div>
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-steel uppercase">
          {vi.mapIcon}
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {DEVICE_ICON_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition ${
                category === cat
                  ? 'bg-accent text-panel ring-accent'
                  : 'bg-mist text-steel ring-line hover:bg-line/40'
              }`}
            >
              {deviceIconCategoryLabel[cat]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-7">
          {icons.map((item) => {
            const active = value === item.key
            return (
              <button
                key={item.key}
                type="button"
                title={deviceIconLabel[item.key] ?? item.key}
                onClick={() => onChange(item.key)}
                className={`flex flex-col items-center gap-1 rounded-md px-1.5 py-2 text-[10px] ring-1 transition ${
                  active
                    ? 'bg-accent/15 text-accent ring-accent/50'
                    : 'bg-fog/60 text-steel ring-transparent hover:ring-line'
                }`}
              >
                <svg viewBox="0 0 24 24" className="size-6 shrink-0" fill="currentColor" aria-hidden>
                  <path d={item.mdi} />
                </svg>
                <span className="max-w-full truncate">{deviceIconLabel[item.key] ?? item.key}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="font-medium tracking-wide text-steel uppercase">{vi.mapIconSize}</span>
          <span className="font-mono text-accent">{size.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={MIN_MAP_ICON_SIZE}
          max={MAX_MAP_ICON_SIZE}
          step={0.5}
          value={size}
          onChange={(e) => onSizeChange(Number(e.target.value) || DEFAULT_MAP_ICON_SIZE)}
          className="w-full accent-[var(--color-accent,#3b82f6)]"
        />
        <div className="mt-0.5 flex justify-between font-mono text-[10px] text-steel/45">
          <span>{MIN_MAP_ICON_SIZE}</span>
          <span>{MAX_MAP_ICON_SIZE}</span>
        </div>
      </div>
    </div>
  )
}
