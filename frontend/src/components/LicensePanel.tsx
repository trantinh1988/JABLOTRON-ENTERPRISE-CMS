import { useRef, useState } from 'react'
import { Download, KeyRound, Upload } from 'lucide-react'
import {
  exportLicenseRequest,
  importLicense,
  type LicenseStatus,
} from '../api/client'
import { labelOf, licenseModeLabel, licenseStatusLabel, vi } from '../i18n/vi'

type Props = {
  license: LicenseStatus | null
  onChanged: () => Promise<void>
}

export function LicensePanel({ license, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const full = license?.mode === 'full'

  async function handleExport() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await exportLicenseRequest()
      setMessage(vi.exportOk)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(file: File) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await importLicense(file)
      setMessage(vi.licenseActiveUntil(result.license.expires_at ?? '—'))
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await onChanged()
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className="panel-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="size-4 text-accent" />
        <h2 className="text-sm font-semibold tracking-wide text-ink">{vi.licenseTitle}</h2>
      </div>

      <dl className="mb-4 grid gap-2 font-mono text-[12px]">
        <Row
          label={vi.status}
          value={labelOf(licenseStatusLabel, license?.status)}
          accent={full ? 'ok' : 'warn'}
        />
        <Row label={vi.mode} value={labelOf(licenseModeLabel, license?.mode)} />
        <Row label={vi.hwid} value={license?.hwid ? `${license.hwid.slice(0, 16)}…` : '…'} />
        <Row label={vi.expires} value={license?.expires_at ?? '—'} />
      </dl>

      {license?.reason && license.mode !== 'full' && (
        <p className="mb-3 text-xs text-warn">{license.reason}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-panel transition hover:brightness-110 disabled:opacity-50"
        >
          <Download className="size-3.5" />
          {vi.exportReq}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-fog px-3 py-2 text-xs font-medium text-ink transition hover:bg-mist disabled:opacity-50"
        >
          <Upload className="size-3.5" />
          {vi.importLic}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".lic,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
          }}
        />
      </div>

      {message && <p className="mt-3 text-xs text-ok">{message}</p>}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </section>
  )
}

function Row({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'ok' | 'warn'
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
      <dt className="text-steel/55">{label}</dt>
      <dd
        className={`max-w-[65%] truncate text-right ${
          accent === 'ok' ? 'text-ok' : accent === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
