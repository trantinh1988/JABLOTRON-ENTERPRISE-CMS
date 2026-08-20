import { useEffect, useRef, useState } from 'react'
import { armedStateLabel, vi } from '../i18n/vi'
import { parsePinInput, sanitizePinInput } from '../lib/pinAuth'
import { Btn } from './ui'

export type SectionPinAction = 'arm' | 'disarm' | 'silence'

type Props = {
  open: boolean
  zoneName: string
  action: SectionPinAction
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (pin: string) => void
  onClearError?: () => void
}

export function SectionPinModal({
  open,
  zoneName,
  action,
  busy,
  error,
  onClose,
  onConfirm,
  onClearError,
}: Props) {
  const [pin, setPin] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPin('')
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open, zoneName, action])

  useEffect(() => {
    if (!open || !error) return
    setPin('')
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open, error])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const actionLabel =
    action === 'arm'
      ? armedStateLabel.armed
      : action === 'silence'
        ? vi.ackAlwaysAlarm
        : armedStateLabel.disarmed

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="section-pin-title"
        className="panel-card w-full max-w-sm p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="section-pin-title" className="text-sm font-semibold text-ink">
          {vi.keypadPinModalTitle}
        </h3>
        <p className="mt-1 font-mono text-[11px] text-steel/65">
          {actionLabel} · {zoneName}
        </p>
        <p className="mt-2 text-[11px] text-steel/55">
          {action === 'silence' ? vi.keypadPinModalSilenceHint : vi.keypadPinModalHint}
        </p>

        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!pin || busy) return
            onConfirm(pin)
          }}
        >
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-steel/80">{vi.keypadPinLabel}</span>
            <input
              ref={inputRef}
              type="password"
              inputMode="text"
              autoComplete="off"
              maxLength={13}
              value={pin}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'section-pin-error' : undefined}
              onChange={(e) => {
                setPin(sanitizePinInput(e.target.value))
                if (error) onClearError?.()
              }}
              className={`w-full rounded-md border bg-mist px-3 py-2 font-mono text-sm tracking-[0.25em] text-ink outline-none focus:ring-1 ${
                error
                  ? 'border-danger/70 ring-danger/25 focus:ring-danger/40'
                  : 'border-line/60 ring-accent/30'
              }`}
              placeholder="••••"
            />
          </label>

          {error && (
            <p
              id="section-pin-error"
              role="alert"
              className="rounded-md bg-danger/10 px-2.5 py-1.5 font-mono text-[11px] text-danger"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Btn type="button" tone="ghost" disabled={busy} onClick={onClose}>
              {vi.cancel}
            </Btn>
            <Btn
              type="submit"
              tone={action === 'disarm' ? 'ok' : 'danger'}
              disabled={busy || !parsePinInput(pin)}
            >
              {busy ? vi.keypadPinSubmitting : actionLabel}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}
