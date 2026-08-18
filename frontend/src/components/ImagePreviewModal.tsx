import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Btn } from './ui'
import { vi } from '../i18n/vi'

type Props = {
  src: string
  title: string
  subtitle?: string
  createdAt?: string | null
  onClose: () => void
}

function snapFilename(title: string, src: string, createdAt?: string | null): string {
  const base =
    (title || 'anh')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'anh'
  const ext = /\.(jpe?g|png|webp|gif)(?:\?|$)/i.exec(src)?.[1]?.toLowerCase() || 'jpg'
  const safeExt = ext === 'jpeg' ? 'jpg' : ext
  let stamp = ''
  if (createdAt) {
    const d = new Date(createdAt)
    if (!Number.isNaN(d.getTime())) {
      stamp = '_' + d.toISOString().slice(0, 19).replace(/[-:T]/g, '')
    }
  }
  return `${base}${stamp}.${safeExt}`
}

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
  } catch {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}

export function ImagePreviewModal({ src, title, subtitle, createdAt, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      setZoom((z) => {
        const next = Math.min(6, Math.max(1, +(z * factor).toFixed(2)))
        if (next <= 1) setPan({ x: 0, y: 0 })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function onDownload() {
    if (busy) return
    setBusy(true)
    try {
      await downloadImage(src, snapFilename(title, src, createdAt))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-panel shadow-2xl ring-1 ring-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
            <p className="text-xs text-steel/65">
              {subtitle ? <span>{subtitle}</span> : null}
              {subtitle ? <span className="mx-1.5 text-steel/30">·</span> : null}
              <span className="text-steel/45">{vi.alarmCameraZoomHint}</span>
              {zoom > 1 ? <span className="ml-2 font-mono text-accent">{zoom.toFixed(1)}×</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Btn tone="ghost" disabled={busy} onClick={() => void onDownload()}>
              <Download className="size-3.5" />
              {busy ? vi.imageDownloadBusy : vi.imageDownload}
            </Btn>
            <Btn type="button" tone="ghost" onClick={onClose}>
              <X className="size-3.5" />
              {vi.cameraClose}
            </Btn>
          </div>
        </div>
        <div
          ref={stageRef}
          className="min-h-0 flex-1 cursor-grab overflow-hidden bg-[#0b1017] active:cursor-grabbing"
          onDoubleClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          onPointerDown={(e) => {
            if (zoom <= 1) return
            dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (!drag) return
            setPan({
              x: drag.panX + (e.clientX - drag.x),
              y: drag.panY + (e.clientY - drag.y),
            })
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            className="mx-auto max-h-[min(80vh,820px)] w-full select-none object-contain"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      </div>
    </div>
  )
}
