import { useMemo, useState } from 'react'
import type { Device, Panel } from '../api/client'
import { EventFeed } from '../components/EventFeed'
import { FloorMapView } from '../components/FloorMap'
import { PanelControls } from '../components/PanelControls'
import { Card, PageHeader } from '../components/ui'
import { vi } from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  writeAllowed: boolean
  mockMode: boolean | null
  events: Parameters<typeof EventFeed>[0]['events']
  loadError: string | null
  onRefresh: () => Promise<void>
}

export function DashboardPage({
  panels,
  devices,
  writeAllowed,
  mockMode,
  events,
  loadError,
  onRefresh,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [focusPanelId, setFocusPanelId] = useState<string | null>(null)

  const selectedSafe = useMemo(() => {
    if (selected.size) return selected
    return new Set(panels.map((p) => p.panel_id))
  }, [panels, selected])

  const focusOptions = useMemo(
    () => [
      { id: null as string | null, label: vi.allPanels },
      ...panels.map((p) => ({ id: p.panel_id, label: p.panel_id })),
    ],
    [panels],
  )

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-5">
      <PageHeader title={vi.navDashboard} hint="Điều khiển tủ · bản đồ realtime · sự kiện trực tiếp" />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col gap-4">
          <PanelControls
            panels={panels}
            writeAllowed={writeAllowed}
            mockMode={mockMode}
            selected={selectedSafe}
            onToggle={(id) => {
              setSelected((prev) => {
                const base = prev.size ? new Set(prev) : new Set(panels.map((p) => p.panel_id))
                if (base.has(id)) base.delete(id)
                else base.add(id)
                return base
              })
            }}
            onSelectAll={() => setSelected(new Set(panels.map((p) => p.panel_id)))}
            onRefresh={onRefresh}
          />
          <EventFeed events={events} />
        </aside>

        <div className="flex min-h-[520px] flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-steel/60">{vi.filterMap}</span>
            {focusOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setFocusPanelId(opt.id)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] ring-1 transition ${
                  focusPanelId === opt.id
                    ? 'bg-accent text-panel ring-accent'
                    : 'bg-mist text-steel ring-line hover:bg-line/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {loadError && (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {vi.backendError(loadError)}
            </p>
          )}

          <FloorMapView panels={panels} devices={devices} focusPanelId={focusPanelId} />
        </div>
      </div>

      <Card className="mt-4">
        <p className="font-mono text-[11px] text-steel/55">
          {panels.length} {vi.panels} · {devices.length} {vi.devices} ·{' '}
          {devices.filter((d) => d.state === 'alarm').length} {vi.alarm}
        </p>
      </Card>
    </div>
  )
}
