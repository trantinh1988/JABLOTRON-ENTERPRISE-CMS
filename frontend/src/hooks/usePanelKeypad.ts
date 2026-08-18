import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ackAlwaysAlarms,
  groupAction,
  type Device,
  type Panel,
  type PanelUser,
  type Zone,
} from '../api/client'
import { formatZoneCaption } from '../components/EventFeed'
import {
  getAlarmFocusQueue,
  releaseAlarmMapFocus,
} from './alarmMapFocusBus'
import {
  armedStateLabel,
  formatCommandError,
  labelOf,
  vi,
} from '../i18n/vi'
import { reactionAlarmsWhenDisarmed } from '../lib/deviceReaction'
import {
  panelControllable,
  pinCommandErrorMessage,
  pinUsersOf,
  resolvePinUser,
} from '../lib/pinAuth'

export type LastAction = {
  at: string
  panelId: string
  target: 'system' | 'section'
  zoneName?: string
  action: 'arm' | 'disarm' | 'partial'
  userName: string
}

export type PendingSectionAction = {
  zone: Zone
  action: 'arm' | 'disarm' | 'silence'
}

type Opts = {
  panel: Panel | null
  zones: Zone[]
  devices: Device[]
  users: PanelUser[]
  writeAllowed: boolean
  mockMode: boolean | null
  onLastAction: (action: LastAction) => void
  onRefresh: () => Promise<void>
  onZonesChange: (zones: Zone[]) => void
  /** Called after a successful arm/disarm (PIN modal already closed). */
  onArmedSuccess?: (action: 'arm' | 'disarm') => void
}

function alwaysAlarmIdsInZone(devices: Device[], zoneId: string): string[] {
  return devices
    .filter(
      (d) =>
        d.zone_id === zoneId &&
        (d.state || '').toLowerCase() === 'alarm' &&
        reactionAlarmsWhenDisarmed(d.reaction),
    )
    .map((d) => d.global_id)
}

function queuedAlarmIdsInZone(devices: Device[], zoneId: string): string[] {
  const inZone = new Set(
    devices.filter((d) => d.zone_id === zoneId).map((d) => d.global_id),
  )
  return getAlarmFocusQueue()
    .filter((q) => inZone.has(q.deviceId))
    .map((q) => q.deviceId)
}

export function usePanelKeypad({
  panel,
  zones,
  devices,
  users,
  writeAllowed,
  mockMode,
  onLastAction,
  onRefresh,
  onZonesChange,
  onArmedSuccess,
}: Opts) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSectionAction | null>(null)

  const sortedZones = useMemo(
    () =>
      [...zones]
        .filter((z) => z.name.trim().toUpperCase() !== 'FULLY SET')
        .sort((a, b) => a.section_num - b.section_num)
        .slice(0, 15),
    [zones],
  )

  const pinUsers = useMemo(() => pinUsersOf(users), [users])

  useEffect(() => {
    setPending(null)
    setError(null)
    setMessage(null)
    setPinError(null)
  }, [panel?.panel_id])

  const gateRequest = useCallback(
    (kind: 'arm' | 'disarm' | 'silence'): boolean => {
      if (!panel) return false
      if (!writeAllowed) {
        setError(vi.readOnlyHint)
        return false
      }
      if (!panelControllable(panel, mockMode) && kind !== 'silence') {
        setError(vi.panelNotControllable(panel.panel_id))
        return false
      }
      if (!pinUsers.length) {
        setError(vi.keypadNoPinUsers)
        return false
      }
      return true
    },
    [panel, writeAllowed, mockMode, pinUsers.length],
  )

  const requestSection = useCallback(
    (zone: Zone, action: 'arm' | 'disarm') => {
      if (!gateRequest(action)) return

      const already =
        (action === 'arm' && (zone.armed_state === 'armed' || zone.armed_state === 'partial')) ||
        (action === 'disarm' && zone.armed_state === 'disarmed')
      if (already) {
        if (action === 'disarm' && alwaysAlarmIdsInZone(devices, zone.zone_id).length) {
          setError(null)
          setMessage(null)
          setPinError(null)
          setPending({ zone, action: 'silence' })
          return
        }
        setError(null)
        setMessage(`${labelOf(armedStateLabel, zone.armed_state)} · ${zone.name}`)
        return
      }

      setError(null)
      setMessage(null)
      setPinError(null)
      setPending({ zone, action })
    },
    [gateRequest, devices],
  )

  const requestSilence = useCallback(
    (zone: Zone) => {
      if (!alwaysAlarmIdsInZone(devices, zone.zone_id).length) return
      if (!gateRequest('silence')) return
      setError(null)
      setMessage(null)
      setPinError(null)
      setPending({ zone, action: 'silence' })
    },
    [devices, gateRequest],
  )

  const cancelPending = useCallback(() => {
    if (busy) return
    setPending(null)
    setPinError(null)
  }, [busy])

  const clearPinError = useCallback(() => setPinError(null), [])

  const confirmSectionWithPin = useCallback(
    async (pin: string) => {
      if (!panel || !pending) return

      const need = pending.action === 'arm' ? 'arm' : 'disarm'
      const resolved = resolvePinUser(pinUsers, pin, need)
      if ('error' in resolved) {
        setPinError(resolved.error)
        return
      }

      const { zone, action } = pending
      const silence = action === 'silence'
      const nextArmed = action === 'arm' ? 'armed' : 'disarmed'
      const zoneId = zone.zone_id

      setPinError(null)
      setError(null)
      setMessage(null)
      setBusy(true)

      const failWith = (raw: string) => {
        const pinMsg = pinCommandErrorMessage(raw)
        if (pinMsg) {
          setPinError(pinMsg)
          return
        }
        setPending(null)
        setError(formatCommandError(raw))
      }

      try {
        // Tắt 24h trên phân khu: PIN CMS (ack). Bật/tắt bảo vệ mới gửi HID xuống tủ.
        if (!silence && panelControllable(panel, mockMode)) {
          const result = await groupAction(
            [panel.panel_id],
            action === 'arm' ? 'arm' : 'disarm',
            `${resolved.user.name} · ${zone.name}`,
            { code: pin, section_num: zone.section_num },
          )
          const failed = result.results.filter((r) => !r.ok)
          if (failed.length) {
            const codes = failed.map((f) => String(f.error ?? ''))
            const pinCode = codes.find((c) => pinCommandErrorMessage(c))
            if (pinCode) {
              setPinError(pinCommandErrorMessage(pinCode) ?? formatCommandError(pinCode))
              return
            }
            setPending(null)
            setError(
              failed
                .map((f) => `${f.panel_id}: ${formatCommandError(String(f.error ?? ''))}`)
                .join(', '),
            )
            return
          }
        }

        const silenceIds = alwaysAlarmIdsInZone(devices, zoneId)
        const zoneQueued = queuedAlarmIdsInZone(devices, zoneId)
        if (silence) {
          if (silenceIds.length) {
            const ack = await ackAlwaysAlarms(panel.panel_id, silenceIds, pin)
            setMessage(
              `${vi.ackAlwaysAlarmOk(ack.silenced?.length ?? silenceIds.length)} · ${zone.name}`,
            )
          } else {
            setMessage(`${vi.ackAlwaysAlarmOk(0)} · ${zone.name}`)
          }
          releaseAlarmMapFocus(
            silenceIds.length
              ? silenceIds
              : devices
                  .filter((d) => d.zone_id === zoneId && reactionAlarmsWhenDisarmed(d.reaction))
                  .map((d) => d.global_id),
          )
        } else {
          if (action === 'disarm' && silenceIds.length) {
            await ackAlwaysAlarms(panel.panel_id, silenceIds, pin)
          }
          if (action === 'disarm') {
            releaseAlarmMapFocus([...new Set([...silenceIds, ...zoneQueued])])
          }
          onZonesChange(
            zones.map((z) => (z.zone_id === zoneId ? { ...z, armed_state: nextArmed } : z)),
          )
          onLastAction({
            at: new Date().toISOString(),
            panelId: panel.panel_id,
            target: 'section',
            zoneName: formatZoneCaption(zone) || zone.name,
            action: action === 'arm' ? 'arm' : 'disarm',
            userName: resolved.user.name,
          })
          if (!onArmedSuccess) {
            setMessage(
              `${labelOf(armedStateLabel, nextArmed)} · ${zone.name} · ${resolved.user.name}${vi.keypadStreamHint}`,
            )
          }
        }
        setPending(null)
        void onRefresh()
        if (action === 'arm' || action === 'disarm') onArmedSuccess?.(action)
      } catch (e) {
        failWith(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [
      panel,
      pending,
      pinUsers,
      zones,
      devices,
      mockMode,
      onZonesChange,
      onLastAction,
      onRefresh,
      onArmedSuccess,
    ],
  )

  return {
    busy,
    message,
    error,
    pinError,
    pending,
    sortedZones,
    requestSection,
    requestSilence,
    cancelPending,
    clearPinError,
    confirmSectionWithPin,
  }
}
