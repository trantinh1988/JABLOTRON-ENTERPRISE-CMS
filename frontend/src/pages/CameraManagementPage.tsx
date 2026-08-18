import { useEffect, useMemo, useState } from 'react'
import { Camera as CameraIcon, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import {
  createCamera,
  deleteCamera,
  listCameras,
  snapshotCamera,
  testCameraConnection,
  updateCamera,
  type Camera,
  type CameraBrand,
  type CameraTestResult,
  type FloorMap,
} from '../api/client'
import { Btn, Card, Field, PageHeader, inputClass } from '../components/ui'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import {
  CAMERA_BRANDS,
  RTSP_HINT,
  SNAPSHOT_HINT,
  brandLabel,
  buildSnapshotUrl,
  hostFromUrl,
  previewSrc,
  snapshotCandidates,
} from '../lib/cameraCatalog'
import { vi } from '../i18n/vi'

type Props = {
  maps: FloorMap[]
  writeAllowed: boolean
}

type FormState = {
  name: string
  brand: CameraBrand
  floor_id: string
  host: string
  snapshot_url: string
  rtsp_url: string
  username: string
  password: string
  is_active: boolean
}

const emptyForm = (): FormState => ({
  name: '',
  brand: 'hikvision',
  floor_id: '',
  host: '',
  snapshot_url: '',
  rtsp_url: '',
  username: 'admin',
  password: '',
  is_active: true,
})

function formFromCamera(cam: Camera): FormState {
  const brand = (CAMERA_BRANDS.some((b) => b.id === cam.brand) ? cam.brand : 'generic') as CameraBrand
  return {
    name: cam.name,
    brand,
    floor_id: cam.floor_id != null ? String(cam.floor_id) : '',
    host: hostFromUrl(cam.snapshot_url) || hostFromUrl(cam.rtsp_url),
    snapshot_url: cam.snapshot_url || '',
    rtsp_url: cam.rtsp_url || '',
    username: cam.username || '',
    password: '',
    is_active: cam.is_active,
  }
}

function resolvedSnapshot(form: FormState): string {
  const manual = form.snapshot_url.trim()
  if (manual) return manual
  return buildSnapshotUrl(form.brand, form.host)
}

function connectionTone(cam: Camera): 'ok' | 'danger' | 'idle' {
  if (!cam.is_active) return 'idle'
  if (cam.last_error) return 'danger'
  if (cam.last_ok_at) return 'ok'
  return 'idle'
}

function connectionLabel(cam: Camera): string {
  if (!cam.is_active) return vi.cameraInactive
  if (cam.last_error) return vi.cameraOffline
  if (cam.last_ok_at) return vi.cameraOnline
  return vi.cameraUnchecked
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('vi-VN')
}

export function CameraManagementPage({ maps, writeAllowed }: Props) {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [query, setQuery] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Camera | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [testedOk, setTestedOk] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testPreview, setTestPreview] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; src: string; at: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  async function reload() {
    setBusy(true)
    setError(null)
    try {
      const rows = await listCameras(floorFilter ? Number(floorFilter) : undefined)
      setCameras(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cameras
    return cameras.filter((c) => {
      const hay = `${c.name} ${c.brand} ${c.floor_name ?? ''} ${c.snapshot_url}`.toLowerCase()
      return hay.includes(q)
    })
  }, [cameras, query])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setAdvanced(false)
    setTestedOk(false)
    setTestMsg(null)
    setTestPreview(null)
    setFormOpen(true)
  }

  function openEdit(cam: Camera) {
    const next = formFromCamera(cam)
    setEditing(cam)
    setForm(next)
    setAdvanced(Boolean(next.rtsp_url) || Boolean(next.snapshot_url && !next.host))
    setTestedOk(false)
    setTestMsg(null)
    setTestPreview(null)
    setFormOpen(true)
  }

  function applyTestResult(result: CameraTestResult) {
    if (result.ok && result.image_base64) {
      setTestedOk(true)
      setTestMsg(vi.cameraTestOk)
      setTestPreview(previewSrc(result.content_type, result.image_base64))
      return
    }
    setTestedOk(false)
    setTestPreview(null)
    setTestMsg(result.error || vi.cameraTestFail)
  }

  async function onTestForm() {
    setTestBusy(true)
    setTestMsg(null)
    try {
      const urls = form.snapshot_url.trim()
        ? [form.snapshot_url.trim()]
        : snapshotCandidates(form.brand, form.host)
      if (!urls.length) {
        setTestMsg(vi.cameraHostRequired)
        return
      }
      let last: CameraTestResult | null = null
      for (const snapshot_url of urls) {
        last = await testCameraConnection({
          camera_id: editing?.id,
          snapshot_url,
          rtsp_url: advanced ? form.rtsp_url : '',
          username: form.username,
          password: form.password || undefined,
          brand: form.brand,
        })
        if (last.ok && last.image_base64) {
          setForm((f) => ({ ...f, snapshot_url }))
          applyTestResult(last)
          return
        }
        if (last.error_code === 'unreachable' || last.error_code === 'timeout' || last.error_code === 'auth') {
          break
        }
      }
      applyTestResult(last ?? { ok: false, error: vi.cameraTestFail })
    } catch (e) {
      setTestedOk(false)
      setTestPreview(null)
      setTestMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setTestBusy(false)
    }
  }

  async function onSave() {
    if (!form.name.trim()) {
      setTestMsg(vi.cameraNameRequired)
      return
    }
    const snapshot = resolvedSnapshot(form)
    if (!snapshot && !form.rtsp_url.trim()) {
      setTestMsg(form.host.trim() ? vi.cameraUrlRequired : vi.cameraHostRequired)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: form.name.trim(),
        brand: form.brand,
        snapshot_url: snapshot,
        rtsp_url: form.rtsp_url.trim(),
        username: form.username.trim(),
        floor_id: form.floor_id ? Number(form.floor_id) : null,
        clear_floor: !form.floor_id,
        is_active: form.is_active,
        ...(form.password || !editing ? { password: form.password } : {}),
      }
      if (editing) await updateCamera(editing.id, body)
      else await createCamera(body)
      setFormOpen(false)
      await reload()
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(cam: Camera) {
    if (!window.confirm(vi.cameraDeleteConfirm(cam.name))) return
    try {
      await deleteCamera(cam.id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onSnap(cam: Camera) {
    setBusy(true)
    try {
      const result = await snapshotCamera(cam.id)
      if (result.ok && result.image_base64) {
        setPreview({
          title: cam.name,
          src: previewSrc(result.content_type, result.image_base64),
          at: result.captured_at || new Date().toISOString(),
        })
        await reload()
      } else {
        setError(result.error || vi.cameraTestFail)
        await reload()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <PageHeader
        title={vi.navCameras}
        hint={vi.cameraPageHint}
        actions={
          writeAllowed ? (
            <Btn type="button" onClick={openCreate}>
              <Plus className="size-3.5" />
              {vi.cameraAdd}
            </Btn>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[14rem] flex-1 space-y-1">
            <span className="text-[11px] font-medium text-steel/80">{vi.cameraSearch}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-steel/50" />
              <input
                className={`${inputClass} pl-8`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={vi.cameraSearchPh}
              />
            </div>
          </label>
          <label className="w-52 space-y-1">
            <span className="text-[11px] font-medium text-steel/80">{vi.cameraFloor}</span>
            <select className={inputClass} value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
              <option value="">{vi.cameraFloorAll}</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-mist/50 font-mono text-[11px] text-steel/70">
              <tr>
                <th className="w-16 px-4 py-2.5 font-medium" />
                <th className="px-4 py-2.5 font-medium">{vi.cameraName}</th>
                <th className="px-4 py-2.5 font-medium">{vi.cameraBrand}</th>
                <th className="px-4 py-2.5 font-medium">{vi.cameraFloor}</th>
                <th className="px-4 py-2.5 font-medium">{vi.cameraHost}</th>
                <th className="px-4 py-2.5 font-medium">{vi.cameraColStatus}</th>
                <th className="px-4 py-2.5 font-medium">{vi.cameraColLastOk}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((cam) => {
                const tone = connectionTone(cam)
                const thumb = cam.thumbnail_url
                  ? `${cam.thumbnail_url}${cam.last_ok_at ? `?t=${encodeURIComponent(cam.last_ok_at)}` : ''}`
                  : null
                const host = hostFromUrl(cam.snapshot_url) || hostFromUrl(cam.rtsp_url) || '—'
                return (
                  <tr key={cam.id} className="border-b border-line/60 hover:bg-mist/30">
                    <td className="px-4 py-2">
                      <div className="flex size-11 items-center justify-center overflow-hidden rounded-md bg-mist ring-1 ring-line">
                        {thumb ? (
                          <img src={thumb} alt="" className="size-full object-cover" />
                        ) : (
                          <CameraIcon className="size-4 text-steel/40" />
                        )}
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-4 py-2">
                      <p className="truncate font-medium text-ink">{cam.name}</p>
                      {cam.last_error ? (
                        <p className="truncate text-[11px] text-danger/80" title={cam.last_error}>
                          {cam.last_error}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-steel">{brandLabel(cam.brand)}</td>
                    <td className="px-4 py-2 text-steel">{cam.floor_name || vi.cameraNoFloor}</td>
                    <td className="px-4 py-2 font-mono text-[12px] text-steel">{host}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          tone === 'ok'
                            ? 'bg-ok/15 text-ok'
                            : tone === 'danger'
                              ? 'bg-danger/15 text-danger'
                              : 'bg-mist text-steel'
                        }`}
                      >
                        {connectionLabel(cam)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-[12px] text-steel/80">
                      {formatTs(cam.last_ok_at)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          disabled={!writeAllowed || busy}
                          className="rounded p-1.5 text-steel hover:bg-mist hover:text-ink disabled:opacity-40"
                          onClick={() => void onSnap(cam)}
                          title={vi.cameraSnap}
                        >
                          <CameraIcon className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!writeAllowed}
                          className="rounded p-1.5 text-steel hover:bg-mist hover:text-ink disabled:opacity-40"
                          onClick={() => openEdit(cam)}
                          title={vi.cameraEdit}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!writeAllowed}
                          className="rounded p-1.5 text-steel hover:bg-danger/15 hover:text-danger disabled:opacity-40"
                          onClick={() => void onDelete(cam)}
                          title={vi.cameraDelete}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-steel/60">
                    {busy ? vi.cameraLoading : vi.cameraEmpty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {formOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => {
            if (!saving && !testBusy) setFormOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-xl bg-panel p-4 shadow-xl ring-1 ring-line"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-ink">{editing ? vi.cameraEditTitle : vi.cameraAddTitle}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={vi.cameraName}>
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={vi.cameraNamePh}
                />
              </Field>
              <Field label={vi.cameraFloor}>
                <select
                  className={inputClass}
                  value={form.floor_id}
                  onChange={(e) => setForm((f) => ({ ...f, floor_id: e.target.value }))}
                >
                  <option value="">{vi.cameraNoFloor}</option>
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={vi.cameraBrand}>
                <select
                  className={inputClass}
                  value={form.brand}
                  onChange={(e) => {
                    const brand = e.target.value as CameraBrand
                    setForm((f) => ({
                      ...f,
                      brand,
                      snapshot_url: f.host ? buildSnapshotUrl(brand, f.host) : '',
                    }))
                    setTestedOk(false)
                  }}
                >
                  {CAMERA_BRANDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={vi.cameraHost}>
                <input
                  className={inputClass}
                  value={form.host}
                  onChange={(e) => {
                    const host = e.target.value
                    setForm((f) => ({
                      ...f,
                      host,
                      snapshot_url: host.trim() ? buildSnapshotUrl(f.brand, host) : '',
                    }))
                    setTestedOk(false)
                  }}
                  placeholder={vi.cameraHostPh}
                />
              </Field>
              <Field label={vi.cameraUsername}>
                <input
                  className={inputClass}
                  value={form.username}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, username: e.target.value }))
                    setTestedOk(false)
                  }}
                  autoComplete="off"
                />
              </Field>
              <Field label={editing ? vi.cameraPasswordKeep : vi.cameraPassword}>
                <input
                  className={inputClass}
                  type="password"
                  value={form.password}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, password: e.target.value }))
                    setTestedOk(false)
                  }}
                  autoComplete="new-password"
                  placeholder={editing ? vi.cameraPasswordKeepPh : ''}
                />
              </Field>
            </div>

            <button
              type="button"
              className="mt-3 text-[12px] font-medium text-steel/70 underline-offset-2 hover:text-ink hover:underline"
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? vi.cameraAdvancedHide : vi.cameraAdvanced}
            </button>

            {advanced && (
              <div className="mt-3 grid gap-3">
                <Field label={vi.cameraSnapshotUrl}>
                  <input
                    className={inputClass}
                    value={form.snapshot_url}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, snapshot_url: e.target.value }))
                      setTestedOk(false)
                    }}
                    placeholder={SNAPSHOT_HINT[form.brand]}
                  />
                </Field>
                <Field label={vi.cameraRtspUrl}>
                  <input
                    className={inputClass}
                    value={form.rtsp_url}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, rtsp_url: e.target.value }))
                      setTestedOk(false)
                    }}
                    placeholder={RTSP_HINT[form.brand]}
                  />
                </Field>
                <Field label={vi.cameraActive}>
                  <select
                    className={inputClass}
                    value={form.is_active ? '1' : '0'}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === '1' }))}
                  >
                    <option value="1">{vi.cameraActiveOn}</option>
                    <option value="0">{vi.cameraActiveOff}</option>
                  </select>
                </Field>
              </div>
            )}

            {testPreview && (
              <img src={testPreview} alt="" className="mt-3 max-h-48 w-full rounded-lg object-contain ring-1 ring-line" />
            )}
            {testMsg && (
              <p className={`mt-2 text-sm ${testedOk ? 'text-ok' : 'text-danger'}`}>{testMsg}</p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Btn type="button" tone="ghost" disabled={testBusy} onClick={() => void onTestForm()}>
                {testBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {vi.cameraTest}
              </Btn>
              <Btn type="button" tone="ghost" disabled={saving || testBusy} onClick={() => setFormOpen(false)}>
                {vi.cameraCancel}
              </Btn>
              <Btn type="button" disabled={saving || !writeAllowed} onClick={() => void onSave()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {testedOk ? vi.cameraSave : vi.cameraSaveAnyway}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <ImagePreviewModal
          src={preview.src}
          title={preview.title}
          subtitle={formatTs(preview.at)}
          createdAt={preview.at}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
