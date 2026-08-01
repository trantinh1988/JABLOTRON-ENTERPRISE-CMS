import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Server, Settings2, Trash2 } from 'lucide-react'
import {
  createDevice,
  createDevicesBulk,
  createPanel,
  deleteDevice,
  deleteDevicesBulk,
  deletePanel,
  updateDevice,
  updatePanel,
  type Device,
  type Panel,
} from '../api/client'
import { DeviceTypeIcon } from '../components/DeviceTypeIcon'
import { Btn, Card, Field, PageHeader, StateDot, inputClass } from '../components/ui'
import {
  connectionLabel,
  deviceStateLabel,
  deviceTypeLabel,
  labelOf,
  vi,
} from '../i18n/vi'

type Props = {
  panels: Panel[]
  devices: Device[]
  writeAllowed: boolean
  mockMode: boolean | null
  usbHint: string | null
  onRefresh: () => Promise<void>
}

const TYPES = Object.keys(deviceTypeLabel)

type FormMode = 'device' | 'panel' | null

export function DevicesPage({ panels, devices, writeAllowed, mockMode, usbHint, onRefresh }: Props) {
  const [editing, setEditing] = useState<Device | null>(null)
  const [editingPanel, setEditingPanel] = useState<Panel | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [bulk, setBulk] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filterPanel, setFilterPanel] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = useMemo(
    () => (filterPanel ? devices.filter((d) => d.panel_id === filterPanel) : devices),
    [devices, filterPanel],
  )

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((d) => selected.has(d.global_id))

  const nextPanelIndex = useMemo(() => {
    const used = new Set<number>()
    for (const p of panels) {
      const m = /^PANEL_(\d+)$/i.exec(p.panel_id)
      if (m) used.add(Number(m[1]))
    }
    let n = 1
    while (used.has(n)) n += 1
    return n
  }, [panels])

  function clearMessages() {
    setInfo(null)
    setError(null)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const d of filtered) next.delete(d.global_id)
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const d of filtered) next.add(d.global_id)
        return next
      })
    }
  }

  async function handleCreatePanel(form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      await createPanel({
        panel_index: Number(form.get('panel_index')),
        display_name: String(form.get('display_name') || ''),
      })
      setFormMode(null)
      setInfo(vi.panelDeclared)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdatePanel(panelId: string, form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      await updatePanel(panelId, String(form.get('display_name') || ''))
      setEditingPanel(null)
      setInfo(vi.panelUpdated)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDeletePanel(p: Panel) {
    if (!window.confirm(vi.confirmDeletePanel(p.display_name || p.panel_id, p.device_count))) return
    setBusy(true)
    clearMessages()
    try {
      await deletePanel(p.panel_id)
      if (filterPanel === p.panel_id) setFilterPanel('')
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of prev) {
          if (id.startsWith(`${p.panel_id}_`)) next.delete(id)
        }
        return next
      })
      setInfo(vi.panelDeleted)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      const panel_id = String(form.get('panel_id'))
      const device_type = String(form.get('device_type') || 'sensor')
      if (bulk) {
        const from_num = Number(form.get('from_num'))
        const to_num = Number(form.get('to_num'))
        if (to_num < from_num) throw new Error('Đến địa chỉ phải ≥ Từ địa chỉ')
        const result = await createDevicesBulk({
          panel_id,
          from_num,
          to_num,
          device_type,
          label_prefix: String(form.get('label_prefix') || ''),
        })
        setInfo(vi.bulkResult(result.created_count, result.skipped_count))
      } else {
        await createDevice({
          panel_id,
          device_num: Number(form.get('device_num')),
          device_type,
          label: String(form.get('label') || ''),
        })
      }
      setFormMode(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdate(globalId: string, form: FormData) {
    setBusy(true)
    clearMessages()
    try {
      await updateDevice(globalId, {
        device_type: String(form.get('device_type') || 'sensor'),
        label: String(form.get('label') || ''),
      })
      setEditing(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(d: Device) {
    if (!window.confirm(vi.confirmDeleteDevice(d.global_id))) return
    setBusy(true)
    clearMessages()
    try {
      await deleteDevice(d.global_id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(d.global_id)
        return next
      })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSelected() {
    const ids = [...selected]
    if (!ids.length) return
    if (!window.confirm(vi.confirmDeleteDevices(ids.length))) return
    setBusy(true)
    clearMessages()
    try {
      const result = await deleteDevicesBulk(ids)
      setSelected(new Set())
      setInfo(vi.deleteResult(result.deleted_count))
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const creating = formMode === 'device'
  const creatingPanel = formMode === 'panel'

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-5">
      <PageHeader
        title={vi.devicesPageTitle}
        hint={vi.devicesPageHint}
        actions={
          <div className="flex flex-wrap gap-2">
            <Btn
              tone="ghost"
              disabled={!writeAllowed}
              onClick={() => {
                setFormMode('panel')
                setEditingPanel(null)
                setEditing(null)
                clearMessages()
              }}
            >
              <Server className="size-3.5" /> {vi.addPanel}
            </Btn>
            <Btn
              disabled={!writeAllowed}
              onClick={() => {
                setFormMode('device')
                setEditing(null)
                setEditingPanel(null)
                setBulk(true)
                clearMessages()
              }}
            >
              <Plus className="size-3.5" /> {vi.addDevice}
            </Btn>
          </div>
        }
      />

      {!writeAllowed && (
        <p className="mb-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">{vi.readOnlyHint}</p>
      )}
      {mockMode === false && usbHint && panels.every((p) => p.connection !== 'usb') && (
        <div className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs text-warn">
          <p className="font-semibold">{vi.usbConnectTitle}</p>
          <p className="mt-1 text-warn/90">{usbHint}</p>
          <p className="mt-2 font-mono text-[10px] text-warn/80">{vi.usbConnectSteps}</p>
        </div>
      )}
      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {info && <p className="mb-3 rounded-md bg-ok/10 px-3 py-2 text-xs text-ok">{info}</p>}

      {(creatingPanel || editingPanel) && (
        <Card className="mb-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editingPanel ? vi.editPanel : vi.addPanel}
          </h3>
          {!editingPanel && (
            <p className="mb-3 text-xs text-steel/70">
              Tủ có thể tự xuất hiện khi cắm USB, hoặc khai báo thủ công tại đây trước khi gắn cảm
              biến.
            </p>
          )}
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              if (editingPanel) void handleUpdatePanel(editingPanel.panel_id, form)
              else void handleCreatePanel(form)
            }}
          >
            {!editingPanel && (
              <Field label={vi.panelIndex}>
                <input
                  name="panel_index"
                  type="number"
                  min={1}
                  max={999}
                  required
                  className={inputClass}
                  defaultValue={nextPanelIndex}
                />
              </Field>
            )}
            {editingPanel && (
              <Field label="ID">
                <input className={inputClass} value={editingPanel.panel_id} disabled readOnly />
              </Field>
            )}
            <Field label={vi.panelName}>
              <input
                name="display_name"
                className={inputClass}
                placeholder={`Tủ Jablotron ${nextPanelIndex}`}
                defaultValue={
                  editingPanel?.display_name ?? `Tủ Jablotron ${nextPanelIndex}`
                }
                required
              />
            </Field>
            <div className="flex items-end gap-2">
              <Btn type="submit" disabled={busy || !writeAllowed}>
                {vi.save}
              </Btn>
              <Btn
                tone="ghost"
                onClick={() => {
                  setFormMode(null)
                  setEditingPanel(null)
                }}
              >
                {vi.cancel}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <Card className="mb-4 overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
          {vi.panelsSection}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line bg-mist/50 font-mono text-[11px] text-steel/70">
              <tr>
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">{vi.panelName}</th>
                <th className="px-4 py-2.5 font-medium">Kết nối</th>
                <th className="px-4 py-2.5 font-medium">Số TB</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {panels.map((p) => (
                <tr key={p.panel_id} className="border-b border-line/60 hover:bg-mist/30">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-accent">{p.panel_id}</td>
                  <td className="px-4 py-2.5">{p.display_name}</td>
                  <td className="px-4 py-2.5 text-steel">
                    {labelOf(connectionLabel, p.connection)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-steel">{p.device_count}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Link
                        to={`/panels/${encodeURIComponent(p.panel_id)}`}
                        className="rounded p-1.5 text-steel hover:bg-mist hover:text-accent"
                        title={vi.panelSetup}
                      >
                        <Settings2 className="size-3.5" />
                      </Link>
                      <button
                        type="button"
                        disabled={!writeAllowed}
                        className="rounded p-1.5 text-steel hover:bg-mist hover:text-ink disabled:opacity-40"
                        onClick={() => {
                          setEditingPanel(p)
                          setFormMode(null)
                          setEditing(null)
                          clearMessages()
                        }}
                        title={vi.editPanel}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!writeAllowed || busy}
                        className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger disabled:opacity-40"
                        onClick={() => void handleDeletePanel(p)}
                        title={vi.deletePanel}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!panels.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-steel/50">
                    {vi.noPanels}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {(creating || editing) && (
        <Card className="mb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {creating ? vi.addDevice : vi.editDevice}
            </h3>
            {creating && (
              <div className="flex gap-1 rounded-md border border-line bg-mist/40 p-0.5 text-xs">
                <button
                  type="button"
                  className={`rounded px-2.5 py-1 ${bulk ? 'bg-panel text-ink shadow-sm' : 'text-steel'}`}
                  onClick={() => setBulk(true)}
                >
                  {vi.bulkMode}
                </button>
                <button
                  type="button"
                  className={`rounded px-2.5 py-1 ${!bulk ? 'bg-panel text-ink shadow-sm' : 'text-steel'}`}
                  onClick={() => setBulk(false)}
                >
                  {vi.singleMode}
                </button>
              </div>
            )}
          </div>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault()
              const form = new FormData(e.currentTarget)
              if (creating) void handleCreate(form)
              else if (editing) void handleUpdate(editing.global_id, form)
            }}
          >
            {creating && (
              <>
                <Field label={vi.panel}>
                  <select
                    name="panel_id"
                    required
                    className={inputClass}
                    defaultValue={filterPanel || panels[0]?.panel_id}
                    disabled={!panels.length}
                  >
                    {panels.map((p) => (
                      <option key={p.panel_id} value={p.panel_id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
                {bulk ? (
                  <>
                    <Field label={vi.deviceFrom}>
                      <input
                        name="from_num"
                        type="number"
                        min={0}
                        max={99}
                        required
                        className={inputClass}
                        defaultValue={1}
                      />
                    </Field>
                    <Field label={vi.deviceTo}>
                      <input
                        name="to_num"
                        type="number"
                        min={0}
                        max={99}
                        required
                        className={inputClass}
                        defaultValue={80}
                      />
                    </Field>
                    <Field label={vi.labelPrefix}>
                      <input
                        name="label_prefix"
                        className={inputClass}
                        placeholder="VD: Địa chỉ"
                        defaultValue="Địa chỉ"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={vi.deviceNum}>
                      <input
                        name="device_num"
                        type="number"
                        min={0}
                        max={99}
                        required
                        className={inputClass}
                        defaultValue={1}
                      />
                    </Field>
                    <Field label={vi.label}>
                      <input name="label" className={inputClass} placeholder="VD: Cửa chính" />
                    </Field>
                  </>
                )}
              </>
            )}
            {!creating && (
              <Field label={vi.label}>
                <input
                  name="label"
                  className={inputClass}
                  defaultValue={editing?.label ?? ''}
                  placeholder="VD: Cửa chính"
                />
              </Field>
            )}
            <Field label={vi.deviceType}>
              <select
                name="device_type"
                className={inputClass}
                defaultValue={editing?.device_type ?? 'sensor'}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {deviceTypeLabel[t]}
                  </option>
                ))}
              </select>
            </Field>
            {!panels.length && creating && (
              <p className="sm:col-span-2 lg:col-span-4 text-xs text-warn">{vi.noPanelsHint}</p>
            )}
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <Btn type="submit" disabled={busy || !writeAllowed || (creating && !panels.length)}>
                {vi.save}
              </Btn>
              <Btn
                tone="ghost"
                onClick={() => {
                  setFormMode(null)
                  setEditing(null)
                }}
              >
                {vi.cancel}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={`${inputClass} w-auto min-w-[180px]`}
          value={filterPanel}
          onChange={(e) => setFilterPanel(e.target.value)}
        >
          <option value="">{vi.allPanels}</option>
          {panels.map((p) => (
            <option key={p.panel_id} value={p.panel_id}>
              {p.display_name} ({p.panel_id})
            </option>
          ))}
        </select>
        {selected.size > 0 && (
          <>
            <span className="text-xs text-steel">{vi.selectedCount(selected.size)}</span>
            <Btn
              tone="danger"
              disabled={!writeAllowed || busy}
              onClick={() => void handleDeleteSelected()}
            >
              <Trash2 className="size-3.5" /> {vi.deleteSelected}
            </Btn>
          </>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
          {vi.devicesSection}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-mist/50 font-mono text-[11px] text-steel/70">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    disabled={!filtered.length || !writeAllowed}
                    onChange={toggleSelectAll}
                    aria-label={vi.selectAll}
                    className="size-3.5 accent-accent"
                  />
                </th>
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">{vi.label}</th>
                <th className="px-4 py-2.5 font-medium">{vi.panel}</th>
                <th className="px-4 py-2.5 font-medium">{vi.deviceType}</th>
                <th className="px-4 py-2.5 font-medium">{vi.status}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.global_id}
                  className={`border-b border-line/60 hover:bg-mist/30 ${
                    selected.has(d.global_id) ? 'bg-accent/5' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(d.global_id)}
                      disabled={!writeAllowed}
                      onChange={() => toggleSelect(d.global_id)}
                      aria-label={d.global_id}
                      className="size-3.5 accent-accent"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-accent">{d.global_id}</td>
                  <td className="px-4 py-2.5">{d.label || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-steel">{d.panel_id}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <DeviceTypeIcon type={d.device_type} className="size-3.5 text-steel" />
                      {labelOf(deviceTypeLabel, d.device_type)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <StateDot state={d.state} />
                      {labelOf(deviceStateLabel, d.state)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        disabled={!writeAllowed}
                        className="rounded p-1.5 text-steel hover:bg-mist hover:text-ink disabled:opacity-40"
                        onClick={() => {
                          setEditing(d)
                          setFormMode(null)
                          setEditingPanel(null)
                        }}
                        title={vi.editDevice}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!writeAllowed || busy}
                        className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger disabled:opacity-40"
                        onClick={() => void handleDelete(d)}
                        title={vi.deleteDevice}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-steel/50">
                    {vi.noDevices}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
