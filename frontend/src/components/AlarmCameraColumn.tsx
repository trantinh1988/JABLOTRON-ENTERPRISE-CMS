import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import {
  listAutomationRules,
  listAutomationSnaps,
  listCameras,
  type Camera as CameraRow,
  type Device,
} from '../api/client'
import {
  ingestAutomationSnapRows,
  parseSnapAt,
  snapsForAlarmFocus,
  subscribeAlarmCameraSnaps,
  type AlarmCameraSnap,
} from '../hooks/alarmCameraSnapBus'
import { formatMapDeviceCaption } from '../lib/deviceIconLibrary'
import { ImagePreviewModal } from './ImagePreviewModal'
import { vi } from '../i18n/vi'

type Props = {
  deviceId: string | null
  mapId: number | null
  queueDeviceIds: string[]
  devices: Device[]
}

function formatTs(iso: string | null | undefined, at?: number): string {
  const n = at && Number.isFinite(at) ? at : parseSnapAt(iso)
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN')
}

function cacheBust(url: string, at: number): string {
  if (!url) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}t=${at}`
}

export function AlarmCameraColumn({ deviceId, mapId, queueDeviceIds, devices }: Props) {
  const [snaps, setSnaps] = useState<AlarmCameraSnap[]>([])
  const [cameras, setCameras] = useState<CameraRow[]>([])
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<AlarmCameraSnap | null>(null)
  const metaReadyRef = useRef(false)

  useEffect(() => subscribeAlarmCameraSnaps(setSnaps), [])

  useEffect(() => {
    let cancelled = false

    async function loadMeta() {
      if (!metaReadyRef.current) setLoading(true)
      try {
        const [camRows, rules] = await Promise.all([
          listCameras(),
          listAutomationRules().catch(() => []),
        ])
        if (cancelled) return
        setCameras(camRows)
        const deviceIf = new Set([
          'armed_alarm',
          'device_alarm',
          'device_open',
          'tamper',
          'loss',
          'device_fault',
        ])
        const pending = rules
          .filter((r) => r.enabled && r.then_type === 'camera_snapshot' && r.then_camera_id)
          .filter((r) => deviceIf.has(String(r.if_type)))
          .filter((r) => {
            if (r.if_device_id && deviceId && r.if_device_id !== deviceId) return false
            if (r.if_floor_id != null && mapId != null && r.if_floor_id !== mapId) return false
            return true
          })
          .map((r) => r.then_camera_id as string)
        setPendingIds([...new Set(pending)])
      } catch {
        /* cột camera không chặn focus map */
      } finally {
        if (!cancelled) {
          metaReadyRef.current = true
          setLoading(false)
        }
      }
    }

    void loadMeta()
    return () => {
      cancelled = true
    }
  }, [deviceId, mapId])

  useEffect(() => {
    let cancelled = false

    async function pullSnaps() {
      try {
        const snapRows = await listAutomationSnaps(12)
        if (!cancelled) ingestAutomationSnapRows(snapRows)
      } catch {
        /* WS automation_fired vẫn đẩy ảnh */
      }
    }

    void pullSnaps()
    const timers = [1000, 2500, 5000].map((ms) => window.setTimeout(() => void pullSnaps(), ms))
    return () => {
      cancelled = true
      for (const t of timers) window.clearTimeout(t)
    }
  }, [deviceId])

  const queueSet = useMemo(() => new Set(queueDeviceIds), [queueDeviceIds])
  const pendingSet = useMemo(() => new Set(pendingIds), [pendingIds])
  const focused = useMemo(
    () => snapsForAlarmFocus(snaps, deviceId, queueSet, pendingSet),
    [snaps, deviceId, queueSet, pendingSet],
  )

  const cards = useMemo(() => {
    const out: Array<{ camera: CameraRow | null; snap: AlarmCameraSnap | null }> = focused.map(
      (snap) => ({
        camera: cameras.find((c) => c.id === snap.cameraId) ?? null,
        snap,
      }),
    )
    if (out.length) return out
    return pendingIds.slice(0, 3).map((id) => ({
      camera: cameras.find((c) => c.id === id) ?? null,
      snap: null,
    }))
  }, [focused, cameras, pendingIds])

  const waiting = !loading && cards.length === 0

  return (
    <>
      <aside className="flex h-full min-h-[200px] w-full shrink-0 flex-col overflow-hidden rounded-xl bg-panel ring-1 ring-danger/25">
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/20 px-3 py-2">
          <Camera className="size-3.5 text-danger" />
          <h3 className="text-[11px] font-semibold tracking-wide text-danger uppercase">
            {vi.alarmCameraColumn}
          </h3>
          <span className="ml-auto font-mono text-[10px] text-steel/50">{cards.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
          {loading && cards.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-6 text-[11px] text-steel/60">
              <Loader2 className="size-3.5 animate-spin" />
              {vi.alarmCameraWaiting}
            </div>
          )}
          {waiting && (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <Camera className="size-6 text-steel/35" />
              <p className="text-[11px] text-steel/55">{vi.alarmCameraWaiting}</p>
            </div>
          )}
          {cards.map(({ camera, snap }, idx) => {
            const name = snap?.cameraName || camera?.name || vi.alarmCameraUntitled
            const src = snap?.imageUrl ? cacheBust(snap.imageUrl, snap.at) : ''
            const device = snap?.deviceId
              ? devices.find((d) => d.global_id === snap.deviceId)
              : null
            const caption = device ? formatMapDeviceCaption(device) : snap?.deviceId || ''
            const failed = snap != null && !snap.ok && !snap.imageUrl
            return (
              <button
                key={snap?.id || camera?.id || `cam-${idx}`}
                type="button"
                disabled={!src}
                title={vi.alarmCameraOpen}
                onClick={() => {
                  if (snap?.imageUrl) setPreview(snap)
                }}
                className="block w-full overflow-hidden rounded-lg bg-mist/80 text-left ring-1 ring-line/70 transition hover:ring-danger/50 disabled:cursor-default disabled:hover:ring-line/70"
              >
                <div className="relative aspect-video bg-[#0b1017]">
                  {src ? (
                    <img src={src} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1.5 text-steel/45">
                      <Loader2 className="size-4 animate-spin" />
                      <span className="text-[10px]">{vi.alarmCameraWaiting}</span>
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-[11px] font-semibold text-ink">{name}</p>
                  {caption ? (
                    <p className="truncate text-[10px] text-steel/55">{caption}</p>
                  ) : null}
                  <p className="truncate text-[10px] text-steel/45">
                    {failed ? snap?.detail || vi.alarmCameraFailed : formatTs(snap?.createdAt, snap?.at)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {preview ? (
        <ImagePreviewModal
          src={cacheBust(preview.imageUrl, preview.at)}
          title={preview.cameraName || vi.alarmCameraUntitled}
          subtitle={formatTs(preview.createdAt, preview.at)}
          createdAt={preview.createdAt}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  )
}
