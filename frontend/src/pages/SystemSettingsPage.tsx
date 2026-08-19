import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Bell, Route, Usb, Volume2 } from 'lucide-react'
import { Btn, Card, Field, PageHeader, Toggle, inputClass } from '../components/ui'
import { vi, deviceStateLabel } from '../i18n/vi'
import {
  getHostPorts,
  getHostService,
  reconnectHostUsb,
  setHostAutostart,
  setHostPorts,
  updatePanel,
  type HostService,
  type Panel,
} from '../api/client'
import { clearAlarmTrail } from '../hooks/alarmTrailBus'
import {
  ensureAlarmNotifyPermission,
  isAlarmDesktopNotifyEnabled,
  isAlarmTitleFlashEnabled,
  setAlarmDesktopNotifyEnabled,
  setAlarmTitleFlashEnabled,
} from '../lib/alarmBrowserAlert'
import {
  ALERT_SOUND_STATUSES,
  clearAlertSoundFile,
  getAlertSoundMeta,
  hydrateAlertSounds,
  persistSiteTitle,
  persistSystemSoundPref,
  persistSystemTrailPref,
  playAlertSound,
  saveAlertSoundFile,
  SITE_TITLE_MAX,
  DEFAULT_SITE_TITLE,
  validateAlertSoundFile,
  type AlertSoundStatus,
} from '../lib/alarmSounds'
import { mapStatusColor } from '../lib/deviceIconLibrary'
import { isAlarmTrailEnabled, isAlertSoundEnabled } from '../lib/systemPrefs'

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-steel/65">{children}</h2>
  )
}

function PrefRow({
  title,
  extra,
  checked,
  onChange,
  disabled,
}: {
  title: string
  extra?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} title={title} className="block truncate text-sm font-medium text-ink">
          {title}
        </label>
        {extra}
      </div>
      <Toggle id={id} checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}

function SmartPrefCard({
  id,
  icon,
  title,
  checked,
  onChange,
  disabled,
  meta,
  metaWarn,
}: {
  id?: string
  icon: ReactNode
  title: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  meta?: string | null
  metaWarn?: boolean
}) {
  const toggleId = useId()
  return (
    <section
      id={id}
      className={`panel-card flex h-full min-w-0 flex-col px-4 py-3 scroll-mt-20 ${
        checked ? 'bg-ok/[0.05] ring-1 ring-ok/30' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`shrink-0 ${checked ? 'text-ok' : 'text-steel/45'}`}>{icon}</span>
          <p className="truncate font-mono text-[11px] uppercase tracking-wide text-steel/55">{title}</p>
        </div>
        <Toggle
          id={toggleId}
          checked={checked}
          onChange={onChange}
          label={title}
          disabled={disabled}
        />
      </div>
      <p className={`mt-1.5 text-2xl font-semibold ${checked ? 'text-ok' : 'text-steel/45'}`}>
        {checked ? vi.systemOn : vi.systemOff}
      </p>
      <p
        className={`mt-auto truncate pt-1 text-[11px] ${
          metaWarn ? 'text-warn' : 'text-steel/55'
        }`}
        title={meta ?? undefined}
      >
        {meta || '\u00a0'}
      </p>
    </section>
  )
}

type Props = { writeAllowed?: boolean; panels?: Panel[]; onRefresh?: () => Promise<void> }

export function SystemSettingsPage({ writeAllowed = true, panels = [], onRefresh }: Props) {
  const [trailOn, setTrailOn] = useState(isAlarmTrailEnabled)
  const [soundOn, setSoundOn] = useState(isAlertSoundEnabled)
  const [notifyOn, setNotifyOn] = useState(isAlarmDesktopNotifyEnabled)
  const [flashOn, setFlashOn] = useState(isAlarmTitleFlashEnabled)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default')
  const [meta, setMeta] = useState(getAlertSoundMeta)
  const [busyStatus, setBusyStatus] = useState<AlertSoundStatus | null>(null)
  const [prefBusy, setPrefBusy] = useState(false)
  const [rowError, setRowError] = useState<{ status: AlertSoundStatus; message: string } | null>(
    null,
  )
  const [pageError, setPageError] = useState<string | null>(null)
  const [host, setHost] = useState<HostService | null>(null)
  const [hostBusy, setHostBusy] = useState(false)
  const [reconnectBusy, setReconnectBusy] = useState(false)
  const [streamPin, setStreamPin] = useState('')
  const [streamBusy, setStreamBusy] = useState(false)
  const [streamMsg, setStreamMsg] = useState<string | null>(null)
  const [streamPanelId, setStreamPanelId] = useState<string>('')
  const [portsDraft, setPortsDraft] = useState({ ui: 8080, api: 8010 })
  const [portsSaved, setPortsSaved] = useState({ ui: 8080, api: 8010 })
  const [portsBusy, setPortsBusy] = useState(false)
  const [portsMsg, setPortsMsg] = useState<string | null>(null)
  const [portsMsgOk, setPortsMsgOk] = useState(true)
  const [siteTitle, setSiteTitle] = useState('')
  const [siteTitleSaved, setSiteTitleSaved] = useState('')
  const [siteBusy, setSiteBusy] = useState(false)
  const [siteMsg, setSiteMsg] = useState<string | null>(null)
  const [siteMsgOk, setSiteMsgOk] = useState(true)
  const fileRefs = useRef<Partial<Record<AlertSoundStatus, HTMLInputElement | null>>>({})

  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPerm('unsupported')
      return
    }
    setPerm(Notification.permission)
  }, [])

  useEffect(() => {
    let cancelled = false
    void hydrateAlertSounds()
      .then((s) => {
        if (cancelled) return
        setSoundOn(s.sound_enabled)
        setTrailOn(s.trail_enabled)
        setMeta(getAlertSoundMeta())
        const title = s.site_title?.trim() ?? ''
        setSiteTitle(title)
        setSiteTitleSaved(title)
      })
      .catch(() => {
        if (!cancelled) setPageError(vi.systemLoadFail)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getHostPorts()
      .then((p) => {
        if (cancelled) return
        const next = { ui: p.ui_port, api: p.api_port }
        setPortsDraft(next)
        setPortsSaved(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getHostService()
      .then((s) => {
        if (!cancelled) setHost(s)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!panels.length) {
      setStreamPanelId('')
      return
    }
    setStreamPanelId((cur) =>
      cur && panels.some((p) => p.panel_id === cur) ? cur : panels[0].panel_id,
    )
  }, [panels])

  const setTrail = async (on: boolean) => {
    setPrefBusy(true)
    setPageError(null)
    try {
      await persistSystemTrailPref(on)
      setTrailOn(on)
      if (!on) clearAlarmTrail()
    } catch {
      setPageError(vi.systemSaveFail)
    } finally {
      setPrefBusy(false)
    }
  }

  const setSound = async (on: boolean) => {
    setPrefBusy(true)
    setPageError(null)
    try {
      await persistSystemSoundPref(on)
      setSoundOn(on)
    } catch {
      setPageError(vi.systemSaveFail)
    } finally {
      setPrefBusy(false)
    }
  }

  const setNotify = async (on: boolean) => {
    setAlarmDesktopNotifyEnabled(on)
    setNotifyOn(on)
    if (on) {
      const next = await ensureAlarmNotifyPermission()
      setPerm(next)
    }
  }

  const setFlash = (on: boolean) => {
    setAlarmTitleFlashEnabled(on)
    setFlashOn(on)
  }

  const errorText = (code: string) => {
    if (code === 'too_big') return vi.systemSoundTooBig
    if (code === 'bad_type') return vi.systemSoundBadType
    if (code === 'empty') return vi.systemSoundNoFile
    if (code === 'play_fail') return vi.systemSoundPlayFail
    return vi.systemSoundSaveFail
  }

  const onPickFile = async (status: AlertSoundStatus, file: File | undefined) => {
    if (!file) return
    const invalid = validateAlertSoundFile(file)
    if (invalid) {
      setRowError({ status, message: errorText(invalid) })
      return
    }
    setBusyStatus(status)
    setRowError(null)
    setPageError(null)
    try {
      await saveAlertSoundFile(status, file)
      setMeta(getAlertSoundMeta())
    } catch {
      setRowError({ status, message: vi.systemSoundSaveFail })
    } finally {
      setBusyStatus(null)
    }
  }

  const onPreview = async (status: AlertSoundStatus) => {
    setBusyStatus(status)
    setRowError(null)
    const result = await playAlertSound(status, { preview: true })
    if (result === 'empty') setRowError({ status, message: vi.systemSoundNoFile })
    if (result === 'play_fail') setRowError({ status, message: vi.systemSoundPlayFail })
    setBusyStatus(null)
  }

  const onClear = async (status: AlertSoundStatus) => {
    setBusyStatus(status)
    setRowError(null)
    setPageError(null)
    try {
      await clearAlertSoundFile(status)
      setMeta(getAlertSoundMeta())
    } catch {
      setRowError({ status, message: vi.systemSoundSaveFail })
    } finally {
      setBusyStatus(null)
    }
  }

  const writeOff = !writeAllowed || prefBusy

  const setAutostart = async (on: boolean) => {
    setHostBusy(true)
    setPageError(null)
    try {
      const next = await setHostAutostart(on)
      setHost(next)
    } catch (e) {
      const extra = e instanceof Error && e.message ? ` ${e.message}` : ''
      setPageError(`${vi.systemHostAutostartFail}${extra}`)
    } finally {
      setHostBusy(false)
    }
  }

  const onReconnectUsb = async () => {
    setReconnectBusy(true)
    setPageError(null)
    try {
      const next = await reconnectHostUsb()
      setHost(next)
    } catch {
      setPageError(vi.systemHostReconnectFail)
    } finally {
      setReconnectBusy(false)
    }
  }

  const streamPanel = panels.find((p) => p.panel_id === streamPanelId) ?? panels[0] ?? null

  const onSaveStreamCode = async (code: string) => {
    if (!streamPanel) return
    const pin = code.trim()
    if (!pin) {
      setStreamMsg(vi.streamCodePlaceholder)
      return
    }
    setStreamBusy(true)
    setStreamMsg(null)
    setPageError(null)
    try {
      await updatePanel(streamPanel.panel_id, { stream_code: pin })
      setStreamPin('')
      setStreamMsg(vi.streamCodeSaved)
      await onRefresh?.()
    } catch (e) {
      setStreamMsg(e instanceof Error ? e.message : vi.systemSaveFail)
    } finally {
      setStreamBusy(false)
    }
  }

  const onClearStreamCode = async () => {
    if (!streamPanel) return
    setStreamBusy(true)
    setStreamMsg(null)
    setPageError(null)
    try {
      await updatePanel(streamPanel.panel_id, { stream_code: '' })
      setStreamPin('')
      setStreamMsg(vi.streamCodeCleared)
      await onRefresh?.()
    } catch (e) {
      setStreamMsg(e instanceof Error ? e.message : vi.systemSaveFail)
    } finally {
      setStreamBusy(false)
    }
  }

  const onSaveSiteTitle = async (value: string) => {
    setSiteBusy(true)
    setSiteMsg(null)
    setPageError(null)
    try {
      const next = await persistSiteTitle(value)
      const saved = next.site_title?.trim() ?? ''
      setSiteTitle(saved)
      setSiteTitleSaved(saved)
      setSiteMsg(vi.systemSiteTitleSaved)
      setSiteMsgOk(true)
    } catch (e) {
      setSiteMsg(e instanceof Error ? e.message : vi.systemSaveFail)
      setSiteMsgOk(false)
    } finally {
      setSiteBusy(false)
    }
  }

  const onSavePorts = async () => {
    const ui = Number(portsDraft.ui)
    const api = Number(portsDraft.api)
    if (
      !Number.isInteger(ui) ||
      !Number.isInteger(api) ||
      ui < 1024 ||
      api < 1024 ||
      ui > 65535 ||
      api > 65535 ||
      ui === api
    ) {
      setPortsMsg(vi.systemPortsInvalid)
      setPortsMsgOk(false)
      return
    }
    setPortsBusy(true)
    setPortsMsg(null)
    setPageError(null)
    try {
      const prevUi = portsSaved.ui
      const next = await setHostPorts(ui, api)
      setPortsSaved({ ui: next.ui_port, api: next.api_port })
      setPortsDraft({ ui: next.ui_port, api: next.api_port })
      const pagePort = Number(
        window.location.port || (window.location.protocol === 'https:' ? '443' : '80'),
      )
      const onCmsUi = pagePort === prevUi || pagePort === 8080 || pagePort === next.ui_port
      if (onCmsUi && pagePort !== next.ui_port && next.applied !== false) {
        setPortsMsg(vi.systemPortsRedirect)
        setPortsMsgOk(true)
        const url = new URL(window.location.href)
        url.port = String(next.ui_port)
        window.setTimeout(() => window.location.assign(url.toString()), 1200)
        return
      }
      setPortsMsg(
        next.applied === false
          ? `${vi.systemPortsSaved}${next.detail ? ` ${next.detail}` : ''}`
          : vi.systemPortsApplied,
      )
      setPortsMsgOk(next.applied !== false)
    } catch (e) {
      setPortsMsg(e instanceof Error ? e.message : vi.systemPortsFail)
      setPortsMsgOk(false)
    } finally {
      setPortsBusy(false)
    }
  }

  const soundCount = ALERT_SOUND_STATUSES.filter((s) => meta[s]).length
  const notifyMeta =
    perm === 'denied'
      ? vi.systemNotifyBlocked
      : perm === 'unsupported'
        ? vi.systemNotifyNoApi
        : perm === 'default' && notifyOn
          ? vi.systemNotifyNeedPerm
          : null
  const usbConnected = Boolean(host && !host.usb_mock_mode && host.usb_panels_connected > 0)
  const usbMeta = host
    ? host.usb_mock_mode
      ? vi.systemHostUsbMock
      : usbConnected
        ? vi.systemHostUsbOk
        : vi.systemHostUsbWait
    : null
  const usbWarn = Boolean(host && !host.usb_mock_mode && host.usb_panels_connected <= 0)

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader title={vi.navSystem} />

      {pageError && <p className="mb-3 text-sm text-danger">{pageError}</p>}

      <Card className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle>{vi.systemSiteTitleTitle}</SectionTitle>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Btn
              type="button"
              tone="ghost"
              disabled={!writeAllowed || siteBusy || !siteTitleSaved}
              onClick={() => void onSaveSiteTitle('')}
            >
              {vi.systemSiteTitleReset}
            </Btn>
            <Btn
              type="button"
              disabled={
                !writeAllowed ||
                siteBusy ||
                siteTitle.trim() === siteTitleSaved
              }
              onClick={() => void onSaveSiteTitle(siteTitle)}
            >
              {vi.systemSiteTitleSave}
            </Btn>
          </div>
        </div>
        <form
          className="flex min-w-0 flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void onSaveSiteTitle(siteTitle)
          }}
        >
          <div className="min-w-0 flex-[1_1_16rem]">
            <Field label={vi.systemSiteTitleLabel}>
              <input
                type="text"
                maxLength={SITE_TITLE_MAX}
                className={inputClass}
                value={siteTitle}
                placeholder={DEFAULT_SITE_TITLE}
                disabled={!writeAllowed || siteBusy}
                onChange={(e) => {
                  setSiteTitle(e.target.value.slice(0, SITE_TITLE_MAX))
                  setSiteMsg(null)
                }}
              />
            </Field>
          </div>
        </form>
        {siteMsg && (
          <p className={`text-[11px] ${siteMsgOk ? 'text-ok' : 'text-danger'}`}>{siteMsg}</p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SmartPrefCard
          id="system-alerts"
          icon={<Volume2 className="size-3.5" />}
          title={vi.systemSummarySound}
          checked={soundOn}
          onChange={(on) => void setSound(on)}
          disabled={writeOff}
          meta={vi.systemSoundAssigned(soundCount)}
        />
        <SmartPrefCard
          icon={<Bell className="size-3.5" />}
          title={vi.systemSummaryNotify}
          checked={notifyOn}
          onChange={(on) => void setNotify(on)}
          meta={notifyMeta}
          metaWarn={perm === 'denied' || perm === 'unsupported'}
        />
        <SmartPrefCard
          id="system-trail"
          icon={<Route className="size-3.5" />}
          title={vi.systemSummaryTrail}
          checked={trailOn}
          onChange={(on) => void setTrail(on)}
          disabled={writeOff}
        />
        <SmartPrefCard
          id="system-host"
          icon={<Usb className="size-3.5" />}
          title={vi.systemSummaryUsb}
          checked={Boolean(host?.autostart_enabled)}
          onChange={(on) => void setAutostart(on)}
          disabled={!writeAllowed || hostBusy || !host?.autostart_supported}
          meta={usbMeta}
          metaWarn={usbWarn}
        />
      </div>

      <Card className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle>{vi.systemPortsSection}</SectionTitle>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Btn
              type="button"
              tone="ghost"
              disabled={!writeAllowed || portsBusy}
              onClick={() => setPortsDraft({ ui: 8080, api: 8010 })}
            >
              {vi.systemPortsReset}
            </Btn>
            <Btn
              type="button"
              disabled={
                !writeAllowed ||
                portsBusy ||
                (portsDraft.ui === portsSaved.ui && portsDraft.api === portsSaved.api)
              }
              onClick={() => void onSavePorts()}
            >
              {portsBusy ? vi.systemPortsBusy : vi.systemPortsSave}
            </Btn>
          </div>
        </div>
        <form
          className="flex min-w-0 flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void onSavePorts()
          }}
        >
          <div className="min-w-0 flex-[1_1_8rem]">
            <Field label={`${vi.systemPortsUi} (8080)`}>
              <input
                type="number"
                min={1024}
                max={65535}
                className={inputClass}
                value={portsDraft.ui}
                disabled={!writeAllowed || portsBusy}
                onChange={(e) => setPortsDraft((p) => ({ ...p, ui: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-[1_1_8rem]">
            <Field label={`${vi.systemPortsApi} (8010)`}>
              <input
                type="number"
                min={1024}
                max={65535}
                className={inputClass}
                value={portsDraft.api}
                disabled={!writeAllowed || portsBusy}
                onChange={(e) => setPortsDraft((p) => ({ ...p, api: Number(e.target.value) }))}
              />
            </Field>
          </div>
        </form>
        <p className="truncate font-mono text-[11px] text-steel/55">
          {`http://127.0.0.1:${portsDraft.ui}`}
          <span className="text-steel/35"> · </span>
          {`http://127.0.0.1:${portsDraft.api}/api`}
        </p>
        {portsMsg && (
          <p className={`text-[11px] ${portsMsgOk ? 'text-ok' : 'text-danger'}`}>{portsMsg}</p>
        )}
      </Card>

      <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-2">
        <Card className="flex h-full min-w-0 flex-col space-y-3">
          <SectionTitle>{vi.systemAlertSection}</SectionTitle>
          <div className="border-b border-line/80">
            <PrefRow title={vi.systemTitleFlashTitle} checked={flashOn} onChange={setFlash} />
          </div>
          <div
            className={`flex-1 overflow-hidden rounded-md ring-1 ring-line ${
              soundOn ? 'bg-fog/40' : 'bg-fog/20 opacity-90'
            }`}
          >
            {ALERT_SOUND_STATUSES.map((status) => {
              const info = meta[status]
              const color = mapStatusColor(status)
              return (
                <div
                  key={status}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line/70 px-3 py-2 last:border-b-0"
                >
                  <span className="inline-flex w-[7.25rem] shrink-0 items-center gap-2 text-sm font-medium text-ink">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="truncate">{deviceStateLabel[status] ?? status}</span>
                  </span>
                  <span className="min-w-0 flex-1 basis-28 truncate font-mono text-[11px] text-steel/65">
                    {info?.name ?? vi.systemSoundEmpty}
                  </span>
                  <input
                    ref={(el) => {
                      fileRefs.current[status] = el
                    }}
                    type="file"
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      void onPickFile(status, file)
                    }}
                  />
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
                    <Btn
                      tone="ghost"
                      disabled={writeOff || busyStatus === status}
                      onClick={() => fileRefs.current[status]?.click()}
                    >
                      {vi.systemSoundChoose}
                    </Btn>
                    <Btn
                      tone="ghost"
                      disabled={busyStatus === status || !info}
                      onClick={() => void onPreview(status)}
                    >
                      {vi.systemSoundPreview}
                    </Btn>
                    <Btn
                      tone="ghost"
                      disabled={writeOff || busyStatus === status || !info}
                      onClick={() => void onClear(status)}
                    >
                      {vi.systemSoundClear}
                    </Btn>
                  </div>
                  {rowError?.status === status && (
                    <p className="w-full text-[11px] text-danger">{rowError.message}</p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="flex h-full min-w-0 flex-col gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <SectionTitle>{vi.systemHostSection}</SectionTitle>
              <Btn
                tone="ghost"
                className="ml-auto"
                disabled={!writeAllowed || reconnectBusy || host?.usb_mock_mode}
                onClick={() => void onReconnectUsb()}
              >
                {reconnectBusy ? vi.systemHostReconnecting : vi.systemHostReconnect}
              </Btn>
            </div>
            {host && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ${
                    host.usb_mock_mode
                      ? 'text-steel/70 ring-line'
                      : host.usb_panels_connected > 0
                        ? 'text-ok ring-ok/30'
                        : 'text-warn ring-warn/30'
                  }`}
                >
                  {host.usb_mock_mode
                    ? vi.systemHostUsbMock
                    : host.usb_panels_connected > 0
                      ? vi.systemHostUsbOk
                      : vi.systemHostUsbWait}
                </span>
                <span
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ${
                    host.docker_ok === true
                      ? 'text-ok ring-ok/30'
                      : host.docker_ok === false
                        ? 'text-warn ring-warn/30'
                        : 'text-steel/70 ring-line'
                  }`}
                >
                  {host.docker_ok === true
                    ? vi.systemHostDockerOk
                    : host.docker_ok === false
                      ? vi.systemHostDockerWait
                      : vi.systemHostDockerUnknown}
                </span>
              </div>
            )}
            {host?.usb_last_error && (
              <p className="break-all rounded-md bg-warn/10 px-2.5 py-1.5 font-mono text-[11px] text-warn">
                {host.usb_last_error}
              </p>
            )}
          </div>

          <div className="mt-auto space-y-3 border-t border-line/80 pt-4">
            <SectionTitle>{vi.systemServiceCodeTitle}</SectionTitle>
            {streamPanel ? (
              <form
                className="flex min-w-0 flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void onSaveStreamCode(streamPin)
                }}
              >
                {panels.length > 1 && (
                  <div className="min-w-0 flex-[1_1_10rem]">
                    <select
                      className={inputClass}
                      value={streamPanel.panel_id}
                      disabled={!writeAllowed || streamBusy}
                      aria-label={vi.filterPanel}
                      onChange={(e) => setStreamPanelId(e.target.value)}
                    >
                      {panels.map((p) => (
                        <option key={p.panel_id} value={p.panel_id}>
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="min-w-0 flex-[2_1_12rem]">
                  <input
                    type="password"
                    autoComplete="off"
                    className={inputClass}
                    value={streamPin}
                    disabled={!writeAllowed || streamBusy}
                    maxLength={32}
                    placeholder={vi.streamCodePlaceholder}
                    aria-label={vi.streamCodeTitle}
                    onChange={(e) => setStreamPin(e.target.value)}
                  />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Btn type="submit" disabled={!writeAllowed || streamBusy || !streamPin.trim()}>
                    {streamBusy
                      ? vi.keypadPinSubmitting
                      : streamPanel.has_stream_code
                        ? vi.systemServiceCodeSave
                        : vi.streamCodeActivateBtn}
                  </Btn>
                  {streamPanel.has_stream_code && (
                    <Btn
                      type="button"
                      tone="ghost"
                      disabled={!writeAllowed || streamBusy}
                      onClick={() => void onClearStreamCode()}
                    >
                      {vi.streamCodeClear}
                    </Btn>
                  )}
                </div>
              </form>
            ) : (
              <p className="text-sm text-steel/60">{vi.noPanels}</p>
            )}
            {streamPanel?.device_stream_ok ? (
              <p className="text-[11px] text-ok">{vi.streamCodeActive}</p>
            ) : streamPanel?.has_stream_code ? (
              <p className="text-[11px] text-warn">{vi.streamCodeWaiting}</p>
            ) : streamPanel ? (
              <p className="text-[11px] text-steel/60">{vi.systemServiceCodeEmpty}</p>
            ) : null}
            {streamMsg && (
              <p
                className={`text-[11px] ${
                  streamMsg === vi.streamCodeSaved || streamMsg === vi.streamCodeCleared
                    ? 'text-ok'
                    : 'text-danger'
                }`}
              >
                {streamMsg}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
