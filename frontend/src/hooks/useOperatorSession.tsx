import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { listPanelUsers, type Panel, type PanelUser } from '../api/client'
import { vi } from '../i18n/vi'
import {
  hasPinUsers,
  hydrateStoredSession,
  readScreenLocked,
  readStoredSession,
  sessionFromPin,
  sessionPinMatches,
  setupOperatorSession,
  writeScreenLocked,
  writeStoredSession,
  type OperatorSession,
} from '../lib/operatorSession'

type LoginResult = { ok: true } | { error: string }

type OperatorSessionContextValue = {
  session: OperatorSession | null
  ready: boolean
  loading: boolean
  loadError: string | null
  allUsers: PanelUser[]
  canSetup: boolean
  canSettings: boolean
  login: (pin: string) => LoginResult
  logout: () => void
  lock: () => void
  unlock: (pin: string) => LoginResult
  locked: boolean
  canLock: boolean
  enterSetup: () => LoginResult
  reloadUsers: () => Promise<void>
}

const OperatorSessionContext = createContext<OperatorSessionContextValue | null>(null)

export function OperatorSessionProvider({
  panels,
  cmsReady = true,
  children,
}: {
  panels: Panel[]
  cmsReady?: boolean
  children: ReactNode
}) {
  const [allUsers, setAllUsers] = useState<PanelUser[]>([])
  const [session, setSession] = useState<OperatorSession | null>(null)
  const [locked, setLocked] = useState(false)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const panelKey = panels.map((p) => p.panel_id).join('|')
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  const lockReadyRef = useRef(false)

  const reloadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const current = panelsRef.current
      if (!current.length) {
        setAllUsers([])
        setLoadError(null)
        return
      }
      const nested = await Promise.all(current.map((p) => listPanelUsers(p.panel_id)))
      setAllUsers(nested.flat())
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [panelKey])

  useEffect(() => {
    if (!cmsReady) return
    void reloadUsers()
  }, [cmsReady, reloadUsers])

  useEffect(() => {
    if (!cmsReady || loading) return
    setSession((prev) => {
      const stored = prev ?? readStoredSession()
      const next = hydrateStoredSession(stored, allUsers)
      writeStoredSession(next)
      if (!next) {
        writeScreenLocked(false)
        setLocked(false)
      } else if (!lockReadyRef.current) {
        const keepLock = Boolean(!next.setup && next.pin && readScreenLocked())
        writeScreenLocked(keepLock)
        setLocked(keepLock)
      }
      lockReadyRef.current = true
      return next
    })
    setReady(true)
  }, [cmsReady, loading, allUsers])

  const apply = useCallback((next: OperatorSession | null) => {
    writeStoredSession(next)
    setSession(next)
    if (!next) {
      writeScreenLocked(false)
      setLocked(false)
    }
  }, [])

  const login = useCallback(
    (pin: string): LoginResult => {
      const result = sessionFromPin(allUsers, pin.trim())
      if ('error' in result) return { error: result.error }
      apply(result)
      writeScreenLocked(false)
      setLocked(false)
      return { ok: true }
    },
    [allUsers, apply],
  )

  const logout = useCallback(() => {
    apply(null)
  }, [apply])

  const lock = useCallback(() => {
    if (!session || session.setup || !session.pin) return
    writeScreenLocked(true)
    setLocked(true)
  }, [session])

  const unlock = useCallback((pin: string): LoginResult => {
    const current = session
    if (!current) return { error: vi.keypadWrongCode }
    if (!sessionPinMatches(current, pin.trim())) return { error: vi.lockWrongPin }
    writeScreenLocked(false)
    setLocked(false)
    return { ok: true }
  }, [session])

  const enterSetup = useCallback((): LoginResult => {
    if (hasPinUsers(allUsers)) {
      return { error: 'pin_users_exist' }
    }
    apply(setupOperatorSession())
    return { ok: true }
  }, [allUsers, apply])

  const canSetup = !hasPinUsers(allUsers)
  const canSettings = Boolean(session?.isAdmin)
  const canLock = Boolean(session && !session.setup && session.pin)

  const value = useMemo<OperatorSessionContextValue>(
    () => ({
      session,
      ready,
      loading,
      loadError,
      allUsers,
      canSetup,
      canSettings,
      canLock,
      locked,
      login,
      logout,
      lock,
      unlock,
      enterSetup,
      reloadUsers,
    }),
    [
      session,
      ready,
      loading,
      loadError,
      allUsers,
      canSetup,
      canSettings,
      canLock,
      locked,
      login,
      logout,
      lock,
      unlock,
      enterSetup,
      reloadUsers,
    ],
  )

  return (
    <OperatorSessionContext.Provider value={value}>{children}</OperatorSessionContext.Provider>
  )
}

const FALLBACK: OperatorSessionContextValue = {
  session: null,
  ready: true,
  loading: false,
  loadError: null,
  allUsers: [],
  canSetup: false,
  canSettings: false,
  canLock: false,
  locked: false,
  login: () => ({ error: 'no_session' }),
  logout: () => {},
  lock: () => {},
  unlock: () => ({ error: 'no_session' }),
  enterSetup: () => ({ error: 'no_session' }),
  reloadUsers: async () => {},
}

export function useOperatorSession(): OperatorSessionContextValue {
  return useContext(OperatorSessionContext) ?? FALLBACK
}
