import { useEffect, useRef, useState } from 'react'
import { listEventHistory, type CmsEvent } from '../api/client'
import { ingestAutomationFiredEvent } from './alarmCameraSnapBus'
import { watchAlarmFocusFromEvent } from './deviceAlarmFocusWatch'

const MAX_EVENTS = 120
const MAX_LOG = 400
const PING_MS = 20000
const HISTORY_SEED = 80

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/events`
}

type Logged = { seq: number; event: CmsEvent }

/**
 * Ring log shared by all consumers (useCmsData, PanelSetup, Dashboard…).
 * Each consumer tracks its own cursor via takeEventsSince — no exclusive drain race.
 */
const eventLog: Logged[] = []
let nextSeq = 0

function pushEvent(event: CmsEvent): number {
  nextSeq += 1
  eventLog.push({ seq: nextSeq, event })
  if (eventLog.length > MAX_LOG) {
    eventLog.splice(0, eventLog.length - MAX_LOG)
  }
  return nextSeq
}

function eventDedupeKey(e: CmsEvent): string {
  // Content key so SQLite history (has id) matches live WS (no id).
  return `${e.ts ?? ''}|${e.type}|${e.panel_id ?? ''}|${e.device_id ?? ''}|${e.state ?? ''}|${e.armed_state ?? ''}|${String(e.detail ?? '')}`
}

/** Flatten payload fields so history rows match live WS shape. */
function normalizeHistoryEvent(row: CmsEvent): CmsEvent {
  const p =
    row.payload && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : {}
  return {
    ...p,
    ...row,
    type: row.type,
    id: row.id,
    panel_id: row.panel_id ?? (p.panel_id as string | undefined),
    device_id: row.device_id ?? (p.device_id as string | undefined),
    state: row.state ?? (p.state as string | undefined),
    disable: row.disable ?? (p.disable as string | undefined),
    armed_state: row.armed_state ?? (p.armed_state as string | undefined),
    detail: row.detail ?? (p.detail as string | undefined),
    ts: row.ts ?? (p.ts as string | undefined),
  }
}

function isFeedHiddenType(type: string): boolean {
  return (
    type === 'devices_state_batch' ||
    type === 'devices_disable_batch' ||
    type === 'devices_state_snapshot' ||
    type === 'panel_live' ||
    type === 'connected'
  )
}

function mergeEventsNewestFirst(live: CmsEvent[], seeded: CmsEvent[]): CmsEvent[] {
  const out: CmsEvent[] = []
  const seen = new Set<string>()
  for (const e of [...live, ...seeded]) {
    if (isFeedHiddenType(e.type)) continue
    const key = eventDedupeKey(e)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
    if (out.length >= MAX_EVENTS) break
  }
  return out
}

export function latestEventSeq(): number {
  return nextSeq
}

/** Events with seq > afterSeq, in order. */
export function takeEventsSince(afterSeq: number): { events: CmsEvent[]; upTo: number } {
  if (!eventLog.length || afterSeq >= nextSeq) {
    return { events: [], upTo: afterSeq }
  }
  const events: CmsEvent[] = []
  let upTo = afterSeq
  for (const row of eventLog) {
    if (row.seq <= afterSeq) continue
    events.push(row.event)
    upTo = row.seq
  }
  return { events, upTo }
}

type Options = {
  /** Called on every successful WS open (including reconnect). */
  onOpen?: () => void
}

export function useEventStream(enabled = true, options?: Options) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<CmsEvent[]>([])
  const [lastEvent, setLastEvent] = useState<CmsEvent | null>(null)
  const [eventSeq, setEventSeq] = useState(0)
  const retryRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const onOpenRef = useRef(options?.onOpen)
  onOpenRef.current = options?.onOpen
  const everConnectedRef = useRef(false)

  // Seed feed from SQLite history so refresh keeps Sự kiện / Người dùng bật-tắt.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void listEventHistory({ limit: HISTORY_SEED })
      .then((rows) => {
        if (cancelled || !rows.length) return
        const seeded = rows.map(normalizeHistoryEvent)
        setEvents((prev) => mergeEventsNewestFirst(prev, seeded))
      })
      .catch(() => {
        // History optional — live WS still works.
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    let closed = false
    let timer: number | undefined
    let pingTimer: number | undefined

    const clearPing = () => {
      if (pingTimer) {
        window.clearInterval(pingTimer)
        pingTimer = undefined
      }
    }

    const connect = () => {
      clearPing()
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        retryRef.current = 0
        setConnected(true)
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send('ping')
            } catch {
              // ignore
            }
          }
        }, PING_MS)
        const isReconnect = everConnectedRef.current
        everConnectedRef.current = true
        // Catch-up after drop: full REST + upcoming 2s snapshot.
        if (isReconnect) {
          onOpenRef.current?.()
        }
      }

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as CmsEvent
          if (data.type === 'connected') return
          // Mirror alarm status early; map focus runs after UI apply in useCmsData.
          watchAlarmFocusFromEvent(data)
          ingestAutomationFiredEvent(data)
          const seq = pushEvent(data)
          setLastEvent(data)
          setEventSeq(seq)
          if (!isFeedHiddenType(data.type)) {
            setEvents((prev) => mergeEventsNewestFirst([data], prev))
          }
        } catch {
          // ignore malformed
        }
      }

      ws.onclose = () => {
        clearPing()
        setConnected(false)
        if (closed) return
        const delay = Math.min(8000, 500 + retryRef.current * 700)
        retryRef.current += 1
        timer = window.setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      closed = true
      clearPing()
      if (timer) window.clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [enabled])

  return { connected, events, lastEvent, eventSeq }
}
