import { Field, inputClass } from './ui'
import { deviceReactionGroupLabel, deviceReactionLabel, labelOf, vi } from '../i18n/vi'
import {
  DEFAULT_DEVICE_REACTION,
  REACTION_GROUPS,
  normalizeReaction,
  reactionChipColor,
  reactionChipLabel,
  reactionShowsMapChip,
  type DeviceReaction,
} from '../lib/deviceReaction'

export function ReactionBadge({
  reaction,
  className = '',
}: {
  reaction?: string | null
  className?: string
}) {
  const key = normalizeReaction(reaction)
  const color = reactionChipColor(key)
  return (
    <span
      title={labelOf(deviceReactionLabel, key)}
      className={`inline-flex max-w-[6.5rem] shrink-0 items-center truncate rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none ${className}`}
      style={{
        color,
        background: `${color}18`,
        boxShadow: `inset 0 0 0 1px ${color}40`,
      }}
    >
      {reactionChipLabel(key)}
    </span>
  )
}

export function ReactionSelect({
  value,
  onChange,
  name = 'reaction',
}: {
  value: string
  onChange: (next: DeviceReaction) => void
  name?: string
}) {
  const current = normalizeReaction(value || DEFAULT_DEVICE_REACTION)
  return (
    <Field label={vi.reaction}>
      <select
        name={name}
        className={inputClass}
        value={current}
        onChange={(e) => onChange(normalizeReaction(e.target.value))}
      >
        {REACTION_GROUPS.map((group) => (
          <optgroup key={group.id} label={labelOf(deviceReactionGroupLabel, group.id)}>
            {group.keys.map((key) => (
              <option key={key} value={key}>
                {labelOf(deviceReactionLabel, key)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
  )
}

/** Chip Reaction trên marker SVG — chỉ hiện khi không phải Instant mặc định. */
export function MapReactionChip({
  reaction,
  size,
}: {
  reaction?: string | null
  size: number
}) {
  if (!reactionShowsMapChip(reaction)) return null
  const label = reactionChipLabel(reaction)
  const color = reactionChipColor(reaction)
  const font = Math.max(0.88, size * 0.4)
  const w = Math.max(size * 1.55, label.length * font * 0.64 + font * 0.7)
  const h = font * 1.5
  const y = -(size * 1.2 + h)
  return (
    <g>
      <rect x={-w / 2} y={y} width={w} height={h} rx={h * 0.22} fill={color} opacity={0.95} />
      <text
        x={0}
        y={y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        style={{
          fontSize: font,
          fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
          fontWeight: 700,
        }}
      >
        {label}
      </text>
    </g>
  )
}
