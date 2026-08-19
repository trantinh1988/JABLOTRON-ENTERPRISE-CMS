import type { Panel, PanelUser } from '../api/client'
import { formatCommandError, vi } from '../i18n/vi'

export type PinNeed = 'arm' | 'disarm'

const PIN_COMMAND_ERRORS = new Set(['wrong_pin_code', 'invalid_pin_code', 'pin_required'])

export function panelControllable(panel: Panel, mockMode: boolean | null): boolean {
  if (mockMode) return true
  return panel.connection === 'usb'
}

export function pinUsersOf(users: PanelUser[]): PanelUser[] {
  return users.filter((u) => Boolean(u.code_label && /^\d{4,10}$/.test(u.code_label)))
}

export function userIsAdmin(user: Pick<PanelUser, 'permissions'>): boolean {
  return user.permissions.includes('admin')
}

export function userCanPinAction(user: PanelUser, need: PinNeed): boolean {
  if (userIsAdmin(user)) return true
  return user.permissions.includes(need)
}

export function usersMatchingPin(users: PanelUser[], pin: string): PanelUser[] {
  if (!/^\d{4,10}$/.test(pin)) return []
  return pinUsersOf(users).filter((u) => u.code_label === pin)
}

export function resolvePinUser(
  users: PanelUser[],
  pin: string,
  need: PinNeed,
): { user: PanelUser } | { error: string } {
  if (!/^\d{4,10}$/.test(pin)) return { error: vi.keypadPinInvalid }
  const match = pinUsersOf(users).find((u) => u.code_label === pin)
  if (!match) return { error: vi.keypadWrongCode }
  if (!userCanPinAction(match, need)) return { error: vi.keypadNoPermission }
  return { user: match }
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
