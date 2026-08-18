import { resolveDeviceIconPath } from '../lib/deviceIconLibrary'

type Props = {
  type: string
  className?: string
  title?: string
}

/** Icon MDI theo loại thiết bị — dùng trong bảng / form. */
export function DeviceTypeIcon({ type, className = 'size-4', title }: Props) {
  const d = resolveDeviceIconPath(type)
  return (
    <span title={title} className="inline-flex">
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="currentColor"
        aria-hidden={title ? undefined : true}
      >
        <path d={d} />
      </svg>
    </span>
  )
}

/** Marker SVG trên bản đồ (đơn vị viewBox ~1–5) — cùng silhouette với picker. */
export function DeviceMapGlyph({
  type,
  icon,
  color,
  size = 2.2,
}: {
  /** @deprecated Prefer `icon` — kept for callers still passing device_type. */
  type?: string
  icon?: string
  color: string
  size?: number
}) {
  const path = resolveDeviceIconPath(icon || type || 'sensor')
  const s = size
  const outline = '#ffffff'
  const stroke = 'rgba(10,15,22,0.72)'
  const sw = Math.max(0.1, Math.min(0.22, s * 0.09))
  const ow = Math.max(0.16, sw + 0.12)
  const scale = (s * 2) / 24

  return (
    <g transform={`translate(${-s},${-s}) scale(${scale})`}>
      <path
        d={path}
        fill={color}
        stroke={outline}
        strokeWidth={ow / scale}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={sw / scale}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  )
}
