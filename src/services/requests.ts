import { supabase } from '../lib/supabase'
import { normalizeDocFile } from '../lib/files'
import type { ClientRequestFull, ClientRequestItem, ClientRequestRow, RequestAttachment, RequestMessage, RequestPassenger, RequestType } from '../types/requests'

// Agency side of "Solicitudes de clientes". Every call runs with the agency's Supabase session: RLS and the cr_* functions validate session and
// permissions in the database on every operation. No privileged key exists in the browser.
const BUCKET = 'client-requests'
const MAX_FILE = 8 * 1024 * 1024
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const LIST_COLS = 'id,created_at,client_name,client_email,client_phone,request_type,description,status,submitted_at,last_activity_at,last_message_author,agency_unread,link_revoked_at'

const SESSION_MSG = 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.'
function fail(e: { message: string; code?: string; status?: number }): never {
  if (e.code === '28000' || e.code === '42501' || e.code === 'PGRST301' || /jwt|not authenticated/i.test(e.message) || e.status === 401) throw new Error(SESSION_MSG)
  throw new Error(e.message)
}
const like = (s: string) => s.replace(/[,()%*\\]/g, ' ').trim()

const mapRow = (r: any): ClientRequestRow => ({
  id: r.id, created_at: r.created_at, client_name: r.client_name, client_email: r.client_email ?? '', client_phone: r.client_phone ?? '', request_type: (r.request_type ?? null) as RequestType | null,
  description: r.description ?? '', status: r.status, submitted_at: r.submitted_at, last_activity_at: r.last_activity_at, last_message_author: r.last_message_author,
  agency_unread: r.agency_unread ?? 0, link_active: r.link_revoked_at == null,
})

export interface RequestFilters { search?: string; status?: string; type?: string; date_from?: string; date_to?: string }
export interface CleanupResult { removed: number; pending: number }

export const requestsService = {
  /** The link carries the token in the URL fragment (#): fragments are never sent to servers, logged by the host or leaked through Referer. */
  link: (token: string) => `${location.origin}/solicitud#${token}`,

  async list(f: RequestFilters = {}): Promise<ClientRequestRow[]> {
    let q = supabase.from('client_requests').select(LIST_COLS).order('last_activity_at', { ascending: false }).limit(500)
    if (f.type) q = q.eq('request_type', f.type)
    if (f.date_from) q = q.gte('created_at', `${f.date_from}T00:00:00-05:00`)
    if (f.date_to) q = q.lte('created_at', `${f.date_to}T23:59:59-05:00`)
    const s = like(f.search ?? '')
    if (s) q = q.or(['client_name', 'client_email', 'client_phone', 'description'].map(c => `${c}.ilike.%${s}%`).join(','))
    switch (f.status) {
      case 'pending': q = q.neq('status', 'closed').eq('last_message_author', 'client'); break
      case 'new': q = q.eq('status', 'new').not('submitted_at', 'is', null); break
      case 'in_progress': q = q.eq('status', 'in_progress'); break
      case 'closed': q = q.eq('status', 'closed'); break
      case 'reopened': q = q.eq('status', 'reopened'); break
    }
    const { data, error } = await q
    if (error) fail(error)
    return (data ?? []).map(mapRow)
  },

  async unreadTotal(): Promise<number> {
    const { count, error } = await supabase.from('client_requests').select('id', { count: 'exact', head: true }).gt('agency_unread', 0)
    if (error) fail(error)
    return count ?? 0
  },

  async get(id: string): Promise<ClientRequestFull | null> {
    const [r, p, m, a, it] = await Promise.all([
      supabase.from('client_requests').select(`${LIST_COLS},observations,details,details_history,closed_at,closed_by,reopened_at`).eq('id', id).maybeSingle(),
      supabase.from('client_request_passengers').select('id,first_names,last_names,document_type,document_number,birth_date,item_id').eq('request_id', id).order('position'),
      supabase.from('client_request_messages').select('id,author,body,created_at').eq('request_id', id).order('created_at').order('id'),
      supabase.from('client_request_attachments').select('id,kind,passenger_id,message_id,item_id,file_name,mime_type,size_bytes,uploaded_by,created_at,storage_path').eq('request_id', id).order('created_at'),
      supabase.from('client_request_items').select('id,request_type,description,observations,details,created_at').eq('request_id', id).order('position'),
    ])
    for (const x of [r, p, m, a, it]) if (x.error) fail(x.error)
    if (!r.data) return null
    return {
      ...mapRow(r.data), observations: r.data.observations ?? '', details: (r.data.details ?? {}) as Record<string, string | number>, closed_at: r.data.closed_at, closed_by: r.data.closed_by, reopened_at: r.data.reopened_at, details_history: (r.data.details_history ?? []) as ClientRequestFull['details_history'],
      passengers: (p.data ?? []) as RequestPassenger[], messages: (m.data ?? []) as RequestMessage[], attachments: (a.data ?? []) as RequestAttachment[], items: (it.data ?? []) as ClientRequestItem[],
    }
  },

  /** Creates an EMPTY conversation + private link: the client chooses the service type and fills in their own data from the link. */
  async create(name = ''): Promise<{ id: string; token: string }> {
    const { data, error } = await supabase.rpc('create_client_request', { p_name: name.trim() || '' })
    if (error) fail(error)
    return data as { id: string; token: string }
  },
  async regenerate(id: string): Promise<string> {
    const { data, error } = await supabase.rpc('regenerate_client_request_link', { p_id: id })
    if (error) fail(error)
    return (data as { token: string }).token
  },
  async revoke(id: string) { const { error } = await supabase.rpc('revoke_client_request_link', { p_id: id }); if (error) fail(error) },
  async setClosed(id: string, closed: boolean) { const { error } = await supabase.rpc('set_client_request_closed', { p_id: id, p_closed: closed }); if (error) fail(error) },
  async markRead(id: string) { const { error } = await supabase.rpc('mark_client_request_read', { p_id: id }); if (error) fail(error) },

  /** Uploads the files to the private bucket first and registers the message afterwards; if anything fails, the uploaded files are removed again. */
  async postMessage(id: string, body: string, files: File[]): Promise<void> {
    const { data: s } = await supabase.auth.getSession()
    if (!s.session) throw new Error(SESSION_MSG)
    const uploaded: { storage_path: string; file_name: string; mime_type: string; size_bytes: number }[] = []
    try {
      for (const f of files) {
        const ok = await normalizeDocFile(f, 'pdf-or-image')
        if (ok.size > MAX_FILE) throw new Error(`«${f.name}» supera los 8 MB.`)
        const storage_path = `requests/${id}/${crypto.randomUUID()}.${EXT[ok.type]}`
        const { error } = await supabase.storage.from(BUCKET).upload(storage_path, ok, { contentType: ok.type, upsert: false })
        if (error) fail(error)
        uploaded.push({ storage_path, file_name: ok.name, mime_type: ok.type, size_bytes: ok.size })
      }
      const { error } = await supabase.rpc('agency_post_message', { p_id: id, p_body: body, p_attachments: uploaded })
      if (error) fail(error)
    } catch (e) {
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded.map(u => u.storage_path))
      throw e
    }
  },

  async signedUrl(path: string, name: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60, { download: name })
    if (error && /not found|does not exist|object/i.test(error.message)) throw new Error('gone')
    if (error || !data) fail(error ?? { message: 'No se pudo preparar la descarga.' })
    return data!.signedUrl
  },

  // ---- deletions: the database part is one transaction; the physical files are queued by a trigger and removed afterwards (retryable) ----
  async deleteRequest(id: string): Promise<CleanupResult> { const { error } = await supabase.rpc('delete_client_request', { p_id: id }); if (error) fail(error); return this.processCleanup() },
  async deleteMessage(id: string): Promise<CleanupResult> { const { error } = await supabase.rpc('delete_client_request_message', { p_id: id }); if (error) fail(error); return this.processCleanup() },
  async deleteAttachment(id: string): Promise<CleanupResult> { const { error } = await supabase.rpc('delete_client_request_attachment', { p_id: id }); if (error) fail(error); return this.processCleanup() },
  async deletePassenger(id: string): Promise<CleanupResult> { const { error } = await supabase.rpc('delete_client_request_passenger', { p_id: id }); if (error) fail(error); return this.processCleanup() },

  /** Removes from Storage every file queued in client_request_cleanup. A task is dropped only when the object is really gone, so failures stay queued and can be retried. */
  async processCleanup(): Promise<CleanupResult> {
    const { data: tasks, error } = await supabase.from('client_request_cleanup').select('id,storage_path').order('created_at').limit(200)
    if (error) fail(error)
    if (!tasks?.length) return { removed: 0, pending: 0 }
    const { data: removedObjs } = await supabase.storage.from(BUCKET).remove(tasks.map(t => t.storage_path))
    const removedNames = new Set((removedObjs ?? []).map(o => o.name))
    const done: string[] = []
    for (const t of tasks) {
      if (removedNames.has(t.storage_path)) { done.push(t.id); continue }
      const dir = t.storage_path.slice(0, t.storage_path.lastIndexOf('/')), base = t.storage_path.slice(t.storage_path.lastIndexOf('/') + 1)
      const { data: found, error: e2 } = await supabase.storage.from(BUCKET).list(dir, { search: base, limit: 1 })
      if (!e2 && !(found ?? []).some(o => o.name === base)) done.push(t.id) // already gone
    }
    if (done.length) await supabase.from('client_request_cleanup').delete().in('id', done)
    return { removed: done.length, pending: tasks.length - done.length }
  },
  async pendingCleanup(): Promise<number> {
    const { count, error } = await supabase.from('client_request_cleanup').select('id', { count: 'exact', head: true })
    if (error) fail(error)
    return count ?? 0
  },

  async linkOperation(requestId: string, operationId: string) {
    const { error } = await supabase.rpc('link_client_request_operation', { p_request: requestId, p_operation: operationId })
    if (error) fail(error)
  },
}
