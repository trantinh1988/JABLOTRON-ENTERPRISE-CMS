import { useEffect, useId, useRef, useState } from 'react'
import { Archive, Download, Upload } from 'lucide-react'
import {
  downloadSystemBackup,
  getBackupInfo,
  restoreSystemBackup,
  type BackupInfo,
} from '../api/client'
import { Btn, Card, PageHeader } from '../components/ui'
import { vi } from '../i18n/vi'

type Props = { writeAllowed?: boolean; onRefresh?: () => Promise<void> }

function formatBytes(n: number): string {
  if (n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-lg bg-mist/60 px-3 py-2 ring-1 ring-line/70">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-steel/55">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold text-ink">{value}</p>
    </div>
  )
}

export function BackupPage({ writeAllowed = true, onRefresh }: Props) {
  const fileId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getBackupInfo()
      .then((next) => {
        if (!cancelled) setInfo(next)
      })
      .catch(() => {
        if (!cancelled) setError(vi.systemLoadFail)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onExport() {
    setError(null)
    setOkMsg(null)
    setExportBusy(true)
    try {
      await downloadSystemBackup()
      setOkMsg(vi.backupExportOk)
    } catch (e) {
      setError(e instanceof Error ? e.message : vi.backupExportFail)
    } finally {
      setExportBusy(false)
    }
  }

  async function onRestore() {
    if (!file) {
      setError(vi.backupNoFile)
      return
    }
    setError(null)
    setOkMsg(null)
    setRestoreBusy(true)
    try {
      await restoreSystemBackup(file)
      setConfirmOpen(false)
      setOkMsg(vi.backupRestoreOk)
      await onRefresh?.()
      window.setTimeout(() => window.location.reload(), 400)
    } catch (e) {
      setRestoreBusy(false)
      setConfirmOpen(false)
      setError(e instanceof Error ? e.message : vi.backupRestoreFail)
    }
  }

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader title={vi.navBackup} hint={vi.backupPageHint} />

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {okMsg && <p className="mb-3 text-sm text-ok">{okMsg}</p>}

      {info && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label={vi.backupStatPanels} value={info.panels} />
          <Stat label={vi.backupStatDevices} value={info.devices} />
          <Stat label={vi.backupStatMaps} value={info.maps} />
          <Stat label={vi.backupStatMapBg} value={info.map_backgrounds} />
          <Stat label={vi.backupStatCameras} value={info.cameras} />
          <Stat label={vi.backupStatRules} value={info.automation_rules} />
          <Stat label={vi.backupStatEvents} value={info.events} />
          <Stat label={vi.backupStatSize} value={formatBytes(info.approx_bytes)} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-accent">
              <Archive className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-steel/65">
                {vi.backupExportTitle}
              </h2>
              <p className="mt-1 text-sm text-steel/75">{vi.backupExportHint}</p>
              <p className="mt-2 text-[11px] text-steel/55">{vi.backupIncludes}</p>
              <div className="mt-3">
                <Btn disabled={!writeAllowed || exportBusy || restoreBusy} onClick={() => void onExport()}>
                  <Download className="size-3.5" />
                  {exportBusy ? vi.backupExportBusy : vi.backupExport}
                </Btn>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-warn">
              <Upload className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-steel/65">
                {vi.backupRestoreTitle}
              </h2>
              <p className="mt-1 text-sm text-steel/75">{vi.backupRestoreHint}</p>
              <input
                id={fileId}
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={!writeAllowed || restoreBusy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setError(null)
                }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Btn
                  tone="ghost"
                  disabled={!writeAllowed || restoreBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {vi.backupChoose}
                </Btn>
                <Btn
                  tone="danger"
                  disabled={!writeAllowed || restoreBusy || !file}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Upload className="size-3.5" />
                  {restoreBusy ? vi.backupRestoreBusy : vi.backupRestore}
                </Btn>
              </div>
              {file && (
                <p className="mt-2 truncate text-[11px] text-steel/60" title={file.name}>
                  {file.name} · {formatBytes(file.size)}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {!writeAllowed && <p className="mt-3 text-sm text-warn">{vi.readOnlyHint}</p>}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => !restoreBusy && setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-panel p-4 shadow-xl ring-1 ring-line"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink">{vi.backupRestoreConfirmTitle}</h3>
            <p className="mt-1 text-xs text-steel/70">{vi.backupRestoreConfirm}</p>
            {file && (
              <p className="mt-2 truncate text-[11px] font-medium text-ink" title={file.name}>
                {file.name}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Btn tone="ghost" disabled={restoreBusy} onClick={() => setConfirmOpen(false)}>
                {vi.cancel}
              </Btn>
              <Btn tone="danger" disabled={restoreBusy || !file} onClick={() => void onRestore()}>
                {restoreBusy ? vi.backupRestoreBusy : vi.backupRestore}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
