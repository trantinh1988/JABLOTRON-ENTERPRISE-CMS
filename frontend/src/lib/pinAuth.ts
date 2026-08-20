import type { Panel, PanelUser } from '../api/client'
import { formatCommandError, vi } from '../i18n/vi'

export type PinNeed = 'arm' | 'disarm'

export type ParsedPin = {
  userNum?: number
  pin: string
}

const PIN_COMMAND_ERRORS = new Set(['wrong_pin_code', 'invalid_pin_code', 'pin_required'])
const PIN_PLAIN = /^\d{4,10}$/
const PIN_PREFIXED = /^(\d{1,2})\*(\d{4,10})$/

export function panelControllable(panel: Panel, mockMode: boolean | null): boolean {
  if (mockMode) return true
  return panel.connection === 'usb'
}

/** F-Link user number from CMS id (`PANEL_1_USER_2` → 2). */
export function flinkUserNum(userId: string): number | null {
  const m = /_USER_(\d+)$/.exec(userId)
  return m ? Number(m[1]) : null
}

export function parsePinInput(raw: string): ParsedPin | null {
  const s = raw.trim()
  const prefixed = PIN_PREFIXED.exec(s)
  if (prefixed) return { userNum: Number(prefixed[1]), pin: prefixed[2] }
  if (PIN_PLAIN.test(s)) return { pin: s }
  return null
}

/** Keep digits and a single `*` (F-Link `2*1234`). */
export function sanitizePinInput(raw: string, maxLen = 13): string {
  let star = false
  let out = ''
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') out += ch
    else if (ch === '*' && !star) {
      star = true
      out += '*'
    }
    if (out.length >= maxLen) break
  }
  return out
}

export function storedPin(user: Pick<PanelUser, 'code_label'>): ParsedPin | null {
  return parsePinInput(user.code_label || '')
}

export function pinUsersOf(users: PanelUser[]): PanelUser[] {
  return users.filter((u) => storedPin(u) != null)
}

export function userIsAdmin(user: Pick<PanelUser, 'permissions'>): boolean {
  return user.permissions.includes('admin')
}

export function userCanPinAction(user: PanelUser, need: PinNeed): boolean {
  if (userIsAdmin(user)) return true
  if (user.permissions.includes(need)) return true
  // F-Link regular user: arm/disarm unless other rights were set explicitly.
  if (!user.permissions.length && (need === 'arm' || need === 'disarm')) return true
  return false
}

export function usersMatchingPin(users: PanelUser[], typed: string): PanelUser[] {
  const input = parsePinInput(typed)
  if (!input) return []
  return pinUsersOf(users).filter((u) => {
    const stored = storedPin(u)
    if (!stored || stored.pin !== input.pin) return false
    if (input.userNum != null) {
      const slot = stored.userNum ?? flinkUserNum(u.user_id)
      return slot === input.userNum
    }
    return true
  })
}

export function resolvePinUser(
  users: PanelUser[],
  typed: string,
  need: PinNeed,
): { user: PanelUser } | { error: string } {
  if (!parsePinInput(typed)) return { error: vi.keypadPinInvalid }
  const match = usersMatchingPin(users, typed)[0]
  if (!match) return { error: vi.keypadWrongCode }
  if (!userCanPinAction(match, need)) return { error: vi.keypadNoPermission }
  return { user: match }
}

/** Code to send to the panel (include `N*` when stored/typed that way). */
export function panelAuthCode(user: PanelUser, typed: string): string {
  const stored = storedPin(user)
  const input = parsePinInput(typed)
  const pin = stored?.pin ?? input?.pin ?? typed.trim()
  const slot = stored?.userNum ?? input?.userNum ?? flinkUserNum(user.user_id)
  if (stored?.userNum != null || input?.userNum != null) {
    return slot != null ? `${slot}*${pin}` : pin
  }
  return pin
}

export function panelAuthUserNum(user: PanelUser, typed: string): number | undefined {
  const stored = storedPin(user)
  const input = parsePinInput(typed)
  return stored?.userNum ?? input?.userNum ?? flinkUserNum(user.user_id) ?? undefined
}

/** Map backend/group-action PIN failures onto the PIN modal warning. */
export function pinCommandErrorMessage(raw: string): string | null {
  const code = raw.trim()
  if (PIN_COMMAND_ERRORS.has(code)) return formatCommandError(code)
  for (const key of PIN_COMMAND_ERRORS) {
    if (code.endsWith(`: ${key}`) || code.endsWith(` ${key}`)) {
      return formatCommandError(key)
    }
  }
  return null
}
