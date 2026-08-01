import { useMemo, useState, type ReactNode } from 'react'
import { Lock, LockOpen, Shield } from 'lucide-react'
import { groupAction, type GroupAction, type Panel } from '../api/client'
import { actionLabel, armedStateLabel, connectionLabel, labelOf, vi } from '../i18n/vi'

type Props = {
  panels: Panel[]
  writeAllowed: boolean
  selected: Set<string>
  onToggle: (panelId: string) => void
  onSelectAll: () => void
  onRefresh: () => Promise<void>
}

export function PanelControls({
  panels,
  writeAllowed,
  selected,
  onToggle,
  onSelectAll,
  onRefresh,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const selectedIds = useMemo(() => [...selected], [selected])

  async function run(action: GroupAction) {
    if (!selectedIds.length) {
      setError(vi.pickPanel)
      return
    }
    setBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      const result = await groupAction(selectedIds, action)
      const failed = result.results.filter((r) => !r.ok)
      if (failed.length) {
        setError(
          failed
            .map(
              (f) =>
                `${f.panel_id}: ${f.error === 'panel_not_found' ? 'không tìm thấy tủ' : f.error ?? vi.failed}`,
            )
            .join(', '),
        )
      } else {
        setOkMsg(vi.queued(actionLabel[action] ?? action, selectedIds.length))
      }
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-accent" />
          <h2 className="text-sm font-semibold tracking-wide text-ink">{vi.panelTitle}</h2>
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          className="font-mono text-[11px] text-accent hover:underline"
        >
          {vi.selectAll}
        </button>
      </div>

      {!writeAllowed && (
        <p className="mb-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">{vi.readOnlyHint}</p>
      )}

      <ul className="mb-4 max-h-52 space-y-2 overflow-auto pr-1">
        {panels.map((p) => {
          const checked = selected.has(p.panel_id)
          return (
            <li key={p.panel_id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line/70 bg-fog/60 px-3 py-2 hover:bg-mist">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(p.panel_id)}
                  className="accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.display_name}</span>
                    <ArmedBadge state={p.armed_state} />
                  </div>
                  <p className="font-mono text-[11px] text-steel/55">
                    {p.panel_id} · {labelOf(connectionLabel, p.connection)} · {p.device_count}{' '}
                    {vi.devices}
                  </p>
                </div>
              </label>
            </li>
          )
        })}
        {!panels.length && <li className="text-xs text-steel/50">{vi.noPanels}</li>}
      </ul>

      <div className="flex flex-wrap gap-2">
        <ActionBtn
          disabled={!writeAllowed || busy}
          onClick={() => void run('arm')}
          icon={<Lock className="size-3.5" />}
          label={vi.arm}
          tone="danger"
        />
        <ActionBtn
          disabled={!writeAllowed || busy}
          onClick={() => void run('disarm')}
          icon={<LockOpen className="size-3.5" />}
          label={vi.disarm}
          tone="ok"
        />
        <ActionBtn
          disabled={!writeAllowed || busy}
          onClick={() => void run('partial')}
          icon={<Shield className="size-3.5" />}
          label={vi.partial}
          tone="warn"
        />
      </div>

      {okMsg && <p className="mt-3 text-xs text-ok">{okMsg}</p>}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </section>
  )
}

function ArmedBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    armed: 'bg-danger/10 text-danger',
    partial: 'bg-warn/10 text-warn',
    disarmed: 'bg-ok/10 text-ok',
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${map[state] ?? 'bg-steel/10 text-steel'}`}
    >
      {labelOf(armedStateLabel, state)}
    </span>
  )
}

function ActionBtn({
  disabled,
  onClick,
  icon,
  label,
  tone,
}: {
  disabled: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  tone: 'ok' | 'warn' | 'danger'
}) {
  const styles = {
    ok: 'bg-ok text-panel hover:brightness-110',
    warn: 'bg-warn text-panel hover:brightness-110',
    danger: 'bg-danger text-white hover:brightness-110',
  }[tone]

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {icon}
      {label}
    </button>
  )
}
