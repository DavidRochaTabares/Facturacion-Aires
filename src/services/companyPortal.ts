import { supabase } from '../lib/supabase'
import type { ApprovalEvent, ApprovalStatus, CompanyAccessStatus, CompanyConversation, CompanyConversationRow, CompanyPortalMe } from '../types/company'

const SESSION_MSG = 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.'
function fail(e: { message: string; code?: string; status?: number }): never {
  if (e.code === '28000' || e.code === 'PGRST301' || /jwt|not authenticated/i.test(e.message) || e.status === 401) throw new Error(SESSION_MSG)
  if (e.code === '42501') throw new Error('No tienes acceso a esta información.')
  throw new Error(e.message)
}
const BUCKET = 'client-requests'

// ---- Public side (employees): plain fetch to the "company-access" Edge Function, no Supabase session involved. -------------------------------
const ACCESS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/company-access`
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
async function access<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(ACCESS_URL, { method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch { throw Object.assign(new Error('No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.'), { status: 0 }) }
  let json: any = null
  try { json = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error(json?.error ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.'), { status: res.status })
  return json as T
}
export const companyAccessPublic = {
  check: (token: string) => access<{ company_name: string }>({ action: 'check', token }),
  start: (token: string, name: string) => access<{ conversation_token: string }>({ action: 'start', token, name }),
}

// ---- Agency side: manage the company link and its single administrator. ----------------------------------------------------------------------
async function adminFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('company-admin', { body })
  if (error) {
    const res = (error as { context?: Response }).context
    if (error.name === 'FunctionsFetchError') throw new Error('No se pudo conectar con el servicio. Revisa tu conexión a internet e inténtalo de nuevo.')
    if (res?.status === 401) throw new Error(SESSION_MSG)
    let msg = error.message
    try { const j = await res?.json(); if (j?.error) msg = j.error } catch { /* keep generic message */ }
    throw new Error(msg)
  }
  return data as T
}

export const companyAccessAdmin = {
  /** The token travels in the URL fragment (#): never sent to servers or leaked through Referer. */
  link: (token: string) => `${location.origin}/empresa-acceso#${token}`,
  portalUrl: () => `${location.origin}/empresa`,

  async status(companyId: string): Promise<CompanyAccessStatus> {
    const [l, a] = await Promise.all([
      supabase.from('company_links').select('id,created_at').eq('company_id', companyId).is('revoked_at', null).order('created_at', { ascending: false }),
      supabase.from('company_admins').select('email,active,created_at').eq('company_id', companyId).maybeSingle(),
    ])
    if (l.error) fail(l.error)
    if (a.error) fail(a.error)
    const active = l.data ?? []
    return { link_active: active.length > 0, links_active: active.length, link_issued_at: active[0]?.created_at ?? null, admin: a.data ?? null }
  },
  async generateLink(companyId: string): Promise<string> {
    const { data, error } = await supabase.rpc('company_link_generate', { p_company: companyId })
    if (error) fail(error)
    return (data as { token: string }).token
  },
  async revokeLink(companyId: string) { const { error } = await supabase.rpc('company_link_revoke', { p_company: companyId }); if (error) fail(error) },
  createAdmin: (companyId: string, email: string) => adminFn<{ ok: true; email: string; link: string | null }>({ action: 'create', company_id: companyId, email }),
  resetAdmin: (companyId: string) => adminFn<{ ok: true; email: string; link: string }>({ action: 'reset', company_id: companyId }),
  setActive: (companyId: string, active: boolean) => adminFn<{ ok: true; active: boolean }>({ action: 'set_active', company_id: companyId, active }),

  async approvals(requestId: string): Promise<ApprovalEvent[]> {
    const { data, error } = await supabase.from('conversation_approvals').select('id,action,from_status,to_status,actor_type,actor_label,note,created_at').eq('request_id', requestId).order('created_at').order('id')
    if (error) fail(error)
    return (data ?? []) as ApprovalEvent[]
  },
  async setApproval(requestId: string, status: Exclude<ApprovalStatus, 'approved' | 'rejected'>, note = '') {
    const { error } = await supabase.rpc('agency_set_approval', { p_id: requestId, p_status: status, p_note: note })
    if (error) fail(error)
  },
}

// ---- Company administrator side: everything goes through company_* functions that resolve the company from auth.uid(). --------------------
export const companyPortal = {
  async me(): Promise<CompanyPortalMe | null> {
    const { data, error } = await supabase.rpc('company_portal_me')
    if (error) fail(error)
    return (data ?? null) as CompanyPortalMe | null
  },
  async list(search = '', status = ''): Promise<CompanyConversationRow[]> {
    const { data, error } = await supabase.rpc('company_list_conversations', { p_search: search, p_status: status })
    if (error) fail(error)
    return (data ?? []) as CompanyConversationRow[]
  },
  async get(id: string): Promise<CompanyConversation> {
    const { data, error } = await supabase.rpc('company_get_conversation', { p_id: id })
    if (error) fail(error)
    return data as CompanyConversation
  },
  async decide(id: string, decision: 'approve' | 'reject', note = '') {
    const { error } = await supabase.rpc('company_decide', { p_id: id, p_decision: decision, p_note: note })
    if (error) fail(error)
  },
  async post(id: string, body: string, replyTo?: string | null) {
    const { error } = await supabase.rpc('company_post_message', { p_id: id, p_body: body, p_reply_to: replyTo ?? null })
    if (error) fail(error)
  },
  /** Short-lived signed URL (private bucket); Storage policies only allow files of conversations of the administrator's own company. */
  async signedUrl(path: string, name: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60, { download: name })
    if (error && /not found|does not exist|object/i.test(error.message)) throw new Error('Este archivo ya no está disponible.')
    if (error || !data) fail(error ?? { message: 'No se pudo preparar la descarga.' })
    return data!.signedUrl
  },
  async isCompanyAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_company_admin_user')
    if (error) return false
    return data === true
  },
}
