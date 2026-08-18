import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Loader2, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listCameras,
  listZones,
  testAutomationRule,
  updateAutomationRule,
  type AutomationIfType,
  type AutomationRule,
  type AutomationRuleWrite,
  type AutomationThenType,
  type Camera as CameraRow,
  type Device,
  type FloorMap,
  type Panel,
  type Zone,
} from '../api/client'
import { Btn, Card, Field, PageHeader, inputClass } from '../components/ui'
import { vi } from '../i18n/vi'

type Props = {
  devices: Device[]
  panels: Panel[]
  maps: FloorMap[]
  writeAllowed: boolean
}

const IF_OPTIONS: { id: AutomationIfType; label: string }[] = [
  { id: 'armed_alarm', label: vi.autoIfArmedAlarm },
  { id: 'device_alarm', label: vi.autoIfDeviceAlarm },
  { id: 'device_open', label: vi.autoIfOpen },
  { id: 'tamper', label: vi.autoIfTamper },
  { id: 'loss', label: vi.autoIfLoss },
  { id: 'device_fault', label: vi.autoIfFault },
  { id: 'section_armed', label: vi.autoIfArmed },
  { id: 'section_disarmed', label: vi.autoIfDisarmed },
  { id: 'panel_armed', label: vi.autoIfPanelArmed },
  { id: 'panel_disarmed', label: vi.autoIfPanelDisarmed },
  { id: 'keypad_alarm', label: vi.autoIfKeypad },
]

const THEN_OPTIONS: { id: AutomationThenType; label: string }[] = [
  { id: 'camera_snapshot', label: vi.autoThenSnapshot },
  { id: 'notify', label: vi.autoThenNotify },
]

type FormState = {
  name: string
  enabled: boolean
  if_type: AutomationIfType
  if_panel_id: string
  if_device_id: string
  if_zone_id: string
  if_floor_id: string
  then_type: AutomationThenType
  then_camera_id: string
  cooldown_sec: string
  if_require_armed: boolean
}

const emptyForm = (): FormState => ({
  name: '',
  enabled: true,
  if_type: 'armed_alarm',
  if_panel_id: '',
  if_device_id: '',
  if_zone_id: '',
  if_floor_id: '',
  then_type: 'camera_snapshot',
  then_camera_id: '',
  cooldown_sec: '30',
  if_require_armed: false,
})

function isDeviceIf(t: string) {
  return (
    t === 'armed_alarm' ||
    t === 'device_alarm' ||
    t === 'device_open' ||
    t === 'tamper' ||
    t === 'loss' ||
    t === 'device_fault'
  )
}

function isZoneIf(t: string) {
  return t === 'section_armed' || t === 'section_disarmed' || t === 'keypad_alarm' || isDeviceIf(t)
}

function ifLabel(t: string) {
  return IF_OPTIONS.find((o) => o.id === t)?.label ?? t
}

function thenLabel(t: string) {
  return THEN_OPTIONS.find((o) => o.id === t)?.label ?? t
}

function deviceLabel(devices: Device[], id: string | null) {
  if (!id) return vi.autoAnyDevice
  const d = devices.find((x) => x.global_id === id)
  return d ? `${d.label || d.global_id}` : id
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return vi.autoNever
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('vi-VN')
}

function toWrite(form: FormState): AutomationRuleWrite {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    if_type: form.if_type,
    if_panel_id: form.if_panel_id || null,
    if_device_id: isDeviceIf(form.if_type) ? form.if_device_id || null : null,
    if_zone_id: isZoneIf(form.if_type) ? form.if_zone_id || null : null,
    if_floor_id: isDeviceIf(form.if_type) && form.if_floor_id ? Number(form.if_floor_id) : null,
    if_require_armed: isDeviceIf(form.if_type) && form.if_type !== 'armed_alarm' ? form.if_require_armed : false,
    then_type: form.then_type,
    then_camera_id: form.then_type === 'camera_snapshot' ? form.then_camera_id || null : null,
    cooldown_sec: Math.max(5, Number(form.cooldown_sec) || 30),
  }
}

export function AutomationPage({ devices, panels, maps, writeAllowed }: Props) {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [cameras, setCameras] = useState<CameraRow[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AutomationRule | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  async function reload() {
    setBusy(true)
    setError(null)
    try {
      const [ruleRows, camRows] = await Promise.all([listAutomationRules(), listCameras()])
      setRules(ruleRows)
      setCameras(camRows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all(panels.map((p) => listZones(p.panel_id).catch(() => [] as Zone[]))).then((groups) => {
      if (!cancelled) setZones(groups.flat())
    })
    return () => {
      cancelled = true
    }
  }, [panels])

  const deviceIf = isDeviceIf(form.if_type)
  const filteredDevices = useMemo(() => {
    if (!form.if_panel_id) return devices
    return devices.filter((d) => d.panel_id === form.if_panel_id)
  }, [devices, form.if_panel_id])
  const filteredZones = useMemo(() => {
    if (!form.if_panel_id) return zones
    return zones.filter((z) => z.panel_id === form.if_panel_id)
  }, [zones, form.if_panel_id])

  function openCreate() {
    const next = emptyForm()
    if (cameras[0]) next.then_camera_id = cameras[0].id
    setEditing(null)
    setForm(next)
    setFormOpen(true)
  }

  function openEdit(rule: AutomationRule) {
    setEditing(rule)
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      if_type: (IF_OPTIONS.some((o) => o.id === rule.if_type) ? rule.if_type : 'device_alarm') as AutomationIfType,
      if_panel_id: rule.if_panel_id || '',
      if_device_id: rule.if_device_id || '',
      if_zone_id: rule.if_zone_id || '',
      if_floor_id: rule.if_floor_id != null ? String(rule.if_floor_id) : '',
      then_type: (rule.then_type === 'notify' ? 'notify' : 'camera_snapshot') as AutomationThenType,
      then_camera_id: rule.then_camera_id || '',
      cooldown_sec: String(rule.cooldown_sec || 30),
      if_require_armed: Boolean(rule.if_require_armed),
    })
    setFormOpen(true)
  }

  async function onSave() {
    const body = toWrite(form)
    if (body.then_type === 'camera_snapshot' && !body.then_camera_id) {
      setError(vi.autoNeedCamera)
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) await updateAutomationRule(editing.id, body)
      else await createAutomationRule(body)
      setFormOpen(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(rule: AutomationRule) {
    if (!window.confirm(vi.autoDeleteConfirm(rule.name))) return
    try {
      await deleteAutomationRule(rule.id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onTest(rule: AutomationRule) {
    setTestingId(rule.id)
    setError(null)
    try {
      const result = await testAutomationRule(rule.id)
      if (result.ok === false) setError(result.detail || vi.failed)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader
        title={vi.navAutomation}
        hint={vi.autoPageHint}
        actions={
          writeAllowed ? (
            <Btn type="button" onClick={openCreate}>
              <Plus className="size-3.5" />
              {vi.autoAdd}
            </Btn>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <p className="text-sm leading-relaxed text-steel/80">{vi.autoIntro}</p>
      </Card>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {rules.length === 0 ? (
        <Card>
          <p className="text-sm text-steel/70">{busy ? vi.cameraLoading : vi.autoEmpty}</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rules.map((rule) => (
            <Card key={rule.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{rule.name}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      rule.enabled ? 'bg-ok/15 text-ok' : 'bg-mist text-steel'
                    }`}
                  >
                    {rule.enabled ? vi.autoEnabled : vi.cameraActiveOff}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-steel/70">
                  <span>{ifLabel(rule.if_type)}</span>
                  <ArrowRight className="size-3 opacity-60" />
                  <span>{thenLabel(rule.then_type)}</span>
                  {rule.then_camera_name ? <span>· {rule.then_camera_name}</span> : null}
                  <span>· {deviceLabel(devices, rule.if_device_id)}</span>
                  <span>· {rule.cooldown_sec}s</span>
                </p>
                <p className="mt-1 text-[11px] text-steel/50">
                  {vi.autoLastFire}: {formatTs(rule.last_fired_at)}
                  {rule.fire_count ? ` · ${rule.fire_count} lần` : ''}
                </p>
                {rule.last_error && <p className="mt-1 text-[11px] text-danger/80">{rule.last_error}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  type="button"
                  tone="ghost"
                  disabled={!writeAllowed || testingId === rule.id}
                  onClick={() => void onTest(rule)}
                >
                  {testingId === rule.id ? <Loader2 className="size-3.5 animate-spin" /> : <Workflow className="size-3.5" />}
                  {vi.autoTest}
                </Btn>
                <Btn type="button" tone="ghost" disabled={!writeAllowed} onClick={() => openEdit(rule)}>
                  <Pencil className="size-3.5" />
                  {vi.cameraEdit}
                </Btn>
                <Btn type="button" tone="danger" disabled={!writeAllowed} onClick={() => void onDelete(rule)}>
                  <Trash2 className="size-3.5" />
                  {vi.cameraDelete}
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => {
            if (!saving) setFormOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-xl bg-panel p-4 shadow-xl ring-1 ring-line"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink">{editing ? vi.autoEditTitle : vi.autoAddTitle}</h3>
            {cameras.length === 0 && (
              <p className="mt-2 text-sm text-warn">{vi.autoNoCamera}</p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={vi.autoName}>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={vi.autoNamePh}
                  />
                </Field>
              </div>
              <Field label={vi.autoIf}>
                <select
                  className={inputClass}
                  value={form.if_type}
                  onChange={(e) => setForm((f) => ({ ...f, if_type: e.target.value as AutomationIfType }))}
                >
                  {IF_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={vi.autoThen}>
                <select
                  className={inputClass}
                  value={form.then_type}
                  onChange={(e) => setForm((f) => ({ ...f, then_type: e.target.value as AutomationThenType }))}
                >
                  {THEN_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={vi.autoPanel}>
                <select
                  className={inputClass}
                  value={form.if_panel_id}
                  onChange={(e) => setForm((f) => ({ ...f, if_panel_id: e.target.value, if_device_id: '', if_zone_id: '' }))}
                >
                  <option value="">{vi.autoAnyPanel}</option>
                  {panels.map((p) => (
                    <option key={p.panel_id} value={p.panel_id}>
                      {p.display_name || p.panel_id}
                    </option>
                  ))}
                </select>
              </Field>
              {deviceIf && (
                <>
                  <Field label={vi.autoDevice}>
                    <select
                      className={inputClass}
                      value={form.if_device_id}
                      onChange={(e) => setForm((f) => ({ ...f, if_device_id: e.target.value }))}
                    >
                      <option value="">{vi.autoAnyDevice}</option>
                      {filteredDevices.map((d) => (
                        <option key={d.global_id} value={d.global_id}>
                          {d.label || d.global_id}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={vi.cameraFloor}>
                    <select
                      className={inputClass}
                      value={form.if_floor_id}
                      onChange={(e) => setForm((f) => ({ ...f, if_floor_id: e.target.value }))}
                    >
                      <option value="">{vi.autoAnyFloor}</option>
                      {maps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {isZoneIf(form.if_type) && (
                <Field label={vi.autoZone}>
                  <select
                    className={inputClass}
                    value={form.if_zone_id}
                    onChange={(e) => setForm((f) => ({ ...f, if_zone_id: e.target.value }))}
                  >
                    <option value="">{vi.autoAnyZone}</option>
                    {filteredZones.map((z) => (
                      <option key={z.zone_id} value={z.zone_id}>
                        {z.section_num ? `${z.section_num}: ${z.name || z.zone_id}` : z.name || z.zone_id}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {deviceIf && form.if_type !== 'armed_alarm' && (
                <div className="sm:col-span-2">
                  <label className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form.if_require_armed}
                      onChange={(e) => setForm((f) => ({ ...f, if_require_armed: e.target.checked }))}
                    />
                    <span>
                      {vi.autoRequireArmed}
                      <span className="mt-0.5 block text-xs text-steel/60">{vi.autoRequireArmedHint}</span>
                    </span>
                  </label>
                </div>
              )}
              {form.then_type === 'camera_snapshot' && (
                <Field label={vi.autoCamera}>
                  <select
                    className={inputClass}
                    value={form.then_camera_id}
                    onChange={(e) => setForm((f) => ({ ...f, then_camera_id: e.target.value }))}
                  >
                    <option value="">{vi.autoPickCamera}</option>
                    {cameras.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={vi.autoCooldown}>
                <input
                  className={inputClass}
                  type="number"
                  min={5}
                  max={3600}
                  value={form.cooldown_sec}
                  onChange={(e) => setForm((f) => ({ ...f, cooldown_sec: e.target.value }))}
                />
              </Field>
              <Field label={vi.autoEnabled}>
                <select
                  className={inputClass}
                  value={form.enabled ? '1' : '0'}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.value === '1' }))}
                >
                  <option value="1">{vi.cameraActiveOn}</option>
                  <option value="0">{vi.cameraActiveOff}</option>
                </select>
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Btn type="button" tone="ghost" disabled={saving} onClick={() => setFormOpen(false)}>
                {vi.cameraCancel}
              </Btn>
              <Btn type="button" disabled={saving || !writeAllowed} onClick={() => void onSave()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {vi.autoSave}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
