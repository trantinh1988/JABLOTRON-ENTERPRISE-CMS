export type DeviceFamily =
  | 'pir'
  | 'door'
  | 'smoke'
  | 'glass'
  | 'siren'
  | 'keypad'
  | 'flood'
  | 'heat'
  | 'sensor'
  | 'other'

export type DeviceLink = 'bus' | 'rf' | ''

export type DeviceModelDef = {
  sku: string
  family: DeviceFamily
  /** Typical installation — not enforced; HID length is source of truth. */
  link?: 'bus' | 'rf'
}

/** Họ thiết bị CMS — Status vẫn là ACT / OK / TMP / Loss / Fault / Disable. */
export const DEVICE_FAMILY_KEYS: DeviceFamily[] = [
  'pir',
  'door',
  'smoke',
  'glass',
  'siren',
  'keypad',
  'flood',
  'heat',
  'sensor',
  'other',
]

/** Catalog SKU JA-100+ — chọn tay. USB không đọc mã hàng từ byte 0x04. */
export const DEVICE_MODEL_CATALOG: DeviceModelDef[] = [
  { sku: 'JA-110P', family: 'pir', link: 'bus' },
  { sku: 'JA-110P PET', family: 'pir', link: 'bus' },
  { sku: 'JA-120P', family: 'pir', link: 'bus' },
  { sku: 'JA-150P', family: 'pir', link: 'rf' },
  { sku: 'JA-150P PET', family: 'pir', link: 'rf' },
  { sku: 'JA-160PC', family: 'pir', link: 'rf' },
  { sku: 'JA-180P', family: 'pir', link: 'rf' },
  { sku: 'JA-111M', family: 'door', link: 'bus' },
  { sku: 'JA-112M', family: 'door', link: 'bus' },
  { sku: 'JA-118M', family: 'door', link: 'bus' },
  { sku: 'JA-151M', family: 'door', link: 'rf' },
  { sku: 'JA-150M', family: 'door', link: 'rf' },
  { sku: 'JA-185B', family: 'door', link: 'rf' },
  { sku: 'JA-111ST', family: 'smoke', link: 'bus' },
  { sku: 'JA-151ST', family: 'smoke', link: 'rf' },
  { sku: 'JA-110B', family: 'glass', link: 'bus' },
  { sku: 'JA-150B', family: 'glass', link: 'rf' },
  { sku: 'JA-110A', family: 'siren', link: 'bus' },
  { sku: 'JA-111A', family: 'siren', link: 'bus' },
  { sku: 'JA-150A', family: 'siren', link: 'rf' },
  { sku: 'JA-162A', family: 'siren', link: 'rf' },
  { sku: 'JA-163A', family: 'siren', link: 'rf' },
  { sku: 'JA-112E', family: 'keypad', link: 'bus' },
  { sku: 'JA-113E', family: 'keypad', link: 'bus' },
  { sku: 'JA-114E', family: 'keypad', link: 'bus' },
  { sku: 'JA-153E', family: 'keypad', link: 'rf' },
  { sku: 'JA-154E', family: 'keypad', link: 'rf' },
  { sku: 'JA-110F', family: 'flood', link: 'bus' },
  { sku: 'JA-150FLOOD', family: 'flood', link: 'rf' },
  { sku: 'JA-111TH', family: 'heat', link: 'bus' },
  { sku: 'JA-151TH', family: 'heat', link: 'rf' },
]

const CATALOG_BY_SKU = new Map(DEVICE_MODEL_CATALOG.map((m) => [m.sku, m]))

export function familyOfType(type: string | null | undefined): DeviceFamily {
  const t = (type || 'sensor').trim().toLowerCase()
  if (t === 'magnet') return 'door'
  if (t === 'motion') return 'pir'
  if (t === 'temp') return 'heat'
  if ((DEVICE_FAMILY_KEYS as string[]).includes(t)) return t as DeviceFamily
  return 'sensor'
}

export function modelsForFamily(family: string): DeviceModelDef[] {
  const fam = familyOfType(family)
  if (fam === 'sensor' || fam === 'other') return DEVICE_MODEL_CATALOG
  return DEVICE_MODEL_CATALOG.filter((m) => m.family === fam)
}

export function catalogEntry(sku: string | null | undefined): DeviceModelDef | undefined {
  const key = (sku || '').trim()
  if (!key) return undefined
  return CATALOG_BY_SKU.get(key)
}

export function modelFitsFamily(model: string, family: string): boolean {
  if (!model.trim()) return true
  if (!catalogEntry(model)) return true
  return modelsForFamily(family).some((m) => m.sku === model)
}

export function normalizeDeviceLink(link: string | null | undefined): DeviceLink {
  const v = (link || '').trim().toLowerCase()
  return v === 'bus' || v === 'rf' ? v : ''
}
