import { NavLink, Outlet } from 'react-router-dom'
import {
  History,
  LayoutDashboard,
  List,
  Map as MapIcon,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import type { LicenseStatus } from '../api/client'
import { LICENSE_FEATURE_ENABLED } from '../config/features'
import { vi } from '../i18n/vi'

type Props = {
  license: LicenseStatus | null
  wsConnected: boolean
  liveActive?: boolean
  mockMode: boolean | null
}

const nav = [
  { to: '/', end: true, label: vi.navDashboard, icon: LayoutDashboard },
  { to: '/devices', label: vi.navDevices, icon: Radio },
  { to: '/status', label: vi.navStatus, icon: List },
  { to: '/maps', label: vi.navMaps, icon: MapIcon },
  { to: '/history', label: vi.navHistory, icon: History },
  ...(LICENSE_FEATURE_ENABLED
    ? [{ to: '/settings', label: vi.navSettings, icon: ShieldCheck }]
    : []),
]

export function AppShell({ license, wsConnected, liveActive = false, mockMode }: Props) {
  const mode = license?.mode ?? 'read-only'
  const full = mode === 'full'

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-panel/90 px-3 py-4 backdrop-blur-md">
        <div className="mb-6 px-2">
          <p className="font-mono text-[10px] tracking-[0.14em] text-steel/70 uppercase">
            {vi.brandSubtitle}
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink">
            {vi.brandTitle} <span className="text-accent">{vi.brandAccent}</span>
          </h1>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-steel hover:bg-mist/80 hover:text-ink'
                }`
              }
            >
              <item.icon className="size-4 shrink-0 opacity-80" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 space-y-1.5 border-t border-line pt-3">
          <Chip label={wsConnected ? vi.wsLive : vi.wsDown} tone={wsConnected ? 'ok' : 'danger'} />
          <Chip
            label={liveActive ? vi.realtimeLive : vi.realtimeIdle}
            tone={liveActive ? 'ok' : 'neutral'}
            pulse={liveActive}
          />
          {LICENSE_FEATURE_ENABLED && (
            <Chip label={full ? vi.licenseFull : vi.licenseReadOnly} tone={full ? 'ok' : 'warn'} />
          )}
          {mockMode != null && (
            <Chip label={mockMode ? vi.usbMock : vi.usbHid} tone="neutral" />
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

function Chip({
  label,
  tone,
  pulse = false,
}: {
  label: string
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  pulse?: boolean
}) {
  const styles = {
    ok: 'bg-ok/10 text-ok ring-ok/20',
    warn: 'bg-warn/10 text-warn ring-warn/25',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    neutral: 'bg-steel/10 text-steel ring-steel/15',
  }[tone]

  return (
    <span
      className={`inline-flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] font-medium ring-1 ${styles}`}
    >
      <span
        className={`size-1.5 rounded-full ${
          tone === 'ok'
            ? 'bg-ok'
            : tone === 'warn'
              ? 'bg-warn'
              : tone === 'danger'
                ? 'bg-danger'
                : 'bg-steel/50'
        } ${pulse ? 'animate-pulse' : ''}`}
      />
      {label}
    </span>
  )
}
