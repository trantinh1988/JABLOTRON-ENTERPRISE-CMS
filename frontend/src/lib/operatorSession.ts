import type { PanelUser } from '../api/client'
import { vi } from '../i18n/vi'
import { pinUsersOf, parsePinInput, userIsAdmin, usersMatchingPin } from './pinAuth'

const STORAGE_KEY = 'cms.operator.session.v1'
const LOCK_KEY = 'cms.operator.locked.v1'

export type OperatorMatch = {
  userId: string
  panelId: string
  name: string
  permissions: string[]
}

export type OperatorSession = {
  pin: string
  userName: string
  isAdmin: boolean
  setup: boolean
  matches: OperatorMatch[]
}

function matchFromUser(user: PanelUser): OperatorMatch {
  return {
    userId: user.user_id,
    panelId: user.panel_id,
    name: user.name,
    permissions: user.permissions,
  }
}

export function setupOperatorSession(): OperatorSession {
  return {
    pin: '',
    userName: vi.loginSetupUser,
    isAdmin: true,
    setup: true,
    matches: [],
  }
}

export function sessionFromPin(
  users: PanelUser[],
  pin: string,
): OperatorSession | { error: string } {
  if (!parsePinInput(pin)) return { error: vi.keypadPinInvalid }
  const hits = usersMatchingPin(users, pin)
  if (!hits.length) return { error: vi.keypadWrongCode }
  const adminHit = hits.find((u) => userIsAdmin(u))
  const primary = adminHit ?? hits[0]
  return {
    pin,
    userName: primary.name,
    isAdmin: Boolean(adminHit),
    setup: false,
    matches: hits.map(matchFromUser),
  }
}

export function sessionMatchOnPanel(
  session: OperatorSession | null,
  panelId: string,
): OperatorMatch | null {
  if (!session) return null
  return session.matches.find((m) => m.panelId === panelId) ?? null
}

export function hasPinUsers(users: PanelUser[]): boolean {
  return pinUsersOf(users).length > 0
}

export function readStoredSession(): OperatorSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OperatorSession
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.setup) {
      return {
        pin: '',
        userName: typeof parsed.userName === 'string' ? parsed.userName : vi.loginSetupUser,
        isAdmin: true,
        setup: true,
        matches: [],
      }
    }
    if (typeof parsed.pin !== 'string' || !Array.isArray(parsed.matches)) return null
    return {
      pin: parsed.pin,
      userName: typeof parsed.userName === 'string' ? parsed.userName : '',
      isAdmin: Boolean(parsed.isAdmin),
      setup: false,
      matches: parsed.matches.filter(
        (m) =>
          m &&
          typeof m.userId === 'string' &&
          typeof m.panelId === 'string' &&
          typeof m.name === 'string' &&
          Array.isArray(m.permissions),
      ),
    }
  } catch {
    return null
  }
}

export function writeStoredSession(session: OperatorSession | null): void {
  try {
    if (!session) {
      sessionStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem(LOCK_KEY)
      return
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* private mode / quota */
  }
}

export function readScreenLocked(): boolean {
  try {
    return sessionStorage.getItem(LOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function writeScreenLocked(locked: boolean): void {
  try {
    if (locked) sessionStorage.setItem(LOCK_KEY, '1')
    else sessionStorage.removeItem(LOCK_KEY)
  } catch {
    /* ignore */
  }
}

export function sessionPinMatches(session: OperatorSession, typed: string): boolean {
  if (session.setup) return false
  const stored = parsePinInput(session.pin)
  const input = parsePinInput(typed)
  if (!stored || !input) return false
  if (stored.pin !== input.pin) return false
  if (stored.userNum != null && input.userNum != null) return stored.userNum === input.userNum
  return true
}

/** Drop a restored session that no longer matches declared users. */
export function hydrateStoredSession(
  stored: OperatorSession | null,
  users: PanelUser[],
): OperatorSession | null {
  if (!stored) return null
  if (stored.setup) {
    return hasPinUsers(users) ? null : setupOperatorSession()
  }
  const fresh = sessionFromPin(users, stored.pin)
  if ('error' in fresh) return null
  return fresh
}
