import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  BrickWall,
  CircleHelp,
  CloudFog,
  DoorOpen,
  Keyboard,
  Radio,
  ScanEye,
} from 'lucide-react'

/** Icon Lucide theo loại cảm biến Jablotron — dùng trong bảng / form. */
export const deviceTypeIcons: Record<string, LucideIcon> = {
  sensor: Radio,
  pir: ScanEye,
  door: DoorOpen,
  smoke: CloudFog,
  glass: BrickWall,
  siren: Bell,
  keypad: Keyboard,
  other: CircleHelp,
}

type Props = {
  type: string
  className?: string
  title?: string
}

export function DeviceTypeIcon({ type, className = 'size-4', title }: Props) {
  const Icon = deviceTypeIcons[type] ?? CircleHelp
  return (
    <span title={title} className="inline-flex">
      <Icon className={className} aria-hidden={title ? undefined : true} />
    </span>
  )
}

/** Marker SVG nhỏ trên bản đồ (đơn vị viewBox ~2–3). */
export function DeviceMapGlyph({
  type,
  color,
  size = 2.2,
}: {
  type: string
  color: string
  size?: number
}) {
  const s = size
  const stroke = '#0f161f'
  const sw = 0.35

  switch (type) {
    case 'door':
      return (
        <g>
          <rect
            x={-s * 0.55}
            y={-s * 0.7}
            width={s * 1.1}
            height={s * 1.4}
            rx={0.15}
            fill={color}
            stroke={stroke}
            strokeWidth={sw}
          />
          <circle cx={s * 0.25} cy={0} r={0.22} fill={stroke} />
        </g>
      )
    case 'pir':
      return (
        <g>
          <circle r={s * 0.85} fill={color} stroke={stroke} strokeWidth={sw} />
          <ellipse cx={0} cy={0} rx={s * 0.45} ry={s * 0.28} fill={stroke} opacity={0.55} />
          <circle r={0.22} fill={color} />
        </g>
      )
    case 'smoke':
      return (
        <g>
          <circle r={s * 0.75} fill={color} stroke={stroke} strokeWidth={sw} />
          <path
            d={`M ${-s * 0.45} 0 Q ${-s * 0.2} ${-s * 0.55} 0 ${-s * 0.15} Q ${s * 0.2} ${-s * 0.55} ${s * 0.45} 0`}
            fill="none"
            stroke={stroke}
            strokeWidth={0.28}
            opacity={0.7}
          />
        </g>
      )
    case 'glass':
      return (
        <polygon
          points={`0,${-s} ${s},0 0,${s} ${-s},0`}
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        />
      )
    case 'siren':
      return (
        <g>
          <path
            d={`M 0 ${-s} L ${s * 0.7} ${s * 0.55} L ${-s * 0.7} ${s * 0.55} Z`}
            fill={color}
            stroke={stroke}
            strokeWidth={sw}
          />
          <rect x={-s * 0.25} y={s * 0.45} width={s * 0.5} height={s * 0.35} fill={color} stroke={stroke} strokeWidth={sw} />
        </g>
      )
    case 'keypad':
      return (
        <g>
          <rect
            x={-s * 0.7}
            y={-s * 0.7}
            width={s * 1.4}
            height={s * 1.4}
            rx={0.2}
            fill={color}
            stroke={stroke}
            strokeWidth={sw}
          />
          <circle cx={-s * 0.28} cy={-s * 0.28} r={0.15} fill={stroke} />
          <circle cx={s * 0.28} cy={-s * 0.28} r={0.15} fill={stroke} />
          <circle cx={-s * 0.28} cy={s * 0.28} r={0.15} fill={stroke} />
          <circle cx={s * 0.28} cy={s * 0.28} r={0.15} fill={stroke} />
        </g>
      )
    default:
      return <circle r={s * 0.85} fill={color} stroke={stroke} strokeWidth={sw} />
  }
}
