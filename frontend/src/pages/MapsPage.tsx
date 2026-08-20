import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ChevronDown,
  ImageOff,
  ImagePlus,
  LayoutDashboard,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Route,
  Rows3,
  Settings2,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import {
  clearMapBackground,
  createMap,
  deleteMap,
  updateDevice,
  updateMap,
  uploadMapBackground,
  uploadMapTrailSnap,
  type Device,
  type FloorMap,
  type Panel,
} from '../api/client'
import { DeviceIconPicker } from '../components/DeviceIconPicker'
import { DeviceTypeIcon } from '../components/DeviceTypeIcon'
import { LinkBadge } from '../components/DeviceModelPicker'
import { ReactionBadge } from '../components/ReactionBadge'
import { AlarmCameraColumn } from '../components/AlarmCameraColumn'
import { InteractiveFloorMap } from '../components/InteractiveFloorMap'
import { MapGridView, MapLayoutPicker } from '../components/MapGridView'
import { openSectionsQuickModal } from '../components/SectionsQuickModal'
import { Btn, Card, Field, inputClass } from '../components/ui'
import {
  getAlarmFocusQueue,
  isAlarmFocusSuppressed,
  requestAlarmMapFocus,
  subscribeAlarmFocusQueue,
  subscribeAlarmMapFocus,
  subscribeAlarmMapRelease,
  type AlarmMapFocusRequest,
} from '../hooks/alarmMapFocusBus'
import {
  clearAlarmTrail,
  getAlarmTrailSnapshot,
  setAlarmTrailHidden,
  subscribeAlarmTrail,
} from '../hooks/alarmTrailBus'
import { formatTrailClock, isAlarmTrailActive, type AlarmTrailSnapshot } from '../lib/alarmTrail'
import {
  clampMapIconSize,
  DEFAULT_MAP_ICON_SIZE,
  formatMapDeviceCaption,
  isMapMarkerLabelMode,
  MAP_MARKER_LABEL_MODE_KEY,
  MAP_MARKER_LABEL_MODES,
  MAP_STATUS_LEGEND,
  mapSizeFromImageAspect,
  mapStatusColor,
  readMapBgFit,
  resolveDeviceIconKey,
  writeMapBgFit,
  type MapBgFitState,
  type MapMarkerLabelMode,
} from '../lib/deviceIconLibrary'
import {
  defaultSlots,
  readMapGridState,
  resizeSlots,
  writeMapGridState,
  type MapGridLayout,
} from '../lib/mapGridLayout'
import { useOperatorSession } from '../hooks/useOperatorSession'
import { deviceStateLabel, effectiveDeviceStatus, labelOf, vi } from '../i18n/vi'
import { reactionShowsMapChip } from '../lib/deviceReaction'

type Props = {
  maps: FloorMap[]
  devices: Device[]
  panels: Panel[]
  writeAllowed: boolean
  wsConnected?: boolean
  liveActive?: boolean
  liveFlashIds?: Set<string>
  mockMode?: boolean | null
  onRefresh: () => Promise<void>
}

type StatusKey = 'ok' | 'open' | 'alarm' | 'tamper' | 'loss' | 'fault'

const STATUS_ITEMS: { key: StatusKey; label: string; color: string }[] = MAP_STATUS_LEGEND.map(
  (item) => ({
    key: item.key as StatusKey,
    label: item.label,
    color: item.color,
  }),
)

const MODE_LABEL: Record<MapMarkerLabelMode, string> = {
  id: vi.mapLabelModeId,
  label: vi.mapLabelModeLabel,
  id_label: vi.mapLabelModeIdLabel,
  icon: vi.mapLabelModeIcon,
}

function readLabelMode(): MapMarkerLabelMode {
  try {
    const raw = localStorage.getItem(MAP_MARKER_LABEL_MODE_KEY)
    if (isMapMarkerLabelMode(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'id_label'
}

function loadImageNaturalSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ w: img.naturalWidth, h: img.naturalHeight })
      } else {
        reject(new Error('Không đọc được kích thước ảnh.'))
      }
    }
    img.onerror = () => reject(new Error('Không tải được ảnh nền.'))
    img.src = url
  })
}

type AlarmLayoutResume = {
  layout: MapGridLayout
  slots: (number | null)[]
  fullscreen: boolean
}

function hasLiveAlarm(device: Device): boolean {
  return effectiveDeviceStatus(device.state, device.disable) === 'alarm'
}

export function MapsPage({
  maps,
  devices,
  panels,
  writeAllowed,
  liveFlashIds,
  onRefresh,
}: Props) {
  const { canSettings } = useOperatorSession()
  const canEditUi = writeAllowed && canSettings
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeId, setActiveId] = useState<number | null>(maps[0]?.id ?? null)
  const [editMode, setEditMode] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [placingId, setPlacingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null)
  const [labelMode, setLabelModeState] = useState<MapMarkerLabelMode>(readLabelMode)
  const [bgFit, setBgFitState] = useState<MapBgFitState>(() =>
    maps[0] ? readMapBgFit(maps[0].id) : { mode: 'fill', scale: 100, offsetX: 0, offsetY: 0, rect: null },
  )
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [alarmBanner, setAlarmBanner] = useState<string | null>(null)
  const [alarmQueue, setAlarmQueue] = useState<AlarmMapFocusRequest[]>([])
  const [alarmPinned, setAlarmPinned] = useState(false)
  const [trailSnap, setTrailSnap] = useState<AlarmTrailSnapshot>(() => getAlarmTrailSnapshot())
  const [snapBusyMapId, setSnapBusyMapId] = useState<number | null>(null)
  const [labelMenuOpen, setLabelMenuOpen] = useState(false)
  const labelMenuRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [editIcon, setEditIcon] = useState('')
  const [editSize, setEditSize] = useState(DEFAULT_MAP_ICON_SIZE)
  const [pendingBgFile, setPendingBgFile] = useState<File | null>(null)
  const [layout, setLayout] = useState<MapGridLayout>(() => readMapGridState().layout)
  const [slots, setSlots] = useState<(number | null)[]>(() => readMapGridState().slots)
  const [resumeHint, setResumeHint] = useState<MapGridLayout | null>(null)
  const lastGridRef = useRef<MapGridLayout>(
    readMapGridState().layout !== 1 ? readMapGridState().layout : 4,
  )
  const bgInputRef = useRef<HTMLInputElement>(null)
  const createBgInputRef = useRef<HTMLInputElement>(null)
  const focusHandledKey = useRef<string | null>(null)
  const devicesRef = useRef(devices)
  devicesRef.current = devices
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const fullscreenRef = useRef(fullscreen)
  fullscreenRef.current = fullscreen
  const alarmResumeRef = useRef<AlarmLayoutResume | null>(null)
  const sawAlarmWhilePinnedRef = useRef(false)
  const isGrid = layout !== 1
  const mapsRef = useRef(maps)
  mapsRef.current = maps
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const applyAlarmFocus = (mapId: number, deviceId: string) => {
    if (
      alarmResumeRef.current &&
      layoutRef.current === 1 &&
      activeIdRef.current === mapId &&
      selectedIdRef.current === deviceId
    ) {
      setAlarmPinned(true)
      sawAlarmWhilePinnedRef.current = true
      return
    }
    const mapList = mapsRef.current
    setActiveId(mapId)
    setSelectedId(deviceId)
    setEditMode(false)
    if (layoutRef.current !== 1) lastGridRef.current = layoutRef.current
    if (!alarmResumeRef.current) {
      const prevLayout = layoutRef.current !== 1 ? layoutRef.current : lastGridRef.current
      alarmResumeRef.current = {
        layout: prevLayout === 1 ? 4 : prevLayout,
        slots: slotsRef.current.slice(),
        fullscreen: fullscreenRef.current,
      }
      setResumeHint(alarmResumeRef.current.layout)
    }
    setLayout(1)
    setFullscreen(true)
    setSidebarOpen(false)
    setAlarmPinned(true)
    sawAlarmWhilePinnedRef.current = true
    const mapName = mapList.find((m) => m.id === mapId)?.name ?? String(mapId)
    const device = devicesRef.current.find((d) => d.global_id === deviceId)
    const caption = device ? formatMapDeviceCaption(device) : deviceId || '—'
    setAlarmBanner(vi.alarmMapFocus(caption, mapName))
  }
  const applyAlarmFocusRef = useRef(applyAlarmFocus)
  applyAlarmFocusRef.current = applyAlarmFocus

  const restoreAlarmGrid = (opts?: { force?: boolean }) => {
    if (getAlarmFocusQueue().length) return
    if (!opts?.force) {
      const stillAlarm = devicesRef.current.some(
        (d) => hasLiveAlarm(d) && !isAlarmFocusSuppressed(d.global_id),
      )
      if (stillAlarm) return
    }
    const resume = alarmResumeRef.current
    if (!resume && !opts?.force) return
    alarmResumeRef.current = null
    sawAlarmWhilePinnedRef.current = false
    setResumeHint(null)
    setAlarmPinned(false)
    setAlarmBanner(null)
    const grid =
      resume && resume.layout !== 1
        ? resume.layout
        : lastGridRef.current !== 1
          ? lastGridRef.current
          : 4
    setLayout(grid)
    setSlots(resizeSlots(grid, mapsRef.current, resume?.slots ?? slotsRef.current))
    setFullscreen(false)
  }
  const restoreAlarmGridRef = useRef(restoreAlarmGrid)
  restoreAlarmGridRef.current = restoreAlarmGrid

  useEffect(() => subscribeAlarmFocusQueue(setAlarmQueue), [])
  useEffect(() => subscribeAlarmTrail(setTrailSnap), [])
  useEffect(() => subscribeAlarmMapRelease(() => restoreAlarmGridRef.current({ force: true })), [])
  useEffect(
    () =>
      subscribeAlarmMapFocus((req: AlarmMapFocusRequest) => {
        applyAlarmFocusRef.current(req.mapId, req.deviceId)
      }),
    [],
  )

  const canEdit = canEditUi && editMode

  // Deep-link / alarm focus: /maps?map=2&device=PANEL_1_DEV_10&focus=alarm&t=…
  // Không phụ thuộc `devices` — mỗi lần WS cập nhật devices từng làm effect chạy lại và dễ nuốt focus.
  useEffect(() => {
    const mapRaw = searchParams.get('map')
    const deviceRaw = searchParams.get('device')
    const focus = searchParams.get('focus')
    const tRaw = searchParams.get('t')
    if (!mapRaw && !deviceRaw) {
      focusHandledKey.current = null
      return
    }

    const key = `${mapRaw ?? ''}|${deviceRaw ?? ''}|${focus ?? ''}|${tRaw ?? ''}`
    if (focusHandledKey.current === key) return

    const mapId = mapRaw != null ? Number(mapRaw) : NaN
    const mapsReady = maps.length > 0
    const mapOk = Number.isFinite(mapId) && maps.some((m) => m.id === mapId)

    // Maps chưa load — giữ query để thử lại. Id không tồn tại → bỏ query.
    if (mapRaw && mapsReady && !mapOk) {
      focusHandledKey.current = key
      setSearchParams({}, { replace: true })
      return
    }
    if (mapRaw && !mapOk) return

    focusHandledKey.current = key

    if (mapOk) {
      if (focus === 'alarm' && deviceRaw) {
        applyAlarmFocusRef.current(mapId, deviceRaw)
      } else {
        setActiveId(mapId)
        if (deviceRaw) setSelectedId(deviceRaw)
      }
    } else if (deviceRaw) {
      setSelectedId(deviceRaw)
    }

    setSearchParams({}, { replace: true })
  }, [searchParams, maps, setSearchParams])

  useEffect(() => {
    if (!alarmBanner) return
    const id = window.setTimeout(() => setAlarmBanner(null), 8000)
    return () => window.clearTimeout(id)
  }, [alarmBanner])

  const prevQueueIdsRef = useRef<string[]>([])

  // Hàng đợi trống và không còn thiết bị Báo động → về lưới.
  // Đọc bus trực tiếp: React state hàng đợi lệch 1 tick khi vừa navigate / vừa focus.
  useEffect(() => {
    const liveQueue = getAlarmFocusQueue()
    const view = liveQueue.length ? liveQueue : alarmQueue
    const ids = view.map((q) => q.deviceId)
    const prevIds = prevQueueIdsRef.current
    prevQueueIdsRef.current = ids

    if (view.length) {
      if (!alarmResumeRef.current) return
      sawAlarmWhilePinnedRef.current = true
      const selectedGone = Boolean(
        selectedId && prevIds.includes(selectedId) && !ids.includes(selectedId),
      )
      if (!selectedGone && selectedId) return
      const queued = view.find((q) => q.mapId === activeId) ?? view[0]
      if (queued && (queued.mapId !== activeId || queued.deviceId !== selectedId)) {
        setActiveId(queued.mapId)
        setSelectedId(queued.deviceId)
      }
      return
    }
    if (!alarmResumeRef.current) return
    if (!sawAlarmWhilePinnedRef.current && devices.length === 0) return
    // Thiết bị vừa Tắt báo động (đang trong cửa sổ chặn focus) không được chặn
    // đường về lưới — REST cũ trả lại "alarm" từng khoá màn hình ở 1 map.
    const stillAlarm = devices.some(
      (d) => hasLiveAlarm(d) && !isAlarmFocusSuppressed(d.global_id),
    )
    if (stillAlarm) return
    restoreAlarmGridRef.current()
  }, [devices, alarmQueue, activeId, selectedId])

  const trailLive = useMemo(() => {
    if (canEdit) return []
    if (!isAlarmTrailActive(trailSnap)) return []
    return trailSnap.points
  }, [canEdit, trailSnap])

  const handleTrailSnap = async (mapId: number, blob: Blob) => {
    setSnapBusyMapId(mapId)
    setError(null)
    try {
      const pts = trailSnap.points.filter((p) => p.mapId === mapId)
      await uploadMapTrailSnap(mapId, blob, {
        pointCount: pts.length || undefined,
        seqs: pts.map((p) => p.seq),
        deviceIds: [...new Set(pts.map((p) => p.deviceId))],
      })
      setInfo(vi.alarmTrailSnapSaved)
    } catch (err) {
      setError(err instanceof Error ? err.message : vi.alarmTrailSnapFail)
    } finally {
      setSnapBusyMapId(null)
    }
  }

  const alarmAlertBar =
    alarmBanner || alarmQueue.length > 0 ? (
      <div className="flex shrink-0 flex-col gap-1 rounded-md bg-danger/15 px-2.5 py-1.5 text-[11px] text-danger ring-1 ring-danger/30">
        <div className="flex items-center gap-2 overflow-hidden">
        <span className="shrink-0 font-semibold">
          {alarmQueue.length > 0 ? vi.alarmFocusQueueTitle(alarmQueue.length) : vi.alarmFocusSingle}
        </span>
        {resumeHint != null && resumeHint !== 1 && (
          <span className="hidden shrink-0 text-[10px] text-danger/70 sm:inline">
            {vi.mapGridAlarmResume(resumeHint)}
          </span>
        )}
        {alarmBanner && alarmQueue.length === 0 && (
          <span className="min-w-0 flex-1 truncate font-semibold">{alarmBanner}</span>
        )}
        {alarmQueue.length > 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {alarmQueue.map((item) => {
              const device = devicesRef.current.find((d) => d.global_id === item.deviceId)
              const mapName = maps.find((m) => m.id === item.mapId)?.name ?? String(item.mapId)
              const caption = device ? formatMapDeviceCaption(device) : item.deviceId
              const active = selectedId === item.deviceId && activeId === item.mapId
              return (
                <button
                  key={`${item.deviceId}-${item.token}`}
                  type="button"
                  title={`${caption} · ${mapName}`}
                  onClick={() => requestAlarmMapFocus(item.mapId, item.deviceId)}
                  className={`max-w-[12rem] shrink-0 truncate rounded border px-2 py-0.5 font-medium transition ${
                    active
                      ? 'border-danger bg-danger text-white'
                      : 'border-danger/40 bg-panel text-danger hover:bg-danger/15'
                  }`}
                >
                  {caption}
                  <span className="opacity-70"> · {mapName}</span>
                </button>
              )
            })}
          </div>
        )}
        {trailSnap.points.length >= 2 && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title={trailSnap.hidden ? vi.alarmTrailShow : vi.alarmTrailHide}
              onClick={() => setAlarmTrailHidden(!trailSnap.hidden)}
              className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded border border-danger/40 bg-panel px-1.5 py-0.5 font-medium text-danger hover:bg-danger/15"
            >
              <Route className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {trailSnap.hidden ? vi.alarmTrailShow : vi.alarmTrailChip(trailSnap.points.length)}
              </span>
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-danger/70 hover:bg-danger/15 hover:text-danger"
              title={vi.alarmTrailClear}
              aria-label={vi.alarmTrailClear}
              onClick={() => clearAlarmTrail()}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        <button
          type="button"
          className="shrink-0 text-danger/80 hover:text-danger"
          onClick={() => setAlarmBanner(null)}
          aria-label="Đóng"
        >
          <X className="size-3.5" />
        </button>
        </div>
        {trailSnap.points.length >= 2 && (
          <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
            role="group"
            aria-label={vi.alarmTrailStepsAria}
          >
            {trailSnap.points.map((p) => {
              const mapName = maps.find((m) => m.id === p.mapId)?.name ?? String(p.mapId)
              const device = devicesRef.current.find((d) => d.global_id === p.deviceId)
              const caption = device ? formatMapDeviceCaption(device) : p.deviceId
              const active = selectedId === p.deviceId && activeId === p.mapId
              return (
                <button
                  key={`trail-${p.seq}-${p.deviceId}`}
                  type="button"
                  title={vi.alarmTrailStopTitle(p.seq, caption, formatTrailClock(p.at))}
                  onClick={() => requestAlarmMapFocus(p.mapId, p.deviceId)}
                  className={`shrink-0 rounded border px-1.5 py-0.5 font-medium transition ${
                    active
                      ? 'border-danger bg-danger text-white'
                      : 'border-danger/40 bg-panel text-danger hover:bg-danger/15'
                  }`}
                >
                  {vi.alarmTrailStep(p.seq, mapName)}
                </button>
              )
            })}
          </div>
        )}
      </div>
    ) : null

  useEffect(() => {
    if (activeId == null && maps[0]) setActiveId(maps[0].id)
    if (activeId != null && maps.length && !maps.some((m) => m.id === activeId)) {
      setActiveId(maps[0]?.id ?? null)
    }
  }, [maps, activeId])

  useEffect(() => {
    if (!maps.length) return
    if (alarmResumeRef.current) return
    setSlots((prev) => {
      if (!prev.length) return defaultSlots(layoutRef.current, maps, activeId)
      return resizeSlots(layoutRef.current, maps, prev)
    })
    // Slot gán theo danh sách map; không reset khi activeId đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps])

  useEffect(() => {
    if (resumeHint != null || alarmResumeRef.current) return
    if (canEditUi) {
      writeMapGridState({ layout, slots })
      return
    }
    const prev = readMapGridState()
    writeMapGridState({
      layout,
      slots: prev.slots.length ? resizeSlots(layout, maps, prev.slots) : slots,
    })
  }, [layout, slots, resumeHint, canEditUi, maps])

  useEffect(() => {
    if (activeId == null) return
    setBgFitState(readMapBgFit(activeId))
  }, [activeId])

  useEffect(() => {
    if (!canEditUi && editMode) setEditMode(false)
  }, [canEditUi, editMode])

  useEffect(() => {
    if (!editMode) {
      setPlacingId(null)
      setCreating(false)
      setEditingMeta(false)
    }
  }, [editMode])

  useEffect(() => {
    if (!labelMenuOpen) return
    function onDoc(e: MouseEvent) {
      if (!labelMenuRef.current?.contains(e.target as Node)) setLabelMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLabelMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [labelMenuOpen])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return
      // Ưu tiên đóng overlay nhỏ trước, lần ESC sau mới thu gọn.
      if (labelMenuOpen) {
        setLabelMenuOpen(false)
        e.preventDefault()
        return
      }
      if (statusFilter) {
        setStatusFilter(null)
        e.preventDefault()
        return
      }
      if (creating) {
        setCreating(false)
        e.preventDefault()
        return
      }
      if (editingMeta) {
        setEditingMeta(false)
        e.preventDefault()
        return
      }
      e.preventDefault()
      setFullscreen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fullscreen, labelMenuOpen, statusFilter, creating, editingMeta])

  const active = useMemo(
    () => maps.find((m) => m.id === activeId) ?? maps[0] ?? null,
    [maps, activeId],
  )

  const onMapDevices = useMemo(
    () => (active ? devices.filter((d) => d.map_id === active.id) : []),
    [devices, active],
  )

  const unplaced = useMemo(
    () => devices.filter((d) => d.map_id == null),
    [devices],
  )

  const selected = useMemo(
    () => onMapDevices.find((d) => d.global_id === selectedId) ?? null,
    [onMapDevices, selectedId],
  )

  const statusSummary = useMemo(() => {
    const counts: Record<StatusKey, number> = {
      ok: 0,
      open: 0,
      alarm: 0,
      tamper: 0,
      loss: 0,
      fault: 0,
    }
    for (const d of onMapDevices) {
      const st = effectiveDeviceStatus(d.state, d.disable) as StatusKey
      if (st in counts) counts[st] += 1
      else counts.ok += 1
    }
    return counts
  }, [onMapDevices])

  const filteredByStatus = useMemo(() => {
    if (!statusFilter) return []
    return onMapDevices.filter((d) => effectiveDeviceStatus(d.state, d.disable) === statusFilter)
  }, [onMapDevices, statusFilter])

  useEffect(() => {
    if (!selected) return
    setEditIcon(resolveDeviceIconKey(selected))
    setEditSize(clampMapIconSize(selected.map_icon_size))
  }, [selected])

  function setLabelMode(mode: MapMarkerLabelMode) {
    setLabelModeState(mode)
    try {
      localStorage.setItem(MAP_MARKER_LABEL_MODE_KEY, mode)
    } catch {
      /* ignore */
    }
  }

  function patchBgFit(patch: Partial<MapBgFitState>) {
    setBgFitState((prev) => {
      const next: MapBgFitState = { ...prev, ...patch }
      if (patch.mode && patch.mode !== 'manual') {
        next.rect = null
      }
      if (patch.mode === 'manual' && !next.rect && active) {
        // Mặc định phủ kín viewBox — kéo tay mới co/giãn từ mép workspace.
        next.rect = { x: 0, y: 0, width: active.width, height: active.height }
      }
      if (patch.mode === 'stretch') {
        next.rect = null
        next.scale = 100
        next.offsetX = 0
        next.offsetY = 0
      }
      if (activeId != null) writeMapBgFit(activeId, next)
      return next
    })
  }

  async function syncMapAspectToBackground() {
    if (!active?.background_url || !canEdit) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const natural = await loadImageNaturalSize(active.background_url)
      const nextSize = mapSizeFromImageAspect(natural.w, natural.h)
      const sx = nextSize.width / active.width
      const sy = nextSize.height / active.height
      await updateMap(active.id, { width: nextSize.width, height: nextSize.height })
      await Promise.all(
        onMapDevices.map((d) =>
          updateDevice(d.global_id, {
            map_id: active.id,
            map_x: (d.map_x ?? active.width / 2) * sx,
            map_y: (d.map_y ?? active.height / 2) * sy,
          }),
        ),
      )
      patchBgFit({ mode: 'stretch', scale: 100, offsetX: 0, offsetY: 0, rect: null })
      setInfo(vi.mapBgSyncDone)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(form: FormData) {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const created = await createMap({
        name: String(form.get('name')),
        description: String(form.get('description') || ''),
      })
      if (pendingBgFile) {
        await uploadMapBackground(created.id, pendingBgFile)
        setPendingBgFile(null)
      }
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
    if (!active || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await updateMap(active.id, {
        name: String(form.get('name')),
        description: String(form.get('description') || ''),
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
    if (!active || !canEdit) return
    if (!window.confirm(vi.confirmDeleteMap(active.name))) return
    setBusy(true)
    setError(null)
    try {
      await deleteMap(active.id)
      setActiveId(null)
      setSelectedId(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleBackgroundFile(file: File | null) {
    if (!active || !file || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await uploadMapBackground(active.id, file)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (bgInputRef.current) bgInputRef.current.value = ''
    }
  }

  async function handleClearBackground() {
    if (!active || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await clearMapBackground(active.id)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function placeAt(x: number, y: number) {
    if (!active || !placingId || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await updateDevice(placingId, { map_id: active.id, map_x: x, map_y: y })
      setSelectedId(placingId)
      setPlacingId(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function moveDevice(globalId: string, x: number, y: number) {
    if (!active || !canEdit) return
    try {
      await updateDevice(globalId, { map_id: active.id, map_x: x, map_y: y })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function unplace(globalId: string) {
    if (!canEdit) return
    try {
      await updateDevice(globalId, { clear_map: true })
      if (selectedId === globalId) setSelectedId(null)
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function saveSelectedVisual() {
    if (!selected || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await updateDevice(selected.global_id, {
        map_icon: editIcon,
        map_icon_size: editSize,
      })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function applyLayout(next: MapGridLayout) {
    if (alarmResumeRef.current) {
      if (next === 1) return
      alarmResumeRef.current = null
      sawAlarmWhilePinnedRef.current = false
      setResumeHint(null)
      setAlarmPinned(false)
    }
    if (next !== 1 && editMode) {
      setEditMode(false)
      setPlacingId(null)
      setCreating(false)
      setEditingMeta(false)
    }
    if (next !== 1) lastGridRef.current = next
    setLayout(next)
    setSlots((prev) => {
      let source = prev
      if (next > 1 && activeId != null && !prev.includes(activeId)) {
        source = [activeId, ...prev]
      }
      return resizeSlots(next, maps, source)
    })
  }

  function expandMap(mapId: number) {
    setActiveId(mapId)
    setLayout(1)
    const device = selectedId
      ? devicesRef.current.find((d) => d.global_id === selectedId)
      : null
    if (device && device.map_id !== mapId) setSelectedId(null)
  }

  const showAlarmCameras = alarmPinned || alarmQueue.length > 0
  const queueDeviceIds = useMemo(() => alarmQueue.map((q) => q.deviceId), [alarmQueue])
  const alarmCamCol = showAlarmCameras ? (
    <AlarmCameraColumn
      deviceId={selectedId}
      mapId={activeId}
      queueDeviceIds={queueDeviceIds}
      devices={devices}
    />
  ) : null

  const mapCanvas = active ? (
    <InteractiveFloorMap
      map={active}
      devices={onMapDevices}
      panels={panels}
      editable={canEdit}
      placing={canEdit && Boolean(placingId)}
      selectedId={selectedId}
      hideChrome
      showCanvasTools
      hideLegend
      legendAsIcon={!sidebarOpen || fullscreen}
      labelMode={labelMode}
      bgFit={bgFit}
      onLabelModeChange={canEditUi ? setLabelMode : undefined}
      onBgFitChange={
        canEditUi
          ? (next) => {
              setBgFitState(next)
              if (activeId != null) writeMapBgFit(activeId, next)
            }
          : undefined
      }
      onSelect={setSelectedId}
      onPlace={placeAt}
      onMove={moveDevice}
      liveFlashIds={liveFlashIds}
      trailPoints={trailLive}
      onHideTrail={() => setAlarmTrailHidden(true)}
      onClearTrail={() => clearAlarmTrail()}
      onTrailSnap={writeAllowed ? (blob) => handleTrailSnap(active.id, blob) : undefined}
      onTrailSnapError={setError}
      trailSnapBusy={snapBusyMapId === active.id}
    />
  ) : null

  const gridView = (
    <MapGridView
      maps={maps}
      devices={devices}
      panels={panels}
      layout={layout}
      slots={slots}
      selectedId={selectedId}
      labelMode={labelMode}
      liveFlashIds={liveFlashIds}
      trailPoints={trailLive}
      alarmMapId={alarmQueue[0]?.mapId ?? (alarmBanner ? activeId : null)}
      canTrailSnap={writeAllowed}
      trailSnapBusyMapId={snapBusyMapId}
      onTrailSnap={writeAllowed ? handleTrailSnap : undefined}
      onTrailSnapError={setError}
      onSlotsChange={canEditUi ? setSlots : undefined}
      assignable={canEditUi}
      onSelectDevice={(id) => {
        setSelectedId(id)
        if (!id) return
        const d = devicesRef.current.find((x) => x.global_id === id)
        if (d?.map_id != null) setActiveId(d.map_id)
      }}
      onExpandMap={expandMap}
    />
  )

  const toolBtn =
    'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-steel ring-1 ring-line/80 transition hover:bg-fog hover:text-ink disabled:opacity-40'
  const segBtn = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none transition ${
      active ? 'bg-accent text-panel' : 'text-steel hover:bg-fog/80 hover:text-ink'
    }`
  const toolGroup =
    'inline-flex items-center gap-1 rounded-lg bg-panel/40 px-1.5 py-1 ring-1 ring-line/50'
  const toolGroupLabel =
    'hidden shrink-0 select-none px-0.5 text-[9px] font-semibold tracking-wide text-steel/45 uppercase xl:inline'

  const toolbar = (
      <div className="flex w-full shrink-0 items-center gap-2">
      <div className={toolGroup} role="group" aria-label={vi.mapGridLayout}>
        <span className={toolGroupLabel}>{vi.mapGridLayout}</span>
        <MapLayoutPicker layout={layout} onChange={applyLayout} btnClass={segBtn} />
      </div>

      {!isGrid && (
        <div className={`${toolGroup} min-w-0 flex-1 overflow-hidden`} role="group" aria-label={vi.mapToolGroupFloors}>
          <span className={toolGroupLabel}>{vi.mapToolGroupFloors}</span>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            {maps.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setActiveId(m.id)
                  setSelectedId(null)
                  setPlacingId(null)
                  setEditingMeta(false)
                }}
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1 transition ${
                  active?.id === m.id
                    ? 'bg-accent/15 text-accent ring-accent/35'
                    : 'bg-mist/70 text-steel ring-line/60 hover:text-ink'
                }`}
              >
                <span className="max-w-[7rem] truncate">{m.name}</span>
                <span className="font-mono text-[10px] opacity-55">{m.device_count}</span>
              </button>
            ))}
            {!maps.length && <span className="text-[11px] text-steel/50">{vi.noMaps}</span>}
          </div>
        </div>
      )}

      {/* Nhãn / Ảnh / Bản đồ / Xem — sát phải */}
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {/* Nhãn marker — gộp thành 1 menu */}
        {canEditUi && (
        <div
          ref={labelMenuRef}
          className={`${toolGroup} relative`}
          role="group"
          aria-label={vi.mapLabelModeHint}
          title={vi.mapLabelModeHint}
        >
          <span className={toolGroupLabel}>{vi.mapToolGroupLabel}</span>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-mist/80 px-2 text-[11px] font-semibold text-ink ring-1 ring-line/70 transition hover:bg-fog"
            aria-expanded={labelMenuOpen}
            aria-haspopup="listbox"
            onClick={() => setLabelMenuOpen((v) => !v)}
          >
            <Tag className="size-3.5 text-accent" />
            <span>{MODE_LABEL[labelMode]}</span>
            <ChevronDown className={`size-3.5 text-steel/70 transition ${labelMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {labelMenuOpen && (
            <div
              role="listbox"
              aria-label={vi.mapLabelMode}
              className="absolute top-[calc(100%+4px)] right-0 z-40 min-w-[9.5rem] overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-line"
            >
              {MAP_MARKER_LABEL_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="option"
                  aria-selected={labelMode === mode}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] font-semibold transition ${
                    labelMode === mode
                      ? 'bg-accent/15 text-accent'
                      : 'text-steel hover:bg-fog hover:text-ink'
                  }`}
                  onClick={() => {
                    setLabelMode(mode)
                    setLabelMenuOpen(false)
                  }}
                >
                  {MODE_LABEL[mode]}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

      {/* Ảnh nền — upload / xóa / đồng bộ tỉ lệ (Vừa/Phủ/Giãn nằm trên canvas) */}
      {canEdit && active?.background_url && (
        <div className={toolGroup} role="group" aria-label={vi.mapToolGroupBg}>
          <span className={toolGroupLabel}>{vi.mapToolGroupBg}</span>
          <input
            ref={bgInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void handleBackgroundFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className={toolBtn}
            disabled={!active || busy}
            title={active?.background_url ? vi.changeMapImage : vi.chooseMapImage}
            onClick={() => bgInputRef.current?.click()}
          >
            <ImagePlus className="size-3.5" />
          </button>
          <button
            type="button"
            className={toolBtn}
            disabled={busy}
            title={vi.removeMapImage}
            onClick={() => void handleClearBackground()}
          >
            <ImageOff className="size-3.5" />
          </button>
          <button
            type="button"
            className={`${toolBtn} !w-auto gap-1 px-1.5 text-[10px] font-semibold`}
            disabled={busy}
            title={vi.mapBgSyncAspect}
            onClick={() => void syncMapAspectToBackground()}
          >
            {vi.mapBgFitFit}
          </button>
        </div>
      )}

      {/* Ảnh nền khi chưa có URL — chỉ nút chọn ảnh */}
      {canEdit && active && !active.background_url && (
        <div className={toolGroup} role="group" aria-label={vi.mapToolGroupBg}>
          <span className={toolGroupLabel}>{vi.mapToolGroupBg}</span>
          <input
            ref={bgInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void handleBackgroundFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className={toolBtn}
            disabled={busy}
            title={vi.chooseMapImage}
            onClick={() => bgInputRef.current?.click()}
          >
            <ImagePlus className="size-3.5" />
          </button>
        </div>
      )}

      {/* Quản lý bản đồ — chỉ khi chỉnh sửa */}
      {canEdit && (
        <div className={toolGroup} role="group" aria-label={vi.mapToolGroupMap}>
          <span className={toolGroupLabel}>{vi.mapToolGroupMap}</span>
          <button
            type="button"
            className={toolBtn}
            disabled={!active}
            title={vi.editMap}
            onClick={() => {
              setEditingMeta(true)
              setCreating(false)
            }}
          >
            <Settings2 className="size-3.5" />
          </button>
          <button
            type="button"
            className={`${toolBtn} text-danger hover:bg-danger/10`}
            disabled={!active || busy}
            title={vi.deleteMap}
            onClick={() => void handleDelete()}
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            className={`${toolBtn} bg-accent/15 text-accent ring-accent/30`}
            title={vi.addMap}
            onClick={() => {
              setCreating(true)
              setEditingMeta(false)
              setPendingBgFile(null)
            }}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      )}

      {/* Chế độ xem */}
      <div className={toolGroup} role="group" aria-label={vi.mapToolGroupView}>
        <span className={toolGroupLabel}>{vi.mapToolGroupView}</span>
        {canEditUi && (
        <button
          type="button"
          onClick={() => {
            setEditMode((v) => {
              const next = !v
              if (next && layoutRef.current !== 1) {
                const focusMap =
                  (selectedId &&
                    devicesRef.current.find((d) => d.global_id === selectedId)?.map_id) ||
                  slotsRef.current.find((id) => id != null) ||
                  activeId
                if (typeof focusMap === 'number') setActiveId(focusMap)
                setLayout(1)
              }
              return next
            })
          }}
          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ring-1 transition disabled:opacity-40 ${
            editMode
              ? 'bg-warn/15 text-warn ring-warn/35'
              : 'bg-mist text-steel ring-line/80 hover:text-ink'
          }`}
          title={isGrid ? vi.mapGridEditHint : vi.editModeHint}
        >
          <Pencil className="size-3.5" />
          <span className="hidden sm:inline">{editMode ? vi.editModeOn : vi.editMode}</span>
        </button>
        )}

        {!fullscreen && !isGrid && !showAlarmCameras && (
          <button
            type="button"
            className={toolBtn}
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? vi.mapCompact : vi.mapExpandSidebar}
          >
            {sidebarOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
          </button>
        )}

        {!fullscreen && (
          <button
            type="button"
            className={toolBtn}
            onClick={() => setFullscreen(true)}
            title={vi.mapFullscreen}
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Fullscreen: Thu gọn + Điều khiển sát góc phải (Điều khiển = vị trí nút góc) */}
      {fullscreen && (
        <>
          <button
            type="button"
            className={toolBtn}
            onClick={() => setFullscreen(false)}
            title={`${vi.mapExitFullscreen} (Esc)`}
          >
            <Minimize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className={`${toolBtn} ${
              devices.some((d) => (d.state || '').toLowerCase() === 'alarm')
                ? 'header-sections-alarm ring-danger/40'
                : 'bg-accent/15 text-accent ring-accent/35 hover:bg-accent/25'
            }`}
            title={vi.headerSectionsHint}
            aria-label={vi.headerSections}
            onClick={() => openSectionsQuickModal()}
          >
            <Rows3 className="size-3.5" />
          </button>
          <Link
            to="/"
            onClick={() => setFullscreen(false)}
            className={`${toolBtn} bg-accent/15 text-accent ring-accent/35 hover:bg-accent/25`}
            title={vi.mapGoDashboardHint}
            aria-label={vi.mapGoDashboard}
          >
            <LayoutDashboard className="size-3.5" />
          </Link>
        </>
      )}
      </div>
    </div>
  )

  const sidebar = (
    <aside className="flex min-h-0 w-full flex-col gap-2 overflow-auto lg:w-[280px] lg:shrink-0 lg:overflow-hidden">
      <Card className="!p-2.5 shrink-0">
        <h4 className="mb-1.5 text-[10px] font-semibold tracking-wide text-steel uppercase">
          {vi.deviceStatus}
        </h4>
        <div className="grid grid-cols-3 gap-1">
          {STATUS_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className="rounded-md bg-fog/80 px-1.5 py-1.5 text-left ring-1 ring-line/60 transition hover:ring-accent/40"
            >
              <p className="font-mono text-[9px] text-steel/55">{item.label}</p>
              <p className="font-mono text-sm font-semibold tabular-nums" style={{ color: item.color }}>
                {statusSummary[item.key]}
              </p>
            </button>
          ))}
        </div>
      </Card>

      {selected && (
        <Card className="!p-2.5 shrink-0">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-[10px] font-semibold tracking-wide text-steel uppercase">
                {vi.selectedDevice}
              </h4>
              <p className="mt-0.5 truncate text-sm font-semibold text-ink">
                {formatMapDeviceCaption(selected)}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-steel/55">
                <span className="truncate">{selected.global_id}</span>
                {selected.model ? <span>{selected.model}</span> : null}
                <LinkBadge link={selected.link} />
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge device={selected} />
              {reactionShowsMapChip(selected.reaction) ? (
                <ReactionBadge reaction={selected.reaction} />
              ) : null}
            </div>
          </div>

          {canEdit ? (
            <>
              <DeviceIconPicker
                compact
                value={editIcon}
                size={editSize}
                onChange={setEditIcon}
                onSizeChange={setEditSize}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Btn disabled={busy} onClick={() => void saveSelectedVisual()} className="!py-1.5">
                  {vi.save}
                </Btn>
                <Btn tone="ghost" onClick={() => void unplace(selected.global_id)} className="!py-1.5">
                  {vi.unplaceDevice}
                </Btn>
                <Btn tone="ghost" onClick={() => setSelectedId(null)} className="!py-1.5">
                  <X className="size-3.5" />
                </Btn>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="text-[10px] text-steel/50 hover:text-steel"
              onClick={() => setSelectedId(null)}
            >
              {vi.closeModal}
            </button>
          )}
        </Card>
      )}

      <Card className="!p-2.5 flex min-h-0 flex-1 flex-col overflow-hidden">
        <h4 className="mb-1.5 shrink-0 text-[10px] font-semibold tracking-wide text-steel uppercase">
          {vi.onMapDevices}
          <span className="ml-1 font-mono text-steel/50">({onMapDevices.length})</span>
        </h4>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto">
          {onMapDevices.map((d) => (
            <DeviceRow
              key={d.global_id}
              device={d}
              active={selectedId === d.global_id}
              liveFlash={liveFlashIds?.has(d.global_id)}
              onSelect={() => setSelectedId(d.global_id)}
              onUnplace={
                canEdit
                  ? () => {
                      void unplace(d.global_id)
                    }
                  : undefined
              }
            />
          ))}
          {!onMapDevices.length && (
            <li className="px-1 py-2 text-[11px] text-steel/45">{vi.noDevicesOnMap}</li>
          )}
        </ul>
      </Card>

      {canEdit && (
        <Card className="!p-2.5 flex max-h-[34%] min-h-[120px] flex-col overflow-hidden">
          <h4 className="mb-1.5 shrink-0 text-[10px] font-semibold tracking-wide text-steel uppercase">
            {vi.placeDevice}
            <span className="ml-1 font-mono text-steel/50">({unplaced.length})</span>
          </h4>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto">
            {unplaced.map((d) => {
              const st = effectiveDeviceStatus(d.state, d.disable)
              return (
                <li key={d.global_id}>
                  <button
                    type="button"
                    onClick={() => setPlacingId(d.global_id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ring-1 transition ${
                      placingId === d.global_id
                        ? 'bg-accent/15 text-accent ring-accent/40'
                        : 'bg-fog/70 text-ink ring-transparent hover:ring-line'
                    }`}
                  >
                    <DeviceTypeIcon type={resolveDeviceIconKey(d)} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-medium">{formatMapDeviceCaption(d)}</span>
                    <LinkBadge link={d.link} showEmpty={false} />
                    <span
                      className="shrink-0 font-mono text-[10px] font-semibold"
                      style={{ color: mapStatusColor(st) }}
                    >
                      {labelOf(deviceStateLabel, st)}
                    </span>
                  </button>
                </li>
              )
            })}
            {!unplaced.length && (
              <li className="px-1 py-2 text-[11px] text-steel/45">{vi.allDevicesPlaced}</li>
            )}
          </ul>
        </Card>
      )}

      <div className="mt-auto shrink-0 rounded-lg bg-panel/60 px-2.5 py-1.5 ring-1 ring-line/60">
        <p className="mb-1 text-[9px] font-semibold tracking-wide text-steel/55 uppercase">
          {vi.statusLegend}
        </p>
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {STATUS_ITEMS.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1 font-mono text-[10px] text-steel/80">
              <span
                className="inline-block size-2 rounded-full ring-1 ring-white/70"
                style={{ background: item.color, boxShadow: `0 0 5px ${item.color}` }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )

  const forms = (
    <>
      {creating && canEdit && (
        <Card className="shrink-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{vi.addMap}</h3>
            <button type="button" className="text-steel hover:text-ink" onClick={() => setCreating(false)}>
              <X className="size-4" />
            </button>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
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
            <Field label={vi.chooseMapImage}>
              <div className="flex items-center gap-2">
                <input
                  ref={createBgInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => setPendingBgFile(e.target.files?.[0] ?? null)}
                />
                <Btn
                  type="button"
                  tone="ghost"
                  className="!py-2"
                  onClick={() => createBgInputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" />
                  {pendingBgFile ? pendingBgFile.name : 'Chọn file…'}
                </Btn>
              </div>
            </Field>
            <div className="flex items-end gap-2">
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

      {editingMeta && active && canEdit && (
        <Card className="shrink-0">
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
              <input name="description" className={inputClass} defaultValue={active.description} />
            </Field>
            <div className="flex items-end gap-2">
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

      {placingId && canEdit && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg bg-accent/12 px-3 py-2 ring-1 ring-accent/30">
          <p className="text-xs text-accent">
            {vi.clickToPlace} <span className="font-mono font-semibold">{placingId}</span>
          </p>
          <Btn tone="ghost" className="!py-1" onClick={() => setPlacingId(null)}>
            {vi.cancelPlace}
          </Btn>
        </div>
      )}
    </>
  )

  const statusModal = statusFilter && (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={() => setStatusFilter(null)}
      role="presentation"
    >
      <div
        className="panel-card flex max-h-[min(78vh,640px)] w-full max-w-md flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={vi.statusFilterTitle(labelOf(deviceStateLabel, statusFilter))}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {vi.statusFilterTitle(
                STATUS_ITEMS.find((s) => s.key === statusFilter)?.label ??
                  labelOf(deviceStateLabel, statusFilter),
              )}
            </h3>
            <p className="font-mono text-[11px] text-steel/55">
              {filteredByStatus.length} {vi.sensors}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-steel hover:bg-mist hover:text-ink"
            onClick={() => setStatusFilter(null)}
            aria-label={vi.closeModal}
          >
            <X className="size-4" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-auto p-3">
          {filteredByStatus.map((d) => (
            <li key={d.global_id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ring-1 ring-transparent transition hover:bg-fog hover:ring-line"
                onClick={() => {
                  setSelectedId(d.global_id)
                  setStatusFilter(null)
                }}
              >
                <DeviceTypeIcon type={resolveDeviceIconKey(d)} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{formatMapDeviceCaption(d)}</span>
                  <span className="block truncate font-mono text-[10px] text-steel/55">{d.global_id}</span>
                </span>
                <StatusBadge device={d} />
              </button>
            </li>
          ))}
          {!filteredByStatus.length && (
            <li className="px-2 py-6 text-center text-xs text-steel/50">{vi.statusFilterEmpty}</li>
          )}
        </ul>
      </div>
    </div>
  )

  if (fullscreen && (active || (isGrid && maps.length))) {
    return (
      <>
        <div className="fixed inset-0 z-[70] flex flex-col bg-panel">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
            {toolbar}
          </div>
          {!isGrid && forms}
          {(error) && (
            <p className="mx-3 mt-2 shrink-0 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}
          {info && (
            <p className="mx-3 mt-2 shrink-0 rounded-md bg-ok/10 px-3 py-2 text-xs text-ok">{info}</p>
          )}
          {alarmAlertBar && <div className="mx-3 mt-2">{alarmAlertBar}</div>}
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">{isGrid ? gridView : mapCanvas}</div>
            {!isGrid && alarmCamCol ? (
              <div className="min-h-[220px] w-full shrink-0 md:h-full md:w-[20rem] xl:w-[22rem]">
                {alarmCamCol}
              </div>
            ) : null}
          </div>
        </div>
        {statusModal}
      </>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-4.25rem)] min-h-[520px] w-full flex-col gap-1.5 px-3 py-2 sm:h-[calc(100dvh-3.75rem)] sm:px-4 lg:px-5">
      {toolbar}

      {!writeAllowed && (
        <p className="shrink-0 rounded-md bg-warn/10 px-3 py-1.5 text-xs text-warn">
          {vi.readOnlyHint}
        </p>
      )}
      {error && (
        <p className="shrink-0 rounded-md bg-danger/10 px-3 py-1.5 text-xs text-danger">{error}</p>
      )}
      {info && (
        <p className="shrink-0 rounded-md bg-ok/10 px-3 py-1.5 text-xs text-ok">{info}</p>
      )}
      {alarmAlertBar}

      {!isGrid && forms}

      {isGrid && maps.length ? (
        <div className="min-h-0 min-w-0 flex-1">{gridView}</div>
      ) : active ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
          <div className="flex min-h-[280px] min-w-0 flex-1 flex-col md:min-h-0">{mapCanvas}</div>
          {alarmCamCol ? (
            <div className="min-h-[220px] w-full shrink-0 md:h-full md:w-[20rem] xl:w-[22rem]">
              {alarmCamCol}
            </div>
          ) : null}
          {!showAlarmCameras && sidebarOpen && sidebar}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line bg-mist/30">
          <div className="max-w-sm px-6 py-10 text-center">
            <MapIcon className="mx-auto size-8 text-steel/40" />
            <p className="mt-3 text-sm text-steel/70">{vi.noMaps}</p>
            {canEditUi && (
              <Btn
                className="mt-4"
                onClick={() => {
                  setEditMode(true)
                  setCreating(true)
                  setPendingBgFile(null)
                }}
              >
                <Plus className="size-3.5" /> {vi.addMap}
              </Btn>
            )}
          </div>
        </div>
      )}

      {statusModal}
    </div>
  )
}

function StatusBadge({ device }: { device: Device }) {
  const st = effectiveDeviceStatus(device.state, device.disable)
  const color = mapStatusColor(st)
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] font-semibold"
      style={{
        color,
        background: `${color}18`,
        boxShadow: `inset 0 0 0 1px ${color}40`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {labelOf(deviceStateLabel, st)}
    </span>
  )
}

function DeviceRow({
  device,
  active,
  liveFlash,
  onSelect,
  onUnplace,
}: {
  device: Device
  active: boolean
  liveFlash?: boolean
  onSelect: () => void
  onUnplace?: () => void
}) {
  const st = effectiveDeviceStatus(device.state, device.disable)
  const color = mapStatusColor(st)
  return (
    <li
      className={`flex items-center justify-between gap-1.5 rounded-md px-1.5 py-1 text-xs ring-1 transition ${
        liveFlash
          ? 'bg-accent/20 text-ink ring-accent/50'
          : active
            ? 'bg-accent/15 text-accent ring-accent/40'
            : 'bg-fog/60 text-ink ring-transparent'
      }`}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <DeviceTypeIcon type={resolveDeviceIconKey(device)} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{formatMapDeviceCaption(device)}</span>
        <LinkBadge link={device.link} showEmpty={false} />
        {reactionShowsMapChip(device.reaction) ? <ReactionBadge reaction={device.reaction} /> : null}
        <span className="shrink-0 font-mono text-[10px] font-semibold" style={{ color }}>
          {labelOf(deviceStateLabel, st)}
        </span>
      </button>
      {onUnplace && (
        <button
          type="button"
          className="text-steel hover:text-danger"
          onClick={onUnplace}
          title={vi.unplaceDevice}
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </li>
  )
}
