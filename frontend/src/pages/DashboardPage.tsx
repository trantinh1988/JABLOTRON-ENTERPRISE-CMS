import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listPanelUsers,
  listZones,
  type CmsEvent,
  type Device,
  type Panel,
  type PanelUser,
  type Zone,
} from '../api/client'
import { EventFeed } from '../components/EventFeed'
import { KeypadControl, type LastAction } from '../components/KeypadControl'
import { Card, PageHeader } from '../components/ui'
import { armedStateLabel, deviceStateLabel, labelOf, vi } from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  writeAllowed: boolean
  mockMode: boolean | null
  events: CmsEvent[]
  lastEvent: CmsEvent | null
  loadError: string | null
  onRefresh: () => Promise<void>
}

export function DashboardPage({
  panels,
  devices,
  writeAllowed,
  mockMode,
  events,
  lastEvent,
  loadError,
  onRefresh,
}: Props) {
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [users, setUsers] = useState<PanelUser[]>([])
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)

  const activePanel = useMemo(() => {
    if (!panels.length) return null
    const id = activePanelId && panels.some((p) => p.panel_id === activePanelId)
      ? activePanelId
      : panels[0].panel_id
    return panels.find((p) => p.panel_id === id) ?? null
  }, [activePanelId, panels])

  const panelDevices = useMemo(
    () => (activePanel ? devices.filter((d) => d.panel_id === activePanel.panel_id) : []),
    [activePanel, devices],
  )

  const alarmDevices = useMemo(
    () => panelDevices.filter((d) => d.state === 'alarm' || d.state === 'open'),
    [panelDevices],
  )

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])

  const loadMeta = useCallback(async (panelId: string) => {
    try {
      const [z, u] = await Promise.all([listZones(panelId), listPanelUsers(panelId)])
      setZones(z)
      setUsers(u)
      setMetaError(null)
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!activePanel) {
      setZones([])
      setUsers([])
      return
    }
    void loadMeta(activePanel.panel_id)
  }, [activePanel, loadMeta])

  useEffect(() => {
    if (!lastEvent || !activePanel) return
    if (lastEvent.panel_id !== activePanel.panel_id) return

    if (lastEvent.type === 'zone_armed' && lastEvent.zone_id) {
      setZones((prev) =>
        prev.map((z) =>
          z.zone_id === lastEvent.zone_id
            ? { ...z, armed_state: String(lastEvent.armed_state ?? z.armed_state) }
            : z,
        ),
      )
      if (typeof lastEvent.detail === 'string' && lastEvent.detail) {
        setLastAction({
          at: lastEvent.ts ?? new Date().toISOString(),
          panelId: activePanel.panel_id,
          target: 'section',
          zoneName: String(lastEvent.detail).split(' · ')[1],
          action:
            lastEvent.armed_state === 'armed'
              ? 'arm'
              : lastEvent.armed_state === 'partial'
                ? 'partial'
                : 'disarm',
          userName: String(lastEvent.detail).split(' · ')[0] || vi.keypadOperatorCms,
        })
      }
    }

    if (lastEvent.type === 'panel_armed' && lastEvent.armed_state) {
      void loadMeta(activePanel.panel_id)
    }
  }, [lastEvent, activePanel, loadMeta])

  const armActivity = useMemo(() => {
    return events
      .filter(
        (e) =>
          (e.type === 'panel_armed' || e.type === 'zone_armed') &&
          (!activePanel || e.panel_id === activePanel.panel_id),
      )
      .slice(0, 12)
  }, [events, activePanel])

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-5">
      <PageHeader title={vi.navDashboard} hint={vi.keypadPageHint} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-steel/60">{vi.filterPanel}</span>
        {panels.map((p) => (
          <button
            key={p.panel_id}
            type="button"
            onClick={() => setActivePanelId(p.panel_id)}
            className={`rounded-md px-2.5 py-1 font-mono text-[11px] ring-1 transition ${
              activePanel?.panel_id === p.panel_id
                ? 'bg-accent text-panel ring-accent'
                : 'bg-mist text-steel ring-line hover:bg-line/40'
            }`}
          >
            {p.display_name}
          </button>
        ))}
        {!panels.length && <span className="text-xs text-steel/50">{vi.noPanels}</span>}
      </div>

      {(loadError || metaError) && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {vi.backendError(loadError || metaError || '')}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <KeypadControl
          panel={activePanel}
          zones={zones}
          devices={panelDevices}
          users={users}
          writeAllowed={writeAllowed}
          mockMode={mockMode}
          lastAction={lastAction}
          onLastAction={setLastAction}
          onRefresh={onRefresh}
          onZonesChange={setZones}
        />

        <aside className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">{vi.keypadSectionStatus}</h2>
            <ul className="space-y-2">
              {zones.length === 0 && (
                <li className="text-xs text-steel/50">{vi.keypadNoSections}</li>
              )}
              {zones
                .slice()
                .sort((a, b) => a.section_num - b.section_num)
                .map((z) => {
                  const alarms = alarmDevices.filter((d) => d.zone_id === z.zone_id)
                  return (
                    <li
                      key={z.zone_id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-fog/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{z.name}</p>
                        <p className="font-mono text-[11px] text-steel/50">
                          SEC {z.section_num}
                          {alarms.length ? ` · ${alarms.length} ${vi.alarm}/${vi.open}` : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          z.armed_state === 'armed'
                            ? 'bg-danger/10 text-danger'
                            : z.armed_state === 'partial'
                              ? 'bg-warn/10 text-warn'
                              : 'bg-ok/10 text-ok'
                        }`}
                      >
                        {labelOf(armedStateLabel, z.armed_state)}
                      </span>
                    </li>
                  )
                })}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">{vi.keypadAlarmTitle}</h2>
            <ul className="max-h-40 space-y-1.5 overflow-auto">
              {alarmDevices.length === 0 && (
                <li className="text-xs text-steel/50">{vi.keypadZonesClear}</li>
              )}
              {alarmDevices.map((d) => (
                <li
                  key={d.global_id}
                  className="rounded-md border border-line/50 bg-fog/70 px-2.5 py-1.5 font-mono text-[11px]"
                >
                  <span className={d.state === 'alarm' ? 'text-danger' : 'text-warn'}>
                    {labelOf(deviceStateLabel, d.state)}
                  </span>
                  <span className="text-steel/70">
                    {' '}
                    · {d.label || d.global_id}
                    {d.zone_id && zoneMap.get(d.zone_id)
                      ? ` · ${zoneMap.get(d.zone_id)!.name}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">{vi.keypadUserActivity}</h2>
            <ul className="max-h-44 space-y-1.5 overflow-auto font-mono text-[11px]">
              {lastAction && lastAction.panelId === activePanel?.panel_id && (
                <li className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-accent">
                  {formatActivityLine(lastAction)}
                </li>
              )}
              {armActivity.map((e, i) => (
                <li
                  key={`${e.ts ?? 't'}-${e.type}-${i}`}
                  className="rounded-md border border-line/50 bg-fog/70 px-2.5 py-1.5 text-steel/80"
                >
                  <span className="text-steel/45">
                    {(e.ts ?? '').replace('T', ' ').replace('Z', '').slice(11, 19)}
                  </span>
                  {' · '}
                  {e.type === 'zone_armed' ? vi.eventTypeLabelZone : vi.eventTypeLabelPanel}
                  {' · '}
                  {labelOf(armedStateLabel, String(e.armed_state ?? ''))}
                  {e.detail ? ` · ${String(e.detail)}` : ''}
                </li>
              ))}
              {!lastAction && !armActivity.length && (
                <li className="text-steel/45">{vi.eventsWaiting}</li>
              )}
            </ul>
          </Card>

          <EventFeed events={events} />
        </aside>
      </div>

      <Card className="mt-4">
        <p className="font-mono text-[11px] text-steel/55">
          {panels.length} {vi.panels} · {devices.length} {vi.devices} ·{' '}
          {devices.filter((d) => d.state === 'alarm').length} {vi.alarm} · {zones.length}{' '}
          {vi.summaryZones.toLowerCase()}
        </p>
      </Card>
    </div>
  )
}

function formatActivityLine(a: LastAction): string {
  const action =
    a.action === 'arm' ? armedStateLabel.armed : a.action === 'disarm' ? armedStateLabel.disarmed : armedStateLabel.partial
  const target = a.target === 'section' && a.zoneName ? a.zoneName : vi.keypadFullySet
  return `${a.userName} · ${action} · ${target}`
}
