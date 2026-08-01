import type { LicenseStatus } from '../api/client'
import { vi } from '../i18n/vi'

type Props = {
  license: LicenseStatus | null
  wsConnected: boolean
  mockMode: boolean | null
}

export function TopBar({ license, wsConnected, mockMode }: Props) {
  const mode = license?.mode ?? 'read-only'
  const full = mode === 'full'

  return (
    <header className="border-b border-line/80 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.14em] text-steel/60 uppercase">
            {vi.brandSubtitle}
          </p>
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {vi.brandTitle} <span className="text-accent">{vi.brandAccent}</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusChip
            label={wsConnected ? vi.wsLive : vi.wsDown}
            tone={wsConnected ? 'ok' : 'danger'}
          />
          <StatusChip
            label={full ? vi.licenseFull : vi.licenseReadOnly}
            tone={full ? 'ok' : 'warn'}
          />
          {mockMode != null && (
            <StatusChip label={mockMode ? vi.usbMock : vi.usbHid} tone="neutral" />
          )}
        </div>
      </div>
    </header>
  )
}

function StatusChip({
  label,
  tone,
}: {
  label: string
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
}) {
  const styles = {
    ok: 'bg-ok/10 text-ok ring-ok/20',
    warn: 'bg-warn/10 text-warn ring-warn/25',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    neutral: 'bg-steel/5 text-steel/70 ring-steel/10',
  }[tone]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] font-medium ring-1 ${styles}`}
    >
      <span
        className={`size-1.5 rounded-full ${
          tone === 'ok'
            ? 'bg-ok'
            : tone === 'warn'
              ? 'bg-warn'
              : tone === 'danger'
                ? 'bg-danger'
                : 'bg-steel/40'
        }`}
      />
      {label}
    </span>
  )
}
