import { useEffect, useState } from 'react'
import { listEventHistory, type CmsEvent, type Panel } from '../api/client'
import { Btn, Card, PageHeader, inputClass } from '../components/ui'
import { armedStateLabel, deviceStateLabel, eventTypeLabel, labelOf, vi } from '../i18n/vi'

type Props = {
  panels: Panel[]
  liveEvents: CmsEvent[]
}

export function HistoryPage({ panels, liveEvents }: Props) {
  const [events, setEvents] = useState<CmsEvent[]>([])
  const [panelFilter, setPanelFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)

  async function load(reset = false) {
    setBusy(true)
    setError(null)
    const nextOffset = reset ? 0 : offset
    try {
      const rows = await listEventHistory({
        limit: 80,
        offset: nextOffset,
        panel_id: panelFilter || undefined,
        event_type: typeFilter || undefined,
      })
      setEvents((prev) => (reset ? rows : [...prev, ...rows]))
      setOffset(nextOffset + rows.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelFilter, typeFilter])

  useEffect(() => {
    if (!liveEvents[0]) return
    const e = liveEvents[0]
    if (panelFilter && e.panel_id !== panelFilter) return
    if (typeFilter && e.type !== typeFilter) return
    setEvents((prev) => {
      const key = `${e.ts}-${e.type}-${e.device_id ?? ''}-${e.panel_id ?? ''}`
      if (prev.some((p) => `${p.ts}-${p.type}-${p.device_id ?? ''}-${p.panel_id ?? ''}` === key)) {
        return prev
      }
      return [e, ...prev].slice(0, 300)
    })
  }, [liveEvents, panelFilter, typeFilter])

  const types = useMemoTypes(events)

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-5">
      <PageHeader title={vi.historyPageTitle} hint={vi.historyPageHint} />

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          className={`${inputClass} w-auto min-w-[160px]`}
          value={panelFilter}
          onChange={(e) => setPanelFilter(e.target.value)}
        >
          <option value="">{vi.allPanels}</option>
          {panels.map((p) => (
            <option key={p.panel_id} value={p.panel_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} w-auto min-w-[180px]`}
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
      </div>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-line/60">
          {events.map((e, i) => (
            <li key={`${e.id ?? 'live'}-${e.ts}-${i}`} className="px-4 py-2.5 hover:bg-mist/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-sm font-medium ${typeColor(e.type)}`}>
                  {labelOf(eventTypeLabel, e.type)}
                </span>
                <span className="font-mono text-[11px] text-steel/50">
                  {e.ts?.replace('T', ' ').replace('Z', '') ?? ''}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-steel/70">{formatDetail(e)}</p>
            </li>
          ))}
          {!events.length && (
            <li className="px-4 py-10 text-center text-sm text-steel/50">{vi.noHistory}</li>
          )}
        </ul>
      </Card>

      <div className="mt-3">
        <Btn tone="ghost" disabled={busy} onClick={() => void load(false)}>
          {vi.loadMore}
        </Btn>
      </div>
    </div>
  )
}

function useMemoTypes(events: CmsEvent[]) {
  const set = new Set(events.map((e) => e.type).filter(Boolean))
  ;[
    'device_state',
    'panel_armed',
    'command_error',
    'device_declared',
    'device_updated',
    'device_deleted',
  ].forEach((t) => set.add(t))
  return [...set].sort()
}

function formatDetail(e: CmsEvent): string {
  const parts: string[] = []
  if (e.panel_id) parts.push(String(e.panel_id))
  if (e.device_id) parts.push(String(e.device_id))
  if (e.state) parts.push(labelOf(deviceStateLabel, String(e.state)))
  if (e.armed_state) parts.push(labelOf(armedStateLabel, String(e.armed_state)))
  if (e.detail) parts.push(String(e.detail))
  return parts.join(' · ') || '—'
}

function typeColor(type: string) {
  if (type.includes('alarm') || type === 'command_error' || type === 'device_deleted')
    return 'text-danger'
  if (type === 'device_state') return 'text-accent'
  if (type === 'panel_armed') return 'text-warn'
  return 'text-ink'
}
