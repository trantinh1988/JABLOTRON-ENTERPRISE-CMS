import type { Device, Zone } from '../api/client'
import { formatZoneCaption } from './EventFeed'
import { vi } from '../i18n/vi'
import { reactionAlarmsWhenDisarmed, sectionLifeAlarmBadge } from '../lib/deviceReaction'

type Props = {
  zones: Zone[]
  devices: Device[]
  selectedZoneId: string | null
  busy: boolean
  writeAllowed: boolean
  onSelect: (zoneId: string | null) => void
  onArm: (zone: Zone) => void
  onDisarm: (zone: Zone) => void
  /** Tắt báo động 24h/Fire — mở modal PIN như bàn phím tủ. */
  onSilence?: (zone: Zone) => void
  /** Ẩn khung/tiêu đề khi nằm trong modal. */
  embedded?: boolean
}

export function SectionGrid({
  zones,
  devices,
  selectedZoneId,
  busy,
  writeAllowed,
  onSelect,
  onArm,
  onDisarm,
  onSilence,
  embedded = false,
}: Props) {
  const armedCount = zones.filter(
    (z) => z.armed_state === 'armed' || z.armed_state === 'partial',
  ).length
  const alarmCount = devices.filter((d) => (d.state || '').toLowerCase() === 'alarm').length

  return (
    <section
      className={
        embedded
          ? 'flex h-full min-h-0 w-full flex-col overflow-hidden'
          : 'panel-card flex h-full min-h-0 w-full flex-col overflow-hidden p-3'
      }
    >
      {!embedded && (
        <div className="mb-2 flex shrink-0 flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-wide text-ink">{vi.keypadSectionsTitle}</h2>
            <p className="mt-0.5 font-mono text-[10px] text-steel/55">
              {vi.keypadSectionsMeta(zones.length, 15, armedCount)}
              {alarmCount > 0 ? ` · ${alarmCount} ${vi.legendAlarm.toLowerCase()}` : ''}
            </p>
          </div>
          {selectedZoneId && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="rounded px-2 py-1 font-mono text-[10px] text-accent ring-1 ring-accent/30 hover:bg-accent/10"
            >
              {vi.keypadClearFilter}
            </button>
          )}
        </div>
      )}

      {zones.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line/60 px-3 py-6 text-center text-xs text-steel/50">
          {vi.keypadNoSections}
        </p>
      ) : (
        <div className="section-panel min-h-0 flex-1 overflow-hidden">
          <div className="section-panel-list overscroll-contain">
            {zones.map((zone) => {
              const armed = zone.armed_state === 'armed' || zone.armed_state === 'partial'
              const selected = selectedZoneId === zone.zone_id
              const zoneDevices = devices.filter((d) => d.zone_id === zone.zone_id)
              const keypadAlarm = Boolean(zone.keypad_alarm)
              const hasAlwaysAlarm = zoneDevices.some(
                (d) =>
                  (d.state || '').toLowerCase() === 'alarm' &&
                  reactionAlarmsWhenDisarmed(d.reaction),
              )
              // HID 0x51 (bàn phím) + sticky 24h/Fire CMS — phân khu tắt vẫn nhấp đỏ.
              const showAlarmLed = keypadAlarm || hasAlwaysAlarm
              const lifeBadge = sectionLifeAlarmBadge(zoneDevices)
              const buttonsDisabled = busy || !writeAllowed
              const caption = formatZoneCaption(zone) || zone.name || zone.zone_id
              const greenOn = !armed && !keypadAlarm
              const silenceThis = Boolean(onSilence && hasAlwaysAlarm)

              return (
                <div
                  key={zone.zone_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(selected ? null : zone.zone_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(selected ? null : zone.zone_id)
                    }
                  }}
                  className={`section-panel-row ${selected ? 'section-panel-row--selected' : ''} ${
                    showAlarmLed ? 'section-panel-row--alarm' : ''
                  }`}
                >
                  <button
                    type="button"
                    disabled={buttonsDisabled}
                    title={silenceThis && !armed ? vi.ackAlwaysAlarm : vi.keypadDisarmSection}
                    aria-label={`${silenceThis && !armed ? vi.ackAlwaysAlarm : vi.keypadDisarmSection}: ${caption}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (silenceThis && !armed && onSilence) onSilence(zone)
                      else onDisarm(zone)
                    }}
                    className={`section-led ${greenOn ? 'section-led--green' : 'section-led--off'}`}
                  />

                  <div className="section-panel-label">
                    <span className="truncate">{caption}</span>
                    {lifeBadge ? <span className="section-panel-rx">{lifeBadge}</span> : null}
                  </div>

                  <button
                    type="button"
                    disabled={buttonsDisabled}
                    title={vi.keypadArmSection}
                    aria-label={`${vi.keypadArmSection}: ${caption}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onArm(zone)
                    }}
                    className={`section-led ${
                      showAlarmLed
                        ? 'section-led--red section-led--alarm'
                        : armed
                          ? 'section-led--red'
                          : 'section-led--off'
                    }`}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
