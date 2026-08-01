import type { ReactNode } from 'react'

export function PageHeader({
  title,
  hint,
  actions,
}: {
  title: string
  hint?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-steel/70">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`panel-card p-4 ${className}`}>{children}</section>
}

export function Btn({
  children,
  onClick,
  disabled,
  tone = 'accent',
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'accent' | 'danger' | 'ghost' | 'ok' | 'warn'
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles = {
    accent: 'bg-accent text-panel hover:brightness-110',
    danger: 'bg-danger text-white hover:brightness-110',
    ok: 'bg-ok text-panel hover:brightness-110',
    warn: 'bg-warn text-panel hover:brightness-110',
    ghost: 'bg-mist text-ink ring-1 ring-line hover:bg-line/40',
  }[tone]

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-steel/80">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-md border border-line bg-fog px-3 py-2 text-sm text-ink outline-none focus:border-accent/60'

export function StateDot({ state }: { state: string }) {
  const color =
    state === 'alarm' ? 'bg-danger' : state === 'open' ? 'bg-warn' : 'bg-ok'
  return <span className={`inline-block size-2 rounded-full ${color}`} />
}
