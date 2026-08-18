import { useEffect, useState } from 'react'
import { LicensePanel } from '../components/LicensePanel'
import { Btn, Card, PageHeader } from '../components/ui'
import type { LicenseStatus } from '../api/client'
import { vi } from '../i18n/vi'
import {
  ensureAlarmNotifyPermission,
  isAlarmDesktopNotifyEnabled,
  setAlarmDesktopNotifyEnabled,
} from '../lib/alarmBrowserAlert'

type Props = {
  license: LicenseStatus | null
  onChanged: () => Promise<void>
}

export function SettingsPage({ license, onChanged }: Props) {
  const [notifyOn, setNotifyOn] = useState(isAlarmDesktopNotifyEnabled)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPerm('unsupported')
      return
    }
    setPerm(Notification.permission)
  }, [])

  const enableNotify = async () => {
    setAlarmDesktopNotifyEnabled(true)
    setNotifyOn(true)
    const next = await ensureAlarmNotifyPermission()
    setPerm(next)
  }

  const disableNotify = () => {
    setAlarmDesktopNotifyEnabled(false)
    setNotifyOn(false)
  }

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader title={vi.navSettings} hint={vi.licenseTitle} />
      <LicensePanel license={license} onChanged={onChanged} />
      <Card className="mt-4">
        <p className="text-sm text-steel/70">
          Hệ thống chạy offline. Xuất file <code className="text-accent">.req</code>, gửi Admin
          ký, rồi nhập <code className="text-accent">.lic</code> để mở khóa điều khiển Arm/Disarm
          và khai báo thiết bị / bản đồ.
        </p>
      </Card>

      <Card className="mt-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{vi.alarmDesktopNotifyTitle}</h2>
          <p className="mt-1 text-sm text-steel/70">{vi.alarmDesktopNotifyHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notifyOn && perm === 'granted' ? (
            <Btn type="button" tone="ghost" onClick={disableNotify}>
              {vi.alarmDesktopNotifyDisable}
            </Btn>
          ) : (
            <Btn type="button" onClick={() => void enableNotify()}>
              {vi.alarmDesktopNotifyEnable}
            </Btn>
          )}
          <span className="text-xs text-steel/60">
            {perm === 'granted'
              ? vi.alarmDesktopNotifyGranted
              : perm === 'denied'
                ? vi.alarmDesktopNotifyDenied
                : perm === 'unsupported'
                  ? vi.alarmDesktopNotifyUnsupported
                  : vi.alarmDesktopNotifyDefault}
          </span>
        </div>
      </Card>
    </div>
  )
}
