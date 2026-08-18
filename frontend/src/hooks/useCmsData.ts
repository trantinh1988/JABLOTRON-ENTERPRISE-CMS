import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getHealth,
  getLicenseStatus,
  listAllDevices,
  listMaps,
  listPanels,
  type Device,
  type FloorMap,
  type LicenseStatus,
  type Panel,
} from '../api/client'
import { LICENSE_FEATURE_ENABLED } from '../config/features'
import {
  isAlarmFocusSuppressed,
  releaseAlarmMapFocus,
  subscribeAlarmCleared,
} from './alarmMapFocusBus'
import {
  focusAlarmAfterUiApply,
  syncDeviceAlarmMirror,
} from './deviceAlarmFocusWatch'
import { effectiveDeviceStatus } from '../i18n/vi'
import { reactionAlarmsWhenDisarmed } from '../lib/deviceReaction'
import { takeEventsSince, useEventStream } from './useEventStream'
import {
  applyDeviceEvent,
  deviceIdsFromEvent,
  isDeviceStateEvent,
  isLiveSignalEvent,
  shouldRefreshOnEvent,
} from './deviceEventSync'
import {
  DevicePulseHold,
  PULSE_UI_HOLD_MS,
  deviceStateRank,
  isPulseVisibleState,
} from './devicePulseHold'

const FULL_REFRESH_MS = 30000
/** Match pulse UI hold so Map / Devices flash covers JA-110P ACT. */
const FLASH_MS = PULSE_UI_HOLD_MS

function mergePanelsFromRest(fromRest: Panel[], live: Panel[]): Panel[] {
  if (!live.length) return fromRest
  const liveById = new Map(live.map((p) => [p.panel_id, p]))
  return fromRest.map((p) => {
    const l = liveById.get(p.panel_id)
    if (!l) return p
    return {
      ...p,
      connection: l.connection,
      usb_path: l.usb_path,
      armed_state: l.armed_state,
      last_seen_at: l.last_seen_at ?? p.last_seen_at,
      device_stream_ok: l.device_stream_ok ?? p.device_stream_ok,
      has_stream_code: l.has_stream_code ?? p.has_stream_code,
    }
  })
}

export function useCmsData() {
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [panels, setPanels] = useState<Panel[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [maps, setMaps] = useState<FloorMap[]>([])
  const [mockMode, setMockMode] = useState<boolean | null>(null)
  const [usbHint, setUsbHint] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveSyncAt, setLiveSyncAt] = useState<number | null>(null)
  const [liveActive, setLiveActive] = useState(false)
  const [liveFlashIds, setLiveFlashIds] = useState<Set<string>>(() => new Set())

  const devicesRef = useRef(devices)
  devicesRef.current = devices
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const eventCursorRef = useRef(0)
  const wsConnectedRef = useRef(false)
  /** Bumps when WS patches runtime device/panel fields — used to detect REST races. */
  const liveGenRef = useRef(0)
  const refreshInFlightRef = useRef(0)
  const failStreakRef = useRef(0)
  const pulseHoldRef = useRef(new DevicePulseHold())

  const commitDevices = useCallback((next: Device[]) => {
    devicesRef.current = next
    syncDeviceAlarmMirror(next)
    setDevices(next)
    liveGenRef.current += 1
  }, [])

  const settlePulseHold = useCallback(
    (deviceId: string, state: string, disable: string) => {
      const cur = devicesRef.current.find((d) => d.global_id === deviceId)
      if (!cur) return
      if (cur.state === state && (cur.disable || 'none') === (disable || 'none')) return
      // Always apply settle from the pulse timer. The hold paints ACT/alarm on
      // purpose — rejecting settle when curRank > settleRank left Dev_09 stuck
      // on Báo động/ACT while EventFeed already showed OK.
      commitDevices(
        devicesRef.current.map((d) =>
          d.global_id === deviceId ? { ...d, state, disable: disable || 'none' } : d,
        ),
      )
    },
    [commitDevices],
  )

  const refresh = useCallback(async (opts?: { forceRestRuntime?: boolean }) => {
    const forceRestRuntime = opts?.forceRestRuntime === true
    const startedGen = liveGenRef.current
    const requestId = ++refreshInFlightRef.current
    try {
      const [lic, pnl, health, allDevices, allMaps] = await Promise.all([
        getLicenseStatus(),
        listPanels(),
        getHealth().catch(() => null),
        listAllDevices().catch(() => [] as Device[]),
        listMaps().catch(() => [] as FloorMap[]),
      ])
      // Drop stale responses superseded by a newer refresh.
      if (requestId !== refreshInFlightRef.current) return

      setLicense(lic)

      const liveMoved = liveGenRef.current !== startedGen
      const preserveLive = wsConnectedRef.current && liveMoved && !forceRestRuntime

      const nextPanels = preserveLive
        ? mergePanelsFromRest(pnl, panelsRef.current)
        : pnl
      // REST is source of truth, but keep in-flight JA-110P ACT paint for a short hold.
      const nextDevices = pulseHoldRef.current.mergeRestDevices(allDevices).map((d) => {
        if (!isAlarmFocusSuppressed(d.global_id)) return d
        if ((d.state || '').toLowerCase() !== 'alarm') return d
        const live = devicesRef.current.find((x) => x.global_id === d.global_id)
        if (!live || (live.state || '').toLowerCase() === 'alarm') return d
        return { ...d, state: live.state }
      })

      panelsRef.current = nextPanels
      setPanels(nextPanels)
      devicesRef.current = nextDevices
      syncDeviceAlarmMirror(nextDevices)
      setDevices(nextDevices)
      setMaps(allMaps)
      if (health) {
        setMockMode(health.usb_mock_mode)
        setUsbHint(health.usb_hint)
      }
      setLoadError(null)
      failStreakRef.current = 0
    } catch (e) {
      if (requestId !== refreshInFlightRef.current) return
      failStreakRef.current += 1
      const msg = e instanceof Error ? e.message : String(e)
      if (failStreakRef.current >= 2 || !panelsRef.current.length) {
        setLoadError(msg)
      }
    }
  }, [])

  const onWsOpen = useCallback(() => {
    // Reconnect catch-up: trust REST runtime once, then WS/snapshots resume.
    void refresh({ forceRestRuntime: true })
  }, [refresh])

  const { connected, events, lastEvent, eventSeq } = useEventStream(true, {
    onOpen: onWsOpen,
  })
  wsConnectedRef.current = connected

  useEffect(() => {
    void refresh({ forceRestRuntime: true })
    const id = window.setInterval(() => void refresh(), FULL_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const { events: batch, upTo } = takeEventsSince(eventCursorRef.current)
    if (!batch.length) return
    eventCursorRef.current = upTo

    let needRefresh = false
    let devicesNext = devicesRef.current
    let devicesChanged = false
    const flashIds: string[] = []
    let panelsNext = panelsRef.current
    let panelsChanged = false
    let liveHit = false
    let usbHintNext: string | null = null
    const alarmFocusIds: { deviceId: string; mapId: number | null; force: boolean }[] = []
    const clearedAlarmIds: string[] = []
    /** Peak ACT/TMP/alarm seen in this WS batch (before coalesce to ok). */
    const peakById = new Map<string, { state: string; disable: string }>()

    const notePeak = (id: string, state: string, disable: string) => {
      if (!isPulseVisibleState(state)) return
      const prev = peakById.get(id)
      if (!prev || deviceStateRank(state) >= deviceStateRank(prev.state)) {
        peakById.set(id, { state, disable: disable || 'none' })
      }
    }

    const patchPanel = (panelId: string, patch: Partial<Panel>) => {
      panelsNext = panelsNext.map((p) => {
        if (p.panel_id !== panelId) return p
        return { ...p, ...patch }
      })
      panelsChanged = true
    }

    for (const ev of batch) {
      if (ev.clear_alarm === true && ev.device_id) {
        clearedAlarmIds.push(String(ev.device_id))
      }
      const clearedBatch = ev.clear_alarm_ids
      if (Array.isArray(clearedBatch)) {
        for (const id of clearedBatch) clearedAlarmIds.push(String(id))
      }
      if (isDeviceStateEvent(ev)) {
        const beforeList = devicesNext
        const patched = applyDeviceEvent(devicesNext, ev)
        if (patched === 'refresh') {
          needRefresh = true
          if (ev.type === 'device_alarm_trigger' && ev.device_id) {
            alarmFocusIds.push({
              deviceId: String(ev.device_id),
              mapId:
                ev.map_id != null && Number.isFinite(Number(ev.map_id))
                  ? Number(ev.map_id)
                  : null,
              force: true,
            })
          }
        } else {
          let list = patched
          for (const id of deviceIdsFromEvent(ev)) {
            const before = beforeList.find((d) => d.global_id === id)
            const after = list.find((d) => d.global_id === id)
            if (!after) continue
            const prevSt = effectiveDeviceStatus(before?.state, before?.disable)
            const curSt = effectiveDeviceStatus(after.state, after.disable)
            notePeak(id, after.state || 'ok', after.disable || 'none')
            // Also note peak from before if this event cleared a visible pulse.
            if (before && isPulseVisibleState(before.state)) {
              notePeak(id, before.state || 'ok', before.disable || 'none')
            }
            if (
              ev.type !== 'devices_state_snapshot' &&
              before &&
              (before.state !== after.state ||
                (before.disable || 'none') !== (after.disable || 'none'))
            ) {
              flashIds.push(id)
            }
            // Chỉ Status = Báo động mới focus map. ACT (open) của 24h/Fire không
            // focus — backend promote ACT → Báo động rồi mới bắn alarm trigger.
            if (ev.type === 'device_alarm_trigger') {
              alarmFocusIds.push({
                deviceId: after.global_id,
                mapId:
                  ev.map_id != null && Number.isFinite(Number(ev.map_id))
                    ? Number(ev.map_id)
                    : after.map_id ?? null,
                force: true,
              })
            } else if (curSt === 'alarm' && prevSt !== 'alarm') {
              alarmFocusIds.push({
                deviceId: after.global_id,
                mapId: after.map_id ?? null,
                force: false,
              })
            }

            // Fast ACT→OK on a later WS tick — keep ACT painted for the hold window.
            if (
              before &&
              isPulseVisibleState(before.state) &&
              !isPulseVisibleState(after.state)
            ) {
              list = pulseHoldRef.current.suppressEarlyOk(
                list,
                id,
                before.state || 'ok',
                before.disable || 'none',
                after.state || 'ok',
                after.disable || 'none',
                settlePulseHold,
              )
            }
          }

          if (list !== devicesNext) {
            devicesNext = list
            devicesChanged = true
          }
        }
      }

      if (ev.type === 'panel_live' && ev.panel_id) {
        const panelId = String(ev.panel_id)
        const cur = panelsNext.find((p) => p.panel_id === panelId)
        patchPanel(panelId, {
          ...(cur?.connection === 'disconnected' ? { connection: 'usb' as const } : {}),
          ...(typeof ev.last_seen_at === 'string' ? { last_seen_at: ev.last_seen_at } : {}),
          ...(typeof ev.device_stream_ok === 'boolean'
            ? { device_stream_ok: ev.device_stream_ok }
            : {}),
          ...(typeof ev.has_stream_code === 'boolean'
            ? { has_stream_code: ev.has_stream_code }
            : {}),
        })
      }

      if (ev.type === 'panel_armed' && ev.panel_id && ev.armed_state) {
        patchPanel(String(ev.panel_id), { armed_state: String(ev.armed_state) })
        // Tắt bảo vệ: chỉ Instant. 24h/Fire chờ clear_alarm (PIN / backend).
        if (String(ev.armed_state) === 'disarmed') {
          const panelId = String(ev.panel_id)
          let cleared = false
          devicesNext = devicesNext.map((d) => {
            if (d.panel_id !== panelId) return d
            if ((d.state || '').toLowerCase() !== 'alarm') return d
            if (reactionAlarmsWhenDisarmed(d.reaction)) return d
            cleared = true
            clearedAlarmIds.push(d.global_id)
            return { ...d, state: 'ok' }
          })
          if (cleared) devicesChanged = true
        }
      }

      if (ev.type === 'zone_armed' && ev.zone_id) {
        const zoneId = String(ev.zone_id)
        const disarmed = String(ev.armed_state || '') === 'disarmed'
        const physicalUnset = ev.physical_unset === true
        // LED keypad tắt ≠ nhập PIN. Tắt phân khu vật lý (physical_unset) mới gỡ 24h.
        if (disarmed || physicalUnset) {
          let cleared = false
          devicesNext = devicesNext.map((d) => {
            if (d.zone_id !== zoneId) return d
            if ((d.state || '').toLowerCase() !== 'alarm') return d
            if (!physicalUnset && reactionAlarmsWhenDisarmed(d.reaction)) return d
            cleared = true
            clearedAlarmIds.push(d.global_id)
            return { ...d, state: 'ok' }
          })
          if (cleared) devicesChanged = true
        }
      }
      if (isLiveSignalEvent(ev)) {
        if (ev.type === 'panel_live') {
          if (ev.device_stream_ok === true) liveHit = true
        } else if (
          ev.type === 'device_state' ||
          ev.type === 'device_disable' ||
          ev.type === 'device_alarm_trigger' ||
          ev.type === 'devices_state_batch' ||
          ev.type === 'devices_disable_batch'
        ) {
          liveHit = true
        }
      }

      if (ev.type === 'panel_connected' && ev.panel_id && typeof ev.usb_path === 'string') {
        patchPanel(String(ev.panel_id), {
          connection: 'usb',
          usb_path: String(ev.usb_path),
        })
        needRefresh = true
      }

      if (ev.type === 'panel_disconnected' && ev.panel_id) {
        patchPanel(String(ev.panel_id), {
          connection: 'disconnected',
          usb_path: null,
        })
      }

      if (ev.type === 'usb_error' && ev.detail) {
        usbHintNext = String(ev.detail)
        needRefresh = true
      }

      if (shouldRefreshOnEvent(ev)) {
        needRefresh = true
      }
    }

    // JA-110P: WS often delivers ACT then OK in one React drain — restore peak ACT
    // so Map / Devices page paint it for PULSE_UI_HOLD_MS (EventFeed already logs both).
    if (peakById.size) {
      const held = pulseHoldRef.current.applyPeakHold(
        devicesNext,
        peakById,
        settlePulseHold,
      )
      if (held.devices !== devicesNext) {
        devicesNext = held.devices
        devicesChanged = true
      }
      for (const id of held.heldIds) flashIds.push(id)
    }

    if (devicesChanged) {
      // Only device runtime bumps the gen used to preserve WS over REST.
      // panel_live heartbeats must NOT freeze sticky OK over real ACT from REST.
      devicesRef.current = devicesNext
      syncDeviceAlarmMirror(devicesNext)
      setDevices(devicesNext)
      liveGenRef.current += 1
    }

    if (clearedAlarmIds.length) {
      releaseAlarmMapFocus([...new Set(clearedAlarmIds)])
    }

    if (alarmFocusIds.length) {
      const seen = new Set<string>(clearedAlarmIds)
      for (const item of alarmFocusIds) {
        if (seen.has(item.deviceId)) continue
        seen.add(item.deviceId)
        const live = devicesNext.find((d) => d.global_id === item.deviceId)
        // Always focus on device_alarm_trigger / ok→alarm — do NOT gate on
        // panel.armed_state (stale "disarmed" before panel_armed WS kills Dev_09 lần 1).
        focusAlarmAfterUiApply(
          item.deviceId,
          item.mapId ?? live?.map_id ?? null,
          { force: item.force },
        )
      }
    }
    if (panelsChanged) {
      panelsRef.current = panelsNext
      setPanels(panelsNext)
    }
    if (flashIds.length) {
      setLiveFlashIds((old) => {
        const next = new Set(old)
        for (const id of flashIds) next.add(id)
        return next
      })
    }
    if (liveHit) {
      setLiveSyncAt(Date.now())
      setLiveActive(true)
    }
    if (usbHintNext) setUsbHint(usbHintNext)
    // Disarm / inventory: force REST so sticky alarm cannot win over cleared backend.
    if (needRefresh) void refresh({ forceRestRuntime: true })
  }, [eventSeq, refresh, settlePulseHold])

  useEffect(() => {
    return subscribeAlarmCleared((ids) => {
      if (!ids.length) return
      for (const id of ids) pulseHoldRef.current.release(id)
      const idSet = new Set(ids)
      let changed = false
      const next = devicesRef.current.map((d) => {
        if (!idSet.has(d.global_id)) return d
        if ((d.state || '').toLowerCase() !== 'alarm') return d
        changed = true
        return { ...d, state: 'ok' }
      })
      if (changed) commitDevices(next)
    })
  }, [commitDevices])

  useEffect(() => {
    const hold = pulseHoldRef.current
    return () => hold.clearAll()
  }, [])

  useEffect(() => {
    if (!liveFlashIds.size) return
    const id = window.setTimeout(() => setLiveFlashIds(new Set()), FLASH_MS)
    return () => window.clearTimeout(id)
  }, [liveFlashIds])

  useEffect(() => {
    if (!liveSyncAt) return
    setLiveActive(true)
    const id = window.setTimeout(() => setLiveActive(false), 8000)
    return () => window.clearTimeout(id)
  }, [liveSyncAt])

  const writeAllowed = !LICENSE_FEATURE_ENABLED || license?.mode === 'full'
  const streamLive =
    connected && panels.some((p) => p.device_stream_ok === true)

  return {
    license,
    panels,
    devices,
    maps,
    mockMode,
    usbHint,
    loadError,
    connected,
    events,
    lastEvent,
    eventSeq,
    liveSyncAt,
    liveActive: liveActive || streamLive,
    liveFlashIds,
    writeAllowed,
    refresh,
    setDevices,
    setMaps,
    setPanels,
  }
}
