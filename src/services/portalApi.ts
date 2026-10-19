import type { PortalData } from '../types/requests'

// Public client of the "portal" Edge Function. It deliberately uses plain fetch (not the Supabase client): the visitor never gets or sends a session,
// and the agency's own session (if it happens to be open in this browser) is never attached. The private token travels only in a header.
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal`
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export class PortalError extends Error {
  constructor(message: string, public status: number, public details: string[] = []) { super(message) }
}

async function call<T>(token: string, body: FormData | Record<string, unknown>): Promise<T> {
  const isForm = body instanceof FormData
  let res: Response
  try {
    res = await fetch(BASE, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { apikey: KEY, 'x-portal-token': token, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
      body: isForm ? body : JSON.stringify(body),
    })
  } catch { throw new PortalError('No se pudo conectar. Revisa tu conexión a internet e inténtalo de nuevo.', 0) }
  let json: any = null
  try { json = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new PortalError(json?.error ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.', res.status, json?.errors ?? [])
  return json as T
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/

export const portalApi = {
  get: (token: string, since?: string) => call<PortalData>(token, { action: 'get', ...(since ? { since } : {}) }),
  async download(token: string, attachmentId: string) { return (await call<{ url: string }>(token, { action: 'download', attachment_id: attachmentId })).url },
  submit(token: string, payload: unknown, files: Record<string, File>) {
    const f = new FormData()
    f.append('action', 'submit'); f.append('payload', JSON.stringify(payload))
    for (const [k, v] of Object.entries(files)) f.append(k, v, v.name)
    return call<{ ok: true }>(token, f)
  },
  /** The client can only remove files THEY sent in a message, while the conversation is open (enforced by the server). */
  deleteAttachment: (token: string, attachmentId: string) => call<{ ok: true; message_deleted: boolean }>(token, { action: 'delete_attachment', attachment_id: attachmentId }),
  update(token: string, payload: unknown, files: Record<string, File>) {
    const f = new FormData()
    f.append('action', 'update_request'); f.append('payload', JSON.stringify(payload))
    for (const [k, v] of Object.entries(files)) f.append(k, v, v.name)
    return call<{ ok: true; changed: boolean }>(token, f)
  },
  message(token: string, body: string, files: File[]) {
    const f = new FormData()
    f.append('action', 'message'); f.append('body', body)
    files.forEach((file, i) => f.append(`file_${i}`, file, file.name))
    return call<{ ok: true; id: string }>(token, f)
  },
}
