import { useEffect, useRef, useState } from 'react'
import { vi } from '../i18n/vi'
import { useOperatorSession } from '../hooks/useOperatorSession'
import { BrandMark } from './BrandMark'
import { Btn } from './ui'

export function UiLoginScreen() {
  const { login, enterSetup, canSetup, loading, loadError } = useOperatorSession()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-mist px-4">
      <div className="panel-card w-full max-w-sm p-5 shadow-[0_20px_50px_rgba(0,0,0,0.18)]">
        <BrandMark
          className="min-w-0"
          titleClass="mt-1 truncate text-lg font-semibold tracking-tight text-ink"
        />
        <h2 className="mt-4 text-sm font-semibold text-ink">{vi.loginTitle}</h2>
        <p className="mt-1 text-[11px] text-steel/60">{vi.loginHint}</p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            const result = login(pin)
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
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              maxLength={10}
              value={pin}
              disabled={loading}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 10))
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

          {loading && <p className="text-[11px] text-steel/55">{vi.loginLoading}</p>}
          {(loadError || error) && (
            <p role="alert" className="rounded-md bg-danger/10 px-2.5 py-1.5 font-mono text-[11px] text-danger">
              {loadError || error}
            </p>
          )}
          {canSetup && (
            <p className="rounded-md bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">
              {vi.loginNoPinUsers}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {canSetup && (
              <Btn
                type="button"
                tone="ghost"
                disabled={loading}
                onClick={() => {
                  const result = enterSetup()
                  if ('error' in result) setError(vi.loginNoPinUsers)
                }}
              >
                {vi.loginEnterSetup}
              </Btn>
            )}
            <Btn type="submit" disabled={loading || pin.length < 4}>
              {vi.loginSubmit}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

export function UiLoginGate({ children }: { children: React.ReactNode }) {
  const { session, ready } = useOperatorSession()
  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mist text-[13px] text-steel/60">
        {vi.loginLoading}
      </div>
    )
  }
  if (!session) return <UiLoginScreen />
  return <>{children}</>
}
