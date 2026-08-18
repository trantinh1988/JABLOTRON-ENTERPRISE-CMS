import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activatePanelDeviceStream,
  listPanelUsers,
  listZones,
  updatePanel,
  type CmsEvent,
  type Device,
  type Panel,
  type PanelUser,
  type Zone,
  patchZoneFromArmedEvent,
} from '../api/client'
import { EventFeed, formatEventTime, formatZoneCaption, zoneCaptionFromEvent } from '../components/EventFeed'
import { SectionGrid } from '../components/SectionGrid'
import { SectionPinModal } from '../components/SectionPinModal'
import { StreamCodeModal } from '../components/StreamCodeModal'
import { Card, PageHeader } from '../components/ui'
import { ReactionBadge } from '../components/ReactionBadge'
import { type LastAction, usePanelKeypad } from '../hooks/usePanelKeypad'
import { latestEventSeq, takeEventsSince } from '../hooks/useEventStream'
import { armedStateLabel, deviceStateLabel, labelOf, vi } from '../i18n/vi'
import { reactionShowsMapChip } from '../lib/deviceReaction'

type Props = {
  panels: Panel[]
  devices: Device[]
  writeAllowed: boolean
  mockMode: boolean | null
  events: CmsEvent[]
  eventSeq: number
  loadError: string | null
  onRefresh: () => Promise<void>
}

export function DashboardPage({
  panels,
  devices,
  writeAllowed,
  mockMode,
  events,
  eventSeq,
  loadError,
  onRefresh,
}: Props) {
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [users, setUsers] = useState<PanelUser[]>([])
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [streamBusy, setStreamBusy] = useState(false)
  const [streamErr, setStreamErr] = useState<string | null>(null)
  const [streamModalOpen, setStreamModalOpen] = useState(false)
  const eventCursorRef = useRef(latestEventSeq())
  const zonesRef = useRef(zones)
  zonesRef.current = zones

  const activePanel = useMemo(() => {
    if (!panels.length) return null
    const id =
      activePanelId && panels.some((p) => p.panel_id === activePanelId)
        ? activePanelId
        : panels[0].panel_id
    return panels.find((p) => p.panel_id === id) ?? null
  }, [activePanelId, panels])

  const panelDevices = useMemo(
    () => (activePanel ? devices.filter((d) => d.panel_id === activePanel.panel_id) : []),
    [activePanel, devices],
  )

  const scopedDevices = useMemo(() => {
    if (!selectedZoneId) return panelDevices
    return panelDevices.filter((d) => d.zone_id === selectedZoneId)
  }, [panelDevices, selectedZoneId])

  const alarmStateDevices = useMemo(() => {
    const rank = (st: string) => {
      if (st === 'alarm') return 0
      if (st === 'open') return 1
      if (st === 'tamper') return 2
      if (st === 'loss') return 3
      if (st === 'fault') return 4
      return 9
    }
    return scopedDevices
      .filter((d) => {
        const st = (d.state || '').toLowerCase()
        return st === 'alarm' || st === 'open' || st === 'tamper' || st === 'loss' || st === 'fault'
      })
      .sort((a, b) => {
        const ra = rank((a.state || '').toLowerCase())
        const rb = rank((b.state || '').toLowerCase())
        if (ra !== rb) return ra - rb
        return (a.device_num ?? 0) - (b.device_num ?? 0)
      })
  }, [scopedDevices])

  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])

  const activePanelKey = activePanel?.panel_id ?? null

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
    if (!activePanelKey) {
      setZones([])
      setUsers([])
      setSelectedZoneId(null)
      return
    }
    setSelectedZoneId(null)
    void loadMeta(activePanelKey)
  }, [activePanelKey, loadMeta])

  useEffect(() => {
    if (!selectedZoneId) return
    if (!zones.some((z) => z.zone_id === selectedZoneId)) {
      setSelectedZoneId(null)
    }
  }, [zones, selectedZoneId])

  useEffect(() => {
    eventCursorRef.current = latestEventSeq()
  }, [activePanel?.panel_id])

  useEffect(() => {
    if (!activePanelKey) return
    const { events: batch, upTo } = takeEventsSince(eventCursorRef.current)
    if (!batch.length) return
    eventCursorRef.current = upTo

    let zonesNext = zonesRef.current
    let zonesChanged = false
    let lastActionNext: LastAction | null = null
    let reloadMeta = false
    const panelId = activePanelKey

    for (const ev of batch) {
      if (ev.panel_id !== panelId) continue

      if (ev.type === 'zone_armed') {
        const armed = String(ev.armed_state ?? '')
        if (!armed) continue
        let matchedCaption: string | undefined
        let armedChanged = false
        const next = zonesNext.map((z) => {
          const patched = patchZoneFromArmedEvent(z, ev)
          if (patched === z) return z
          matchedCaption = formatZoneCaption(z)
          if (patched.armed_state !== z.armed_state) armedChanged = true
          return patched
        })
        if (next.some((z, i) => z !== zonesNext[i])) {
          zonesNext = next
          zonesChanged = true
        }
        if (!armedChanged) continue
        const fromCms = typeof ev.detail === 'string' && ev.detail.includes(' · ')
        lastActionNext = {
          at: ev.ts ?? new Date().toISOString(),
          panelId,
          target: 'section',
          zoneName: matchedCaption || (fromCms ? String(ev.detail).split(' · ')[1] : undefined),
          action: armed === 'armed' ? 'arm' : armed === 'partial' ? 'partial' : 'disarm',
          userName: fromCms
            ? String(ev.detail).split(' · ')[0]
            : vi.keypadOperatorPhysical,
        }
      }

      if (ev.type === 'panel_armed' && ev.armed_state) {
        const armed = String(ev.armed_state)
        const detail = ev.detail != null ? String(ev.detail) : ''
        const fromCms = Boolean(detail) && !detail.startsWith('mock') && !detail.startsWith('usb')
        lastActionNext = {
          at: ev.ts ?? new Date().toISOString(),
          panelId,
          target: 'system',
          action: armed === 'armed' ? 'arm' : armed === 'partial' ? 'partial' : 'disarm',
          userName: fromCms ? detail.split(' · ')[0] || detail : vi.keypadOperatorPhysical,
        }
        reloadMeta = true
      }
    }

    if (zonesChanged) {
      zonesRef.current = zonesNext
      setZones(zonesNext)
    }
    if (lastActionNext) setLastAction(lastActionNext)
    if (reloadMeta) void loadMeta(panelId)
  }, [eventSeq, activePanelKey, loadMeta])

  const keypad = usePanelKeypad({
    panel: activePanel,
    zones,
    devices: panelDevices,
    users,
    writeAllowed,
    mockMode,
    onLastAction: setLastAction,
    onRefresh,
    onZonesChange: setZones,
  })

  const armActivity = useMemo(() => {
    return events
      .filter(
        (e) =>
          (e.type === 'panel_armed' || e.type === 'zone_armed') &&
          (!activePanel || e.panel_id === activePanel.panel_id),
      )
      .slice(0, 10)
  }, [events, activePanel])

  const panelEvents = useMemo(
    () =>
      events
        .filter((e) => {
          if (activePanel && e.panel_id !== activePanel.panel_id) return false
          if (
            e.type === 'devices_state_batch' ||
            e.type === 'devices_disable_batch' ||
            e.type === 'devices_state_snapshot'
          ) {
            return false
          }
          return true
        })
        .slice(0, 60),
    [events, activePanel],
  )

  const alarmTotal = panelDevices.filter((d) => (d.state || '').toLowerCase() === 'alarm').length
  const needsStreamSetup =
    activePanel?.connection === 'usb' && activePanel.device_stream_ok !== true

  async function saveStreamCode(code: string) {
    if (!activePanel) return
    setStreamBusy(true)
    setStreamErr(null)
    try {
      await updatePanel(activePanel.panel_id, { stream_code: code })
      await onRefresh()
      if (code) setStreamModalOpen(false)
    } catch (e) {
      setStreamErr(e instanceof Error ? e.message : String(e))
    } finally {
      setStreamBusy(false)
    }
  }

  async function reactivateStream() {
    if (!activePanel) return
    setStreamBusy(true)
    setStreamErr(null)
    try {
      await activatePanelDeviceStream(activePanel.panel_id)
      await onRefresh()
      setStreamModalOpen(false)
    } catch (e) {
      setStreamErr(e instanceof Error ? e.message : String(e))
    } finally {
      setStreamBusy(false)
    }
  }

  return (
    <div className="dashboard-page flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 sm:px-5 lg:px-6">
      <div className="shrink-0">
        <PageHeader
          title={vi.navDashboard}
          hint={vi.keypadPageHint}
          actions={
            <span className="hidden font-mono text-[11px] text-steel/50 sm:inline">
              {keypad.sortedZones.length} {vi.section.toLowerCase()} · {alarmTotal}{' '}
              {vi.legendAlarm.toLowerCase()}
            </span>
          }
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
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
          {needsStreamSetup && writeAllowed && (
            <button
              type="button"
              onClick={() => {
                setStreamErr(null)
                setStreamModalOpen(true)
              }}
              className="rounded-md bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn ring-1 ring-warn/35 transition hover:bg-warn/25"
              title={vi.streamCodeBannerBody}
            >
              {vi.streamCodeActivateBtn}
            </button>
          )}
        </div>

        {(loadError || metaError) && (
          <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {vi.backendError(loadError || metaError || '')}
          </p>
        )}
      </div>

      {/*
        3 cột bằng nhau, cao theo chuẩn card Sự kiện (15 dòng).
        Trang không cuộn — chỉ cuộn trong từng card.
      */}
      <div className="dashboard-board grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-2 xl:grid-cols-3">
        {/* Cột trái: Phân khu */}
        <div className="dashboard-board-col min-h-0">
          <SectionGrid
            zones={keypad.sortedZones}
            devices={panelDevices}
            selectedZoneId={selectedZoneId}
            busy={keypad.busy}
            writeAllowed={writeAllowed}
            onSelect={setSelectedZoneId}
            onArm={(zone) => keypad.requestSection(zone, 'arm')}
            onDisarm={(zone) => keypad.requestSection(zone, 'disarm')}
            onSilence={(zone) => keypad.requestSilence(zone)}
          />
        </div>

        <SectionPinModal
          open={Boolean(keypad.pending)}
          zoneName={keypad.pending?.zone.name ?? ''}
          action={keypad.pending?.action ?? 'disarm'}
          busy={keypad.busy}
          error={keypad.pinError}
          onClose={keypad.cancelPending}
          onClearError={keypad.clearPinError}
          onConfirm={(pin) => void keypad.confirmSectionWithPin(pin)}
        />

        <StreamCodeModal
          open={streamModalOpen}
          panelName={activePanel?.display_name ?? ''}
          hasStreamCode={Boolean(activePanel?.has_stream_code)}
          busy={streamBusy}
          error={streamErr}
          onClose={() => {
            if (!streamBusy) {
              setStreamModalOpen(false)
              setStreamErr(null)
            }
          }}
          onConfirm={(pin) => void saveStreamCode(pin)}
          onReactivate={() => void reactivateStream()}
          onClear={() => void saveStreamCode('')}
        />

        {/* Cột giữa: Sự kiện trực tiếp (chuẩn 15 dòng) */}
        <div className="dashboard-board-col min-h-0">
          <EventFeed
            events={panelEvents}
            devices={panelDevices}
            zones={zones}
            fill
            visibleRows={15}
          />
        </div>

        {/* Cột phải: Trạng thái + Người dùng — chia đều chiều cao */}
        <aside className="dashboard-board-col flex min-h-0 flex-col gap-3 lg:col-span-2 xl:col-span-1">
          <Card
            className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
              alarmStateDevices.some((d) => (d.state || '').toLowerCase() === 'alarm')
                ? 'ring-1 ring-danger/35 shadow-[0_0_24px_rgba(239,83,80,0.12)]'
                : alarmStateDevices.length
                  ? 'ring-1 ring-warn/30'
                  : ''
            }`}
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">{vi.keypadAlarmStateTitle}</h2>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  alarmStateDevices.some((d) => (d.state || '').toLowerCase() === 'alarm')
                    ? 'bg-danger/15 text-danger'
                    : alarmStateDevices.length
                      ? 'bg-warn/15 text-warn'
                      : 'bg-ok/10 text-ok'
                }`}
              >
                {alarmStateDevices.length}
              </span>
            </div>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {alarmStateDevices.length === 0 && (
                <li className="rounded-md border border-dashed border-line/50 px-2.5 py-3 text-center text-xs text-steel/45">
                  {vi.keypadAlarmStateEmpty}
                </li>
              )}
              {alarmStateDevices.map((d) => {
                const st = (d.state || 'ok').toLowerCase()
                const tone =
                  st === 'alarm'
                    ? 'border-danger/25 bg-danger/5 text-danger'
                    : st === 'open' || st === 'tamper' || st === 'loss' || st === 'fault'
                      ? 'border-warn/25 bg-warn/5 text-warn'
                      : 'border-line/50 bg-fog/70 text-ink'
                return (
                  <li
                    key={d.global_id}
                    className={`rounded-md border px-2.5 py-1.5 font-mono text-[11px] ${tone}`}
                  >
                    <span className="font-semibold">{labelOf(deviceStateLabel, st)}</span>
                    {reactionShowsMapChip(d.reaction) ? (
                      <ReactionBadge reaction={d.reaction} className="ml-1 align-middle" />
                    ) : null}
                    <span className="text-steel/70"> · {d.label || d.global_id}</span>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <h2 className="mb-2 shrink-0 text-sm font-semibold text-ink">{vi.keypadUserActivity}</h2>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto font-mono text-[11px]">
              {lastAction && lastAction.panelId === activePanel?.panel_id && (
                <li className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-accent">
                  {formatActivityLine(lastAction)}
                </li>
              )}
              {armActivity.map((e, i) => {
                const action = labelOf(armedStateLabel, String(e.armed_state ?? ''))
                const zonePart =
                  e.type === 'zone_armed'
                    ? zoneCaptionFromEvent(e, zoneMap) || vi.eventTypeLabelZone
                    : vi.keypadSystemTarget
                return (
                  <li
                    key={`${e.ts ?? 't'}-${e.type}-${i}`}
                    className="rounded-md border border-line/50 bg-fog/70 px-2.5 py-1.5 text-steel/80"
                  >
                    <span className="text-steel/45" title="GMT+07 · Hồ Chí Minh">
                      {formatEventTime(e.ts, true)}
                    </span>
                    {' | '}
                    {zonePart}
                    {' | '}
                    {action}
                  </li>
                )
              })}
              {!lastAction && !armActivity.length && (
                <li className="text-steel/45">{vi.keypadUserActivityEmpty}</li>
              )}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function formatActivityLine(a: LastAction): string {
  const action =
    a.action === 'arm'
      ? armedStateLabel.armed
      : a.action === 'disarm'
        ? armedStateLabel.disarmed
        : armedStateLabel.partial
  const target = a.target === 'section' && a.zoneName ? a.zoneName : vi.keypadSystemTarget
  return `${a.userName} | ${target} | ${action}`
}
