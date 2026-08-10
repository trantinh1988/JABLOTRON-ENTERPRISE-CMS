export type LicenseStatus = {
  status: string
  mode: 'full' | 'read-only' | string
  hwid: string
  app_code: string
  expires_at: string | null
  issued_at: string | null
  features: string[]
  customer: string | null
  reason: string | null
}

export type Panel = {
  panel_id: string
  display_name: string
  connection: string
  usb_path: string | null
  armed_state: string
  last_seen_at: string | null
  device_count: number
  zone_count?: number
  user_count?: number
  pg_count?: number
}

export type Zone = {
  zone_id: string
  panel_id: string
  name: string
  section_num: number
  armed_state: string
}

export type PanelUser = {
  user_id: string
  panel_id: string
  name: string
  code_label: string
  permissions: string[]
}

export type PgOutput = {
  pg_id: string
  panel_id: string
  pg_num: number
  label: string
  zone_id: string | null
  mode: string
  state: string
}

export type Device = {
  global_id: string
  panel_id: string
  device_id: string
  device_num: number | null
  device_type: string
  label: string
  state: string
  zone_id: string | null
  map_id: number | null
  map_x: number | null
  map_y: number | null
}

export type FloorMap = {
  id: number
  name: string
  description: string
  width: number
  height: number
  background_url: string | null
  device_count: number
  created_at: string | null
  updated_at: string | null
}

export type CmsEvent = {
  id?: number
  type: string
  panel_id?: string
  device_id?: string
  state?: string
  armed_state?: string
  detail?: string
  ts?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

export type GroupAction = 'arm' | 'disarm' | 'partial'

export type DeviceCreate = {
  panel_id: string
  device_num: number
  device_type?: string
  label?: string
  zone_id?: string | null
  map_id?: number | null
  map_x?: number | null
  map_y?: number | null
}

export type DeviceBulkCreate = {
  panel_id: string
  from_num: number
  to_num: number
  device_type?: string
  label_prefix?: string
}

export type DeviceBulkResult = {
  created: Device[]
  skipped: string[]
  created_count: number
  skipped_count: number
}

export type DeviceBulkDeleteResult = {
  deleted: string[]
  deleted_count: number
  missing: string[]
}

export type DeviceUpdate = {
  device_type?: string
  label?: string
  zone_id?: string | null
  clear_zone?: boolean
  map_id?: number | null
  map_x?: number | null
  map_y?: number | null
  clear_map?: boolean
}

export type FloorMapCreate = {
  name: string
  description?: string
  width?: number
  height?: number
  background_url?: string | null
}

export type FloorMapUpdate = Partial<FloorMapCreate>

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data?.detail === 'string') return data.detail
    if (data?.detail?.message) return data.detail.message
    if (data?.detail?.license?.reason) return data.detail.license.reason
    return JSON.stringify(data.detail ?? data)
  } catch {
    return res.statusText || `Lỗi HTTP ${res.status}`
  }
}

export type HealthStatus = {
  status: string
  app: string
  license_mode: string
  usb_mock_mode: boolean
  usb_hid_available: boolean
  usb_devices_found: number
  usb_panels_connected: number
  usb_last_error: string | null
  usb_hint: string | null
}

export async function getHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<HealthStatus>
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const res = await fetch('/api/license/status')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function exportLicenseRequest(customer?: string): Promise<void> {
  const q = customer ? `?customer=${encodeURIComponent(customer)}` : ''
  const res = await fetch(`/api/license/export-req${q}`)
  if (!res.ok) throw new Error(await parseError(res))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `jablotron_cms_${new Date().toISOString().slice(0, 10)}.req`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importLicense(file: File): Promise<{ ok: boolean; license: LicenseStatus }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/license/import-lic', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listPanels(): Promise<Panel[]> {
  const res = await fetch('/api/panels')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type PanelCreate = {
  panel_index?: number
  panel_id?: string
  display_name?: string
}

export async function createPanel(body: PanelCreate): Promise<Panel> {
  const res = await fetch('/api/panels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updatePanel(panelId: string, displayName: string): Promise<Panel> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deletePanel(panelId: string): Promise<void> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function getPanel(panelId: string): Promise<Panel> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function syncPanelDevices(panelId: string): Promise<{
  ok: boolean
  synced?: number
  hid_device_updates?: number
  hid_device_nums?: number[]
  matched_declared?: number
  states?: Record<string, string>
}> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/sync-devices`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type PanelProbeConfig = {
  ok: boolean
  mode?: string | null
  section_nums?: number[]
  section_count_hint?: number | null
  device_count_hint?: number | null
  pg_count_hint?: number | null
  user_count_hint?: number | null
  note?: string | null
}

export type PanelImportConfigBody = {
  section_count?: number | null
  device_count?: number | null
  user_count?: number | null
  pg_count?: number | null
  device_type?: string
  create_sections?: boolean
  create_devices?: boolean
  create_users?: boolean
  create_pgs?: boolean
  assign_devices_to_first_zone?: boolean
}

export type PanelImportConfigResult = {
  ok: boolean
  sections_created: number
  devices_created: number
  users_created: number
  pgs_created: number
  sections_skipped: number
  devices_skipped: number
  users_skipped: number
  pgs_skipped: number
  used: {
    section_count?: number
    device_count?: number
    user_count?: number
    pg_count?: number
  }
  probed?: PanelProbeConfig | null
  synced?: number | null
  note?: string | null
}

export async function probePanelConfig(panelId: string): Promise<PanelProbeConfig> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/probe-config`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function importPanelConfig(
  panelId: string,
  body: PanelImportConfigBody,
): Promise<PanelImportConfigResult> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/import-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listZones(panelId: string): Promise<Zone[]> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/zones`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createZone(
  panelId: string,
  body: { name: string; section_num: number },
): Promise<Zone> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/zones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateZone(
  panelId: string,
  zoneId: string,
  body: Partial<{ name: string; section_num: number; armed_state: string; detail: string }>,
): Promise<Zone> {
  const res = await fetch(
    `/api/panels/${encodeURIComponent(panelId)}/zones/${encodeURIComponent(zoneId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteZone(panelId: string, zoneId: string): Promise<void> {
  const res = await fetch(
    `/api/panels/${encodeURIComponent(panelId)}/zones/${encodeURIComponent(zoneId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listPanelUsers(panelId: string): Promise<PanelUser[]> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/users`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createPanelUser(
  panelId: string,
  body: { name: string; code_label?: string; permissions?: string[] },
): Promise<PanelUser> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updatePanelUser(
  panelId: string,
  userId: string,
  body: Partial<{ name: string; code_label: string; permissions: string[] }>,
): Promise<PanelUser> {
  const res = await fetch(
    `/api/panels/${encodeURIComponent(panelId)}/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deletePanelUser(panelId: string, userId: string): Promise<void> {
  const res = await fetch(
    `/api/panels/${encodeURIComponent(panelId)}/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listPgs(panelId: string): Promise<PgOutput[]> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/pgs`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createPg(
  panelId: string,
  body: { pg_num: number; label?: string; zone_id?: string | null; mode?: string },
): Promise<PgOutput> {
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/pgs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updatePg(
  panelId: string,
  pgId: string,
  body: Partial<{ pg_num: number; label: string; zone_id: string | null; mode: string; state: string }>,
): Promise<PgOutput> {
  const res = await fetch(
    `/api/panels/${encodeURIComponent(panelId)}/pgs/${encodeURIComponent(pgId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deletePg(panelId: string, pgId: string): Promise<void> {
  const res = await fetch(
    `/api/panels/${encodeURIComponent(panelId)}/pgs/${encodeURIComponent(pgId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listDevices(panelId: string, zoneId?: string): Promise<Device[]> {
  const q = zoneId ? `?zone_id=${encodeURIComponent(zoneId)}` : ''
  const res = await fetch(`/api/panels/${encodeURIComponent(panelId)}/devices${q}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listAllDevices(params?: {
  panel_id?: string
  zone_id?: string
  map_id?: number
  state?: string
}): Promise<Device[]> {
  const q = new URLSearchParams()
  if (params?.panel_id) q.set('panel_id', params.panel_id)
  if (params?.zone_id) q.set('zone_id', params.zone_id)
  if (params?.map_id != null) q.set('map_id', String(params.map_id))
  if (params?.state) q.set('state', params.state)
  const suffix = q.toString() ? `?${q}` : ''
  const res = await fetch(`/api/devices${suffix}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createDevice(body: DeviceCreate): Promise<Device> {
  const res = await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createDevicesBulk(body: DeviceBulkCreate): Promise<DeviceBulkResult> {
  const res = await fetch('/api/devices/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateDevice(globalId: string, body: DeviceUpdate): Promise<Device> {
  const res = await fetch(`/api/devices/${encodeURIComponent(globalId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteDevice(globalId: string): Promise<void> {
  const res = await fetch(`/api/devices/${encodeURIComponent(globalId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function deleteDevicesBulk(globalIds: string[]): Promise<DeviceBulkDeleteResult> {
  const res = await fetch('/api/devices/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ global_ids: globalIds }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listMaps(): Promise<FloorMap[]> {
  const res = await fetch('/api/maps')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createMap(body: FloorMapCreate): Promise<FloorMap> {
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateMap(id: number, body: FloorMapUpdate): Promise<FloorMap> {
  const res = await fetch(`/api/maps/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteMap(id: number): Promise<void> {
  const res = await fetch(`/api/maps/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listEventHistory(params?: {
  limit?: number
  offset?: number
  panel_id?: string
  event_type?: string
}): Promise<CmsEvent[]> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.panel_id) q.set('panel_id', params.panel_id)
  if (params?.event_type) q.set('event_type', params.event_type)
  const suffix = q.toString() ? `?${q}` : ''
  const res = await fetch(`/api/events${suffix}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function groupAction(
  panelIds: string[],
  action: GroupAction,
  detail?: string,
  opts?: { code?: string; section_num?: number },
) {
  const res = await fetch('/api/panels/group-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      panel_ids: panelIds,
      action,
      detail,
      code: opts?.code,
      section_num: opts?.section_num,
    }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<{
    action: string
    results: Array<{ panel_id: string; ok: boolean; error?: string }>
  }>
}
