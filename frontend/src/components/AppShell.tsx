import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  Archive,
  ChevronDown,
  History,
  LayoutDashboard,
  List,
  Lock,
  LogOut,
  Map as MapIcon,
  Menu,
  Radio,
  Rows3,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Usb,
  Video,
  Wifi,
  Workflow,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Device, LicenseStatus, Panel } from '../api/client'
import { LICENSE_FEATURE_ENABLED } from '../config/features'
import { useOperatorSession } from '../hooks/useOperatorSession'
import { vi } from '../i18n/vi'
import { BrandMark } from './BrandMark'
import { SectionsQuickModal, subscribeSectionsQuickModal } from './SectionsQuickModal'

type Props = {
  license: LicenseStatus | null
  wsConnected: boolean
  liveActive?: boolean
  mockMode: boolean | null
  panels?: Panel[]
  devices?: Device[]
  writeAllowed?: boolean
  eventSeq?: number
  onRefresh?: () => Promise<void>
}

const primaryNav = [
  { to: '/maps', label: vi.navMaps, icon: MapIcon },
  { to: '/', end: true, label: vi.navDashboard, icon: LayoutDashboard },
  { to: '/status', label: vi.navStatus, icon: List },
  { to: '/history', label: vi.navHistory, icon: History },
]

const settingsNav = [
  { to: '/devices', label: vi.navDevices, icon: Radio },
  { to: '/cameras', label: vi.navCameras, icon: Video },
  { to: '/automation', label: vi.navAutomation, icon: Workflow },
  { to: '/system', label: vi.navSystem, icon: SlidersHorizontal },
  { to: '/backup', label: vi.navBackup, icon: Archive },
  ...(LICENSE_FEATURE_ENABLED
    ? [{ to: '/settings', label: vi.navSettings, icon: ShieldCheck }]
    : []),
]

function pathInSettings(pathname: string) {
  return (
    pathname === '/devices' ||
    pathname.startsWith('/devices/') ||
    pathname.startsWith('/panels/') ||
    pathname === '/cameras' ||
    pathname.startsWith('/cameras/') ||
    pathname === '/automation' ||
    pathname.startsWith('/automation/') ||
    pathname === '/system' ||
    pathname.startsWith('/system/') ||
    pathname === '/backup' ||
    pathname.startsWith('/backup/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  )
}

export function AppShell({
  license,
  wsConnected,
  liveActive = false,
  mockMode,
  panels = [],
  devices = [],
  writeAllowed = false,
  eventSeq = 0,
  onRefresh,
}: Props) {
  const mode = license?.mode ?? 'read-only'
  const full = mode === 'full'
  const location = useLocation()
  const { session, canSettings, canLock, lock, logout } = useOperatorSession()
  const settingsActive = pathInSettings(location.pathname)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeSectionsQuickModal(() => setSectionsOpen(true)), [])

  const anyArmed = panels.some(
    (p) => p.armed_state === 'armed' || p.armed_state === 'partial',
  )
  const anyAlarm = devices.some((d) => (d.state || '').toLowerCase() === 'alarm')

  const clusterTone: 'ok' | 'warn' | 'danger' = !wsConnected
    ? 'danger'
    : liveActive
      ? 'ok'
      : 'warn'
  const clusterSummary = !wsConnected
    ? vi.headerStatusDown
    : liveActive
      ? vi.headerStatusLive
      : vi.headerStatusIdle
  const accountInitial = (session?.userName?.trim()?.charAt(0) || '?').toUpperCase()

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  useEffect(() => {
    if (!statusOpen && !settingsOpen && !accountOpen) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (!statusRef.current?.contains(t)) setStatusOpen(false)
      if (!settingsRef.current?.contains(t)) setSettingsOpen(false)
      if (!accountRef.current?.contains(t)) setAccountOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setStatusOpen(false)
        setSettingsOpen(false)
        setAccountOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [statusOpen, settingsOpen, accountOpen])

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 z-40 border-b border-line/80 bg-panel/85 backdrop-blur-md">
        <div className="flex w-full items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5 lg:px-6">
          <BrandMark />

          <nav
            className="hidden min-w-0 flex-1 items-center justify-center lg:flex"
            aria-label="Menu chính"
          >
            <div className="inline-flex max-w-full items-center gap-0.5 overflow-visible rounded-xl bg-mist/70 p-1 ring-1 ring-line/70">
              {primaryNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                      isActive
                        ? 'bg-accent/15 text-accent shadow-sm ring-1 ring-accent/25'
                        : 'text-steel hover:bg-fog/80 hover:text-ink'
                    }`
                  }
                >
                  <item.icon className="size-3.5 shrink-0 opacity-85" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
              ))}
              {canSettings && (
              <div ref={settingsRef} className="relative">
                <button
                  type="button"
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                    settingsActive || settingsOpen
                      ? 'bg-accent/15 text-accent shadow-sm ring-1 ring-accent/25'
                      : 'text-steel hover:bg-fog/80 hover:text-ink'
                  }`}
                  aria-expanded={settingsOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setAccountOpen(false)
                    setStatusOpen(false)
                    setSettingsOpen((v) => !v)
                  }}
                >
                  <Settings className="size-3.5 shrink-0 opacity-85" />
                  <span className="whitespace-nowrap">{vi.navSettingsMenu}</span>
                  <ChevronDown
                    className={`size-3 opacity-70 transition ${settingsOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {settingsOpen && (
                  <div
                    role="menu"
                    aria-label={vi.navSettingsMenu}
                    className="absolute top-[calc(100%+6px)] left-0 z-50 min-w-[12.5rem] overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-line"
                  >
                    {settingsNav.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        role="menuitem"
                        onClick={() => setSettingsOpen(false)}
                        className={({ isActive }) =>
                          `flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium transition ${
                            isActive
                              ? 'bg-accent/15 text-accent'
                              : 'text-steel hover:bg-fog hover:text-ink'
                          }`
                        }
                      >
                        <item.icon className="size-3.5 shrink-0 opacity-85" />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-xl bg-mist/70 p-0.5 ring-1 ring-line/70">
              <button
                type="button"
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                  anyAlarm
                    ? 'header-sections-alarm'
                    : anyArmed
                      ? 'bg-warn/10 text-warn hover:bg-warn/15'
                      : 'text-steel hover:bg-fog hover:text-ink'
                }`}
                title={vi.headerSectionsHint}
                aria-haspopup="dialog"
                aria-expanded={sectionsOpen}
                onClick={() => {
                  setAccountOpen(false)
                  setStatusOpen(false)
                  setSettingsOpen(false)
                  setSectionsOpen(true)
                }}
              >
                <Rows3 className="size-3.5 shrink-0 opacity-90" />
                <span className="hidden sm:inline">{vi.headerSections}</span>
                <span
                  className={`size-1.5 rounded-full ${
                    anyAlarm ? 'bg-danger animate-pulse' : anyArmed ? 'bg-warn' : 'bg-ok'
                  }`}
                />
              </button>

              <div className="mx-0.5 h-4 w-px bg-line/80" aria-hidden />

              <div ref={statusRef} className="relative">
                <button
                  type="button"
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition ${
                    statusOpen
                      ? 'bg-fog text-ink'
                      : clusterTone === 'danger'
                        ? 'text-danger hover:bg-danger/10'
                        : 'text-steel hover:bg-fog hover:text-ink'
                  }`}
                  aria-expanded={statusOpen}
                  aria-haspopup="listbox"
                  title={vi.connectionStatusCluster}
                  onClick={() => {
                    setAccountOpen(false)
                    setSettingsOpen(false)
                    setStatusOpen((v) => !v)
                  }}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      clusterTone === 'ok'
                        ? `bg-ok${liveActive ? ' animate-pulse' : ''}`
                        : clusterTone === 'danger'
                          ? 'bg-danger'
                          : 'bg-steel'
                    }`}
                  />
                  <span className="hidden max-w-[7.5rem] truncate sm:inline">{clusterSummary}</span>
                  <ChevronDown
                    className={`size-3 opacity-70 transition ${statusOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {statusOpen && (
                  <div
                    role="listbox"
                    aria-label={vi.connectionStatusCluster}
                    className="absolute top-[calc(100%+6px)] right-0 z-50 min-w-[13.5rem] overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-line"
                  >
                    <StatusRow
                      icon={Wifi}
                      label={wsConnected ? vi.wsLive : vi.wsDown}
                      tone={wsConnected ? 'ok' : 'danger'}
                    />
                    <StatusRow
                      icon={Activity}
                      label={liveActive ? vi.realtimeLive : vi.realtimeIdle}
                      tone={liveActive ? 'ok' : 'neutral'}
                      pulse={liveActive}
                    />
                    {mockMode != null && (
                      <StatusRow
                        icon={Usb}
                        label={mockMode ? vi.usbMock : vi.usbHid}
                        tone={mockMode ? 'warn' : 'ok'}
                      />
                    )}
                    {LICENSE_FEATURE_ENABLED && (
                      <StatusRow
                        icon={ShieldCheck}
                        label={full ? vi.licenseFull : vi.licenseReadOnly}
                        tone={full ? 'ok' : 'warn'}
                      />
                    )}
                  </div>
                )}
              </div>

              {session && (
                <>
                  <div className="mx-0.5 hidden h-4 w-px bg-line/80 sm:block" aria-hidden />
                  {canLock && (
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-steel transition hover:bg-fog hover:text-ink"
                      aria-label={vi.lockScreen}
                      title={vi.lockScreen}
                      onClick={() => {
                        setStatusOpen(false)
                        setSettingsOpen(false)
                        setAccountOpen(false)
                        lock()
                      }}
                    >
                      <Lock className="size-3.5 shrink-0 opacity-85" />
                      <span>{vi.lockScreen}</span>
                    </button>
                  )}
                  <div ref={accountRef} className="relative hidden sm:block">
                    <button
                      type="button"
                      className={`inline-flex h-8 max-w-[10.5rem] items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold transition ${
                        accountOpen ? 'bg-fog text-ink' : 'text-steel hover:bg-fog hover:text-ink'
                      }`}
                      aria-expanded={accountOpen}
                      aria-haspopup="menu"
                      aria-label={vi.headerAccount}
                      title={vi.headerAccount}
                      onClick={() => {
                        setStatusOpen(false)
                        setSettingsOpen(false)
                        setAccountOpen((v) => !v)
                      }}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[10px] font-bold text-accent">
                        {accountInitial}
                      </span>
                      <span className="min-w-0 truncate text-ink">{session.userName}</span>
                      <ChevronDown
                        className={`size-3 shrink-0 opacity-70 transition ${accountOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {accountOpen && (
                      <div
                        role="menu"
                        aria-label={vi.headerAccount}
                        className="absolute top-[calc(100%+6px)] right-0 z-50 min-w-[12rem] overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-line"
                      >
                        <div className="px-3 py-2">
                          <p className="truncate text-[12px] font-semibold text-ink">
                            {session.userName}
                          </p>
                          <p className="mt-0.5 text-[10px] font-medium text-steel/70">
                            {session.isAdmin ? vi.loginRoleAdmin : vi.loginRoleUser}
                          </p>
                        </div>
                        <div className="mx-2 border-t border-line/80" />
                        {canLock && (
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-steel transition hover:bg-fog hover:text-ink"
                            onClick={() => {
                              setAccountOpen(false)
                              lock()
                            }}
                          >
                            <Lock className="size-3.5 shrink-0 opacity-85" />
                            {vi.lockScreen}
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-steel transition hover:bg-fog hover:text-ink"
                          onClick={() => {
                            setAccountOpen(false)
                            logout()
                          }}
                        >
                          <LogOut className="size-3.5 shrink-0 opacity-85" />
                          {vi.logout}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg p-2 text-steel ring-1 ring-line transition hover:bg-mist hover:text-ink lg:hidden"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? 'Đóng menu' : 'Mở menu'}
              onClick={() => {
                setAccountOpen(false)
                setStatusOpen(false)
                setSettingsOpen(false)
                setMobileOpen((v) => !v)
              }}
            >
              {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div
            id="mobile-nav"
            className="border-t border-line bg-panel/95 px-3 py-3 backdrop-blur-md lg:hidden"
          >
            <nav className="grid gap-1" aria-label="Menu di động">
              {primaryNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-accent/15 text-accent ring-1 ring-accent/25'
                        : 'text-steel hover:bg-mist hover:text-ink'
                    }`
                  }
                >
                  <item.icon className="size-4 shrink-0 opacity-85" />
                  {item.label}
                </NavLink>
              ))}
              {canSettings && (
                <>
              <p className="mt-2 px-3 pt-1 text-[10px] font-semibold tracking-[0.12em] text-steel/50 uppercase">
                {vi.navSettingsMenu}
              </p>
              {settingsNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-accent/15 text-accent ring-1 ring-accent/25'
                        : 'text-steel hover:bg-mist hover:text-ink'
                    }`
                  }
                >
                  <item.icon className="size-4 shrink-0 opacity-85" />
                  {item.label}
                </NavLink>
              ))}
                </>
              )}
              {session && (
                <>
                {canLock && (
                  <button
                    type="button"
                    className="mt-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-steel hover:bg-mist hover:text-ink"
                    onClick={() => {
                      setMobileOpen(false)
                      lock()
                    }}
                  >
                    <Lock className="size-4 shrink-0 opacity-85" />
                    {vi.lockScreen}
                  </button>
                )}
                <button
                  type="button"
                  className="mt-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-steel hover:bg-mist hover:text-ink"
                  onClick={() => {
                    setMobileOpen(false)
                    logout()
                  }}
                >
                  <LogOut className="size-4 shrink-0 opacity-85" />
                  {vi.logout} · {session.userName}
                </button>
                </>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {!canSettings && pathInSettings(location.pathname) ? <Navigate to="/" replace /> : <Outlet />}
      </main>

      <SectionsQuickModal
        open={sectionsOpen}
        panels={panels}
        devices={devices}
        writeAllowed={writeAllowed}
        mockMode={mockMode}
        eventSeq={eventSeq}
        onClose={() => setSectionsOpen(false)}
        onRefresh={onRefresh ?? (async () => {})}
      />
    </div>
  )
}

function StatusRow({
  icon: Icon,
  label,
  tone,
  pulse = false,
}: {
  icon: typeof Wifi
  label: string
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  pulse?: boolean
}) {
  const dot =
    tone === 'ok'
      ? 'bg-ok'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'danger'
          ? 'bg-danger'
          : 'bg-steel/50'
  const text =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-steel'

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold ${text}`}>
      <Icon className="size-3.5 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`size-1.5 shrink-0 rounded-full ${dot}${pulse ? ' animate-pulse' : ''}`} />
    </div>
  )
}
