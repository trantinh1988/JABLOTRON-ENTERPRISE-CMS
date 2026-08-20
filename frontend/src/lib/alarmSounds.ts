import {
  deleteAlertSound,
  deleteSiteLogo,
  getSystemSettings,
  patchSystemSettings,
  uploadAlertSound,
  uploadSiteLogo,
  type AlertSoundSlot,
  type SystemSettings,
} from '../api/client'
import { vi } from '../i18n/vi'
import { setAlarmTrailEnabled, setAlertSoundEnabled } from './systemPrefs'

export const ALERT_SOUND_STATUSES = ['alarm', 'tamper', 'fault', 'loss'] as const
export type AlertSoundStatus = (typeof ALERT_SOUND_STATUSES)[number]

export const ALERT_SOUND_MAX_BYTES = 2 * 1024 * 1024

const IDB_NAME = 'cms-system'
const IDB_STORE = 'alert-sounds'
const MIGRATE_KEY = 'cms:alert-sound-migrated'
const DEDUPE_MS = 600

type SoundMeta = { name: string; type: string; url?: string }

let catalog: SystemSettings | null = null
let hydratePromise: Promise<SystemSettings> | null = null
let hydrated = false
let currentAudio: HTMLAudioElement | null = null
let lastPlay: { status: string; at: number } | null = null
const settingsListeners = new Set<() => void>()

export const DEFAULT_SITE_TITLE = `${vi.brandTitle} ${vi.brandAccent}`
export const SITE_TITLE_MAX = 80
export const LOGO_MAX_BYTES = 1 * 1024 * 1024

export function isAlertSoundStatus(value: string): value is AlertSoundStatus {
  return (ALERT_SOUND_STATUSES as readonly string[]).includes(value)
}

function notifySettings(): void {
  for (const fn of settingsListeners) fn()
}

function applyCatalog(next: SystemSettings): SystemSettings {
  catalog = next
  setAlertSoundEnabled(next.sound_enabled)
  setAlarmTrailEnabled(next.trail_enabled)
  notifySettings()
  return next
}

export function getSiteTitle(): string {
  const custom = catalog?.site_title?.trim()
  return custom || DEFAULT_SITE_TITLE
}

export function getSiteLogoUrl(): string | null {
  const url = catalog?.site_logo?.url?.trim()
  return url || null
}

export function subscribeSystemSettings(fn: () => void): () => void {
  settingsListeners.add(fn)
  return () => {
    settingsListeners.delete(fn)
  }
}

export function getAlertSoundMeta(): Partial<Record<AlertSoundStatus, SoundMeta>> {
  const sounds = catalog?.sounds ?? {}
  const out: Partial<Record<AlertSoundStatus, SoundMeta>> = {}
  for (const status of ALERT_SOUND_STATUSES) {
    const slot = sounds[status]
    if (slot?.name && slot.url) {
      out[status] = { name: slot.name, type: slot.type || '', url: slot.url }
    }
  }
  return out
}

export function getCachedSystemSettings(): SystemSettings | null {
  return catalog
}

export function slotOf(status: AlertSoundStatus): AlertSoundSlot | null {
  return catalog?.sounds[status] ?? null
}

function openLegacyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('unsupported'))
      return
    }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb'))
  })
}

async function readLegacyBlob(
  status: AlertSoundStatus,
): Promise<{ name: string; type: string; blob: Blob } | null> {
  try {
    const db = await openLegacyDb()
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(status)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('idb'))
    })
    if (!raw || typeof raw !== 'object') return null
    const rec = raw as { name?: string; type?: string; blob?: Blob }
    if (!(rec.blob instanceof Blob)) return null
    return { name: rec.name || `${status}.wav`, type: rec.type || rec.blob.type || 'audio/wav', blob: rec.blob }
  } catch {
    return null
  }
}

async function clearLegacyStore(): Promise<void> {
  try {
    const db = await openLegacyDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('idb'))
    })
  } catch {
    /* ignore */
  }
}

/** Máy đã chọn file lúc còn IndexedDB — đẩy lên server một lần. */
async function migrateLegacyIfNeeded(remote: SystemSettings): Promise<SystemSettings> {
  try {
    if (localStorage.getItem(MIGRATE_KEY) === '1') return remote
  } catch {
    /* ignore */
  }
  let next = remote
  let uploaded = false
  for (const status of ALERT_SOUND_STATUSES) {
    if (next.sounds[status]?.url) continue
    const rec = await readLegacyBlob(status)
    if (!rec) continue
    try {
      const file = new File([rec.blob], rec.name, { type: rec.type })
      next = applyCatalog(await uploadAlertSound(status, file))
      uploaded = true
    } catch {
      /* máy khác / read-only — bỏ qua */
    }
  }
  try {
    localStorage.setItem(MIGRATE_KEY, '1')
  } catch {
    /* ignore */
  }
  if (uploaded) await clearLegacyStore()
  return next
}

const EMPTY_SETTINGS: SystemSettings = {
  sound_enabled: false,
  trail_enabled: true,
  site_title: '',
  sounds: {},
}

export async function hydrateAlertSounds(): Promise<SystemSettings> {
  if (hydrated && catalog) return catalog
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const remote = await getSystemSettings()
      if (hydrated && catalog) return catalog
      applyCatalog(remote)
      const next = await migrateLegacyIfNeeded(catalog ?? remote)
      hydrated = true
      return next
    })().catch(() => {
      hydratePromise = null
      return catalog ?? EMPTY_SETTINGS
    })
  }
  return hydratePromise
}

export function validateAlertSoundFile(file: File): string | null {
  if (file.size > ALERT_SOUND_MAX_BYTES) return 'too_big'
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  const okType =
    type.startsWith('audio/') ||
    name.endsWith('.mp3') ||
    name.endsWith('.wav') ||
    name.endsWith('.ogg') ||
    name.endsWith('.m4a') ||
    name.endsWith('.webm')
  if (!okType) return 'bad_type'
  return null
}

export async function saveAlertSoundFile(status: AlertSoundStatus, file: File): Promise<SystemSettings> {
  const next = applyCatalog(await uploadAlertSound(status, file))
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

export async function clearAlertSoundFile(status: AlertSoundStatus): Promise<SystemSettings> {
  const next = applyCatalog(await deleteAlertSound(status))
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

export async function persistSystemSoundPref(on: boolean): Promise<SystemSettings> {
  const next = applyCatalog(await patchSystemSettings({ sound_enabled: on }))
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

export async function persistSystemTrailPref(on: boolean): Promise<SystemSettings> {
  const next = applyCatalog(await patchSystemSettings({ trail_enabled: on }))
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

export async function persistSiteTitle(title: string): Promise<SystemSettings> {
  const next = applyCatalog(await patchSystemSettings({ site_title: title.trim().slice(0, SITE_TITLE_MAX) }))
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

export function validateLogoFile(file: File): string | null {
  if (file.size > LOGO_MAX_BYTES) return 'too_big'
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  const okType =
    type.startsWith('image/') ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp') ||
    name.endsWith('.svg')
  if (!okType) return 'bad_type'
  return null
}

export async function persistSiteLogo(file: File): Promise<SystemSettings> {
  const next = applyCatalog(await uploadSiteLogo(file))
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

export async function clearSiteLogo(): Promise<SystemSettings> {
  const next = applyCatalog(await deleteSiteLogo())
  hydrated = true
  hydratePromise = Promise.resolve(next)
  return next
}

function stopCurrent(): void {
  if (!currentAudio) return
  try {
    currentAudio.pause()
    currentAudio.removeAttribute('src')
    currentAudio.load()
  } catch {
    /* ignore */
  }
  currentAudio = null
}

async function playUrl(url: string): Promise<void> {
  stopCurrent()
  const audio = new Audio(url)
  currentAudio = audio
  const release = () => {
    if (currentAudio === audio) currentAudio = null
  }
  audio.addEventListener('ended', release, { once: true })
  audio.addEventListener('error', release, { once: true })
  try {
    await audio.play()
  } catch {
    release()
    throw new Error('play_fail')
  }
}

/**
 * Phát file đã gán cho trạng thái (URL trên máy chủ CMS).
 * `preview` = nghe thử từ trang Hệ thống (bỏ qua công tắc master / chống trùng).
 */
export async function playAlertSound(
  status: string,
  opts?: { preview?: boolean },
): Promise<'ok' | 'off' | 'empty' | 'play_fail'> {
  if (!isAlertSoundStatus(status)) return 'empty'
  try {
    if (!catalog) await hydrateAlertSounds()
  } catch {
    /* dùng cache / local */
  }
  if (!opts?.preview && !catalog?.sound_enabled) return 'off'
  if (!opts?.preview) {
    const now = Date.now()
    if (lastPlay && lastPlay.status === status && now - lastPlay.at < DEDUPE_MS) return 'ok'
    lastPlay = { status, at: now }
  }
  const url = catalog?.sounds[status]?.url
  if (!url) return 'empty'
  try {
    await playUrl(url)
    return 'ok'
  } catch {
    return 'play_fail'
  }
}
