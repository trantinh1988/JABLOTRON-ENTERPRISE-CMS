import type { CmsEvent, Device, Zone } from '../api/client'
import {
  armedStateLabel,
  deviceDisableLabel,
  deviceStateLabel,
  eventTypeLabel,
  formatCommandError,
  labelOf,
  vi,
} from '../i18n/vi'

type Props = {
  events: CmsEvent[]
  devices?: Device[]
  zones?: Zone[]
  compact?: boolean
  /** Stretch list to fill parent height (dashboard middle column). */
  fill?: boolean
  /** Visible rows before inner scroll (dashboard standard). */
  visibleRows?: number
}

const TZ = 'Asia/Ho_Chi_Minh'
const EVENT_ROW_REM = 2.75
const EVENT_GAP_REM = 0.375

export function EventFeed({
  events,
  devices = [],
  zones = [],
  compact = false,
  fill = false,
  visibleRows,
}: Props) {
  const deviceMap = new Map(devices.map((d) => [d.global_id, d]))
  const zoneMap = new Map(zones.map((z) => [z.zone_id, z]))
  const rows = visibleRows && visibleRows > 0 ? visibleRows : null

  return (
    <section className={`panel-card flex min-h-0 flex-col p-4 ${fill ? 'h-full' : ''}`}>
      <h2 className="mb-3 shrink-0 text-sm font-semibold text-ink">{vi.eventsTitle}</h2>
      <ul
        className={`min-h-0 space-y-1.5 overflow-y-auto overscroll-contain font-mono text-[11px] ${
          fill
            ? 'flex-1'
            : rows != null
              ? ''
              : compact
                ? 'max-h-48'
                : 'max-h-64'
        }`}
        style={
          !fill && rows != null
            ? {
                maxHeight: `calc(${rows} * ${EVENT_ROW_REM}rem + ${Math.max(rows - 1, 0)} * ${EVENT_GAP_REM}rem)`,
              }
            : undefined
        }
      >
        {events.length === 0 && <li className="text-steel/45">{vi.eventsWaiting}</li>}
        {events.map((e, i) => {
          const deviceEvent = isDeviceRealtimeEvent(e)
          return (
            <li
              key={`${e.ts ?? 't'}-${e.type}-${e.device_id ?? ''}-${i}`}
              className="event-feed-row rounded-md border border-line/50 bg-fog/70 px-2.5 py-1.5"
            >
              {deviceEvent ? (
                <DeviceEventBody
                  event={e}
                  deviceMap={deviceMap}
                  zoneMap={zoneMap}
                  time={formatEventTime(e.ts, compact || Boolean(rows))}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={typeColor(e.type)}>{labelOf(eventTypeLabel, e.type)}</span>
                    <span className="shrink-0 text-steel/45" title="GMT+07 · Hồ Chí Minh">
                      {formatEventTime(e.ts, compact || Boolean(rows))}
                    </span>
                  </div>
                  <p className="truncate text-steel/70">{formatGenericDetail(e, zoneMap)}</p>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DeviceEventBody({
  event,
  deviceMap,
  zoneMap,
  time,
}: {
  event: CmsEvent
  deviceMap: Map<string, Device>
  zoneMap: Map<string, Zone>
  time: string
}) {
  const device = event.device_id ? deviceMap.get(String(event.device_id)) : undefined
  const status = deviceStatusText(event)
  const idLabel = deviceIdLabel(event, device)
  const name = (device?.label || '').trim()
  const section = sectionLabel(device, zoneMap)

  return (
    <div className="space-y-0.5">
      {/* Dòng 1: thông tin trạng thái (ACT / OK / TMP / Loss…) + giờ GMT+07 */}
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold ${stateColor(statusKey(event))}`}>{status}</span>
        <span className="shrink-0 text-steel/45" title="GMT+07 · Hồ Chí Minh">
          {time}
        </span>
      </div>
      {/* Dòng 2: ID + Device | Section */}
      <p className="truncate text-steel/70">
        {idLabel}
        {name ? ` ${name}` : ''}
        {' | '}
        {section}
      </p>
    </div>
  )
}

function isDeviceRealtimeEvent(e: CmsEvent): boolean {
  return (
    e.type === 'device_state' ||
    e.type === 'device_alarm_trigger' ||
    e.type === 'device_disable'
  )
}

function statusKey(e: CmsEvent): string {
  if (e.type === 'device_alarm_trigger') return 'alarm'
  if (e.state) return String(e.state).toLowerCase()
  return 'ok'
}

function deviceStatusText(e: CmsEvent): string {
  if (e.type === 'device_disable' && e.disable) {
    const st = labelOf(deviceStateLabel, statusKey(e))
    const bypass = labelOf(deviceDisableLabel, String(e.disable))
    return `${st} · ${bypass}`
  }
  return labelOf(deviceStateLabel, statusKey(e))
}

function deviceIdLabel(e: CmsEvent, device?: Device): string {
  if (device?.device_num != null && device.device_num >= 0) return String(device.device_num)
  const fromGlobal = shortDeviceToken(e.device_id)
  return fromGlobal || '—'
}

function shortDeviceToken(deviceId: string | undefined): string {
  if (!deviceId) return ''
  const m = /(?:^|_)DEV_(\d+)$/i.exec(String(deviceId))
  if (m) return String(Number(m[1]))
  return String(deviceId)
}

/** Caption phân khu: `1. BÁO ĐỘNG` (không hiện zone_id nội bộ). */
export function formatZoneCaption(zone: Zone): string {
  const sec = zone.section_num
  const name = (zone.name || '').trim()
  if (sec != null && sec >= 1) {
    if (!name || /^section\s*\d+$/i.test(name)) return String(sec)
    if (/^\d+\s*[.:]/.test(name)) return name
    return `${sec}. ${name}`
  }
  return name || ''
}

export function zoneCaptionFromEvent(
  e: CmsEvent,
  zoneMap: Map<string, Zone>,
): string {
  let zone: Zone | undefined
  if (e.zone_id) zone = zoneMap.get(String(e.zone_id))
  if (!zone && e.section_num != null) {
    const sec = Number(e.section_num)
    for (const z of zoneMap.values()) {
      if (Number(z.section_num) === sec) {
        zone = z
        break
      }
    }
  }
  if (zone) {
    const caption = formatZoneCaption(zone)
    if (caption) return caption
  }
  if (e.section_num != null) return String(e.section_num)
  return ''
}

function sectionLabel(device: Device | undefined, zoneMap: Map<string, Zone>): string {
  if (!device?.zone_id) return vi.eventsNoSection
  const zone = zoneMap.get(device.zone_id)
  if (!zone) return vi.eventsNoSection
  return formatZoneCaption(zone) || vi.eventsNoSection
}

function formatGenericDetail(e: CmsEvent, zoneMap: Map<string, Zone>): string {
  if (e.type === 'zone_armed' || e.type === 'panel_armed') {
    const action = e.armed_state
      ? labelOf(armedStateLabel, String(e.armed_state))
      : ''
    if (e.type === 'panel_armed') {
      return action || '—'
    }
    const zoneCaption = zoneCaptionFromEvent(e, zoneMap)
    if (action && zoneCaption) return `${action} | ${zoneCaption}`
    return action || zoneCaption || '—'
  }

  const parts: string[] = []
  if (e.armed_state) parts.push(labelOf(armedStateLabel, String(e.armed_state)))
  if (e.state && !e.armed_state) parts.push(labelOf(deviceStateLabel, String(e.state)))
  if (e.detail) {
    const detail =
      e.type === 'command_error' ? formatCommandError(String(e.detail)) : localizeDetail(String(e.detail))
    // Bỏ detail kỹ thuật kiểu device_stream_activated — đã có tiêu đề loại sự kiện.
    if (detail && !/^[a-z][a-z0-9_]*$/i.test(detail)) {
      parts.push(detail)
    } else if (detail && e.type === 'command_error') {
      parts.push(detail)
    } else if (detail && !parts.length) {
      parts.push(detail)
    }
  }
  const zoneCaption = zoneCaptionFromEvent(e, zoneMap)
  if (zoneCaption && e.type !== 'panel_connected' && e.type !== 'panel_disconnected') {
    parts.push(zoneCaption)
  }
  if (e.pg_id) parts.push(`PG ${String(e.pg_id)}`)
  return parts.join(' | ') || '—'
}

function localizeDetail(detail: string): string {
  if (detail.startsWith('mock')) return vi.eventsDetailMock
  if (detail.startsWith('usb')) return vi.eventsDetailUsb
  return detail
}

/** Giờ theo GMT+07 (Asia/Ho_Chi_Minh). */
export function formatEventTime(ts?: string, compact = false): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) {
    return ts.replace('T', ' ').replace(/Z$/, '')
  }
  if (compact) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d)
  }
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

function typeColor(type: string) {
  if (type.includes('alarm') || type === 'command_error' || type === 'map_trail_snap') return 'text-danger'
  if (type === 'device_state' || type === 'device_disable') return 'text-accent'
  if (type === 'panel_armed' || type === 'zone_armed') return 'text-warn'
  return 'text-ink'
}

function stateColor(state: string) {
  const st = state.toLowerCase()
  if (st === 'alarm') return 'text-danger'
  if (st === 'open' || st === 'tamper' || st === 'fault' || st === 'loss') return 'text-warn'
  if (st === 'ok') return 'text-ok'
  return 'text-ink'
}
