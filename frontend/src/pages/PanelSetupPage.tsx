import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  createDevice,
  createDevicesBulk,
  createPg,
  createPanelUser,
  createZone,
  deleteDevice,
  deleteDevicesBulk,
  deletePg,
  deletePanelUser,
  deleteZone,
  getPanel,
  listDevices,
  listPanelUsers,
  listPgs,
  listZones,
  activatePanelDeviceStream,
  updateDevice,
  updatePanel,
  updatePanelUser,
  updatePg,
  updateZone,
  type Device,
  type Panel,
  type PanelUser,
  type PgOutput,
  type Zone,
  patchZoneFromArmedEvent,
} from '../api/client'
import { DeviceIconPicker } from '../components/DeviceIconPicker'
import { DeviceModelPicker, LinkBadge } from '../components/DeviceModelPicker'
import { DeviceTypeIcon } from '../components/DeviceTypeIcon'
import { ReactionBadge, ReactionSelect } from '../components/ReactionBadge'
import { ImportPanelConfigCard } from '../components/ImportPanelConfigCard'
import { Btn, Card, Field, StateDot, inputClass } from '../components/ui'
import {
  clampMapIconSize,
  DEFAULT_MAP_ICON_SIZE,
  resolveDeviceIconKey,
} from '../lib/deviceIconLibrary'
import { DEFAULT_DEVICE_REACTION, normalizeReaction } from '../lib/deviceReaction'
import { DEVICE_FAMILY_KEYS, familyOfType, modelFitsFamily, normalizeDeviceLink, type DeviceLink } from '../lib/deviceCatalog'
import {
  armedStateLabel,
  connectionLabel,
  deviceStateLabel,
  deviceTypeLabel,
  labelOf,
  permissionLabel,
  pgModeLabel,
  pgStateLabel,
  vi,
} from '../i18n/vi'
import { applyDeviceEvent, isDeviceStateEvent } from '../hooks/deviceEventSync'
import { latestEventSeq, takeEventsSince } from '../hooks/useEventStream'

const TABS = ['overview', 'zones', 'users', 'inputs', 'pg', 'connection'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, string> = {
  overview: vi.tabOverview,
  zones: vi.tabZones,
  users: vi.tabUsers,
  inputs: vi.tabInputs,
  pg: vi.tabPg,
  connection: vi.tabConnection,
}

const PERMISSIONS = Object.keys(permissionLabel)
const DEVICE_TYPES = DEVICE_FAMILY_KEYS
const PG_MODES = Object.keys(pgModeLabel)

type Props = {
  writeAllowed: boolean
  onRefresh: () => Promise<void>
  eventSeq: number
  mockMode: boolean | null
  usbHint: string | null
}

export function PanelSetupPage({ writeAllowed, onRefresh, eventSeq, mockMode, usbHint }: Props) {
  const { panelId = '' } = useParams()
  const [tab, setTab] = useState<Tab>('overview')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [users, setUsers] = useState<PanelUser[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [pgs, setPgs] = useState<PgOutput[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const eventCursorRef = useRef(latestEventSeq())
  const devicesRef = useRef(devices)
  devicesRef.current = devices
  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const pgsRef = useRef(pgs)
  pgsRef.current = pgs

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])

  const load = useCallback(async () => {
    if (!panelId) return
    try {
      const [p, z, u, d, pg] = await Promise.all([
        getPanel(panelId),
        listZones(panelId),
        listPanelUsers(panelId),
        listDevices(panelId),
        listPgs(panelId),
      ])
      setPanel(p)
      setZones(z)
      setUsers(u)
      devicesRef.current = d
      setDevices(d)
      setPgs(pg)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [panelId])

  useEffect(() => {
    eventCursorRef.current = latestEventSeq()
    void load()
  }, [load])

  useEffect(() => {
    if (!panelId) return
    const { events: batch, upTo } = takeEventsSince(eventCursorRef.current)
    if (!batch.length) return
    eventCursorRef.current = upTo

    let needLoad = false
    let devicesNext = devicesRef.current
    let devicesChanged = false
    let zonesNext = zonesRef.current
    let zonesChanged = false
    let pgsNext = pgsRef.current
    let pgsChanged = false
    let panelArmed: string | null = null

    for (const ev of batch) {
      if (ev.panel_id && String(ev.panel_id) !== panelId) continue

      if (isDeviceStateEvent(ev)) {
        const patched = applyDeviceEvent(devicesNext, ev)
        if (patched === 'refresh') {
          needLoad = true
        } else if (patched !== devicesNext) {
          devicesNext = patched
          devicesChanged = true
        }
      }

      if (ev.type === 'panel_armed' && ev.armed_state) {
        panelArmed = String(ev.armed_state)
      }

      if (ev.type === 'panel_connected' || ev.type === 'panel_disconnected') {
        needLoad = true
      }

      if (ev.type === 'zone_armed' && (ev.zone_id || ev.section_num != null)) {
        const armed = String(ev.armed_state ?? '')
        if (!armed) continue
        const next = zonesNext.map((z) => patchZoneFromArmedEvent(z, ev))
        if (next.some((z, i) => z !== zonesNext[i])) {
          zonesNext = next
          zonesChanged = true
        }
      }

      if (ev.type === 'pg_state' && ev.pg_id) {
        const state = String(ev.state ?? '')
        if (!state) continue
        let changed = false
        const next = pgsNext.map((p) => {
          if (p.pg_id !== ev.pg_id || p.state === state) return p
          changed = true
          return { ...p, state }
        })
        if (changed) {
          pgsNext = next
          pgsChanged = true
        }
      }
    }

    if (devicesChanged) {
      devicesRef.current = devicesNext
      setDevices(devicesNext)
    }
    if (zonesChanged) {
      zonesRef.current = zonesNext
      setZones(zonesNext)
    }
    if (pgsChanged) {
      pgsRef.current = pgsNext
      setPgs(pgsNext)
    }
    if (panelArmed) {
      setPanel((p) => (p ? { ...p, armed_state: panelArmed } : p))
    }
    if (needLoad) void load()
  }, [eventSeq, panelId, load])

  async function reload() {
    await load()
    await onRefresh()
  }

  function connBadgeClass(connection: string) {
    if (connection === 'usb') return 'bg-ok/10 text-ok ring-ok/20'
    if (connection === 'mock') return 'bg-warn/10 text-warn ring-warn/20'
    return 'bg-steel/10 text-steel ring-line'
  }

  if (!panelId) {
    return <p className="p-5 text-sm text-danger">{vi.panelNotFound}</p>
  }

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/devices"
            className="mb-2 inline-flex items-center gap-1 text-xs text-steel hover:text-ink"
          >
            <ArrowLeft className="size-3.5" /> {vi.backToDevices}
          </Link>
          <h2 className="text-xl font-semibold tracking-tight text-ink">
            {panel?.display_name ?? panelId}
          </h2>
          <p className="mt-0.5 font-mono text-sm text-steel/70">{panelId}</p>
        </div>
        {panel && (
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${connBadgeClass(panel.connection)}`}
          >
            {labelOf(connectionLabel, panel.connection)}
          </span>
        )}
      </div>

      {!writeAllowed && (
        <p className="mb-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">{vi.readOnlyHint}</p>
      )}
      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {info && <p className="mb-3 rounded-md bg-ok/10 px-3 py-2 text-xs text-ok">{info}</p>}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              tab === t ? 'bg-accent text-panel' : 'text-steel hover:bg-mist'
            }`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && panel && (
        <>
          <ImportPanelConfigCard
            panels={[panel]}
            selectedPanelId={panel.panel_id}
            writeAllowed={writeAllowed}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
            onInfo={setInfo}
            onDone={reload}
          />
          <OverviewTab
            panel={panel}
            zones={zones}
            users={users}
            devices={devices}
            pgs={pgs}
            writeAllowed={writeAllowed}
            busy={busy}
            onSave={async (name) => {
              setBusy(true)
              setError(null)
              try {
                await updatePanel(panelId, { display_name: name })
                setInfo(vi.panelUpdated)
                await reload()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          />
        </>
      )}

      {tab === 'zones' && (
        <ZonesTab
          panelId={panelId}
          zones={zones}
          devices={devices}
          writeAllowed={writeAllowed}
          busy={busy}
          onReload={reload}
          onError={setError}
          setBusy={setBusy}
        />
      )}

      {tab === 'users' && (
        <UsersTab
          panelId={panelId}
          users={users}
          writeAllowed={writeAllowed}
          busy={busy}
          onReload={reload}
          onError={setError}
          setBusy={setBusy}
        />
      )}

      {tab === 'inputs' && (
        <InputsTab
          panelId={panelId}
          devices={devices}
          zones={zones}
          zoneMap={zoneMap}
          selected={selected}
          setSelected={setSelected}
          writeAllowed={writeAllowed}
          busy={busy}
          onReload={reload}
          onError={setError}
          onInfo={setInfo}
          setBusy={setBusy}
        />
      )}

      {tab === 'pg' && (
        <PgTab
          panelId={panelId}
          pgs={pgs}
          zones={zones}
          zoneMap={zoneMap}
          writeAllowed={writeAllowed}
          busy={busy}
          onReload={reload}
          onError={setError}
          setBusy={setBusy}
        />
      )}

      {tab === 'connection' && panel && (
        <ConnectionTab
          panel={panel}
          mockMode={mockMode}
          usbHint={usbHint}
          writeAllowed={writeAllowed}
          busy={busy}
          onSaveStreamCode={async (code) => {
            setBusy(true)
            setError(null)
            try {
              if (!code && panel?.has_stream_code) {
                await activatePanelDeviceStream(panelId)
                setInfo(vi.streamCodeSaved)
              } else {
                await updatePanel(panelId, { stream_code: code })
                setInfo(code ? vi.streamCodeSaved : vi.streamCodeCleared)
              }
              await reload()
              await onRefresh()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
          onClearStreamCode={async () => {
            setBusy(true)
            setError(null)
            try {
              await updatePanel(panelId, { stream_code: '' })
              setInfo(vi.streamCodeCleared)
              await reload()
              await onRefresh()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function OverviewTab({
  panel,
  zones,
  users,
  devices,
  pgs,
  writeAllowed,
  busy,
  onSave,
}: {
  panel: Panel
  zones: Zone[]
  users: PanelUser[]
  devices: Device[]
  pgs: PgOutput[]
  writeAllowed: boolean
  busy: boolean
  onSave: (name: string) => Promise<void>
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 text-sm font-semibold">{vi.tabOverview}</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Stat label={vi.summaryZones} value={zones.length} />
          <Stat label={vi.summaryUsers} value={users.length} />
          <Stat label={vi.summaryInputs} value={devices.length} />
          <Stat label={vi.summaryPgs} value={pgs.length} />
        </dl>
        <p className="mt-3 text-xs text-steel">
          {vi.status}: {labelOf(armedStateLabel, panel.armed_state)}
        </p>
      </Card>
      <Card>
        <h3 className="mb-3 text-sm font-semibold">{vi.editPanel}</h3>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void onSave(String(new FormData(e.currentTarget).get('display_name') || ''))
          }}
        >
          <Field label={vi.panelName}>
            <input
              name="display_name"
              className={inputClass}
              defaultValue={panel.display_name}
              required
            />
          </Field>
          <Btn type="submit" disabled={!writeAllowed || busy}>
            {vi.save}
          </Btn>
        </form>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-mist/40 px-3 py-2">
      <dt className="text-[11px] text-steel/70">{label}</dt>
      <dd className="text-lg font-semibold text-ink">{value}</dd>
    </div>
  )
}

function ConnectionTab({
  panel,
  mockMode,
  usbHint,
  writeAllowed,
  busy,
  onSaveStreamCode,
  onClearStreamCode,
}: {
  panel: Panel
  mockMode: boolean | null
  usbHint: string | null
  writeAllowed: boolean
  busy: boolean
  onSaveStreamCode: (code: string) => Promise<void>
  onClearStreamCode: () => Promise<void>
}) {
  const hint =
    panel.connection === 'usb'
      ? vi.connectionHintUsb
      : panel.connection === 'mock'
        ? vi.connectionHintMock
        : vi.connectionHintDisconnected

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-3 text-sm font-semibold">{vi.connectionStatus}</h3>
        <dl className="space-y-2 text-sm">
          <Row label={vi.status} value={labelOf(connectionLabel, panel.connection)} />
          <Row label={vi.usbPath} value={panel.usb_path ?? '—'} mono />
          <Row label={vi.lastSeen} value={panel.last_seen_at ?? '—'} mono />
          <Row label="armed_state" value={labelOf(armedStateLabel, panel.armed_state)} />
          <Row
            label={vi.streamCodeTitle}
            value={
              panel.device_stream_ok
                ? vi.streamCodeActive
                : panel.has_stream_code
                  ? vi.streamCodeInactive
                  : '—'
            }
          />
        </dl>
        <p className="mt-4 text-xs text-steel/70">{hint}</p>
        {mockMode === false && panel.connection !== 'usb' && usbHint && (
          <div className="mt-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <p className="font-semibold">{vi.usbConnectTitle}</p>
            <p className="mt-1">{usbHint}</p>
            <p className="mt-2 font-mono text-[10px] opacity-90">{vi.usbConnectSteps}</p>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-semibold">{vi.streamCodeTitle}</h3>
        <p className="mb-3 text-xs text-steel/70">{vi.streamCodeHint}</p>
        <p className="mb-3 text-xs text-steel/60">{vi.streamCodeBannerBody}</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const code = String(new FormData(e.currentTarget).get('stream_code') || '').trim()
            void onSaveStreamCode(code)
            if (code) e.currentTarget.reset()
          }}
        >
          <Field label={vi.streamCodeTitle}>
            <input
              name="stream_code"
              type="password"
              autoComplete="off"
              className={inputClass}
              placeholder={vi.streamCodePlaceholder}
            />
          </Field>
          <Btn type="submit" disabled={!writeAllowed || busy}>
            {panel.has_stream_code ? vi.streamCodeReactivate : vi.streamCodeActivate}
          </Btn>
          {panel.has_stream_code && (
            <Btn
              type="button"
              tone="ghost"
              disabled={!writeAllowed || busy}
              onClick={() => void onClearStreamCode()}
            >
              {vi.streamCodeClear}
            </Btn>
          )}
        </form>
        {panel.device_stream_ok ? (
          <p className="mt-2 text-xs text-ok">{vi.streamCodeActive}</p>
        ) : panel.has_stream_code ? (
          <p className="mt-2 text-xs text-warn">{vi.streamCodeWaiting}</p>
        ) : null}
      </Card>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/50 py-2">
      <dt className="text-steel/70">{label}</dt>
      <dd className={mono ? 'font-mono text-[12px]' : ''}>{value}</dd>
    </div>
  )
}

function ZonesTab({
  panelId,
  zones,
  devices,
  writeAllowed,
  busy,
  onReload,
  onError,
  setBusy,
}: {
  panelId: string
  zones: Zone[]
  devices: Device[]
  writeAllowed: boolean
  busy: boolean
  onReload: () => Promise<void>
  onError: (m: string | null) => void
  setBusy: (b: boolean) => void
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Zone | null>(null)

  async function handleSubmit(form: FormData) {
    setBusy(true)
    onError(null)
    try {
      const name = String(form.get('name') || '')
      const section_num = Number(form.get('section_num'))
      if (editing) {
        await updateZone(panelId, editing.zone_id, { name, section_num })
      } else {
        await createZone(panelId, { name, section_num })
      }
      setCreating(false)
      setEditing(null)
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(z: Zone) {
    if (!window.confirm(vi.confirmDeleteZone(z.name))) return
    setBusy(true)
    onError(null)
    try {
      await deleteZone(panelId, z.zone_id)
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function assignDevice(device: Device, zoneId: string | null) {
    setBusy(true)
    onError(null)
    try {
      await updateDevice(device.global_id, zoneId ? { zone_id: zoneId } : { clear_zone: true })
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn
          disabled={!writeAllowed}
          onClick={() => {
            setCreating(true)
            setEditing(null)
          }}
        >
          <Plus className="size-3.5" /> {vi.addZone}
        </Btn>
      </div>

      {(creating || editing) && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">{editing ? vi.editZone : vi.addZone}</h3>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit(new FormData(e.currentTarget))
            }}
          >
            <Field label={vi.zoneName}>
              <input name="name" className={inputClass} defaultValue={editing?.name ?? ''} required />
            </Field>
            <Field label={vi.sectionNum}>
              <input
                name="section_num"
                type="number"
                min={1}
                max={32}
                className={inputClass}
                defaultValue={editing?.section_num ?? 1}
                required
              />
            </Field>
            <div className="flex items-end gap-2">
              <Btn type="submit" disabled={busy || !writeAllowed}>
                {vi.save}
              </Btn>
              <Btn
                tone="ghost"
                onClick={() => {
                  setCreating(false)
                  setEditing(null)
                }}
              >
                {vi.cancel}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      {zones.map((z) => {
        const zoneDevices = devices.filter((d) => d.zone_id === z.zone_id)
        return (
          <Card key={z.zone_id}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold text-ink">
                  {z.name}{' '}
                  <span className="font-mono text-xs text-steel">(Section {z.section_num})</span>
                </h4>
                <p className="text-xs text-steel">
                  {zoneDevices.length} {vi.devices} · {labelOf(armedStateLabel, z.armed_state)}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={!writeAllowed}
                  className="rounded p-1.5 text-steel hover:bg-mist"
                  onClick={() => {
                    setEditing(z)
                    setCreating(false)
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!writeAllowed || busy}
                  className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger"
                  onClick={() => void handleDelete(z)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <p className="mb-2 text-[11px] font-medium text-steel/70">{vi.zoneAddresses}</p>
            <div className="flex flex-wrap gap-1">
              {zoneDevices.map((d) => (
                <span
                  key={d.global_id}
                  className="inline-flex items-center gap-1 rounded bg-mist/60 px-2 py-0.5 font-mono text-[11px]"
                >
                  {d.device_id}
                  {writeAllowed && (
                    <button
                      type="button"
                      className="text-steel hover:text-danger"
                      onClick={() => void assignDevice(d, null)}
                      title={vi.unassignZone}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {!zoneDevices.length && (
                <span className="text-xs text-steel/50">—</span>
              )}
            </div>
            {writeAllowed && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  className={`${inputClass} w-auto min-w-[160px] text-xs`}
                  defaultValue=""
                  onChange={(e) => {
                    const gid = e.target.value
                    if (!gid) return
                    const dev = devices.find((d) => d.global_id === gid)
                    if (dev) void assignDevice(dev, z.zone_id)
                    e.target.value = ''
                  }}
                >
                  <option value="">{vi.assignZone}…</option>
                  {devices
                    .filter((d) => d.zone_id !== z.zone_id)
                    .map((d) => (
                      <option key={d.global_id} value={d.global_id}>
                        {d.global_id} {d.label ? `· ${d.label}` : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </Card>
        )
      })}
      {!zones.length && <p className="text-sm text-steel/50">{vi.noZones}</p>}
    </div>
  )
}

function UsersTab({
  panelId,
  users,
  writeAllowed,
  busy,
  onReload,
  onError,
  setBusy,
}: {
  panelId: string
  users: PanelUser[]
  writeAllowed: boolean
  busy: boolean
  onReload: () => Promise<void>
  onError: (m: string | null) => void
  setBusy: (b: boolean) => void
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PanelUser | null>(null)
  const [perms, setPerms] = useState<string[]>([])

  useEffect(() => {
    setPerms(editing?.permissions ?? [])
  }, [editing])

  async function handleSubmit(form: FormData) {
    setBusy(true)
    onError(null)
    try {
      const body = {
        name: String(form.get('name') || ''),
        code_label: String(form.get('code_label') || ''),
        permissions: perms,
      }
      if (editing) await updatePanelUser(panelId, editing.user_id, body)
      else await createPanelUser(panelId, body)
      setCreating(false)
      setEditing(null)
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn
          disabled={!writeAllowed}
          onClick={() => {
            setCreating(true)
            setEditing(null)
            setPerms([])
          }}
        >
          <Plus className="size-3.5" /> {vi.addUser}
        </Btn>
      </div>

      {(creating || editing) && (
        <Card>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit(new FormData(e.currentTarget))
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={vi.userName}>
                <input name="name" className={inputClass} defaultValue={editing?.name ?? ''} required />
              </Field>
              <Field label={vi.codeLabel}>
                <input name="code_label" className={inputClass} defaultValue={editing?.code_label ?? ''} />
              </Field>
            </div>
            <Field label={vi.permissions}>
              <div className="flex flex-wrap gap-3">
                {PERMISSIONS.map((p) => (
                  <label key={p} className="inline-flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={perms.includes(p)}
                      onChange={(e) => {
                        setPerms((prev) =>
                          e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                        )
                      }}
                      className="size-3.5 accent-accent"
                    />
                    {permissionLabel[p]}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex gap-2">
              <Btn type="submit" disabled={busy || !writeAllowed}>
                {vi.save}
              </Btn>
              <Btn tone="ghost" onClick={() => { setCreating(false); setEditing(null) }}>
                {vi.cancel}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-mist/50 text-[11px] text-steel/70">
            <tr>
              <th className="px-4 py-2">{vi.userName}</th>
              <th className="px-4 py-2">{vi.codeLabel}</th>
              <th className="px-4 py-2">{vi.permissions}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="border-b border-line/60">
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{u.code_label || '—'}</td>
                <td className="px-4 py-2 text-xs">
                  {u.permissions.map((p) => labelOf(permissionLabel, p)).join(', ') || '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      disabled={!writeAllowed}
                      className="rounded p-1.5 text-steel hover:bg-mist"
                      onClick={() => { setEditing(u); setCreating(false) }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!writeAllowed || busy}
                      className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger"
                      onClick={() => {
                        if (!window.confirm(vi.confirmDeleteUser(u.name))) return
                        setBusy(true)
                        void deletePanelUser(panelId, u.user_id)
                          .then(onReload)
                          .catch((e) => onError(e instanceof Error ? e.message : String(e)))
                          .finally(() => setBusy(false))
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-steel/50">
                  {vi.noUsers}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function InputsTab({
  panelId,
  devices,
  zones,
  zoneMap,
  selected,
  setSelected,
  writeAllowed,
  busy,
  onReload,
  onError,
  onInfo,
  setBusy,
}: {
  panelId: string
  devices: Device[]
  zones: Zone[]
  zoneMap: Map<string, Zone>
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  writeAllowed: boolean
  busy: boolean
  onReload: () => Promise<void>
  onError: (m: string | null) => void
  onInfo: (m: string | null) => void
  setBusy: (b: boolean) => void
}) {
  const [creating, setCreating] = useState(false)
  const [bulk, setBulk] = useState(true)
  const [editing, setEditing] = useState<Device | null>(null)
  const [formIcon, setFormIcon] = useState('sensor')
  const [formIconSize, setFormIconSize] = useState(DEFAULT_MAP_ICON_SIZE)
  const [formFamily, setFormFamily] = useState('sensor')
  const [formModel, setFormModel] = useState('')
  const [formLink, setFormLink] = useState<DeviceLink>('')
  const [formReaction, setFormReaction] = useState(DEFAULT_DEVICE_REACTION)

  useEffect(() => {
    if (editing) {
      setFormIcon(resolveDeviceIconKey(editing))
      setFormIconSize(clampMapIconSize(editing.map_icon_size))
      setFormFamily(familyOfType(editing.device_type))
      setFormModel(editing.model || '')
      setFormLink(normalizeDeviceLink(editing.link))
      setFormReaction(normalizeReaction(editing.reaction))
    } else if (creating) {
      setFormIcon('sensor')
      setFormIconSize(DEFAULT_MAP_ICON_SIZE)
      setFormFamily('sensor')
      setFormModel('')
      setFormLink('')
      setFormReaction(DEFAULT_DEVICE_REACTION)
    }
  }, [editing, creating])

  async function handleCreate(form: FormData) {
    setBusy(true)
    onError(null)
    try {
      const device_type = formFamily || String(form.get('device_type') || 'sensor')
      const map_icon = String(form.get('map_icon') || formIcon || device_type)
      const map_icon_size = clampMapIconSize(
        Number(form.get('map_icon_size') || formIconSize),
      )
      if (bulk) {
        const result = await createDevicesBulk({
          panel_id: panelId,
          from_num: Number(form.get('from_num')),
          to_num: Number(form.get('to_num')),
          device_type,
          label_prefix: String(form.get('label_prefix') || ''),
          model: formModel.trim() || undefined,
          link: formLink || undefined,
          map_icon,
          map_icon_size,
          reaction: formReaction,
        })
        onInfo(vi.bulkResult(result.created_count, result.skipped_count))
      } else {
        await createDevice({
          panel_id: panelId,
          device_num: Number(form.get('device_num')),
          device_type,
          label: String(form.get('label') || ''),
          model: formModel.trim() || undefined,
          link: formLink || undefined,
          zone_id: String(form.get('zone_id') || '') || null,
          map_icon,
          map_icon_size,
          reaction: formReaction,
        })
      }
      setCreating(false)
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdate(form: FormData) {
    if (!editing) return
    setBusy(true)
    onError(null)
    try {
      const zoneVal = String(form.get('zone_id') || '')
      await updateDevice(editing.global_id, {
        device_type: formFamily || String(form.get('device_type') || 'sensor'),
        label: String(form.get('label') || ''),
        model: formModel.trim(),
        link: formLink,
        map_icon: String(form.get('map_icon') || formIcon),
        map_icon_size: clampMapIconSize(Number(form.get('map_icon_size') || formIconSize)),
        reaction: formReaction,
        ...(zoneVal ? { zone_id: zoneVal } : { clear_zone: true }),
      })
      setEditing(null)
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const allSelected = devices.length > 0 && devices.every((d) => selected.has(d.global_id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <Btn disabled={!writeAllowed} onClick={() => { setCreating(true); setEditing(null); setBulk(true) }}>
          <Plus className="size-3.5" /> {vi.addDevice}
        </Btn>
        {selected.size > 0 && (
          <Btn
            tone="danger"
            disabled={!writeAllowed || busy}
            onClick={() => {
              if (!window.confirm(vi.confirmDeleteDevices(selected.size))) return
              setBusy(true)
              void deleteDevicesBulk([...selected])
                .then(async (r) => {
                  setSelected(new Set())
                  onInfo(vi.deleteResult(r.deleted_count))
                  await onReload()
                })
                .catch((e) => onError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            <Trash2 className="size-3.5" /> {vi.deleteSelected} ({selected.size})
          </Btn>
        )}
      </div>

      {(creating || editing) && (
        <Card>
          {creating && (
            <div className="mb-3 flex gap-1 rounded-md border border-line bg-mist/40 p-0.5 text-xs">
              <button
                type="button"
                className={`rounded px-2.5 py-1 ${bulk ? 'bg-panel shadow-sm' : ''}`}
                onClick={() => setBulk(true)}
              >
                {vi.bulkMode}
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 ${!bulk ? 'bg-panel shadow-sm' : ''}`}
                onClick={() => setBulk(false)}
              >
                {vi.singleMode}
              </button>
            </div>
          )}
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              if (creating) void handleCreate(form)
              else void handleUpdate(form)
            }}
          >
            {creating && bulk && (
              <>
                <Field label={vi.deviceFrom}>
                  <input name="from_num" type="number" min={0} max={99} className={inputClass} defaultValue={1} required />
                </Field>
                <Field label={vi.deviceTo}>
                  <input name="to_num" type="number" min={0} max={99} className={inputClass} defaultValue={80} required />
                </Field>
                <Field label={vi.labelPrefix}>
                  <input name="label_prefix" className={inputClass} defaultValue="Địa chỉ" />
                </Field>
              </>
            )}
            {creating && !bulk && (
              <>
                <Field label={vi.deviceNum}>
                  <input name="device_num" type="number" min={0} max={99} className={inputClass} defaultValue={1} required />
                </Field>
                <Field label={vi.label}>
                  <input name="label" className={inputClass} />
                </Field>
                <Field label={vi.tabZones}>
                  <select name="zone_id" className={inputClass} defaultValue="">
                    <option value="">{vi.unassignZone}</option>
                    {zones.map((z) => (
                      <option key={z.zone_id} value={z.zone_id}>{z.name}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {editing && (
              <>
                <Field label={vi.label}>
                  <input name="label" className={inputClass} defaultValue={editing.label} />
                </Field>
                <Field label={vi.tabZones}>
                  <select name="zone_id" className={inputClass} defaultValue={editing.zone_id ?? ''}>
                    <option value="">{vi.unassignZone}</option>
                    {zones.map((z) => (
                      <option key={z.zone_id} value={z.zone_id}>{z.name}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field label={vi.deviceType}>
              <select
                name="device_type"
                className={inputClass}
                value={formFamily}
                onChange={(e) => {
                  const t = e.target.value
                  setFormFamily(t)
                  if (!editing?.map_icon) setFormIcon(t)
                  if (!modelFitsFamily(formModel, t)) setFormModel('')
                }}
              >
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>{deviceTypeLabel[t]}</option>
                ))}
              </select>
            </Field>
            <DeviceModelPicker
              family={formFamily}
              model={formModel}
              link={formLink}
              onModelChange={setFormModel}
              onLinkChange={setFormLink}
            />
            <ReactionSelect value={formReaction} onChange={setFormReaction} />
            <p className="sm:col-span-2 text-[11px] text-steel/60">{vi.reactionHint}</p>
            <p className="sm:col-span-2 text-[11px] text-steel/60">{vi.modelPickerHint}</p>
            <DeviceIconPicker
              value={formIcon}
              size={formIconSize}
              onChange={setFormIcon}
              onSizeChange={setFormIconSize}
            />
            <div className="flex items-end gap-2 sm:col-span-2">
              <Btn type="submit" disabled={busy || !writeAllowed}>{vi.save}</Btn>
              <Btn tone="ghost" onClick={() => { setCreating(false); setEditing(null) }}>{vi.cancel}</Btn>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line bg-mist/50 text-[11px] text-steel/70">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={!devices.length || !writeAllowed}
                  onChange={() => {
                    if (allSelected) setSelected(new Set())
                    else setSelected(new Set(devices.map((d) => d.global_id)))
                  }}
                  className="size-3.5 accent-accent"
                />
              </th>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">{vi.label}</th>
              <th className="px-4 py-2">{vi.model}</th>
              <th className="px-4 py-2">{vi.link}</th>
              <th className="px-4 py-2">{vi.tabZones}</th>
              <th className="px-4 py-2">{vi.deviceType}</th>
              <th className="px-4 py-2">{vi.reaction}</th>
              <th className="px-4 py-2">{vi.status}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.global_id} className="border-b border-line/60">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(d.global_id)}
                    disabled={!writeAllowed}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(d.global_id)) next.delete(d.global_id)
                      else next.add(d.global_id)
                      setSelected(next)
                    }}
                    className="size-3.5 accent-accent"
                  />
                </td>
                <td className="px-4 py-2 font-mono text-xs text-accent" title={d.global_id}>
                  {d.device_num != null ? d.device_num : d.global_id}
                </td>
                <td className="px-4 py-2">{d.label || '—'}</td>
                <td className="px-4 py-2 font-mono text-xs text-steel">{d.model || '—'}</td>
                <td className="px-4 py-2"><LinkBadge link={d.link} /></td>
                <td className="px-4 py-2 text-xs">
                  {d.zone_id
                    ? (() => {
                        const z = zoneMap.get(d.zone_id)
                        if (!z) return d.zone_id
                        const name = (z.name || '').trim()
                        const sec = z.section_num
                        if (sec != null && sec >= 1) {
                          if (!name || /^section\s*\d+$/i.test(name)) return String(sec)
                          return `${sec}: ${name}`
                        }
                        return name || d.zone_id
                      })()
                    : '—'}
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    <DeviceTypeIcon type={resolveDeviceIconKey(d)} className="size-3.5" />
                    {labelOf(deviceTypeLabel, d.device_type)}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <ReactionBadge reaction={d.reaction} />
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-1">
                    <StateDot state={d.state} />
                    {labelOf(deviceStateLabel, d.state || 'ok')}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      disabled={!writeAllowed}
                      className="rounded p-1.5 text-steel hover:bg-mist"
                      onClick={() => { setEditing(d); setCreating(false) }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!writeAllowed || busy}
                      className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger"
                      onClick={() => {
                        if (!window.confirm(vi.confirmDeleteDevice(d.global_id))) return
                        setBusy(true)
                        void deleteDevice(d.global_id).then(onReload).finally(() => setBusy(false))
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!devices.length && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-steel/50">{vi.noDevices}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function PgTab({
  panelId,
  pgs,
  zones,
  zoneMap,
  writeAllowed,
  busy,
  onReload,
  onError,
  setBusy,
}: {
  panelId: string
  pgs: PgOutput[]
  zones: Zone[]
  zoneMap: Map<string, Zone>
  writeAllowed: boolean
  busy: boolean
  onReload: () => Promise<void>
  onError: (m: string | null) => void
  setBusy: (b: boolean) => void
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PgOutput | null>(null)

  async function handleSubmit(form: FormData) {
    setBusy(true)
    onError(null)
    try {
      const body = {
        pg_num: Number(form.get('pg_num')),
        label: String(form.get('label') || ''),
        zone_id: String(form.get('zone_id') || '') || null,
        mode: String(form.get('mode') || 'pulse'),
      }
      if (editing) await updatePg(panelId, editing.pg_id, body)
      else await createPg(panelId, body)
      setCreating(false)
      setEditing(null)
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleState(pg: PgOutput) {
    setBusy(true)
    try {
      await updatePg(panelId, pg.pg_id, { state: pg.state === 'on' ? 'off' : 'on' })
      await onReload()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn disabled={!writeAllowed} onClick={() => { setCreating(true); setEditing(null) }}>
          <Plus className="size-3.5" /> {vi.addPg}
        </Btn>
      </div>

      {(creating || editing) && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit(new FormData(e.currentTarget))
            }}
          >
            <Field label={vi.pgNum}>
              <input
                name="pg_num"
                type="number"
                min={1}
                max={128}
                className={inputClass}
                defaultValue={editing?.pg_num ?? 1}
                required
              />
            </Field>
            <Field label={vi.label}>
              <input name="label" className={inputClass} defaultValue={editing?.label ?? ''} />
            </Field>
            <Field label={vi.tabZones}>
              <select name="zone_id" className={inputClass} defaultValue={editing?.zone_id ?? ''}>
                <option value="">{vi.unassignZone}</option>
                {zones.map((z) => (
                  <option key={z.zone_id} value={z.zone_id}>{z.name}</option>
                ))}
              </select>
            </Field>
            <Field label={vi.pgMode}>
              <select name="mode" className={inputClass} defaultValue={editing?.mode ?? 'pulse'}>
                {PG_MODES.map((m) => (
                  <option key={m} value={m}>{pgModeLabel[m]}</option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Btn type="submit" disabled={busy || !writeAllowed}>{vi.save}</Btn>
              <Btn tone="ghost" onClick={() => { setCreating(false); setEditing(null) }}>{vi.cancel}</Btn>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-mist/50 text-[11px] text-steel/70">
            <tr>
              <th className="px-4 py-2">PG</th>
              <th className="px-4 py-2">{vi.label}</th>
              <th className="px-4 py-2">{vi.tabZones}</th>
              <th className="px-4 py-2">{vi.pgMode}</th>
              <th className="px-4 py-2">{vi.pgState}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {pgs.map((pg) => (
              <tr key={pg.pg_id} className="border-b border-line/60">
                <td className="px-4 py-2 font-mono">{pg.pg_num}</td>
                <td className="px-4 py-2">{pg.label}</td>
                <td className="px-4 py-2 text-xs">
                  {pg.zone_id ? zoneMap.get(pg.zone_id)?.name ?? pg.zone_id : '—'}
                </td>
                <td className="px-4 py-2">{labelOf(pgModeLabel, pg.mode)}</td>
                <td className="px-4 py-2">
                  {writeAllowed ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        pg.state === 'on' ? 'bg-ok/15 text-ok' : 'bg-mist text-steel'
                      }`}
                      onClick={() => void toggleState(pg)}
                    >
                      {labelOf(pgStateLabel, pg.state)}
                    </button>
                  ) : (
                    labelOf(pgStateLabel, pg.state)
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      disabled={!writeAllowed}
                      className="rounded p-1.5 text-steel hover:bg-mist"
                      onClick={() => { setEditing(pg); setCreating(false) }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!writeAllowed || busy}
                      className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger"
                      onClick={() => {
                        if (!window.confirm(vi.confirmDeletePg(pg.label))) return
                        setBusy(true)
                        void deletePg(panelId, pg.pg_id).then(onReload).finally(() => setBusy(false))
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!pgs.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-steel/50">{vi.noPgs}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
