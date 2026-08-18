import { useEffect, useRef, useState } from 'react'
import { vi } from '../i18n/vi'
import { Btn } from './ui'

type Props = {
  open: boolean
  panelName: string
  hasStreamCode: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (pin: string) => void
  onReactivate?: () => void
  onClear?: () => void
}

export function StreamCodeModal({
  open,
  panelName,
  hasStreamCode,
  busy,
  error,
  onClose,
  onConfirm,
  onReactivate,
  onClear,
}: Props) {
  const [pin, setPin] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPin('')
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open, panelName])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stream-code-title"
        className="panel-card w-full max-w-sm p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="stream-code-title" className="text-sm font-semibold text-ink">
          {vi.streamCodeBannerTitle}
        </h3>
        <p className="mt-1 font-mono text-[11px] text-steel/65">{panelName}</p>
        <p className="mt-2 text-[11px] text-steel/55">
          {hasStreamCode ? vi.streamCodeWaiting : vi.streamCodeBannerBody}
        </p>

        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy) return
            const code = pin.trim()
            if (code) {
              onConfirm(code)
              return
            }
            if (hasStreamCode && onReactivate) onReactivate()
          }}
        >
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-steel/80">{vi.streamCodeTitle}</span>
            <input
              ref={inputRef}
              type="password"
              autoComplete="off"
              value={pin}
              disabled={busy}
              onChange={(e) => setPin(e.target.value.slice(0, 32))}
              className="w-full rounded-md border border-line/60 bg-mist px-3 py-2 font-mono text-sm tracking-wide text-ink outline-none ring-accent/30 focus:ring-1"
              placeholder={vi.streamCodePlaceholder}
            />
          </label>
          <p className="text-[10px] text-steel/50">{vi.streamCodeHint}</p>

          {error && (
            <p className="rounded-md bg-danger/10 px-2.5 py-1.5 font-mono text-[11px] text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {hasStreamCode && onClear && (
              <Btn type="button" tone="ghost" disabled={busy} onClick={onClear}>
                {vi.streamCodeClear}
              </Btn>
            )}
            <Btn type="button" tone="ghost" disabled={busy} onClick={onClose}>
              {vi.cancel}
            </Btn>
            <Btn
              type="submit"
              disabled={busy || (!pin.trim() && !hasStreamCode)}
            >
              {busy
                ? vi.keypadPinSubmitting
                : hasStreamCode
                  ? vi.streamCodeReactivate
                  : vi.streamCodeActivateBtn}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}
