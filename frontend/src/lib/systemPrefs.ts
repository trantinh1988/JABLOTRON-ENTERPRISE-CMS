/** Tùy chọn vận hành máy trạm — localStorage, không đụng USB / panel. */

const TRAIL_KEY = 'cms:alarm-trail-enabled'
const SOUND_KEY = 'cms:alert-sound-enabled'

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

/** Mặc định bật — giữ hành vi truy vết hiện tại. */
export function isAlarmTrailEnabled(): boolean {
  return readFlag(TRAIL_KEY, true)
}

export function setAlarmTrailEnabled(on: boolean): void {
  writeFlag(TRAIL_KEY, on)
}

/** Mặc định tắt — chưa có file thì không phát (hành vi cũ: im lặng). */
export function isAlertSoundEnabled(): boolean {
  return readFlag(SOUND_KEY, false)
}

export function setAlertSoundEnabled(on: boolean): void {
  writeFlag(SOUND_KEY, on)
}
