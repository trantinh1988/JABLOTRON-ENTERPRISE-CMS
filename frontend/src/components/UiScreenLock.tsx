import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { vi } from '../i18n/vi'
import { useOperatorSession } from '../hooks/useOperatorSession'
import { parsePinInput, sanitizePinInput } from '../lib/pinAuth'
import { BrandMark } from './BrandMark'
import { Btn } from './ui'

export function UiScreenLock({ children }: { children: React.ReactNode }) {
  const { locked, unlock } = useOperatorSession()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!locked) {
      setPin('')
      setError(null)
      return
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 40)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const block = (event: Event) => {
      const card = cardRef.current
      if (card && event.target instanceof Node && card.contains(event.target)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const types: Array<keyof DocumentEventMap> = [
      'pointerdown',
      'pointerup',
      'mousedown',
      'mouseup',
      'click',
      'touchstart',
      'touchend',
      'wheel',
      'keydown',
    ]
    for (const type of types) {
      document.addEventListener(type, block, true)
    }
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prevOverflow
      for (const type of types) {
        document.removeEventListener(type, block, true)
      }
    }
  }, [locked])

  const overlay =
    locked &&
    createPortal(
      <div
        className="fixed inset-0 z-[10000] flex items-center justify-center bg-mist/95 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cms-lock-title"
      >
        <div ref={cardRef} className="panel-card w-full max-w-sm p-5 shadow-[0_20px_50px_rgba(0,0,0,0.18)]">
          <BrandMark
            className="min-w-0"
            titleClass="mt-1 truncate text-lg font-semibold tracking-tight text-ink"
          />
          <h2 id="cms-lock-title" className="mt-4 text-sm font-semibold text-ink">
            {vi.lockTitle}
          </h2>
          <p className="mt-1 text-[11px] text-steel/60">{vi.lockHint}</p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              const result = unlock(pin)
              if ('error' in result) {
                setError(result.error)
                setPin('')
                inputRef.current?.focus()
              }
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
                aria-invalid={Boolean(error)}
                onChange={(e) => {
                  setPin(sanitizePinInput(e.target.value))
                  if (error) setError(null)
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
              <p role="alert" className="rounded-md bg-danger/10 px-2.5 py-1.5 font-mono text-[11px] text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end pt-1">
              <Btn type="submit" disabled={!parsePinInput(pin)}>
                {vi.lockSubmit}
              </Btn>
            </div>
          </form>
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      {children}
      {overlay}
    </>
  )
}
