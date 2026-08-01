import type { CmsEvent } from '../api/client'
import { armedStateLabel, deviceStateLabel, eventTypeLabel, formatCommandError, labelOf, vi } from '../i18n/vi'

type Props = {
  events: CmsEvent[]
}

export function EventFeed({ events }: Props) {
  return (
    <section className="panel-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{vi.eventsTitle}</h2>
      <ul className="max-h-64 space-y-1.5 overflow-auto font-mono text-[11px]">
        {events.length === 0 && <li className="text-steel/45">{vi.eventsWaiting}</li>}
        {events.map((e, i) => (
          <li
            key={`${e.ts ?? 't'}-${e.type}-${i}`}
            className="rounded-md border border-line/50 bg-fog/70 px-2.5 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={typeColor(e.type)}>{labelOf(eventTypeLabel, e.type)}</span>
              <span className="text-steel/45">
                {e.ts?.replace('T', ' ').replace('Z', '') ?? ''}
              </span>
            </div>
            <p className="truncate text-steel/70">{formatEventDetail(e)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function formatEventDetail(e: CmsEvent): string {
  const parts: string[] = []
  if (e.panel_id) parts.push(String(e.panel_id))
  if (e.device_id) parts.push(String(e.device_id))
  if (e.state) parts.push(labelOf(deviceStateLabel, String(e.state)))
  if (e.armed_state) parts.push(labelOf(armedStateLabel, String(e.armed_state)))
  if (e.detail) {
    const detail =
      e.type === 'command_error' ? formatCommandError(String(e.detail)) : String(e.detail)
    parts.push(detail)
  }
  return parts.join(' · ')
}

function typeColor(type: string) {
  if (type.includes('alarm') || type === 'command_error') return 'text-danger'
  if (type === 'device_state') return 'text-accent'
  if (type === 'panel_armed') return 'text-warn'
  return 'text-ink'
}
