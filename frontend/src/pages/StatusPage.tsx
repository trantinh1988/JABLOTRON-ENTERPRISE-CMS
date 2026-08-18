import { useEffect, useMemo, useState } from 'react'
import { FileDown, RefreshCw, Search, X } from 'lucide-react'
import { listZones, type Device, type Panel, type Zone } from '../api/client'
import { Btn, Card, Field, PageHeader, StateDot, inputClass } from '../components/ui'
import { DeviceTypeIcon } from '../components/DeviceTypeIcon'
import { LinkBadge } from '../components/DeviceModelPicker'
import { ReactionBadge } from '../components/ReactionBadge'
import { resolveDeviceIconKey } from '../lib/deviceIconLibrary'
import { DEVICE_FAMILY_KEYS, familyOfType, normalizeDeviceLink } from '../lib/deviceCatalog'
import { reactionChipLabel } from '../lib/deviceReaction'
import { exportTableExcel, exportTablePdf, reportStamp } from '../lib/tableExport'
import {
  armedStateLabel,
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
  wsConnected?: boolean
  liveActive?: boolean
  liveFlashIds?: Set<string>
  onRefresh: () => Promise<void>
}

type StatKey = 'alarm' | 'tamper' | 'loss' | 'open' | 'ok'

function deviceAddressId(d: Device): string {
  if (d.device_num != null && d.device_num >= 0) return String(d.device_num)
  const m = /_DEV_(\d+)$/i.exec(d.global_id)
  return m ? String(Number(m[1])) : d.global_id
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

function statusLabel(d: Device): string {
  return labelOf(deviceStateLabel, effectiveDeviceStatus(d.state, d.disable))
}

function linkText(d: Device): string {
  const link = normalizeDeviceLink(d.link)
  if (link === 'bus') return vi.linkBus
  if (link === 'rf') return vi.linkRf
  return vi.linkUnknown
}

function matchesState(shown: string, filter: string): boolean {
  if (!filter) return true
  if (filter === 'loss') return shown === 'loss' || shown === 'fault'
  return shown === filter
}

export function StatusPage({
  panels,
  devices,
  wsConnected = false,
  liveActive = false,
  liveFlashIds,
  onRefresh,
}: Props) {
  const [panelFilter, setPanelFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [error, setError] = useState<string | null>(null)
  const [zones, setZones] = useState<Zone[]>([])

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

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])
  const panelName = useMemo(() => {
    const map = new Map(panels.map((p) => [p.panel_id, p.display_name || p.panel_id]))
    return (id: string) => map.get(id) || id
  }, [panels])

  const shownOf = (d: Device) => effectiveDeviceStatus(d.state, d.disable)

  const counts = useMemo(() => {
    let alarm = 0
    let tamper = 0
    let loss = 0
    let open = 0
    let ok = 0
    for (const d of devices) {
      const shown = shownOf(d)
      if (shown === 'alarm') alarm += 1
      else if (shown === 'tamper') tamper += 1
      else if (shown === 'loss' || shown === 'fault') loss += 1
      else if (shown === 'open') open += 1
      else if (shown === 'ok') ok += 1
    }
    return { alarm, tamper, loss, open, ok, total: devices.length }
  }, [devices])

  const typeOptions = useMemo(() => {
    const present = new Set(devices.map((d) => familyOfType(d.device_type)))
    return DEVICE_FAMILY_KEYS.filter((k) => present.has(k))
  }, [devices])

  const sectionOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const z of zones) {
      if (panelFilter && z.panel_id !== panelFilter) continue
      seen.set(z.zone_id, zoneDisplayName(z, z.zone_id))
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [zones, panelFilter])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return devices.filter((d) => {
      if (panelFilter && d.panel_id !== panelFilter) return false
      if (!matchesState(shownOf(d), stateFilter)) return false
      if (typeFilter && familyOfType(d.device_type) !== typeFilter) return false
      if (zoneFilter && d.zone_id !== zoneFilter) return false
      if (!needle) return true
      const zone = zoneDisplayName(zoneMap.get(d.zone_id || ''), d.zone_id)
      return (
        d.global_id.toLowerCase().includes(needle) ||
        deviceAddressId(d).toLowerCase().includes(needle) ||
        d.label.toLowerCase().includes(needle) ||
        (d.model || '').toLowerCase().includes(needle) ||
        d.device_type.toLowerCase().includes(needle) ||
        labelOf(deviceTypeLabel, d.device_type).toLowerCase().includes(needle) ||
        panelName(d.panel_id).toLowerCase().includes(needle) ||
        d.panel_id.toLowerCase().includes(needle) ||
        zone.toLowerCase().includes(needle)
      )
    })
  }, [devices, panelFilter, stateFilter, typeFilter, zoneFilter, q, zoneMap, panelName])

  const filtersActive = Boolean(q || panelFilter || stateFilter || typeFilter || zoneFilter)

  function clearFilters() {
    setQ('')
    setPanelFilter('')
    setStateFilter('')
    setTypeFilter('')
    setZoneFilter('')
  }

  function toggleStat(key: StatKey | '') {
    setStateFilter((prev) => (prev === key ? '' : key))
  }

  function togglePanel(id: string) {
    setPanelFilter((prev) => {
      const next = prev === id ? '' : id
      if (next !== prev) setZoneFilter('')
      return next
    })
  }

  const exportHeaders = [
    'ID',
    vi.label,
    vi.model,
    vi.link,
    vi.panel,
    vi.tabZones,
    vi.deviceType,
    vi.reaction,
    vi.status,
  ]

  function exportRows(): string[][] {
    return filtered.map((d) => [
      deviceAddressId(d),
      d.label || '—',
      d.model || '—',
      linkText(d),
      panelName(d.panel_id),
      zoneDisplayName(zoneMap.get(d.zone_id || ''), d.zone_id),
      labelOf(deviceTypeLabel, d.device_type),
      reactionChipLabel(d.reaction),
      statusLabel(d),
    ])
  }

  function runExport() {
    if (!filtered.length) {
      setError(vi.statusExportEmpty)
      return
    }
    setExporting(true)
    setError(null)
    try {
      const rows = exportRows()
      const stamp = reportStamp()
      if (exportFormat === 'xlsx') {
        exportTableExcel({
          filename: `trang-thai-thiet-bi_${stamp}.xlsx`,
          sheetName: vi.statusExportSheet,
          headers: exportHeaders,
          rows,
          colWidths: [8, 22, 16, 10, 22, 18, 18, 12, 14],
        })
      } else {
        exportTablePdf({
          title: vi.statusPageTitle,
          meta: `${filtered.length} thiết bị · ${new Date().toLocaleString('vi-VN')} · GMT+07`,
          headers: exportHeaders,
          rows,
          emptyText: vi.statusExportEmpty,
        })
      }
      setExportOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader
        title={vi.statusPageTitle}
        hint={vi.statusPageHint}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] ring-1 ${
                liveActive
                  ? 'bg-ok/10 text-ok ring-ok/25'
                  : wsConnected
                    ? 'bg-steel/10 text-steel ring-steel/20'
                    : 'bg-danger/10 text-danger ring-danger/20'
              }`}
            >
              <span className={`size-1.5 rounded-full ${liveActive ? 'bg-ok animate-pulse' : wsConnected ? 'bg-steel' : 'bg-danger'}`} />
              {liveActive ? vi.realtimeLive : wsConnected ? vi.realtimeIdle : vi.wsDown}
            </span>
            <Btn
              tone="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void onRefresh().finally(() => setBusy(false))
              }}
            >
              <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> {vi.refresh}
            </Btn>
            <Btn tone="ghost" onClick={() => setExportOpen(true)}>
              <FileDown className="size-3.5" />
              {vi.historyExport}
            </Btn>
          </div>
        }
      />

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label={vi.statusTotal}
          value={counts.total}
          tone="info"
          active={!stateFilter}
          onClick={() => toggleStat('')}
        />
        <StatCard
          label={vi.legendAlarm}
          value={counts.alarm}
          tone="danger"
          active={stateFilter === 'alarm'}
          onClick={() => toggleStat('alarm')}
        />
        <StatCard
          label={vi.legendTamper}
          value={counts.tamper}
          tone="danger"
          active={stateFilter === 'tamper'}
          onClick={() => toggleStat('tamper')}
        />
        <StatCard
          label={vi.legendLoss}
          value={counts.loss}
          tone="danger"
          active={stateFilter === 'loss'}
          onClick={() => toggleStat('loss')}
        />
        <StatCard
          label={vi.legendOpen}
          value={counts.open}
          tone="warn"
          active={stateFilter === 'open'}
          onClick={() => toggleStat('open')}
        />
        <StatCard
          label={vi.legendOk}
          value={counts.ok}
          tone="ok"
          active={stateFilter === 'ok'}
          onClick={() => toggleStat('ok')}
        />
      </div>

      <Card className="mb-4">
        <h3 className="mb-3 text-sm font-semibold">{vi.panels}</h3>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {panels.map((p) => {
            const active = panelFilter === p.panel_id
            return (
              <button
                key={p.panel_id}
                type="button"
                onClick={() => togglePanel(p.panel_id)}
                className={`min-w-[220px] shrink-0 rounded-lg border px-3 py-2.5 text-left transition ${
                  active
                    ? 'border-accent/50 bg-accent/10 ring-1 ring-accent/30'
                    : 'border-line/70 bg-fog/60 hover:border-line hover:bg-mist/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{p.display_name}</span>
                  <ArmedBadge state={p.armed_state} />
                </div>
                <p className="mt-1 font-mono text-[11px] text-steel/55">
                  {p.panel_id} · {labelOf(connectionLabel, p.connection)} · {p.device_count} {vi.devices}
                </p>
              </button>
            )
          })}
          {!panels.length && <p className="text-sm text-steel/50">{vi.noPanels}</p>}
        </div>
      </Card>

      <Card className="mb-3 py-3">
        <div className="grid grid-cols-[minmax(0,1.35fr)_repeat(4,minmax(0,1fr))_auto] items-center gap-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-steel/50" />
            <input
              className={`${inputClass} min-w-0 pl-8`}
              placeholder={vi.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={vi.search}
            />
          </div>
          <select
            className={`${inputClass} min-w-0`}
            value={panelFilter}
            onChange={(e) => {
              setPanelFilter(e.target.value)
              setZoneFilter('')
            }}
          >
            <option value="">{vi.allPanels}</option>
            {panels.map((p) => (
              <option key={p.panel_id} value={p.panel_id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} min-w-0`}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">{vi.statusAllTypes}</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {labelOf(deviceTypeLabel, t)}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} min-w-0`}
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
          >
            <option value="">{vi.statusAllSections}</option>
            {sectionOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} min-w-0`}
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">{vi.allStates}</option>
            <option value="ok">{vi.legendOk}</option>
            <option value="open">{vi.legendOpen}</option>
            <option value="alarm">{vi.legendAlarm}</option>
            <option value="tamper">{vi.legendTamper}</option>
            <option value="loss">{vi.legendLoss}</option>
            <option value="fault">{vi.legendFault}</option>
          </select>
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            {filtersActive && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-steel/70 hover:text-ink"
                onClick={clearFilters}
              >
                <X className="size-3" />
                {vi.statusClearFilters}
              </button>
            )}
            <span className="font-mono text-[11px] text-steel/55">
              {vi.statusResultCount(filtered.length, devices.length)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
          {vi.devicesSection}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line bg-mist/50 font-mono text-[11px] text-steel/70">
              <tr>
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">{vi.label}</th>
                <th className="px-4 py-2.5 font-medium">{vi.model}</th>
                <th className="px-4 py-2.5 font-medium">{vi.link}</th>
                <th className="px-4 py-2.5 font-medium">{vi.panel}</th>
                <th className="px-4 py-2.5 font-medium">{vi.tabZones}</th>
                <th className="px-4 py-2.5 font-medium">{vi.deviceType}</th>
                <th className="px-4 py-2.5 font-medium">{vi.reaction}</th>
                <th className="px-4 py-2.5 font-medium">{vi.status}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const shown = shownOf(d)
                const rowTone =
                  shown === 'alarm' || shown === 'tamper' || shown === 'loss' || shown === 'fault'
                    ? 'bg-danger/5'
                    : shown === 'open'
                      ? 'bg-warn/5'
                      : 'hover:bg-mist/30'
                return (
                  <tr
                    key={`${d.global_id}-${d.state}`}
                    className={`border-b border-line/60 ${
                      liveFlashIds?.has(d.global_id) ? 'live-flash' : rowTone
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-[12px] text-accent" title={d.global_id}>
                      {deviceAddressId(d)}
                    </td>
                    <td className="px-4 py-2.5">{d.label || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-steel">{d.model || '—'}</td>
                    <td className="px-4 py-2.5">
                      <LinkBadge link={d.link} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-steel">{d.panel_id}</td>
                    <td className="px-4 py-2.5 text-[12px] text-steel">
                      {zoneDisplayName(zoneMap.get(d.zone_id || ''), d.zone_id)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <DeviceTypeIcon type={resolveDeviceIconKey(d)} className="size-3.5 text-steel" />
                        {labelOf(deviceTypeLabel, d.device_type)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <ReactionBadge reaction={d.reaction} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <StateDot state={shown} />
                        {statusLabel(d)}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-steel/50">
                    {devices.length ? vi.statusExportEmpty : vi.noDevices}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {exportOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => !exporting && setExportOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-panel p-4 shadow-xl ring-1 ring-line"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink">{vi.statusExportTitle}</h3>
            <p className="mt-1 text-xs text-steel/70">{vi.statusExportHint}</p>
            <div className="mt-4 space-y-3">
              <Field label={vi.historyExportFormat}>
                <div className="flex gap-2">
                  <label
                    className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 ${
                      exportFormat === 'xlsx' ? 'bg-accent/10 ring-accent/40' : 'ring-line'
                    }`}
                  >
                    <input
                      type="radio"
                      name="status-export-format"
                      checked={exportFormat === 'xlsx'}
                      onChange={() => setExportFormat('xlsx')}
                    />
                    {vi.historyExportExcel}
                  </label>
                  <label
                    className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 ${
                      exportFormat === 'pdf' ? 'bg-accent/10 ring-accent/40' : 'ring-line'
                    }`}
                  >
                    <input
                      type="radio"
                      name="status-export-format"
                      checked={exportFormat === 'pdf'}
                      onChange={() => setExportFormat('pdf')}
                    />
                    {vi.historyExportPdf}
                  </label>
                </div>
              </Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn tone="ghost" disabled={exporting} onClick={() => setExportOpen(false)}>
                {vi.cancel}
              </Btn>
              <Btn disabled={exporting || !filtered.length} onClick={runExport}>
                <FileDown className="size-3.5" />
                {exporting ? vi.historyExportBusy : vi.historyExport}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone: 'danger' | 'warn' | 'ok' | 'info'
  active: boolean
  onClick: () => void
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'info'
          ? 'text-[#3b82f6]'
          : 'text-ok'
  const ring =
    active
      ? tone === 'danger'
        ? 'ring-2 ring-danger/40 bg-danger/5'
        : tone === 'warn'
          ? 'ring-2 ring-warn/40 bg-warn/5'
          : tone === 'info'
            ? 'ring-2 ring-accent/35 bg-accent/5'
            : 'ring-2 ring-ok/40 bg-ok/5'
      : 'hover:bg-mist/40'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`panel-card w-full px-4 py-3 text-left transition ${ring}`}
    >
      <p className="font-mono text-[11px] text-steel/55">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </button>
  )
}

function ArmedBadge({ state }: { state: string }) {
  const tone =
    state === 'armed' ? 'bg-danger/10 text-danger' : state === 'partial' ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${tone}`}>
      {labelOf(armedStateLabel, state)}
    </span>
  )
}
