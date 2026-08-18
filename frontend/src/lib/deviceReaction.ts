/** F-Link Reaction (zone type) — độc lập với Status runtime. */

export const DEVICE_REACTIONS = [
  'instant',
  'delayed',
  'instant_confirmed',
  'delayed_confirmed',
  'repeating_instant',
  'repeating_delayed',
  '24h',
  'fire',
  'fire_confirmed',
  'fire_instant',
  'panic_silent',
  'panic_audible',
  'flood',
  'gas',
  'report',
  'keybox',
  'siren_mute',
  'none',
  'none_no_tamper',
] as const

export type DeviceReaction = (typeof DEVICE_REACTIONS)[number]

export type ReactionClass = 'intrusion' | 'always' | 'life' | 'report' | 'none'

export const DEFAULT_DEVICE_REACTION: DeviceReaction = 'instant'

export const REACTION_GROUPS: { id: ReactionClass | 'other'; keys: DeviceReaction[] }[] = [
  {
    id: 'intrusion',
    keys: [
      'instant',
      'delayed',
      'instant_confirmed',
      'delayed_confirmed',
      'repeating_instant',
      'repeating_delayed',
    ],
  },
  { id: 'always', keys: ['24h'] },
  {
    id: 'life',
    keys: ['fire', 'fire_confirmed', 'fire_instant', 'panic_silent', 'panic_audible', 'flood', 'gas'],
  },
  { id: 'other', keys: ['report', 'keybox', 'siren_mute', 'none', 'none_no_tamper'] },
]

const REACTION_SET = new Set<string>(DEVICE_REACTIONS)

const ALWAYS_ALARM = new Set<string>([
  '24h',
  'fire',
  'fire_confirmed',
  'fire_instant',
  'panic_silent',
  'panic_audible',
  'flood',
  'gas',
])

const NO_ALARM = new Set<string>(['report', 'keybox', 'siren_mute', 'none', 'none_no_tamper'])

export function normalizeReaction(raw?: string | null): DeviceReaction {
  const v = (raw || '').trim().toLowerCase()
  return REACTION_SET.has(v) ? (v as DeviceReaction) : DEFAULT_DEVICE_REACTION
}

export function reactionClassOf(raw?: string | null): ReactionClass {
  const key = normalizeReaction(raw)
  if (key === '24h') return 'always'
  if (ALWAYS_ALARM.has(key)) return 'life'
  if (NO_ALARM.has(key) && key !== 'report' && key !== 'keybox') return 'none'
  if (key === 'report' || key === 'keybox') return 'report'
  return 'intrusion'
}

export function reactionAlarmsWhenDisarmed(raw?: string | null): boolean {
  return ALWAYS_ALARM.has(normalizeReaction(raw))
}

export function reactionShowsMapChip(raw?: string | null): boolean {
  return normalizeReaction(raw) !== 'instant'
}

/** Chip ngắn trên map / bảng — không phá layout. */
export function reactionChipLabel(raw?: string | null): string {
  switch (normalizeReaction(raw)) {
    case 'instant':
      return 'Instant'
    case 'delayed':
      return 'Delay'
    case 'instant_confirmed':
      return 'Instant+'
    case 'delayed_confirmed':
      return 'Delay+'
    case 'repeating_instant':
      return 'Repeat'
    case 'repeating_delayed':
      return 'Rpt D'
    case '24h':
      return '24h'
    case 'fire':
    case 'fire_confirmed':
    case 'fire_instant':
      return 'Fire'
    case 'panic_silent':
    case 'panic_audible':
      return 'Panic'
    case 'flood':
      return 'Flood'
    case 'gas':
      return 'Gas'
    case 'report':
      return 'Report'
    case 'keybox':
      return 'Key'
    case 'siren_mute':
      return 'Mute'
    case 'none':
    case 'none_no_tamper':
      return 'None'
    default:
      return 'Instant'
  }
}

export function reactionChipColor(raw?: string | null): string {
  switch (normalizeReaction(raw)) {
    case '24h':
      return '#f59e0b'
    case 'fire':
    case 'fire_confirmed':
    case 'fire_instant':
      return '#ef4444'
    case 'panic_silent':
    case 'panic_audible':
      return '#d946ef'
    case 'flood':
      return '#0ea5e9'
    case 'gas':
      return '#84cc16'
    case 'report':
    case 'keybox':
    case 'siren_mute':
      return '#64748b'
    case 'none':
    case 'none_no_tamper':
      return '#94a3b8'
    default:
      return '#64748b'
  }
}

export function sectionLifeAlarmBadge(
  devices: { state?: string; reaction?: string | null }[],
): string | null {
  let fire = false
  let panic = false
  let flood = false
  let gas = false
  let always = false
  for (const d of devices) {
    if ((d.state || '').toLowerCase() !== 'alarm') continue
    const key = normalizeReaction(d.reaction)
    if (key === 'fire' || key === 'fire_confirmed' || key === 'fire_instant') fire = true
    else if (key === 'panic_silent' || key === 'panic_audible') panic = true
    else if (key === 'flood') flood = true
    else if (key === 'gas') gas = true
    else if (key === '24h') always = true
  }
  if (fire) return 'FIRE'
  if (panic) return 'PANIC'
  if (flood) return 'FLOOD'
  if (gas) return 'GAS'
  if (always) return '24h'
  return null
}
