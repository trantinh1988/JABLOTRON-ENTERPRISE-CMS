import { useMemo, useState } from 'react'
import {
  groupAction,
  type Device,
  type GroupAction,
  type Panel,
  type PanelUser,
  type Zone,
} from '../api/client'
import {
  actionLabel,
  armedStateLabel,
  formatCommandError,
  labelOf,
  vi,
} from '../i18n/vi'

type Props = {
  panel: Panel | null
  zones: Zone[]
  devices: Device[]
  users: PanelUser[]
  writeAllowed: boolean
  mockMode: boolean | null
  lastAction: LastAction | null
  onLastAction: (action: LastAction) => void
  onRefresh: () => Promise<void>
  onZonesChange: (zones: Zone[]) => void
}

export type LastAction = {
  at: string
  panelId: string
  target: 'system' | 'section'
  zoneName?: string
  action: 'arm' | 'disarm' | 'partial'
  userName: string
}

function panelControllable(p: Panel, mockMode: boolean | null): boolean {
  if (mockMode) return true
  return p.connection === 'usb'
}

export function KeypadControl({
  panel,
  zones,
  devices,
  users,
  writeAllowed,
  mockMode,
  lastAction,
  onLastAction,
  onRefresh,
  onZonesChange,
}: Props) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => a.section_num - b.section_num),
    [zones],
  )

  const alarmDevices = useMemo(
    () => devices.filter((d) => d.state === 'alarm' || d.state === 'open'),
    [devices],
  )

  const statusTone = panelArmedTone(panel?.armed_state)

  function resolveUser(): {
    user: PanelUser | null
    label: string
    code: string
    error?: string
  } {
    if (!pin) {
      return { user: null, label: '', code: '', error: vi.keypadEnterCode }
    }
    if (!/^\d{4,10}$/.test(pin)) {
      return { user: null, label: '', code: '', error: formatCommandError('invalid_pin_code') }
    }
    if (!users.length) {
      return { user: null, label: vi.keypadOperatorCms, code: pin }
    }
    const match = users.find((u) => u.code_label && u.code_label === pin)
    if (!match) {
      return { user: null, label: '', code: '', error: vi.keypadWrongCode }
    }
    return { user: match, label: match.name, code: pin }
  }

  function userCan(action: GroupAction, user: PanelUser | null): boolean {
    if (!user) return true
    if (user.permissions.includes('admin')) return true
    return user.permissions.includes(action)
  }

  async function runSystem(action: GroupAction) {
    if (!panel) return
    if (!writeAllowed) {
      setError(vi.readOnlyHint)
      return
    }
    if (!panelControllable(panel, mockMode)) {
      setError(vi.panelNotControllable(panel.panel_id))
      return
    }
    const resolved = resolveUser()
    if (resolved.error) {
      setError(resolved.error)
      return
    }
    if (!userCan(action, resolved.user)) {
      setError(vi.keypadNoPermission)
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await groupAction([panel.panel_id], action, resolved.label, {
        code: resolved.code,
      })
      const failed = result.results.filter((r) => !r.ok)
      if (failed.length) {
        setError(
          failed
            .map((f) => `${f.panel_id}: ${formatCommandError(String(f.error ?? ''))}`)
            .join(', '),
        )
      } else {
        const label = actionLabel[action] ?? action
        setMessage(`${label} · ${resolved.label}`)
        onLastAction({
          at: new Date().toISOString(),
          panelId: panel.panel_id,
          target: 'system',
          action,
          userName: resolved.label,
        })
        setPin('')
      }
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleSection(zone: Zone) {
    if (!panel) return
    if (!writeAllowed) {
      setError(vi.readOnlyHint)
      return
    }
    if (!panelControllable(panel, mockMode)) {
      setError(vi.panelNotControllable(panel.panel_id))
      return
    }

    const nextArmed = zone.armed_state === 'armed' ? 'disarmed' : 'armed'
    const action: GroupAction = nextArmed === 'armed' ? 'arm' : 'disarm'
    const resolved = resolveUser()
    if (resolved.error) {
      setError(resolved.error)
      return
    }
    if (!userCan(action, resolved.user)) {
      setError(vi.keypadNoPermission)
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const detail = `${resolved.label} · ${zone.name}`
      const result = await groupAction([panel.panel_id], action, detail, {
        code: resolved.code,
        section_num: zone.section_num,
      })
      const failed = result.results.filter((r) => !r.ok)
      if (failed.length) {
        setError(
          failed
            .map((f) => `${f.panel_id}: ${formatCommandError(String(f.error ?? ''))}`)
            .join(', '),
        )
      } else {
        onZonesChange(
          zones.map((z) =>
            z.zone_id === zone.zone_id ? { ...z, armed_state: nextArmed } : z,
          ),
        )
        setMessage(
          `${labelOf(armedStateLabel, nextArmed)} · ${zone.name} · ${resolved.label}`,
        )
        onLastAction({
          at: new Date().toISOString(),
          panelId: panel.panel_id,
          target: 'section',
          zoneName: zone.name,
          action,
          userName: resolved.label,
        })
        setPin('')
      }
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function pressKey(key: string) {
    setError(null)
    if (key === 'ESC') {
      setPin('')
      setMessage(null)
      return
    }
    if (key === '⌫') {
      setPin((p) => p.slice(0, -1))
      return
    }
    if (pin.length >= 8) return
    setPin((p) => p + key)
  }

  if (!panel) {
    return (
      <section className="panel-card flex min-h-[520px] items-center justify-center p-6">
        <p className="text-sm text-steel/60">{vi.keypadPickPanel}</p>
      </section>
    )
  }

  return (
    <section className="panel-card overflow-hidden p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-ink">{vi.keypadTitle}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-steel/55">
            {panel.display_name} · {panel.panel_id}
          </p>
        </div>
        {!writeAllowed && (
          <span className="rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">{vi.licenseReadOnly}</span>
        )}
      </div>

      <div className="mx-auto w-full max-w-md">
        {/* Housing — look of physical Jablotron keypad */}
        <div className="keypad-housing rounded-2xl p-3 shadow-[0_20px_50px_rgba(0,0,0,0.35)] sm:p-4">
          {/* Section bars */}
          <div className="overflow-hidden rounded-xl bg-[#f4f5f7] ring-1 ring-black/10">
            {sortedZones.length === 0 && (
              <p className="border-b border-black/10 px-4 py-3 text-center text-xs text-[#5a6570]">
                {vi.keypadNoSections}
              </p>
            )}
            {sortedZones.map((zone) => {
              const zoneAlarms = alarmDevices.filter((d) => d.zone_id === zone.zone_id)
              const leftTone =
                zoneAlarms.some((d) => d.state === 'alarm')
                  ? 'danger'
                  : zoneAlarms.length
                    ? 'warn'
                    : zone.armed_state === 'disarmed'
                      ? 'ok'
                      : 'idle'
              const armed = zone.armed_state === 'armed' || zone.armed_state === 'partial'
              return (
                <SectionBar
                  key={zone.zone_id}
                  label={zone.name}
                  leftTone={leftTone}
                  rightActive={armed}
                  disabled={busy || !writeAllowed}
                  onToggle={() => void toggleSection(zone)}
                />
              )
            })}
            <SectionBar
              label={vi.keypadFullySet}
              leftTone={statusTone === 'ok' ? 'ok' : statusTone === 'danger' ? 'danger' : 'idle'}
              rightActive={panel.armed_state === 'armed'}
              disabled={busy || !writeAllowed}
              onToggle={() => void runSystem(panel.armed_state === 'armed' ? 'disarm' : 'arm')}
              emphasis
            />
          </div>

          {/* Status LED strip + LCD */}
          <div className="mt-3 overflow-hidden rounded-xl bg-[#1a1f24] ring-1 ring-black/20">
            <div
              className={`h-1.5 w-full transition-colors ${
                statusTone === 'danger'
                  ? 'bg-danger shadow-[0_0_12px_rgba(239,83,80,0.7)]'
                  : statusTone === 'warn'
                    ? 'bg-warn shadow-[0_0_12px_rgba(227,162,39,0.55)]'
                    : 'bg-ok shadow-[0_0_12px_rgba(61,203,122,0.55)]'
              }`}
            />
            <div className="keypad-lcd min-h-[148px] px-4 py-3 text-[#c8e6c0]">
              <p className="font-mono text-[10px] tracking-[0.2em] text-[#7a9a72]">
                {vi.brandTitle.toUpperCase()}
              </p>
              <p className="mt-2 font-mono text-sm font-semibold tracking-wide">
                {labelOf(armedStateLabel, panel.armed_state)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-[#9bbb93]">
                {alarmDevices.length
                  ? vi.keypadAlarmZones(alarmDevices.length)
                  : vi.keypadZonesClear}
              </p>
              {alarmDevices.slice(0, 3).map((d) => (
                <p key={d.global_id} className="truncate font-mono text-[11px] text-[#ef9a9a]">
                  {d.label || d.global_id}
                  {d.state === 'alarm' ? ` - ${vi.alarm}` : ` - ${vi.open}`}
                </p>
              ))}
              {lastAction && lastAction.panelId === panel.panel_id && (
                <p className="mt-2 border-t border-[#2a3a2e] pt-2 font-mono text-[11px] text-[#b0d4a8]">
                  {formatLastAction(lastAction)}
                </p>
              )}
              {message && (
                <p className="mt-1 font-mono text-[11px] text-[#ffe082]">{message}</p>
              )}
              {error && (
                <p className="mt-1 font-mono text-[11px] text-[#ef9a9a]">{error}</p>
              )}
              <p className="mt-2 font-mono text-base tracking-[0.35em] text-[#dcefd6]">
                {pin ? '*'.repeat(pin.length) : '-'}
              </p>
            </div>
          </div>

          {/* Numeric keypad */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ESC', '0', '⌫'].map((key) => (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => pressKey(key)}
                className={`keypad-key h-12 rounded-md text-sm font-semibold tracking-wide transition active:translate-y-px disabled:opacity-40 ${
                  key === 'ESC' || key === '⌫'
                    ? 'bg-[#2b333b] text-[#d7dee5] hover:bg-[#343d47]'
                    : 'bg-[#12171c] text-white hover:bg-[#1c232b]'
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <ActionChip
              label={vi.arm}
              tone="danger"
              disabled={busy || !writeAllowed}
              onClick={() => void runSystem('arm')}
            />
            <ActionChip
              label={vi.disarm}
              tone="ok"
              disabled={busy || !writeAllowed}
              onClick={() => void runSystem('disarm')}
            />
            <ActionChip
              label={vi.partial}
              tone="warn"
              disabled={busy || !writeAllowed}
              onClick={() => void runSystem('partial')}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function SectionBar({
  label,
  leftTone,
  rightActive,
  disabled,
  onToggle,
  emphasis,
}: {
  label: string
  leftTone: 'ok' | 'warn' | 'danger' | 'idle'
  rightActive: boolean
  disabled: boolean
  onToggle: () => void
  emphasis?: boolean
}) {
  const leftClass = {
    ok: 'bg-[#3dcb7a] shadow-[0_0_8px_rgba(61,203,122,0.65)]',
    warn: 'bg-[#e3a227] shadow-[0_0_8px_rgba(227,162,39,0.55)]',
    danger: 'bg-[#ef5350] shadow-[0_0_8px_rgba(239,83,80,0.65)]',
    idle: 'bg-[#b0b8c0]',
  }[leftTone]

  return (
    <div
      className={`flex items-center gap-3 border-b border-black/10 px-3 py-2.5 last:border-b-0 ${
        emphasis ? 'bg-[#e9ebef]' : 'bg-[#f4f5f7]'
      }`}
    >
      <span className={`inline-block size-3 shrink-0 rounded-full ${leftClass}`} />
      <span
        className={`min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-[0.14em] text-[#2a3138] ${
          emphasis ? 'font-bold' : ''
        }`}
      >
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        title={rightActive ? vi.disarm : vi.arm}
        className={`size-7 shrink-0 rounded-full ring-2 transition disabled:cursor-not-allowed disabled:opacity-50 ${
          rightActive
            ? 'bg-[#ef5350] ring-[#ef5350]/60 shadow-[0_0_10px_rgba(239,83,80,0.55)]'
            : 'bg-[#c5ccd3] ring-[#c5ccd3]/40 hover:bg-[#b0b8c0]'
        }`}
      />
    </div>
  )
}

function ActionChip({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string
  tone: 'ok' | 'warn' | 'danger'
  disabled: boolean
  onClick: () => void
}) {
  const styles = {
    ok: 'bg-ok/90 text-[#062012] hover:brightness-110',
    warn: 'bg-warn/90 text-[#2a1a00] hover:brightness-110',
    danger: 'bg-danger/90 text-white hover:brightness-110',
  }[tone]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-2.5 text-[11px] font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {label}
    </button>
  )
}

function panelArmedTone(state: string | undefined): 'ok' | 'warn' | 'danger' {
  if (state === 'armed') return 'danger'
  if (state === 'partial') return 'warn'
  return 'ok'
}

function formatLastAction(a: LastAction): string {
  const action = labelOf(armedStateLabel, a.action === 'arm' ? 'armed' : a.action === 'disarm' ? 'disarmed' : 'partial')
  const target = a.target === 'section' && a.zoneName ? a.zoneName : vi.keypadFullySet
  const time = a.at.replace('T', ' ').slice(11, 19)
  return `${time} · ${a.userName} · ${action} · ${target}`
}
