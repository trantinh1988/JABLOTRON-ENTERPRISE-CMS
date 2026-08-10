import { useEffect, useRef, useState } from 'react'
import type { CmsEvent } from '../api/client'

const MAX_EVENTS = 120
const PING_MS = 20000

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/events`
}

export function useEventStream(enabled = true) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<CmsEvent[]>([])
  const [lastEvent, setLastEvent] = useState<CmsEvent | null>(null)
  const [eventSeq, setEventSeq] = useState(0)
  const retryRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)

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
      }

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as CmsEvent
          if (data.type === 'connected') return
          setLastEvent(data)
          setEventSeq((n) => n + 1)
          setEvents((prev) => [data, ...prev].slice(0, MAX_EVENTS))
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
