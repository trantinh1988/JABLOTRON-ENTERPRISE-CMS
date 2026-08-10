import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Device, Panel } from '../api/client'
import { Btn, Card, PageHeader, StateDot, inputClass } from '../components/ui'
import { DeviceTypeIcon } from '../components/DeviceTypeIcon'
import {
  armedStateLabel,
  connectionLabel,
  deviceStateLabel,
  deviceTypeLabel,
  labelOf,
  vi,
} from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  onRefresh: () => Promise<void>
}

export function StatusPage({ panels, devices, onRefresh }: Props) {
  const [panelFilter, setPanelFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return devices.filter((d) => {
      if (panelFilter && d.panel_id !== panelFilter) return false
      if (stateFilter && d.state !== stateFilter) return false
      if (!needle) return true
      return (
        d.global_id.toLowerCase().includes(needle) ||
        d.label.toLowerCase().includes(needle) ||
        d.device_type.toLowerCase().includes(needle)
      )
    })
  }, [devices, panelFilter, stateFilter, q])

  const alarmCount = devices.filter((d) => d.state === 'alarm').length
  const openCount = devices.filter((d) => d.state === 'open').length
  const tamperCount = devices.filter((d) => d.state === 'tamper' || d.state === 'fault').length
  const okCount = devices.filter((d) => d.state === 'ok').length

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-5">
      <PageHeader
        title={vi.statusPageTitle}
        hint={vi.statusPageHint}
        actions={
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
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={vi.legendAlarm} value={alarmCount} tone="danger" />
        <StatCard label={vi.legendTamper} value={tamperCount} tone="danger" />
        <StatCard label={vi.legendOpen} value={openCount} tone="warn" />
        <StatCard label={vi.legendOk} value={okCount} tone="ok" />
      </div>

      <Card className="mb-4">
        <h3 className="mb-3 text-sm font-semibold">{vi.panels}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {panels.map((p) => (
            <div
              key={p.panel_id}
              className="rounded-lg border border-line/70 bg-fog/60 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{p.display_name}</span>
                <ArmedBadge state={p.armed_state} />
              </div>
              <p className="mt-1 font-mono text-[11px] text-steel/55">
                {p.panel_id} · {labelOf(connectionLabel, p.connection)} · {p.device_count}{' '}
                {vi.devices}
              </p>
            </div>
          ))}
          {!panels.length && <p className="text-sm text-steel/50">{vi.noPanels}</p>}
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder={vi.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={`${inputClass} w-auto min-w-[160px]`}
          value={panelFilter}
          onChange={(e) => setPanelFilter(e.target.value)}
        >
          <option value="">{vi.filterPanel}: {vi.allPanels}</option>
          {panels.map((p) => (
            <option key={p.panel_id} value={p.panel_id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} w-auto min-w-[160px]`}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">{vi.allStates}</option>
          <option value="ok">{vi.legendOk}</option>
          <option value="open">{vi.legendOpen}</option>
          <option value="alarm">{vi.legendAlarm}</option>
          <option value="tamper">{vi.legendTamper}</option>
          <option value="fault">{vi.legendFault}</option>
        </select>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-line bg-mist/50 font-mono text-[11px] text-steel/70">
              <tr>
                <th className="px-4 py-2.5 font-medium">{vi.status}</th>
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">{vi.label}</th>
                <th className="px-4 py-2.5 font-medium">{vi.panel}</th>
                <th className="px-4 py-2.5 font-medium">{vi.deviceType}</th>
                <th className="px-4 py-2.5 font-medium">Map</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.global_id}
                  className={`border-b border-line/60 ${
                    d.state === 'alarm' || d.state === 'tamper' || d.state === 'fault'
                      ? 'bg-danger/5'
                      : d.state === 'open'
                        ? 'bg-warn/5'
                        : 'hover:bg-mist/30'
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <StateDot state={d.state} />
                      {labelOf(deviceStateLabel, d.state)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-accent">{d.global_id}</td>
                  <td className="px-4 py-2.5">{d.label || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-steel">{d.panel_id}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <DeviceTypeIcon type={d.device_type} className="size-3.5 text-steel" />
                      {labelOf(deviceTypeLabel, d.device_type)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-steel/60">
                    {d.map_id != null
                      ? `#${d.map_id} (${d.map_x?.toFixed(0)}, ${d.map_y?.toFixed(0)})`
                      : '—'}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-steel/50">
                    {vi.noDevices}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'ok' | 'warn' | 'danger'
}) {
  const styles = {
    ok: 'text-ok border-ok/20 bg-ok/5',
    warn: 'text-warn border-warn/20 bg-warn/5',
    danger: 'text-danger border-danger/20 bg-danger/5',
  }[tone]
  return (
    <div className={`rounded-xl border px-4 py-3 ${styles}`}>
      <p className="font-mono text-[11px] opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function ArmedBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    armed: 'bg-danger/10 text-danger',
    partial: 'bg-warn/10 text-warn',
    disarmed: 'bg-ok/10 text-ok',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${map[state] ?? 'bg-steel/10 text-steel'}`}>
      {labelOf(armedStateLabel, state)}
    </span>
  )
}
