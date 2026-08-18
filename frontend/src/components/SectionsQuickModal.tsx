import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  listPanelUsers,
  listZones,
  patchZoneFromArmedEvent,
  type Device,
  type Panel,
  type PanelUser,
  type Zone,
} from '../api/client'
import { formatZoneCaption } from './EventFeed'
import { SectionGrid } from './SectionGrid'
import { SectionPinModal } from './SectionPinModal'
import { usePanelKeypad } from '../hooks/usePanelKeypad'
import { latestEventSeq, takeEventsSince } from '../hooks/useEventStream'
import { vi } from '../i18n/vi'

const OPEN_EVENT = 'cms:open-sections'

export function openSectionsQuickModal(): void {
  try {
    window.dispatchEvent(new Event(OPEN_EVENT))
  } catch {
    /* ignore */
  }
}

export function subscribeSectionsQuickModal(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler)
  return () => window.removeEventListener(OPEN_EVENT, handler)
}

type Props = {
  open: boolean
  panels: Panel[]
  devices: Device[]
  writeAllowed: boolean
  mockMode: boolean | null
  eventSeq: number
  onClose: () => void
  onRefresh: () => Promise<void>
}

export function SectionsQuickModal({
  open,
  panels,
  devices,
  writeAllowed,
  mockMode,
  eventSeq,
  onClose,
  onRefresh,
}: Props) {
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [users, setUsers] = useState<PanelUser[]>([])
  const [metaError, setMetaError] = useState<string | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
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

  const keypad = usePanelKeypad({
    panel: activePanel,
    zones,
    devices: panelDevices,
    users,
    writeAllowed,
    mockMode,
    onLastAction: () => {},
    onRefresh,
    onZonesChange: setZones,
    onArmedSuccess: onClose,
  })

  useEffect(() => {
    if (!open) {
      setSelectedZoneId(null)
      keypad.cancelPending()
      return
    }
    eventCursorRef.current = latestEventSeq()
    const id = activePanel?.panel_id
    if (!id) {
      setZones([])
      setUsers([])
      return
    }
    void loadMeta(id)
    // keypad.cancelPending ổn định theo busy; không đưa keypad vào deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePanel?.panel_id, loadMeta])

  useEffect(() => {
    if (!open || !activePanel?.panel_id) return
    const { events: batch, upTo } = takeEventsSince(eventCursorRef.current)
    if (!batch.length) return
    eventCursorRef.current = upTo

    const panelId = activePanel.panel_id
    let next = zonesRef.current
    let changed = false

    for (const ev of batch) {
      if (ev.panel_id !== panelId) continue
      if (ev.type === 'zone_armed') {
        const armed = String(ev.armed_state ?? '')
        if (!armed) continue
        const mapped = next.map((z) => patchZoneFromArmedEvent(z, ev))
        if (mapped.some((z, i) => z !== next[i])) {
          next = mapped
          changed = true
        }
      }
    }
    if (changed) setZones(next)
  }, [eventSeq, open, activePanel?.panel_id])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (keypad.pending || keypad.busy) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, keypad.pending, keypad.busy, onClose])

  if (!open) return null

  const armedCount = keypad.sortedZones.filter(
    (z) => z.armed_state === 'armed' || z.armed_state === 'partial',
  ).length

  return (
    <>
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => {
        if (!keypad.pending && !keypad.busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sections-quick-title"
        className="panel-card flex max-h-[min(86vh,640px)] w-full max-w-md flex-col overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 id="sections-quick-title" className="text-sm font-semibold text-ink">
              {vi.headerSections}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-steel/55">
              {vi.headerSectionsHint}
              {keypad.sortedZones.length
                ? ` · ${vi.keypadSectionsMeta(keypad.sortedZones.length, 15, armedCount)}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-steel hover:bg-mist hover:text-ink"
            onClick={onClose}
            aria-label={vi.closeModal}
          >
            <X className="size-4" />
          </button>
        </div>

        {panels.length > 1 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-line/70 px-4 py-2">
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
          </div>
        )}

        {(metaError || keypad.error || keypad.message) && (
          <div className="shrink-0 space-y-1 px-4 pt-2">
            {metaError && (
              <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
                {vi.backendError(metaError)}
              </p>
            )}
            {keypad.error && (
              <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
                {keypad.error}
              </p>
            )}
            {keypad.message && (
              <p className="rounded-md bg-ok/10 px-2.5 py-1.5 text-[11px] text-ok">{keypad.message}</p>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 px-4 py-3">
          <SectionGrid
            embedded
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
      </div>
    </div>

      <SectionPinModal
        open={Boolean(keypad.pending)}
        zoneName={
          keypad.pending
            ? formatZoneCaption(keypad.pending.zone) || keypad.pending.zone.name
            : ''
        }
        action={keypad.pending?.action ?? 'disarm'}
        busy={keypad.busy}
        error={keypad.pinError}
        onClose={keypad.cancelPending}
        onClearError={keypad.clearPinError}
        onConfirm={(pin) => void keypad.confirmSectionWithPin(pin)}
      />
    </>
  )
}
