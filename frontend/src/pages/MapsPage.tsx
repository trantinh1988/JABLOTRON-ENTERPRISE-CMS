import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createMap,
  deleteMap,
  updateDevice,
  updateMap,
  type Device,
  type FloorMap,
  type Panel,
} from '../api/client'
import { InteractiveFloorMap } from '../components/InteractiveFloorMap'
import { Btn, Card, Field, PageHeader, inputClass } from '../components/ui'
import { vi } from '../i18n/vi'

type Props = {
  maps: FloorMap[]
  devices: Device[]
  panels: Panel[]
  writeAllowed: boolean
  onRefresh: () => Promise<void>
}

export function MapsPage({ maps, devices, panels, writeAllowed, onRefresh }: Props) {
  const [activeId, setActiveId] = useState<number | null>(maps[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [placingId, setPlacingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (activeId == null && maps[0]) setActiveId(maps[0].id)
    if (activeId != null && maps.length && !maps.some((m) => m.id === activeId)) {
      setActiveId(maps[0]?.id ?? null)
    }
  }, [maps, activeId])

  const active = useMemo(
    () => maps.find((m) => m.id === activeId) ?? maps[0] ?? null,
    [maps, activeId],
  )

  const onMapDevices = useMemo(
    () => (active ? devices.filter((d) => d.map_id === active.id) : []),
    [devices, active],
  )

  const unplaced = useMemo(
    () => devices.filter((d) => d.map_id == null || (active && d.map_id !== active.id)),
    [devices, active],
  )

  async function handleCreate(form: FormData) {
    setBusy(true)
    setError(null)
    try {
      const created = await createMap({
        name: String(form.get('name')),
        description: String(form.get('description') || ''),
        background_url: String(form.get('background_url') || '') || null,
      })
      setCreating(false)
      setActiveId(created.id)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdateMeta(form: FormData) {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      await updateMap(active.id, {
        name: String(form.get('name')),
        description: String(form.get('description') || ''),
        background_url: String(form.get('background_url') || '') || null,
      })
      setEditingMeta(false)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!active) return
    if (!window.confirm(vi.confirmDeleteMap(active.name))) return
    setBusy(true)
    setError(null)
    try {
      await deleteMap(active.id)
      setActiveId(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function placeAt(x: number, y: number) {
    if (!active || !placingId || !writeAllowed) return
    setBusy(true)
    setError(null)
    try {
      await updateDevice(placingId, { map_id: active.id, map_x: x, map_y: y })
      setPlacingId(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function moveDevice(globalId: string, x: number, y: number) {
    if (!active || !writeAllowed) return
    try {
      await updateDevice(globalId, { map_id: active.id, map_x: x, map_y: y })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function unplace(globalId: string) {
    if (!writeAllowed) return
    try {
      await updateDevice(globalId, { clear_map: true })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-5">
      <PageHeader
        title={vi.mapsPageTitle}
        hint={vi.mapsPageHint}
        actions={
          <Btn
            disabled={!writeAllowed}
            onClick={() => {
              setCreating(true)
              setEditingMeta(false)
            }}
          >
            <Plus className="size-3.5" /> {vi.addMap}
          </Btn>
        }
      />

      {!writeAllowed && (
        <p className="mb-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">{vi.readOnlyHint}</p>
      )}
      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {creating && (
        <Card className="mb-4">
          <h3 className="mb-3 text-sm font-semibold">{vi.addMap}</h3>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault()
              void handleCreate(new FormData(e.currentTarget))
            }}
          >
            <Field label={vi.mapName}>
              <input name="name" required className={inputClass} placeholder="Tầng 1" />
            </Field>
            <Field label={vi.mapDescription}>
              <input name="description" className={inputClass} />
            </Field>
            <Field label={vi.backgroundUrl}>
              <input name="background_url" className={inputClass} placeholder="https://…" />
            </Field>
            <div className="flex gap-2 sm:col-span-3">
              <Btn type="submit" disabled={busy}>
                {vi.save}
              </Btn>
              <Btn tone="ghost" onClick={() => setCreating(false)}>
                {vi.cancel}
              </Btn>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {maps.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setActiveId(m.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition ${
              active?.id === m.id
                ? 'bg-accent text-panel ring-accent'
                : 'bg-mist text-steel ring-line hover:bg-line/40'
            }`}
          >
            {m.name}
            <span className="ml-1.5 font-mono opacity-70">({m.device_count})</span>
          </button>
        ))}
        {!maps.length && <p className="text-sm text-steel/50">{vi.noMaps}</p>}
      </div>

      {active && (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{active.name}</h3>
                <p className="text-xs text-steel/60">{active.description || '—'}</p>
              </div>
              <div className="flex gap-2">
                <Btn
                  tone="ghost"
                  disabled={!writeAllowed}
                  onClick={() => {
                    setEditingMeta(true)
                    setCreating(false)
                  }}
                >
                  <Pencil className="size-3.5" /> {vi.editMap}
                </Btn>
                <Btn tone="danger" disabled={!writeAllowed || busy} onClick={() => void handleDelete()}>
                  <Trash2 className="size-3.5" /> {vi.deleteMap}
                </Btn>
              </div>
            </div>

            {editingMeta && (
              <Card>
                <form
                  className="grid gap-3 sm:grid-cols-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleUpdateMeta(new FormData(e.currentTarget))
                  }}
                >
                  <Field label={vi.mapName}>
                    <input name="name" required className={inputClass} defaultValue={active.name} />
                  </Field>
                  <Field label={vi.mapDescription}>
                    <input
                      name="description"
                      className={inputClass}
                      defaultValue={active.description}
                    />
                  </Field>
                  <Field label={vi.backgroundUrl}>
                    <input
                      name="background_url"
                      className={inputClass}
                      defaultValue={active.background_url ?? ''}
                    />
                  </Field>
                  <div className="flex gap-2 sm:col-span-3">
                    <Btn type="submit" disabled={busy}>
                      {vi.save}
                    </Btn>
                    <Btn tone="ghost" onClick={() => setEditingMeta(false)}>
                      {vi.cancel}
                    </Btn>
                  </div>
                </form>
              </Card>
            )}

            {placingId && (
              <p className="rounded-md bg-accent/10 px-3 py-2 text-xs text-accent">
                {vi.clickToPlace} <span className="font-mono">{placingId}</span>
              </p>
            )}

            <InteractiveFloorMap
              map={active}
              devices={onMapDevices}
              panels={panels}
              editable={writeAllowed}
              onPlace={placeAt}
              onMove={moveDevice}
            />
          </div>

          <aside className="flex flex-col gap-3">
            <Card>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-steel uppercase">
                Trên bản đồ
              </h4>
              <ul className="max-h-48 space-y-1 overflow-auto">
                {onMapDevices.map((d) => (
                  <li
                    key={d.global_id}
                    className="flex items-center justify-between gap-2 rounded-md bg-fog/70 px-2 py-1.5 text-xs"
                  >
                    <span className="truncate font-mono text-accent">{d.device_id}</span>
                    <button
                      type="button"
                      disabled={!writeAllowed}
                      className="text-steel hover:text-danger disabled:opacity-40"
                      onClick={() => void unplace(d.global_id)}
                      title={vi.unplaceDevice}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
                {!onMapDevices.length && (
                  <li className="text-[11px] text-steel/45">Chưa gắn thiết bị</li>
                )}
              </ul>
            </Card>

            <Card>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-steel uppercase">
                {vi.placeDevice}
              </h4>
              <ul className="max-h-72 space-y-1 overflow-auto">
                {unplaced.map((d) => (
                  <li key={d.global_id}>
                    <button
                      type="button"
                      disabled={!writeAllowed}
                      onClick={() => setPlacingId(d.global_id)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-xs ring-1 transition disabled:opacity-40 ${
                        placingId === d.global_id
                          ? 'bg-accent/15 text-accent ring-accent/40'
                          : 'bg-fog/70 text-ink ring-transparent hover:ring-line'
                      }`}
                    >
                      <span className="font-mono text-accent">{d.global_id}</span>
                      <span className="mt-0.5 block truncate text-steel/70">{d.label}</span>
                    </button>
                  </li>
                ))}
                {!unplaced.length && (
                  <li className="text-[11px] text-steel/45">Tất cả đã được gắn</li>
                )}
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </div>
  )
}
