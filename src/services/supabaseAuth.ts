import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AuthSession } from '../types'
import type { AuthService } from './types'

const toSession = (s: Session | null): AuthSession | null => (s?.user.email ? { email: s.user.email } : null)

export class SupabaseAuthService implements AuthService {
  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    return error ? null : toSession(data.session)
  }
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) throw new Error(error?.message === 'Invalid login credentials' ? 'Credenciales inválidas' : error?.message ?? 'No se pudo iniciar sesión')
    return toSession(data.session)!
  }
  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }
  onChange(cb: (s: AuthSession | null) => void) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(toSession(session)))
    return () => data.subscription.unsubscribe()
  }
}
