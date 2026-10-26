import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { onRefresh, refreshAll, trackEnd, trackStart } from '../lib/refresh'
import { authService } from '../services'
import type { AuthSession } from '../types'

interface AuthCtx { session: AuthSession | null; loading: boolean; signIn: (e: string, p: string) => Promise<void>; signOut: () => Promise<void> }
const AuthContext = createContext<AuthCtx>(null!)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    authService.getSession().then(s => { setSession(s); setLoading(false) })
    return authService.onChange(setSession)
  }, [])
  const signIn = useCallback(async (e: string, p: string) => { await authService.signIn(e, p) }, [])
  const signOut = useCallback(() => authService.signOut(), [])
  return <AuthContext.Provider value={{ session, loading, signIn, signOut }}>{children}</AuthContext.Provider>
}

type Theme = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>(null!)
export const useTheme = () => useContext(ThemeContext)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('aires.theme') as Theme) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('aires.theme', theme)
  }, [theme])
  return <ThemeContext.Provider value={{ theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) }}>{children}</ThemeContext.Provider>
}

export { refreshAll }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const quiet = useRef(false)
  useEffect(() => onRefresh(() => { quiet.current = true; setTick(t => t + 1) }), [])
  useEffect(() => {
    let alive = true
    const silent = quiet.current
    quiet.current = false
    if (!silent) setLoading(true)
    setError(null)
    let failed = false
    trackStart()
    fn().then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(e => {
        if (!alive) return
        failed = silent
        if (silent) setLoading(false)
        else { setError(e instanceof Error ? e.message : 'Error inesperado'); setLoading(false) }
      })
      .finally(() => trackEnd(failed))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, loading, error, reload: () => setTick(t => t + 1) }
}

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

/** PWA updates: a new service worker takes over by itself (skipWaiting), but the open page keeps running old code until it is reloaded. This only reports it; the user decides when to reload. */
export function useAppUpdate() {
  const [ready, setReady] = useState(false)
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  const check = useCallback(async () => {
    if (!supported) return
    try { await (await navigator.serviceWorker.getRegistration())?.update() } catch { /* offline: keep running the current version */ }
  }, [supported])
  useEffect(() => {
    if (!supported) return
    // the first controllerchange of a fresh install is not an update; any later one (a new version taking over) is
    let hadController = !!navigator.serviceWorker.controller
    const onChange = () => { if (hadController) setReady(true); hadController = true }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    document.addEventListener('visibilitychange', onVisible)
    return () => { navigator.serviceWorker.removeEventListener('controllerchange', onChange); document.removeEventListener('visibilitychange', onVisible) }
  }, [supported, check])
  const apply = useCallback(() => {
    if (document.querySelector('form') && !confirm('Hay un formulario abierto. Si actualizas ahora se perderán los cambios sin guardar. ¿Actualizar de todos modos?')) return
    location.reload()
  }, [])
  return { ready, check, apply }
}
