import { useEffect, useState } from 'react'
import { Download, Radar } from 'lucide-react'
import {
  importPanelConfig,
  probePanelConfig,
  type Panel,
  type PanelImportConfigResult,
} from '../api/client'
import { formatCommandError, vi } from '../i18n/vi'
import { Btn, Card, Field, inputClass } from './ui'

type Props = {
  panels: Panel[]
  selectedPanelId?: string
  writeAllowed: boolean
  busy?: boolean
  onBusy?: (busy: boolean) => void
  onError?: (msg: string | null) => void
  onInfo?: (msg: string | null) => void
  onDone?: () => Promise<void> | void
  className?: string
}

export function ImportPanelConfigCard({
  panels,
  selectedPanelId,
  writeAllowed,
  busy = false,
  onBusy,
  onError,
  onInfo,
  onDone,
  className = 'mb-4',
}: Props) {
  const defaultPanelId =
    selectedPanelId ||
    panels.find((p) => p.connection === 'usb')?.panel_id ||
    panels[0]?.panel_id ||
    ''

  const [panelId, setPanelId] = useState(defaultPanelId)
  const [sectionCount, setSectionCount] = useState('1')
  const [deviceCount, setDeviceCount] = useState('12')
  const [userCount, setUserCount] = useState('5')
  const [pgCount, setPgCount] = useState('8')
  const [localBusy, setLocalBusy] = useState(false)

  useEffect(() => {
    if (selectedPanelId) setPanelId(selectedPanelId)
    else if (!panelId && defaultPanelId) setPanelId(defaultPanelId)
  }, [selectedPanelId, defaultPanelId, panelId])

  const activeBusy = busy || localBusy
  const panel = panels.find((p) => p.panel_id === panelId)
  const canProbe = panel?.connection === 'usb' || panel?.connection === 'mock'

  function setBusy(v: boolean) {
    setLocalBusy(v)
    onBusy?.(v)
  }

  function parseCount(raw: string): number | null {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.floor(n)
  }

  async function handleProbe() {
    if (!panelId) return
    setBusy(true)
    onError?.(null)
    try {
      const hint = await probePanelConfig(panelId)
      if (hint.section_count_hint != null) setSectionCount(String(hint.section_count_hint))
      if (hint.device_count_hint != null) setDeviceCount(String(hint.device_count_hint))
      if (hint.pg_count_hint != null) setPgCount(String(hint.pg_count_hint))
      onInfo?.(vi.importPanelConfigProbeOk)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onError?.(formatCommandError(msg))
    } finally {
      setBusy(false)
    }
  }

  async function handleImport() {
    if (!panelId) return
    const sections = parseCount(sectionCount)
    const devices = parseCount(deviceCount)
    const users = parseCount(userCount)
    const pgs = parseCount(pgCount)
    if (sections == null || sections < 1 || devices == null || users == null || pgs == null) {
      onError?.('Số liệu nhập không hợp lệ.')
      return
    }

    setBusy(true)
    onError?.(null)
    try {
      const result: PanelImportConfigResult = await importPanelConfig(panelId, {
        section_count: sections,
        device_count: devices,
        user_count: users,
        pg_count: pgs,
      })
      onInfo?.(
        vi.importPanelConfigOk(
          result.sections_created,
          result.devices_created,
          result.users_created,
          result.pgs_created,
        ),
      )
      await onDone?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onError?.(formatCommandError(msg))
    } finally {
      setBusy(false)
    }
  }

  if (!panels.length) return null

  return (
    <Card className={className}>
      <h3 className="mb-1 text-sm font-semibold">{vi.importPanelConfig}</h3>
      <p className="mb-3 text-xs text-steel/70">{vi.importPanelConfigHint}</p>
      <div className="flex flex-wrap items-end gap-3">
        {!selectedPanelId && panels.length > 1 && (
          <Field label={vi.importSelectPanel}>
            <select
              className={inputClass}
              value={panelId}
              disabled={activeBusy}
              onChange={(e) => setPanelId(e.target.value)}
            >
              {panels.map((p) => (
                <option key={p.panel_id} value={p.panel_id}>
                  {p.display_name || p.panel_id}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={vi.importSectionCount}>
          <input
            className={inputClass}
            type="number"
            min={1}
            max={32}
            value={sectionCount}
            disabled={activeBusy}
            onChange={(e) => setSectionCount(e.target.value)}
          />
        </Field>
        <Field label={vi.importDeviceCount}>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={99}
            value={deviceCount}
            disabled={activeBusy}
            onChange={(e) => setDeviceCount(e.target.value)}
          />
        </Field>
        <Field label={vi.importUserCount}>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={300}
            value={userCount}
            disabled={activeBusy}
            onChange={(e) => setUserCount(e.target.value)}
          />
        </Field>
        <Field label={vi.importPgCount}>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={128}
            value={pgCount}
            disabled={activeBusy}
            onChange={(e) => setPgCount(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Btn tone="ghost" disabled={!writeAllowed || activeBusy || !canProbe} onClick={() => void handleProbe()}>
            <Radar className="size-3.5" /> {vi.importPanelConfigProbe}
          </Btn>
          <Btn disabled={!writeAllowed || activeBusy || !panelId} onClick={() => void handleImport()}>
            <Download className="size-3.5" /> {vi.importPanelConfigRun}
          </Btn>
        </div>
      </div>
    </Card>
  )
}
