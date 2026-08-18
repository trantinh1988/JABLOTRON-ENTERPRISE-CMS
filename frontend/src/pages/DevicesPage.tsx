import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Usb,
  X,
} from 'lucide-react'
import {
  createDevice,
  createDevicesBulk,
  createPanel,
  deleteDevice,
  deleteDevicesBulk,
  deletePanel,
  listZones,
  syncPanelDevices,
  updateDevice,
  updatePanel,
  type Device,
  type Panel,
  type Zone,
} from '../api/client'
import { DeviceIconPicker } from '../components/DeviceIconPicker'
import { DeviceModelPicker, LinkBadge } from '../components/DeviceModelPicker'
import { DeviceTypeIcon } from '../components/DeviceTypeIcon'
import { ReactionBadge, ReactionSelect } from '../components/ReactionBadge'
import { ImportPanelConfigCard } from '../components/ImportPanelConfigCard'
import { Btn, Card, Field, PageHeader, StateDot, inputClass } from '../components/ui'
import {
  clampMapIconSize,
  DEFAULT_MAP_ICON_SIZE,
  resolveDeviceIconKey,
} from '../lib/deviceIconLibrary'
import { DEFAULT_DEVICE_REACTION, normalizeReaction } from '../lib/deviceReaction'
import { DEVICE_FAMILY_KEYS, familyOfType, modelFitsFamily, normalizeDeviceLink, type DeviceLink } from '../lib/deviceCatalog'
import {
  connectionLabel,
  deviceStateLabel,
  deviceTypeLabel,
  effectiveDeviceStatus,
  labelOf,
  vi,
} from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  writeAllowed: boolean
  mockMode: boolean | null
  usbHint: string | null
  wsConnected?: boolean
  liveActive?: boolean
  liveFlashIds?: Set<string>
  onRefresh: () => Promise<void>
}

function deviceAddressId(d: Device): string {
  if (d.device_num != null && d.device_num >= 0) return String(d.device_num)
  const m = /_DEV_(\d+)$/i.exec(d.global_id)
  return m ? String(Number(m[1])) : d.global_id
}

function deviceSortKey(d: Device): number {
  if (d.device_num != null && d.device_num >= 0) return d.device_num
  const m = /_DEV_(\d+)$/i.exec(d.global_id)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

/** F-Link style: "1: BAO DONG" when zone has a custom name; else just section number. */
function zoneDisplayName(zone: Zone | undefined, zoneId: string | null | undefined): string {
  if (!zoneId) return '—'
  if (!zone) return zoneId
  const name = (zone.name || '').trim()
  const sec = zone.section_num
  if (sec != null && sec >= 1) {
    if (!name || /^section\s*\d+$/i.test(name)) return String(sec)
    return `${sec}: ${name}`
  }
  return name || zoneId
}

const TYPES = DEVICE_FAMILY_KEYS

function statusDisplayLabel(d: Device): string {
  return labelOf(deviceStateLabel, effectiveDeviceStatus(d.state, d.disable))
}

type FormMode = 'device' | 'panel' | null

function FormOverlay({
  children,
  onClose,
  size = 'md',
}: {
  children: ReactNode
  onClose: () => void
  size?: 'sm' | 'md' | 'lg'
}) {
  const max = size === 'lg' ? 'max-w-3xl' : size === 'sm' ? 'max-w-lg' : 'max-w-2xl'
  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/55 p-4 pt-[6vh] backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`mb-10 w-full ${max} overflow-hidden rounded-xl bg-panel p-4 shadow-xl ring-1 ring-line`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function DevicesPage({
  panels,
  devices,
  writeAllowed,
  mockMode,
  usbHint,
  wsConnected = false,
  liveActive = false,
  liveFlashIds,
  onRefresh,
}: Props) {
  const [editing, setEditing] = useState<Device | null>(null)
  const [editingPanel, setEditingPanel] = useState<Panel | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [bulk, setBulk] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filterPanel, setFilterPanel] = useState('')
  const [query, setQuery] = useState('')
  const [pickedPanel, setPickedPanel] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [zones, setZones] = useState<Zone[]>([])
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
    } else if (formMode === 'device') {
      setFormIcon('sensor')
      setFormIconSize(DEFAULT_MAP_ICON_SIZE)
      setFormFamily('sensor')
      setFormModel('')
      setFormLink('')
      setFormReaction(DEFAULT_DEVICE_REACTION)
    }
  }, [editing, formMode])

  const panelIdsKey = panels.map((p) => p.panel_id).join('|')

  useEffect(() => {
    let cancelled = false
    async function loadZones() {
      const ids = panelIdsKey ? panelIdsKey.split('|') : []
      if (!ids.length) {
        if (!cancelled) setZones([])
        return
      }
      try {
        const lists = await Promise.all(ids.map((id) => listZones(id)))
        if (!cancelled) setZones(lists.flat())
      } catch {
        if (!cancelled) setZones([])
      }
    }
    void loadZones()
    return () => {
      cancelled = true
    }
  }, [panelIdsKey])

  useEffect(() => {
    if (pickedPanel || !panels.length) return
    const usb = panels.find((p) => p.connection === 'usb')
    setFilterPanel(usb?.panel_id ?? panels[0].panel_id)
  }, [panels, pickedPanel])

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])

  const panelFiltered = useMemo(
    () => (filterPanel ? devices.filter((d) => d.panel_id === filterPanel) : devices),
    [devices, filterPanel],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = q
      ? panelFiltered.filter((d) => {
          const zone = zoneDisplayName(zoneMap.get(d.zone_id || ''), d.zone_id)
          const hay = `${deviceAddressId(d)} ${d.label} ${d.model || ''} ${d.panel_id} ${d.device_type} ${d.global_id} ${zone}`.toLowerCase()
          return hay.includes(q)
        })
      : panelFiltered
    return [...rows].sort((a, b) => deviceSortKey(a) - deviceSortKey(b) || a.global_id.localeCompare(b.global_id))
  }, [panelFiltered, query, zoneMap])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((d) => selected.has(d.global_id))

  const nextPanelIndex = useMemo(() => {
    const used = new Set<number>()
    for (const p of panels) {
      const m = /^PANEL_(\d+)$/i.exec(p.panel_id)
      if (m) used.add(Number(m[1]))
    }
    let n = 1
    while (used.has(n)) n += 1
    return n
  }, [panels])

  const selectedPanel = filterPanel ? panels.find((p) => p.panel_id === filterPanel) ?? null : null

  function clearMessages() {
    setInfo(null)
    setError(null)
  }

  function selectPanel(id: string) {
    setPickedPanel(true)
    setFilterPanel(id)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const d of filtered) next.delete(d.global_id)
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const d of filtered) next.add(d.global_id)
        return next
      })
    }
  }

  async function handleCreatePanel(form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      const created = await createPanel({
        panel_index: Number(form.get('panel_index')),
        display_name: String(form.get('display_name') || ''),
      })
      setFormMode(null)
      setPickedPanel(true)
      setFilterPanel(created.panel_id)
      setInfo(vi.panelDeclared)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdatePanel(panelId: string, form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      await updatePanel(panelId, { display_name: String(form.get('display_name') || '') })
      setEditingPanel(null)
      setInfo(vi.panelUpdated)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDeletePanel(p: Panel) {
    if (!window.confirm(vi.confirmDeletePanel(p.display_name || p.panel_id, p.device_count))) return
    setBusy(true)
    clearMessages()
    try {
      await deletePanel(p.panel_id)
      if (filterPanel === p.panel_id) setFilterPanel('')
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of prev) {
          if (id.startsWith(`${p.panel_id}_`)) next.delete(id)
        }
        return next
      })
      setInfo(vi.panelDeleted)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      const panel_id = String(form.get('panel_id'))
      const device_type = formFamily || String(form.get('device_type') || 'sensor')
      const map_icon = String(form.get('map_icon') || formIcon || device_type)
      const map_icon_size = clampMapIconSize(
        Number(form.get('map_icon_size') || formIconSize),
      )
      if (bulk) {
        const from_num = Number(form.get('from_num'))
        const to_num = Number(form.get('to_num'))
        if (to_num < from_num) throw new Error('Đến địa chỉ phải ≥ Từ địa chỉ')
        const result = await createDevicesBulk({
          panel_id,
          from_num,
          to_num,
          device_type,
          label_prefix: String(form.get('label_prefix') || ''),
          model: formModel.trim() || undefined,
          link: formLink || undefined,
          map_icon,
          map_icon_size,
          reaction: formReaction,
        })
        setInfo(vi.bulkResult(result.created_count, result.skipped_count))
      } else {
        await createDevice({
          panel_id,
          device_num: Number(form.get('device_num')),
          device_type,
          label: String(form.get('label') || ''),
          model: formModel.trim() || undefined,
          link: formLink || undefined,
          map_icon,
          map_icon_size,
          reaction: formReaction,
        })
      }
      setFormMode(null)
      if (panel_id) {
        setPickedPanel(true)
        setFilterPanel(panel_id)
      }
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdate(globalId: string, form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      await updateDevice(globalId, {
        device_type: formFamily || String(form.get('device_type') || 'sensor'),
        label: String(form.get('label') || ''),
        model: formModel.trim(),
        link: formLink,
        map_icon: String(form.get('map_icon') || formIcon),
        map_icon_size: clampMapIconSize(Number(form.get('map_icon_size') || formIconSize)),
        reaction: formReaction,
      })
      setEditing(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(d: Device) {
    if (!window.confirm(vi.confirmDeleteDevice(d.global_id))) return
    setBusy(true)
    clearMessages()
    try {
      await deleteDevice(d.global_id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(d.global_id)
        return next
      })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSelected() {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(vi.confirmDeleteDevices(ids.length))) return
    setBusy(true)
    clearMessages()
    try {
      const result = await deleteDevicesBulk(ids)
      setSelected(new Set())
      setInfo(vi.deleteResult(result.deleted_count))
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const creating = formMode === 'device'
  const creatingPanel = formMode === 'panel'

  const usbPanel = panels.find((p) => p.connection === 'usb')

  async function handleSyncStates() {
    if (!usbPanel) return
    setBusy(true)
    setError(null)
    try {
      const result = await syncPanelDevices(usbPanel.panel_id)
      const base = vi.syncDeviceStatesOk(result.synced ?? 0)
      const detail =
        result.matched_declared != null
          ? ` ${vi.syncDeviceStatesDetail(result.matched_declared, result.hid_device_updates ?? 0)}`
          : ''
      setInfo(`${base}${detail} — ${vi.syncCloseFlinkHint}`)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const workspaceTitle = selectedPanel
    ? `${vi.devicesWorkspace} · ${selectedPanel.display_name}`
    : vi.devicesSection

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader
        title={vi.devicesPageTitle}
        hint={vi.devicesPageHint}
        actions={
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] ring-1 ${
              liveActive
                ? 'bg-ok/10 text-ok ring-ok/25'
                : wsConnected
                  ? 'bg-steel/10 text-steel ring-steel/20'
                  : 'bg-danger/10 text-danger ring-danger/20'
            }`}
            title={vi.realtimeHint}
          >
            <span
              className={`size-1.5 rounded-full ${
                liveActive ? 'bg-ok animate-pulse' : wsConnected ? 'bg-steel' : 'bg-danger'
              }`}
            />
            {liveActive ? vi.realtimeLive : wsConnected ? vi.realtimeIdle : vi.wsDown}
          </span>
        }
      />

      {!writeAllowed && (
        <p className="mb-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">{vi.readOnlyHint}</p>
      )}
      {panels.some((p) => p.connection === 'usb' && !p.has_stream_code) && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          {vi.streamCodeMissing}{' '}
          <Link className="underline" to="/">
            {vi.navDashboard}
          </Link>
          {' · '}
          <Link className="underline" to={`/panels/${panels.find((p) => p.connection === 'usb')?.panel_id || ''}`}>
            {vi.panelSetup}
          </Link>
        </p>
      )}
      {mockMode === false && usbHint && panels.every((p) => p.connection !== 'usb') && (
        <div className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs text-warn">
          <p className="font-semibold">{vi.usbConnectTitle}</p>
          <p className="mt-1 text-warn/90">{usbHint}</p>
          <p className="mt-2 font-mono text-[10px] text-warn/80">{vi.usbConnectSteps}</p>
        </div>
      )}
      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {info && <p className="mb-3 rounded-md bg-ok/10 px-3 py-2 text-xs text-ok">{info}</p>}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18.5rem_minmax(0,1fr)] lg:overflow-hidden">
        <Card className="flex max-h-64 flex-col overflow-hidden p-0 lg:max-h-none lg:min-h-0">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <h3 className="text-sm font-semibold">{vi.panelsSection}</h3>
            <Btn
              tone="ghost"
              className="px-2 py-1.5"
              disabled={!writeAllowed}
              onClick={() => {
                setFormMode('panel')
                setEditingPanel(null)
                setEditing(null)
                setShowImport(false)
                clearMessages()
              }}
            >
              <Plus className="size-3.5" /> {vi.addPanel}
            </Btn>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => selectPanel('')}
              className={`mb-0.5 flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                !filterPanel
                  ? 'bg-accent/12 text-ink ring-1 ring-accent/30'
                  : 'text-steel hover:bg-mist/70 hover:text-ink'
              }`}
            >
              <span className="font-medium">{vi.allPanels}</span>
              <span className="font-mono text-[11px] text-steel/70">{devices.length}</span>
            </button>
            {panels.map((p) => {
              const active = filterPanel === p.panel_id
              const usb = p.connection === 'usb'
              return (
                <div
                  key={p.panel_id}
                  className={`group mb-0.5 flex items-stretch rounded-md ${
                    active ? 'bg-accent/12 ring-1 ring-accent/30' : 'hover:bg-mist/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectPanel(p.panel_id)}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <p className="truncate text-sm font-medium text-ink">{p.display_name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-steel/70">
                      {usb && <Usb className="size-3 text-ok" />}
                      <span className={usb ? 'text-ok' : ''}>{labelOf(connectionLabel, p.connection)}</span>
                      <span>·</span>
                      <span>{p.panel_id}</span>
                    </p>
                  </button>
                  <div className="flex flex-col justify-center pr-1">
                    <span className="rounded bg-mist px-1.5 py-0.5 font-mono text-[10px] text-steel">
                      {vi.deviceCountShort(p.device_count)}
                    </span>
                  </div>
                </div>
              )
            })}
            {!panels.length && (
              <p className="px-2.5 py-6 text-center text-xs text-steel/50">{vi.noPanels}</p>
            )}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden p-0">
          <div className="border-b border-line px-3 py-2.5 sm:px-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{workspaceTitle}</h3>
                {selectedPanel && (
                  <p className="mt-0.5 font-mono text-[11px] text-steel/60">{selectedPanel.panel_id}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedPanel && (
                  <>
                    <Link
                      to={`/panels/${encodeURIComponent(selectedPanel.panel_id)}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-mist px-2.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-line hover:bg-line/40"
                      title={vi.panelSetup}
                    >
                      <Settings2 className="size-3.5" /> {vi.panelSetup}
                    </Link>
                    <Btn
                      tone="ghost"
                      className="px-2 py-1.5"
                      disabled={!writeAllowed}
                      onClick={() => {
                        setEditingPanel(selectedPanel)
                        setFormMode(null)
                        setEditing(null)
                        setShowImport(false)
                        clearMessages()
                      }}
                    >
                      <Pencil className="size-3.5" /> {vi.editPanel}
                    </Btn>
                    <Btn
                      tone="ghost"
                      className="px-2 py-1.5"
                      disabled={!writeAllowed || busy}
                      onClick={() => void handleDeletePanel(selectedPanel)}
                    >
                      <Trash2 className="size-3.5" /> {vi.deletePanel}
                    </Btn>
                  </>
                )}
                {panels.length > 0 && (
                  <Btn
                    tone="ghost"
                    className="px-2 py-1.5"
                    disabled={!writeAllowed || busy}
                    onClick={() => {
                      setShowImport(true)
                      setFormMode(null)
                      setEditing(null)
                      setEditingPanel(null)
                      clearMessages()
                    }}
                  >
                    <Download className="size-3.5" /> {vi.importPanelConfig}
                  </Btn>
                )}
                {usbPanel && (
                  <Btn tone="ghost" className="px-2 py-1.5" disabled={busy} onClick={() => void handleSyncStates()}>
                    <RefreshCw className="size-3.5" /> {vi.syncDeviceStates}
                  </Btn>
                )}
                <Btn
                  className="px-2.5 py-1.5"
                  disabled={!writeAllowed}
                  onClick={() => {
                    setFormMode('device')
                    setEditing(null)
                    setEditingPanel(null)
                    setShowImport(false)
                    setBulk(true)
                    clearMessages()
                  }}
                >
                  <Plus className="size-3.5" /> {vi.addDevice}
                </Btn>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-steel/50" />
                <input
                  className={`${inputClass} py-1.5 pl-8`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={vi.devicesSearchPh}
                  aria-label={vi.devicesSearch}
                />
              </div>
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-steel">{vi.selectedCount(selected.size)}</span>
                  <Btn
                    tone="danger"
                    className="px-2 py-1.5"
                    disabled={!writeAllowed || busy}
                    onClick={() => void handleDeleteSelected()}
                  >
                    <Trash2 className="size-3.5" /> {vi.deleteSelected}
                  </Btn>
                </>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-line bg-mist/90 font-mono text-[11px] text-steel/70 backdrop-blur-sm">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      disabled={!filtered.length || !writeAllowed}
                      onChange={toggleSelectAll}
                      aria-label={vi.selectAll}
                      className="size-3.5 accent-accent"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">ID</th>
                  <th className="px-3 py-2.5 font-medium">{vi.label}</th>
                  <th className="px-3 py-2.5 font-medium">{vi.model}</th>
                  <th className="px-3 py-2.5 font-medium">{vi.link}</th>
                  {!filterPanel && <th className="px-3 py-2.5 font-medium">{vi.panel}</th>}
                  <th className="px-3 py-2.5 font-medium">{vi.tabZones}</th>
                  <th className="px-3 py-2.5 font-medium">{vi.deviceType}</th>
                  <th className="px-3 py-2.5 font-medium">{vi.reaction}</th>
                  <th className="px-3 py-2.5 font-medium">{vi.status}</th>
                  <th className="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const shown = effectiveDeviceStatus(d.state, d.disable)
                  return (
                    <tr
                      key={`${d.global_id}-${d.state}-${d.disable}`}
                      className={`border-b border-line/60 hover:bg-mist/30 ${
                        liveFlashIds?.has(d.global_id)
                          ? 'live-flash'
                          : selected.has(d.global_id)
                            ? 'bg-accent/5'
                            : shown === 'alarm' ||
                                shown === 'tamper' ||
                                shown === 'loss' ||
                                shown === 'fault'
                              ? 'bg-danger/5'
                              : shown === 'open'
                                ? 'bg-warn/5'
                                : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(d.global_id)}
                          disabled={!writeAllowed}
                          onChange={() => toggleSelect(d.global_id)}
                          aria-label={d.global_id}
                          className="size-3.5 accent-accent"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-accent" title={d.global_id}>
                        {deviceAddressId(d)}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2">{d.label || '—'}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-steel">{d.model || '—'}</td>
                      <td className="px-3 py-2">
                        <LinkBadge link={d.link} />
                      </td>
                      {!filterPanel && (
                        <td className="px-3 py-2 font-mono text-[12px] text-steel">{d.panel_id}</td>
                      )}
                      <td className="px-3 py-2 text-[12px] text-steel">
                        {zoneDisplayName(zoneMap.get(d.zone_id || ''), d.zone_id)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <DeviceTypeIcon type={resolveDeviceIconKey(d)} className="size-3.5 text-steel" />
                          {labelOf(deviceTypeLabel, d.device_type)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <ReactionBadge reaction={d.reaction} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <StateDot state={effectiveDeviceStatus(d.state, d.disable)} />
                          {statusDisplayLabel(d)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            disabled={!writeAllowed}
                            className="rounded p-1.5 text-steel hover:bg-mist hover:text-ink disabled:opacity-40"
                            onClick={() => {
                              setEditing(d)
                              setFormMode(null)
                              setEditingPanel(null)
                              setShowImport(false)
                            }}
                            title={vi.editDevice}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!writeAllowed || busy}
                            className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger disabled:opacity-40"
                            onClick={() => void handleDelete(d)}
                            title={vi.deleteDevice}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!filtered.length && (
                  <tr>
                    <td
                      colSpan={filterPanel ? 10 : 11}
                      className="px-4 py-10 text-center text-sm text-steel/50"
                    >
                      {!panels.length
                        ? vi.noPanelsHint
                        : panelFiltered.length === 0 && filterPanel
                          ? vi.devicesEmptyPanel
                          : vi.noDevices}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {showImport && (
        <FormOverlay onClose={() => setShowImport(false)} size="lg">
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="sr-only">{vi.importPanelConfig}</span>
            <button
              type="button"
              className="ml-auto rounded p-1 text-steel hover:bg-mist hover:text-ink"
              onClick={() => setShowImport(false)}
              aria-label={vi.cancel}
            >
              <X className="size-4" />
            </button>
          </div>
          <ImportPanelConfigCard
            panels={panels}
            selectedPanelId={filterPanel || undefined}
            writeAllowed={writeAllowed}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
            onInfo={setInfo}
            onDone={onRefresh}
            className="mb-0"
          />
        </FormOverlay>
      )}

      {(creatingPanel || editingPanel) && (
        <FormOverlay
          size="sm"
          onClose={() => {
            setFormMode(null)
            setEditingPanel(null)
          }}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold">{editingPanel ? vi.editPanel : vi.addPanel}</h3>
            <button
              type="button"
              className="rounded p-1 text-steel hover:bg-mist hover:text-ink"
              onClick={() => {
                setFormMode(null)
                setEditingPanel(null)
              }}
              aria-label={vi.cancel}
            >
              <X className="size-4" />
            </button>
          </div>
          {!editingPanel && <p className="mb-3 text-xs text-steel/70">{vi.addPanelHint}</p>}
          <form
            key={editingPanel?.panel_id ?? 'new-panel'}
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              if (editingPanel) void handleUpdatePanel(editingPanel.panel_id, form)
              else void handleCreatePanel(form)
            }}
          >
            {!editingPanel && (
              <Field label={vi.panelIndex}>
                <input
                  name="panel_index"
                  type="number"
                  min={1}
                  max={999}
                  required
                  className={inputClass}
                  defaultValue={nextPanelIndex}
                />
              </Field>
            )}
            {editingPanel && (
              <Field label="ID">
                <input className={inputClass} value={editingPanel.panel_id} disabled readOnly />
              </Field>
            )}
            <Field label={vi.panelName}>
              <input
                name="display_name"
                className={inputClass}
                placeholder={`Tủ Jablotron ${nextPanelIndex}`}
                defaultValue={editingPanel?.display_name ?? `Tủ Jablotron ${nextPanelIndex}`}
                required
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn
                tone="ghost"
                onClick={() => {
                  setFormMode(null)
                  setEditingPanel(null)
                }}
              >
                {vi.cancel}
              </Btn>
              <Btn type="submit" disabled={busy || !writeAllowed}>
                {vi.save}
              </Btn>
            </div>
          </form>
        </FormOverlay>
      )}

      {(creating || editing) && (
        <FormOverlay
          size="lg"
          onClose={() => {
            setFormMode(null)
            setEditing(null)
          }}
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-base font-semibold">{creating ? vi.addDevice : vi.editDevice}</h3>
            <div className="flex items-center gap-2">
              {creating && (
                <div className="flex gap-1 rounded-md border border-line bg-mist/40 p-0.5 text-xs">
                  <button
                    type="button"
                    className={`rounded px-2.5 py-1 ${bulk ? 'bg-panel text-ink shadow-sm' : 'text-steel'}`}
                    onClick={() => setBulk(true)}
                  >
                    {vi.bulkMode}
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2.5 py-1 ${!bulk ? 'bg-panel text-ink shadow-sm' : 'text-steel'}`}
                    onClick={() => setBulk(false)}
                  >
                    {vi.singleMode}
                  </button>
                </div>
              )}
              <button
                type="button"
                className="rounded p-1 text-steel hover:bg-mist hover:text-ink"
                onClick={() => {
                  setFormMode(null)
                  setEditing(null)
                }}
                aria-label={vi.cancel}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <form
            key={editing?.global_id ?? `create-${bulk}`}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              if (creating) void handleCreate(form)
              else if (editing) void handleUpdate(editing.global_id, form)
            }}
          >
            {creating && (
              <div className="rounded-lg bg-mist/30 p-3">
                <p className="mb-3 text-[11px] font-semibold tracking-wide text-steel/80 uppercase">
                  {vi.deviceFormAddress}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                <Field label={vi.panel}>
                  <select
                    name="panel_id"
                    required
                    className={inputClass}
                    defaultValue={filterPanel || panels[0]?.panel_id}
                    disabled={!panels.length}
                  >
                    {panels.map((p) => (
                      <option key={p.panel_id} value={p.panel_id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
                {bulk ? (
                  <>
                    <Field label={vi.labelPrefix}>
                      <input
                        name="label_prefix"
                        className={inputClass}
                        placeholder="VD: Địa chỉ"
                        defaultValue="Địa chỉ"
                      />
                    </Field>
                    <Field label={vi.deviceFrom}>
                      <input
                        name="from_num"
                        type="number"
                        min={0}
                        max={99}
                        required
                        className={inputClass}
                        defaultValue={1}
                      />
                    </Field>
                    <Field label={vi.deviceTo}>
                      <input
                        name="to_num"
                        type="number"
                        min={0}
                        max={99}
                        required
                        className={inputClass}
                        defaultValue={80}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={vi.deviceNum}>
                      <input
                        name="device_num"
                        type="number"
                        min={0}
                        max={99}
                        required
                        className={inputClass}
                        defaultValue={1}
                      />
                    </Field>
                    <Field label={vi.label}>
                      <input name="label" className={inputClass} placeholder="VD: Cửa chính" />
                    </Field>
                  </>
                )}
                </div>
              </div>
            )}
            {!creating && (
              <Field label={vi.label}>
                <input
                  name="label"
                  className={inputClass}
                  defaultValue={editing?.label ?? ''}
                  placeholder="VD: Cửa chính"
                />
              </Field>
            )}
            <div className="rounded-lg bg-mist/30 p-3">
              <p className="mb-3 text-[11px] font-semibold tracking-wide text-steel/80 uppercase">
                {vi.deviceFormIdentity}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
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
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {deviceTypeLabel[t]}
                    </option>
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
              </div>
            </div>
            <div className="rounded-lg bg-mist/30 p-3">
              <DeviceIconPicker
                compact
                value={formIcon}
                size={formIconSize}
                onChange={setFormIcon}
                onSizeChange={setFormIconSize}
              />
            </div>
            {!panels.length && creating && <p className="text-xs text-warn">{vi.noPanelsHint}</p>}
            <div className="flex justify-end gap-2">
              <Btn
                tone="ghost"
                onClick={() => {
                  setFormMode(null)
                  setEditing(null)
                }}
              >
                {vi.cancel}
              </Btn>
              <Btn type="submit" disabled={busy || !writeAllowed || (creating && !panels.length)}>
                {vi.save}
              </Btn>
            </div>
          </form>
        </FormOverlay>
      )}
    </div>
  )
}
