import { useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, Image, Search, X } from 'lucide-react'
import {
  listAutomationSnaps,
  listEventHistory,
  listZones,
  type AutomationSnap,
  type CmsEvent,
  type Device,
  type Panel,
  type Zone,
} from '../api/client'
import { formatZoneCaption } from '../components/EventFeed'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { Btn, Card, Field, PageHeader, inputClass } from '../components/ui'
import { exportHistoryExcel, exportHistoryPdf } from '../lib/historyExport'
import {
  buildHistoryRow,
  dateInputVn,
  eventTypeOptions,
  expandHistoryEvents,
  formatSnapTs,
  matchSmartQuery,
  rangeBounds,
  rowTone,
  snapFromEvent,
  statusTone,
  upsertLiveSnap,
  type EventSnap,
  type HistoryRow,
} from '../lib/historyRows'
import { latestEventSeq, takeEventsSince } from '../hooks/useEventStream'
import { eventTypeLabel, labelOf, vi } from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  liveEvents: CmsEvent[]
  eventSeq: number
}

const PAGE_SIZE = 100
const EXPORT_LIMIT = 500

export function HistoryPage({ panels, devices, liveEvents, eventSeq }: Props) {
  const [events, setEvents] = useState<CmsEvent[]>([])
  const [snaps, setSnaps] = useState<AutomationSnap[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [q, setQ] = useState('')
  const [panelFilter, setPanelFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [photoFilter, setPhotoFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [preset, setPreset] = useState('')
  const [alarmOnly, setAlarmOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [preview, setPreview] = useState<EventSnap | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [exportImages, setExportImages] = useState(false)

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])
  const bounds = useMemo(() => rangeBounds(preset, fromDate, toDate), [preset, fromDate, toDate])

  async function load(reset = false) {
    setBusy(true)
    setError(null)
    const nextOffset = reset ? 0 : offset
    try {
      const [rows, snapRows] = await Promise.all([
        listEventHistory({
          limit: PAGE_SIZE,
          offset: nextOffset,
          panel_id: panelFilter || undefined,
          event_type: typeFilter || undefined,
          since: bounds.since,
          until: bounds.until,
          history_page: true,
        }),
        reset ? listAutomationSnaps(200) : Promise.resolve(null),
      ])
      setEvents((prev) => (reset ? rows : [...prev, ...rows]))
      setOffset(nextOffset + rows.length)
      setHasMore(rows.length >= PAGE_SIZE)
      if (snapRows) setSnaps(snapRows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void Promise.all(panels.map((p) => listZones(p.panel_id).catch(() => [] as Zone[]))).then((groups) => {
      setZones(groups.flat())
    })
  }, [panels])

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelFilter, typeFilter, bounds.since, bounds.until])

  const liveCursorRef = useRef(latestEventSeq())

  useEffect(() => {
    const { events: batch, upTo } = takeEventsSince(liveCursorRef.current)
    liveCursorRef.current = upTo
    if (!batch.length) return
    const incoming = expandHistoryEvents(batch)
    if (!incoming.length) return
    const nextEvents: CmsEvent[] = []
    for (const e of incoming) {
      if (panelFilter && e.panel_id !== panelFilter) continue
      if (typeFilter && e.type !== typeFilter) continue
      if (bounds.since) {
        const at = e.ts ? new Date(e.ts).getTime() : 0
        if (at && at < new Date(bounds.since).getTime()) continue
      }
      if (bounds.until) {
        const at = e.ts ? new Date(e.ts).getTime() : 0
        if (at && at > new Date(bounds.until).getTime()) continue
      }
      nextEvents.push(e)
      const liveSnap = snapFromEvent(e)
      if (liveSnap) {
        setSnaps((prev) => upsertLiveSnap(prev, e, liveSnap))
      }
    }
    if (!nextEvents.length) return
    setEvents((prev) => {
      let merged = prev
      for (const e of nextEvents) {
        const key = `${e.ts}-${e.type}-${e.device_id ?? ''}-${e.panel_id ?? ''}-${e.zone_id ?? ''}`
        if (merged.some((p) => `${p.ts}-${p.type}-${p.device_id ?? ''}-${p.panel_id ?? ''}-${p.zone_id ?? ''}` === key)) {
          continue
        }
        merged = [e, ...merged]
      }
      return merged === prev ? prev : merged.slice(0, 400)
    })
  }, [eventSeq, liveEvents, panelFilter, typeFilter, bounds.since, bounds.until])

  const types = useMemo(() => eventTypeOptions(events), [events])

  const allRows = useMemo(
    () =>
      expandHistoryEvents(events).map((e, i) =>
        buildHistoryRow(e, i, panels, devices, zoneMap, snaps),
      ),
    [events, panels, devices, zoneMap, snaps],
  )

  const sectionOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const z of zones) {
      if (panelFilter && z.panel_id !== panelFilter) continue
      seen.set(z.zone_id, formatZoneCaption(z) || z.name || z.zone_id)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [zones, panelFilter])

  const rows = useMemo(() => {
    return allRows.filter((row) => {
      if (statusFilter && row.statusKey !== statusFilter) return false
      if (zoneFilter && row.zoneId !== zoneFilter) return false
      if (photoFilter === 'yes' && !row.snap) return false
      if (photoFilter === 'no' && row.snap) return false
      if (alarmOnly && !isAlarmStatus(row)) return false
      if (!matchSmartQuery(row, q)) return false
      return true
    })
  }, [allRows, statusFilter, zoneFilter, photoFilter, alarmOnly, q])

  const filtersActive = Boolean(
    q || panelFilter || typeFilter || statusFilter || zoneFilter || photoFilter || fromDate || toDate || preset || alarmOnly,
  )

  function clearFilters() {
    setQ('')
    setPanelFilter('')
    setTypeFilter('')
    setStatusFilter('')
    setZoneFilter('')
    setPhotoFilter('')
    setFromDate('')
    setToDate('')
    setPreset('')
    setAlarmOnly(false)
  }

  function applyPreset(next: string) {
    if (preset === next && next !== 'alarm') {
      setPreset('')
      setFromDate('')
      setToDate('')
      return
    }
    if (next === 'alarm') {
      setAlarmOnly((v) => !v)
      return
    }
    setPreset(next)
    if (next === 'today') {
      const today = dateInputVn()
      setFromDate(today)
      setToDate(today)
    } else if (next === '24h' || next === '7d') {
      setFromDate('')
      setToDate('')
    }
  }

  async function runExport() {
    if (!rows.length) {
      setError(vi.historyExportEmpty)
      return
    }
    setExporting(true)
    setError(null)
    try {
      let exportRows = rows
      if (hasMore) {
        const extra = await listEventHistory({
          limit: EXPORT_LIMIT,
          offset: 0,
          panel_id: panelFilter || undefined,
          event_type: typeFilter || undefined,
          since: bounds.since,
          until: bounds.until,
          history_page: true,
        })
        exportRows = extra
          .map((e, i) => buildHistoryRow(e, i, panels, devices, zoneMap, snaps))
          .filter((row) => {
            if (statusFilter && row.statusKey !== statusFilter) return false
            if (zoneFilter && row.zoneId !== zoneFilter) return false
            if (photoFilter === 'yes' && !row.snap) return false
            if (photoFilter === 'no' && row.snap) return false
            if (alarmOnly && !isAlarmStatus(row)) return false
            return matchSmartQuery(row, q)
          })
      }
      if (!exportRows.length) {
        setError(vi.historyExportEmpty)
        return
      }
      if (exportFormat === 'xlsx') await exportHistoryExcel(exportRows, exportImages)
      else await exportHistoryPdf(exportRows, exportImages)
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
        title={vi.historyPageTitle}
        hint={vi.historyPageHint}
        actions={
          <Btn tone="ghost" onClick={() => setExportOpen(true)}>
            <FileDown className="size-3.5" />
            {vi.historyExport}
          </Btn>
        }
      />

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <Card className="mb-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-steel/50" />
            <input
              className={`${inputClass} pl-8`}
              placeholder={vi.historySmartSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={vi.historySmartSearch}
            />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-steel/70">
            {vi.historyFrom}
            <input
              type="date"
              className={`${inputClass} w-auto`}
              value={fromDate}
              onChange={(e) => {
                setPreset('')
                setFromDate(e.target.value)
              }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-steel/70">
            {vi.historyTo}
            <input
              type="date"
              className={`${inputClass} w-auto`}
              value={toDate}
              onChange={(e) => {
                setPreset('')
                setToDate(e.target.value)
              }}
            />
          </label>
        </div>

        <div className="mb-3 grid grid-cols-5 gap-2">
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
            <option value="">{vi.allTypes}</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {labelOf(eventTypeLabel, t)}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} min-w-0`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{vi.allStates}</option>
            <option value="alarm">{vi.legendAlarm}</option>
            <option value="tamper">{vi.legendTamper}</option>
            <option value="fault">{vi.legendFault}</option>
          </select>
          <select
            className={`${inputClass} min-w-0`}
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
          >
            <option value="">{vi.historyAllSections}</option>
            {sectionOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} min-w-0`}
            value={photoFilter}
            onChange={(e) => setPhotoFilter(e.target.value)}
          >
            <option value="">{vi.historyPhotoAll}</option>
            <option value="yes">{vi.historyPhotoYes}</option>
            <option value="no">{vi.historyPhotoNo}</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip active={preset === 'today'} onClick={() => applyPreset('today')}>
            {vi.historyPresetToday}
          </Chip>
          <Chip active={preset === '24h'} onClick={() => applyPreset('24h')}>
            {vi.historyPreset24h}
          </Chip>
          <Chip active={preset === '7d'} onClick={() => applyPreset('7d')}>
            {vi.historyPreset7d}
          </Chip>
          <Chip active={alarmOnly} onClick={() => applyPreset('alarm')}>
            {vi.historyPresetAlarm}
          </Chip>
          <Chip active={photoFilter === 'yes'} onClick={() => setPhotoFilter((v) => (v === 'yes' ? '' : 'yes'))}>
            {vi.historyPhotoYes}
          </Chip>
          {filtersActive && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-steel/70 hover:text-ink"
              onClick={clearFilters}
            >
              <X className="size-3" />
              {vi.historyClearFilters}
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-steel/55">{vi.historyResultCount(rows.length, allRows.length)}</span>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-line bg-mist/50 font-mono text-[11px] text-steel/70">
              <tr>
                <th className="px-4 py-2.5 font-medium">{vi.historyColTime}</th>
                <th className="px-4 py-2.5 font-medium">{vi.historyColPanel}</th>
                <th className="px-4 py-2.5 font-medium">{vi.historyColId}</th>
                <th className="px-4 py-2.5 font-medium">{vi.historyColLabel}</th>
                <th className="px-4 py-2.5 font-medium">{vi.historyColSection}</th>
                <th className="px-4 py-2.5 font-medium">{vi.historyColStatus}</th>
                <th className="px-4 py-2.5 font-medium">{vi.historyColPhoto}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={`border-b border-line/60 ${rowTone(row.statusKey, row.eventType)}`}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-steel/70">{row.tsLabel}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-sm text-ink">{row.panelName}</div>
                    {row.panelId && row.panelName !== row.panelId && (
                      <div className="font-mono text-[10px] text-steel/45">{row.panelId}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-accent">{row.idLabel}</td>
                  <td className="px-4 py-2.5">{row.label}</td>
                  <td className="px-4 py-2.5 text-steel/80">{row.section}</td>
                  <td className={`px-4 py-2.5 font-medium ${statusTone(row.statusKey, row.eventType)}`}>{row.status}</td>
                  <td className="px-4 py-2.5">
                    {row.snap ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:underline"
                        onClick={() => setPreview(row.snap)}
                      >
                        {row.snap.imageUrl ? (
                          <img
                            src={row.snap.imageUrl}
                            alt=""
                            className="size-8 rounded object-cover ring-1 ring-line"
                          />
                        ) : (
                          <Image className="size-3.5" />
                        )}
                        {vi.historyViewSnap}
                      </button>
                    ) : (
                      <span className="text-steel/40">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-steel/50">
                    {allRows.length ? vi.historyExportEmpty : vi.noHistory}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-3">
        <Btn tone="ghost" disabled={busy || !hasMore} onClick={() => void load(false)}>
          {vi.loadMore}
        </Btn>
      </div>

      {preview && (
        <ImagePreviewModal
          src={preview.imageUrl}
          title={preview.cameraName || vi.historySnapTitle}
          subtitle={formatSnapTs(preview.createdAt)}
          createdAt={preview.createdAt}
          onClose={() => setPreview(null)}
        />
      )}

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
            <h3 className="text-base font-semibold text-ink">{vi.historyExportTitle}</h3>
            <p className="mt-1 text-xs text-steel/70">{vi.historyExportHint}</p>
            <div className="mt-4 space-y-3">
              <Field label={vi.historyExportFormat}>
                <div className="flex gap-2">
                  <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 ${exportFormat === 'xlsx' ? 'bg-accent/10 ring-accent/40' : 'ring-line'}`}>
                    <input
                      type="radio"
                      name="export-format"
                      checked={exportFormat === 'xlsx'}
                      onChange={() => setExportFormat('xlsx')}
                    />
                    {vi.historyExportExcel}
                  </label>
                  <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ring-1 ${exportFormat === 'pdf' ? 'bg-accent/10 ring-accent/40' : 'ring-line'}`}>
                    <input
                      type="radio"
                      name="export-format"
                      checked={exportFormat === 'pdf'}
                      onChange={() => setExportFormat('pdf')}
                    />
                    {vi.historyExportPdf}
                  </label>
                </div>
              </Field>
              <label className="flex items-start gap-2 rounded-md bg-fog px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={exportImages}
                  onChange={(e) => setExportImages(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-ink">{vi.historyExportWithImages}</span>
                  <span className="mt-0.5 block text-[11px] text-steel/65">{vi.historyExportWithImagesHint}</span>
                </span>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn tone="ghost" disabled={exporting} onClick={() => setExportOpen(false)}>
                {vi.cameraCancel}
              </Btn>
              <Btn disabled={exporting || !rows.length} onClick={() => void runExport()}>
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

function isAlarmStatus(row: HistoryRow): boolean {
  const st = row.statusKey
  return st === 'alarm' || st === 'tamper' || st === 'fault' || row.eventType === 'device_alarm_trigger'
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition ${
        active ? 'bg-accent/15 text-accent ring-accent/35' : 'bg-fog text-steel/80 ring-line hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
