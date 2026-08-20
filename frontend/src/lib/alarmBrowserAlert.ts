const TITLE_BASE_KEY = 'cms:doc-title-base'
const NOTIFY_PREF_KEY = 'cms:alarm-desktop-notify'
const FLASH_PREF_KEY = 'cms:alarm-title-flash'
const FLASH_MS = 12000

let flashTimer: number | undefined
let flashOn = false

function readFlag(key: string, defaultOn: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return defaultOn
    return raw !== '0'
  } catch {
    return defaultOn
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function isAlarmDesktopNotifyEnabled(): boolean {
  return readFlag(NOTIFY_PREF_KEY, true)
}

export function setAlarmDesktopNotifyEnabled(on: boolean): void {
  writeFlag(NOTIFY_PREF_KEY, on)
}

/** Mặc định bật — giữ hành vi nhấp tiêu đề khi tab ẩn. */
export function isAlarmTitleFlashEnabled(): boolean {
  return readFlag(FLASH_PREF_KEY, true)
}

export function setAlarmTitleFlashEnabled(on: boolean): void {
  writeFlag(FLASH_PREF_KEY, on)
}

export async function ensureAlarmNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function setDocumentTitleBase(title: string): void {
  const next = title.trim() || 'Jablotron Enterprise CMS'
  try {
    sessionStorage.setItem(TITLE_BASE_KEY, next)
  } catch {
    /* ignore */
  }
  if (!flashTimer) document.title = next
}

function stopTitleFlash(): void {
  if (flashTimer) {
    window.clearInterval(flashTimer)
    flashTimer = undefined
  }
  flashOn = false
  try {
    const base = sessionStorage.getItem(TITLE_BASE_KEY)
    if (base) document.title = base
  } catch {
    /* ignore */
  }
}

function startTitleFlash(caption: string): void {
  try {
    if (!sessionStorage.getItem(TITLE_BASE_KEY)) {
      sessionStorage.setItem(TITLE_BASE_KEY, document.title || 'Jablotron CMS')
    }
  } catch {
    /* ignore */
  }
  stopTitleFlash()
  const base = (() => {
    try {
      return sessionStorage.getItem(TITLE_BASE_KEY) || 'Jablotron CMS'
    } catch {
      return 'Jablotron CMS'
    }
  })()
  const alertTitle = `⚠ BÁO ĐỘNG — ${caption}`
  flashOn = true
  document.title = alertTitle
  flashTimer = window.setInterval(() => {
    flashOn = !flashOn
    document.title = flashOn ? alertTitle : base
  }, 900)
  window.setTimeout(stopTitleFlash, FLASH_MS)
  const onVis = () => {
    if (document.visibilityState === 'visible') {
      stopTitleFlash()
      document.removeEventListener('visibilitychange', onVis)
    }
  }
  document.addEventListener('visibilitychange', onVis)
}

/**
 * Cố gắng báo người vận hành khi UI đang ẩn/minimise.
 * Trình duyệt không cho ép cửa sổ nhảy lên taskbar tự động (bảo mật) —
 * dùng thông báo Windows + nhấp nháy title; bấm thông báo sẽ focus lại tab.
 */
export function alertBrowserOnAlarm(opts: {
  caption: string
  mapName?: string
  onOpen?: () => void
}): void {
  const { caption, mapName, onOpen } = opts
  const body = mapName ? `${caption} — ${mapName}` : caption

  try {
    window.focus()
  } catch {
    /* ignore */
  }

  const api = window.pywebview?.api
  if (api && typeof api.raise_on_alarm === 'function') {
    void api.raise_on_alarm().catch(() => undefined)
  }

  if (document.hidden || document.visibilityState !== 'visible') {
    if (isAlarmTitleFlashEnabled()) startTitleFlash(caption)
  }

  if (!isAlarmDesktopNotifyEnabled()) return
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return

  try {
    // renotify / requireInteraction chưa có trong lib.dom hiện tại.
    const n = new Notification('Jablotron CMS — Báo động', {
      body,
      tag: 'cms-alarm',
      renotify: true,
      requireInteraction: true,
    } as NotificationOptions & { renotify: boolean; requireInteraction: boolean })
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      onOpen?.()
      n.close()
      stopTitleFlash()
    }
  } catch {
    /* ignore */
  }
}

declare global {
  interface Window {
    pywebview?: {
      api?: {
        raise_on_alarm?: () => Promise<unknown>
        set_title?: (title: string) => Promise<unknown>
        refresh_branding?: (title?: string) => Promise<unknown>
      }
    }
  }
}
