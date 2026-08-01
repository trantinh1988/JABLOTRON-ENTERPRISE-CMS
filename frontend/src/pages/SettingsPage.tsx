import { LicensePanel } from '../components/LicensePanel'
import { Card, PageHeader } from '../components/ui'
import type { LicenseStatus } from '../api/client'
import { vi } from '../i18n/vi'

type Props = {
  license: LicenseStatus | null
  onChanged: () => Promise<void>
}

export function SettingsPage({ license, onChanged }: Props) {
  return (
    <div className="mx-auto max-w-[720px] px-5 py-5">
      <PageHeader title={vi.navSettings} hint={vi.licenseTitle} />
      <LicensePanel license={license} onChanged={onChanged} />
      <Card className="mt-4">
        <p className="text-sm text-steel/70">
          Hệ thống chạy offline. Xuất file <code className="text-accent">.req</code>, gửi Admin
          ký, rồi nhập <code className="text-accent">.lic</code> để mở khóa điều khiển Arm/Disarm
          và khai báo thiết bị / bản đồ.
        </p>
      </Card>
    </div>
  )
}
