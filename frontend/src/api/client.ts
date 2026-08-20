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
  has_stream_code?: boolean
  device_stream_ok?: boolean
}

export type Zone = {
  zone_id: string
  panel_id: string
  name: string
  section_num: number
  armed_state: string
  keypad_alarm?: boolean
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
  /** Manual F-Link SKU or unique HID hint (JA-118M). Empty when unknown. */
  model?: string
  /** bus | rf from HID 0x8a length (9 = RF) */
  link?: string
  state: string
  /** F-Link Disable: none | input | device | tamper */
  disable?: string
  /** F-Link Reaction (zone type) */
  reaction?: string
  zone_id: string | null
  map_id: number | null
  map_x: number | null
  map_y: number | null
  /** Icon key from CMS library; empty → fall back to device_type */
  map_icon?: string
  /** Marker size in map units (1–5) */
  map_icon_size?: number
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
  disable?: string
  armed_state?: string
  zone_id?: string
  section_num?: number
  detail?: string
  ts?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

/** Apply HID/CMS zone_armed to one section without touching other zones. */
export function patchZoneFromArmedEvent(z: Zone, ev: CmsEvent): Zone {
  const byId = Boolean(ev.zone_id) && z.zone_id === ev.zone_id
  const bySection =
    ev.section_num != null && Number(z.section_num) === Number(ev.section_num)
  if (!byId && !bySection) return z
  const armed = String(ev.armed_state ?? z.armed_state)
  const keypadAlarm =
    typeof ev.keypad_alarm === 'boolean' ? ev.keypad_alarm : Boolean(z.keypad_alarm)
  if (z.armed_state === armed && Boolean(z.keypad_alarm) === keypadAlarm) return z
  return { ...z, armed_state: armed, keypad_alarm: keypadAlarm }
}

export type GroupAction = 'arm' | 'disarm' | 'partial'

export type DeviceCreate = {
  panel_id: string
  device_num: number
  device_type?: string
  label?: string
  model?: string
  link?: string
  zone_id?: string | null
  map_id?: number | null
  map_x?: number | null
  map_y?: number | null
  map_icon?: string
  map_icon_size?: number
  reaction?: string
}

export type DeviceBulkCreate = {
  panel_id: string
  from_num: number
  to_num: number
  device_type?: string
  label_prefix?: string
  model?: string
  link?: string
  map_icon?: string
  map_icon_size?: number
  reaction?: string
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
  model?: string
  link?: string
  zone_id?: string | null
  clear_zone?: boolean
  map_id?: number | null
  map_x?: number | null
  map_y?: number | null
  clear_map?: boolean
  map_icon?: string
  map_icon_size?: number
  disable?: 'none' | 'input' | 'device' | 'tamper'
  reaction?: string
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

const TRANSIENT_HTTP = new Set([502, 503, 504])

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Retry GET on 502/503/504 — nginx drops host.docker.internal while HID blocks. */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase()
  const retryable = method === 'GET' || method === 'HEAD'
  const attempts = retryable ? 3 : 1
  let lastRes: Response | null = null
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init)
      if (retryable && TRANSIENT_HTTP.has(res.status) && i < attempts - 1) {
        lastRes = res
        await sleep(250 * (i + 1))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      if (!retryable || i >= attempts - 1) throw e
      await sleep(250 * (i + 1))
    }
  }
  if (lastRes) return lastRes
  throw lastErr instanceof Error ? lastErr : new Error('Không kết nối được máy chủ')
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
  const res = await apiFetch('/api/health')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<HealthStatus>
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const res = await apiFetch('/api/license/status')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function exportLicenseRequest(customer?: string): Promise<void> {
  const q = customer ? `?customer=${encodeURIComponent(customer)}` : ''
  const res = await apiFetch(`/api/license/export-req${q}`)
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
  const res = await apiFetch('/api/license/import-lic', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listPanels(): Promise<Panel[]> {
  const res = await apiFetch('/api/panels')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type PanelCreate = {
  panel_index?: number
  panel_id?: string
  display_name?: string
}

export async function createPanel(body: PanelCreate): Promise<Panel> {
  const res = await apiFetch('/api/panels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updatePanel(
  panelId: string,
  body: { display_name?: string; stream_code?: string },
): Promise<Panel> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

/** Re-enable HID device-state stream using the stored Admin/Service PIN. */
export async function activatePanelDeviceStream(panelId: string): Promise<Panel> {
  const res = await apiFetch(
    `/api/panels/${encodeURIComponent(panelId)}/device-stream/activate`,
    { method: 'POST' },
  )
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deletePanel(panelId: string): Promise<void> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function getPanel(panelId: string): Promise<Panel> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}`)
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
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/sync-devices`, {
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
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/probe-config`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function importPanelConfig(
  panelId: string,
  body: PanelImportConfigBody,
): Promise<PanelImportConfigResult> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/import-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listZones(panelId: string): Promise<Zone[]> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/zones`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createZone(
  panelId: string,
  body: { name: string; section_num: number },
): Promise<Zone> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/zones`, {
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
  const res = await apiFetch(
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
  const res = await apiFetch(
    `/api/panels/${encodeURIComponent(panelId)}/zones/${encodeURIComponent(zoneId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listPanelUsers(panelId: string): Promise<PanelUser[]> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/users`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createPanelUser(
  panelId: string,
  body: { name: string; code_label?: string; permissions?: string[] },
): Promise<PanelUser> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/users`, {
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
  const res = await apiFetch(
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
  const res = await apiFetch(
    `/api/panels/${encodeURIComponent(panelId)}/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listPgs(panelId: string): Promise<PgOutput[]> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/pgs`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createPg(
  panelId: string,
  body: { pg_num: number; label?: string; zone_id?: string | null; mode?: string },
): Promise<PgOutput> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/pgs`, {
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
  const res = await apiFetch(
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
  const res = await apiFetch(
    `/api/panels/${encodeURIComponent(panelId)}/pgs/${encodeURIComponent(pgId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listDevices(panelId: string, zoneId?: string): Promise<Device[]> {
  const q = zoneId ? `?zone_id=${encodeURIComponent(zoneId)}` : ''
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/devices${q}`)
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
  const res = await apiFetch(`/api/devices${suffix}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createDevice(body: DeviceCreate): Promise<Device> {
  const res = await apiFetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createDevicesBulk(body: DeviceBulkCreate): Promise<DeviceBulkResult> {
  const res = await apiFetch('/api/devices/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateDevice(globalId: string, body: DeviceUpdate): Promise<Device> {
  const res = await apiFetch(`/api/devices/${encodeURIComponent(globalId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteDevice(globalId: string): Promise<void> {
  const res = await apiFetch(`/api/devices/${encodeURIComponent(globalId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function deleteDevicesBulk(globalIds: string[]): Promise<DeviceBulkDeleteResult> {
  const res = await apiFetch('/api/devices/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ global_ids: globalIds }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listMaps(): Promise<FloorMap[]> {
  const res = await apiFetch('/api/maps')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createMap(body: FloorMapCreate): Promise<FloorMap> {
  const res = await apiFetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateMap(id: number, body: FloorMapUpdate): Promise<FloorMap> {
  const res = await apiFetch(`/api/maps/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteMap(id: number): Promise<void> {
  const res = await apiFetch(`/api/maps/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function uploadMapBackground(id: number, file: File): Promise<FloorMap> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch(`/api/maps/${id}/background`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function clearMapBackground(id: number): Promise<FloorMap> {
  const res = await apiFetch(`/api/maps/${id}/background`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function uploadMapTrailSnap(
  mapId: number,
  blob: Blob,
  meta?: { pointCount?: number; seqs?: number[]; deviceIds?: string[] },
): Promise<{ ok: boolean; map_id: number; map_name: string; image_url: string }> {
  const form = new FormData()
  form.append('file', blob, `map-${mapId}-trail.jpg`)
  if (meta?.pointCount != null) form.append('point_count', String(meta.pointCount))
  if (meta?.seqs?.length) form.append('seqs', meta.seqs.join(','))
  if (meta?.deviceIds?.length) form.append('device_ids', meta.deviceIds.join(','))
  const res = await apiFetch(`/api/maps/${mapId}/trail-snap`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listEventHistory(params?: {
  limit?: number
  offset?: number
  panel_id?: string
  event_type?: string
  since?: string
  until?: string
  history_page?: boolean
}): Promise<CmsEvent[]> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  if (params?.panel_id) q.set('panel_id', params.panel_id)
  if (params?.event_type) q.set('event_type', params.event_type)
  if (params?.since) q.set('since', params.since)
  if (params?.until) q.set('until', params.until)
  if (params?.history_page) q.set('history_page', 'true')
  const suffix = q.toString() ? `?${q}` : ''
  const res = await apiFetch(`/api/events${suffix}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function groupAction(
  panelIds: string[],
  action: GroupAction,
  detail?: string,
  opts?: { code?: string; section_num?: number; user_num?: number },
) {
  const res = await apiFetch('/api/panels/group-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      panel_ids: panelIds,
      action,
      detail,
      code: opts?.code,
      section_num: opts?.section_num,
      user_num: opts?.user_num,
    }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<{
    action: string
    results: Array<{ panel_id: string; ok: boolean; error?: string }>
  }>
}

export async function ackAlwaysAlarms(
  panelId: string,
  globalIds?: string[],
  code?: string,
): Promise<{ ok: boolean; silenced: number[]; states: Record<string, string> }> {
  const res = await apiFetch(`/api/panels/${encodeURIComponent(panelId)}/ack-always-alarms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ global_ids: globalIds ?? null, code: code || undefined }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function ackDeviceAlarm(
  globalId: string,
): Promise<{ ok: boolean; silenced: number[]; states: Record<string, string> }> {
  const res = await apiFetch(`/api/devices/${encodeURIComponent(globalId)}/ack-alarm`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type CameraBrand = 'hikvision' | 'dahua' | 'kbvision' | 'ezviz' | 'onvif' | 'generic'

export type Camera = {
  id: string
  name: string
  brand: CameraBrand | string
  snapshot_url: string
  rtsp_url: string
  username: string
  has_password: boolean
  floor_id: number | null
  floor_name: string | null
  is_active: boolean
  last_ok_at: string | null
  last_checked_at: string | null
  last_error: string
  thumbnail_url: string | null
  created_at: string | null
  updated_at: string | null
}

export type CameraWrite = {
  name: string
  brand?: CameraBrand
  snapshot_url?: string
  rtsp_url?: string
  username?: string
  password?: string
  floor_id?: number | null
  clear_floor?: boolean
  is_active?: boolean
}

export type CameraTestInput = {
  camera_id?: string
  snapshot_url?: string
  rtsp_url?: string
  username?: string
  password?: string
  brand?: CameraBrand
}

export type CameraTestResult = {
  ok: boolean
  source?: string | null
  content_type?: string | null
  image_base64?: string | null
  latency_ms?: number | null
  error_code?: string | null
  error?: string | null
  captured_at?: string | null
}

export async function listCameras(floorId?: number): Promise<Camera[]> {
  const q = floorId != null ? `?floor_id=${floorId}` : ''
  const res = await apiFetch(`/api/cameras${q}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createCamera(body: CameraWrite): Promise<Camera> {
  const res = await apiFetch('/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateCamera(id: string, body: CameraWrite): Promise<Camera> {
  const res = await apiFetch(`/api/cameras/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteCamera(id: string): Promise<void> {
  const res = await apiFetch(`/api/cameras/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function testCameraConnection(body: CameraTestInput): Promise<CameraTestResult> {
  const res = await apiFetch('/api/cameras/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function snapshotCamera(id: string): Promise<CameraTestResult> {
  const res = await apiFetch(`/api/cameras/${encodeURIComponent(id)}/snapshot`, { method: 'POST' })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type AutomationIfType =
  | 'armed_alarm'
  | 'device_alarm'
  | 'device_open'
  | 'tamper'
  | 'loss'
  | 'device_fault'
  | 'section_armed'
  | 'section_disarmed'
  | 'panel_armed'
  | 'panel_disarmed'
  | 'keypad_alarm'

export type AutomationThenType = 'camera_snapshot' | 'notify'

export type AutomationRule = {
  id: string
  name: string
  enabled: boolean
  if_type: AutomationIfType | string
  if_panel_id: string | null
  if_device_id: string | null
  if_zone_id: string | null
  if_floor_id: number | null
  if_require_armed: boolean
  then_type: AutomationThenType | string
  then_camera_id: string | null
  then_camera_name: string | null
  cooldown_sec: number
  last_fired_at: string | null
  last_error: string
  fire_count: number
  created_at: string | null
  updated_at: string | null
}

export type AutomationRuleWrite = {
  name?: string
  enabled?: boolean
  if_type: AutomationIfType
  if_panel_id?: string | null
  if_device_id?: string | null
  if_zone_id?: string | null
  if_floor_id?: number | null
  if_require_armed?: boolean
  then_type: AutomationThenType
  then_camera_id?: string | null
  cooldown_sec?: number
}

export type AutomationSnap = {
  id: string
  rule_id: string
  camera_id: string | null
  camera_name: string
  device_id: string | null
  image_url: string
  created_at: string | null
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  const res = await apiFetch('/api/automation/rules')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function createAutomationRule(body: AutomationRuleWrite): Promise<AutomationRule> {
  const res = await apiFetch('/api/automation/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateAutomationRule(
  id: string,
  body: AutomationRuleWrite,
): Promise<AutomationRule> {
  const res = await apiFetch(`/api/automation/rules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteAutomationRule(id: string): Promise<void> {
  const res = await apiFetch(`/api/automation/rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function testAutomationRule(id: string): Promise<{ ok?: boolean; image_url?: string; detail?: string }> {
  const res = await apiFetch(`/api/automation/rules/${encodeURIComponent(id)}/test`, { method: 'POST' })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function listAutomationSnaps(limit = 20): Promise<AutomationSnap[]> {
  const res = await apiFetch(`/api/automation/snaps?limit=${limit}`)
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type AlertSoundSlot = {
  name: string
  url: string
  type: string
}

export type SystemSettings = {
  sound_enabled: boolean
  trail_enabled: boolean
  site_title?: string
  site_logo?: AlertSoundSlot | null
  sounds: Partial<Record<'alarm' | 'tamper' | 'fault' | 'loss', AlertSoundSlot | null>>
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const res = await apiFetch('/api/system/settings')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function patchSystemSettings(body: {
  sound_enabled?: boolean
  trail_enabled?: boolean
  site_title?: string
}): Promise<SystemSettings> {
  const res = await apiFetch('/api/system/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function uploadAlertSound(
  status: 'alarm' | 'tamper' | 'fault' | 'loss',
  file: File,
): Promise<SystemSettings> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch(`/api/system/sounds/${status}`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteAlertSound(
  status: 'alarm' | 'tamper' | 'fault' | 'loss',
): Promise<SystemSettings> {
  const res = await apiFetch(`/api/system/sounds/${status}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function uploadSiteLogo(file: File): Promise<SystemSettings> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch('/api/system/logo', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function deleteSiteLogo(): Promise<SystemSettings> {
  const res = await apiFetch('/api/system/logo', { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type HostService = {
  ok: boolean
  os: 'windows' | 'linux' | 'other' | string
  autostart_supported: boolean
  autostart_enabled: boolean
  autostart_label: string
  start_script: string
  docker_ok: boolean | null
  usb_mock_mode: boolean
  usb_hid_available: boolean
  usb_devices_found: number
  usb_panels_connected: number
  usb_last_error: string | null
  detail: string | null
}

export async function getHostService(): Promise<HostService> {
  const res = await apiFetch('/api/system/host')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function setHostAutostart(enabled: boolean): Promise<HostService> {
  const res = await apiFetch('/api/system/host/autostart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function reconnectHostUsb(): Promise<HostService> {
  const res = await apiFetch('/api/system/host/usb-reconnect', { method: 'POST' })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type HostPorts = {
  ui_port: number
  api_port: number
  ui_port_default: number
  api_port_default: number
  ui_url: string
  api_url: string
  lan_ip?: string | null
  client_url?: string | null
  os: string
  applied: boolean | null
  detail: string | null
  start_script: string
}

export async function getHostPorts(): Promise<HostPorts> {
  const res = await apiFetch('/api/system/ports')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function setHostPorts(uiPort: number, apiPort: number): Promise<HostPorts> {
  const res = await apiFetch('/api/system/ports', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ui_port: uiPort, api_port: apiPort }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export type BackupInfo = {
  format: string
  version: number
  panels: number
  devices: number
  maps: number
  map_backgrounds: number
  cameras: number
  automation_rules: number
  events: number
  extra_files: number
  approx_bytes: number
}

export type BackupRestoreResult = BackupInfo & {
  ok: boolean
  created_at?: string | null
  detail?: string | null
}

export async function getBackupInfo(): Promise<BackupInfo> {
  const res = await apiFetch('/api/system/backup/info')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const star = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* keep fallback */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i)
  return plain?.[1]?.trim() || fallback
}

export async function downloadSystemBackup(): Promise<void> {
  const res = await apiFetch('/api/system/backup')
  if (!res.ok) throw new Error(await parseError(res))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filenameFromDisposition(
    res.headers.get('content-disposition'),
    `jablotron-cms-backup_${new Date().toISOString().slice(0, 10)}.zip`,
  )
  a.click()
  URL.revokeObjectURL(url)
}

export async function restoreSystemBackup(file: File): Promise<BackupRestoreResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch('/api/system/backup/restore', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}
