// Supabase Edge Function: portal  (PUBLIC: deployed with --no-verify-jwt; every request is authorised by the private link token alone)
// The token travels in the x-portal-token header (never in a URL / query string). Only its SHA-256 hash is looked up in the database.
// The service-role key lives only inside this function. The client can read/write ONLY its own conversation and can never close, reopen or delete anything.
import { checkFile, type CheckedFile, EXT, MAX_FILES_TOTAL_BYTES } from './files.ts'
import { validateSubmission, validateUpdate, validateItem } from './validate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'client-requests'
const MAX_BODY = 48 * 1024 * 1024
const MAX_MESSAGE_FILES = 5
const MAX_EXTRA_FILES = 5

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-portal-token, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const baseHeaders = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: baseHeaders })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => reply(status, { error, ...extra })
const INVALID = 'Este enlace no es válido o ha sido desactivado. Contacta a la agencia para recibir uno nuevo.'

const PORTAL_ERRORS: Record<string, [number, string]> = {
  'portal:invalid_link': [404, INVALID],
  'portal:closed': [409, 'Esta conversación está cerrada y ya no se pueden enviar mensajes ni archivos. Contacta a la agencia si necesitas continuar.'],
  'portal:already_submitted': [409, 'Esta solicitud ya fue enviada.'],
  'portal:not_submitted': [409, 'Primero completa y envía el formulario de la solicitud.'],
  'portal:privacy_required': [400, 'Debes aceptar el aviso de privacidad para enviar la solicitud.'],
  'portal:empty': [400, 'Escribe un mensaje o adjunta un archivo.'],
  'portal:too_long': [400, 'El mensaje es demasiado largo (máximo 5.000 caracteres).'],
  'portal:too_many_files': [413, 'Se superó el número máximo de archivos permitido para esta conversación.'],
  'portal:too_many_items': [413, 'Ya tienes el máximo de requerimientos en esta conversación. Escríbenos por el chat si necesitas más.'],
  'portal:storage_limit': [413, 'Se superó el espacio máximo de archivos de esta conversación. Contacta a la agencia.'],
  'portal:forbidden': [403, 'No tienes permiso para eliminar este archivo.'],
  'portal:not_found': [404, 'El archivo ya no existe.'],
  'portal:rate_limited': [429, 'Has enviado muchos mensajes en poco tiempo. Espera unos minutos e inténtalo de nuevo.'],
}

// ---- tiny per-instance guard against token guessing (best effort; tokens carry 256 bits so guessing is infeasible anyway)
const misses = new Map<string, { n: number; t: number }>()
const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
const blocked = (ip: string) => { const m = misses.get(ip); return !!m && Date.now() - m.t < 60_000 && m.n >= 20 }
const miss = (ip: string) => { const m = misses.get(ip); misses.set(ip, m && Date.now() - m.t < 60_000 ? { n: m.n + 1, t: m.t } : { n: 1, t: Date.now() }) }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

async function rpc(name: string, args: Record<string, unknown>): Promise<{ data?: any; code?: string; failed?: boolean }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  if (res.ok) return { data: res.status === 204 ? null : await res.json() }
  let msg = ''
  try { msg = (await res.json())?.message ?? '' } catch { /* not JSON */ }
  console.error('rpc failed', name, res.status, msg.startsWith('portal:') ? msg : '(internal)')
  return msg.startsWith('portal:') ? { code: msg, failed: true } : { failed: true }
}

const objectUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
async function upload(path: string, f: CheckedFile): Promise<boolean> {
  const res = await fetch(objectUrl(path), { method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': f.mime, 'x-upsert': 'false' }, body: f.bytes as unknown as BodyInit })
  if (!res.ok) console.error('storage upload failed', res.status)
  return res.ok
}
async function removeObjects(paths: string[]) {
  for (const p of paths) {
    try { await fetch(objectUrl(p), { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }) } catch { /* the DB has no row for it: harmless leftover */ }
  }
}
/** Removes the physical object and, once it is really gone, its cleanup task. If Storage fails the task stays queued and is retried later. */
async function removeAndDequeue(path: string): Promise<boolean> {
  try {
    const res = await fetch(objectUrl(path), { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
    if (!res.ok && res.status !== 404) return false
    const q = await fetch(`${SUPABASE_URL}/rest/v1/client_request_cleanup?storage_path=eq.${encodeURIComponent(path)}`, { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
    return q.ok
  } catch { return false }
}
async function signedUrl(path: string, name: string): Promise<string | null | 'missing'> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }),
  })
  if (res.status === 400 || res.status === 404) return 'missing' // the object no longer exists in Storage
  if (!res.ok) return null
  const j = await res.json()
  return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}&download=${encodeURIComponent(name)}` : null
}

interface Stored { storage_path: string; file_name: string; mime_type: string; size_bytes: number }
const toStored = (reqId: string, f: CheckedFile): Stored => ({ storage_path: `requests/${reqId}/${crypto.randomUUID()}.${EXT[f.mime]}`, file_name: f.name, mime_type: f.mime, size_bytes: f.size })

/** Validates and uploads all files; on any failure nothing stays in Storage. */
async function uploadAll(reqId: string, files: { file: CheckedFile; key: string }[]): Promise<{ stored: Map<string, Stored> } | { error: Response }> {
  const done: string[] = []
  const stored = new Map<string, Stored>()
  for (const { file, key } of files) {
    const s = toStored(reqId, file)
    if (!(await upload(s.storage_path, file))) { await removeObjects(done); return { error: fail(502, 'No se pudo guardar uno de los archivos. Inténtalo de nuevo.') } }
    done.push(s.storage_path); stored.set(key, s)
  }
  return { stored }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'Método no permitido')
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(500, 'Servicio no configurado.')

  const ip = clientIp(req)
  if (blocked(ip)) return fail(429, 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.')
  const token = req.headers.get('x-portal-token') ?? ''
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) { miss(ip); return fail(404, INVALID) }
  const hash = await sha256(token)

  // Link validity is checked before reading any body, on every single request (reads, sends and downloads).
  const look = await rpc('portal_lookup', { p_hash: hash })
  if (look.failed) return fail(500, 'No se pudo procesar la solicitud. Inténtalo de nuevo.')
  if (!look.data) { miss(ip); return fail(404, INVALID) }
  const info = look.data as { id: string; status: string; submitted: boolean }

  const ct = req.headers.get('content-type') ?? ''
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return fail(413, 'La solicitud es demasiado grande.')
  let json: any = null, form: FormData | null = null
  try {
    if (ct.startsWith('multipart/form-data')) form = await req.formData()
    else json = await req.json()
  } catch { return fail(400, 'Solicitud no válida.') }
  const action = String((form ? form.get('action') : json?.action) ?? '')
  const fail409 = (code: string) => { const [s, m] = PORTAL_ERRORS[code]; return fail(s, m) }

  if (action === 'get') {
    const since = typeof json?.since === 'string' && !Number.isNaN(Date.parse(json.since)) ? json.since : null
    const r = await rpc('portal_get', { p_hash: hash, p_since: since })
    if (r.failed) return fail(500, 'No se pudo cargar la conversación.')
    return r.data ? reply(200, r.data) : fail(404, INVALID)
  }

  if (action === 'download') {
    const id = String(json?.attachment_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'Archivo no válido.')
    const r = await rpc('portal_attachment', { p_hash: hash, p_attachment: id })
    if (r.failed) return fail(500, 'No se pudo preparar la descarga.')
    if (!r.data) return fail(404, 'Archivo no encontrado.')
    const url = await signedUrl(r.data.storage_path, r.data.file_name)
    if (url === 'missing') return fail(404, 'Este archivo ya no está disponible.')
    return url ? reply(200, { url, expires_in: 60 }) : fail(502, 'No se pudo preparar la descarga.')
  }

  if (action === 'submit') {
    if (!form) return fail(400, 'Solicitud no válida.')
    if (info.status === 'closed') return fail409('portal:closed')
    if (info.submitted) return fail409('portal:already_submitted')
    let payload: any
    try { payload = JSON.parse(String(form.get('payload') ?? '')) } catch { return fail(400, 'Solicitud no válida.') }
    const { data, errors } = validateSubmission(payload)
    const problems = [...errors]

    const entries: { file: CheckedFile; key: string }[] = []
    let total = 0
    const pull = async (key: string, label: string, required: boolean) => {
      const v = form!.get(key)
      if (!(v instanceof File) || v.size === 0) { if (required) problems.push(`Falta ${label}.`); return }
      const c = await checkFile(v, label)
      if ('error' in c) { problems.push(c.error); return }
      total += c.size; entries.push({ file: c, key })
    }
    const count = Array.isArray(payload?.passengers) ? Math.min(payload.passengers.length, 10) : 0
    for (let i = 0; i < count; i++) {
      const p = payload.passengers[i]
      const name = [p?.first_names, p?.last_names].filter((x: unknown) => typeof x === 'string' && x.trim()).join(' ').trim()
      await pull(`file_p${i}`, `el documento de identidad del pasajero ${i + 1}${name ? ` (${name.slice(0, 60)})` : ''}`, false)
    }
    for (let j = 0; j < MAX_EXTRA_FILES; j++) await pull(`file_x${j}`, `el archivo complementario ${j + 1}`, false)
    if (total > MAX_FILES_TOTAL_BYTES) problems.push('Los archivos superan el tamaño total permitido (40 MB).')
    if (problems.length || !data) return fail(422, problems[0] ?? 'Revisa los datos de la solicitud.', { errors: problems })

    const up = await uploadAll(info.id, entries)
    if ('error' in up) return up.error
    const rec = (k: string) => up.stored.get(k) ?? null
    const r = await rpc('portal_submit', {
      p_hash: hash,
      p_data: { ...data, passengers: data.passengers.map((p, i) => ({ ...p, file: rec(`file_p${i}`) })), extras: [...up.stored.entries()].filter(([k]) => k.startsWith('file_x')).map(([, s]) => s) },
    })
    if (r.failed) { await removeObjects([...up.stored.values()].map(s => s.storage_path)); return r.code && PORTAL_ERRORS[r.code] ? fail409(r.code) : fail(500, 'No se pudo guardar la solicitud. Inténtalo de nuevo.') }
    return reply(200, { ok: true })
  }

  if (action === 'update_request') {
    if (!form) return fail(400, 'Solicitud no válida.')
    if (info.status === 'closed') return fail409('portal:closed')
    let payload: any
    try { payload = JSON.parse(String(form.get('payload') ?? '')) } catch { return fail(400, 'Solicitud no válida.') }
    const current = await rpc('portal_get', { p_hash: hash })
    if (current.failed || !current.data) return fail(500, 'No se pudo procesar la solicitud. Inténtalo de nuevo.')
    const existing = (current.data.passengers ?? []).length as number
    const { data, errors } = validateUpdate(payload, existing)
    const problems = [...errors]
    const entries: { file: CheckedFile; key: string }[] = []
    let total = 0
    const pull = async (key: string, label: string, required: boolean) => {
      const v = form!.get(key)
      if (!(v instanceof File) || v.size === 0) { if (required) problems.push(`Falta ${label}.`); return }
      const c = await checkFile(v, label)
      if ('error' in c) { problems.push(c.error); return }
      total += c.size; entries.push({ file: c, key })
    }
    const fresh = Array.isArray(payload?.passengers) ? Math.min(payload.passengers.length, 10) : 0
    for (let i = 0; i < fresh; i++) {
      const p = payload.passengers[i]
      const name = [p?.first_names, p?.last_names].filter((x: unknown) => typeof x === 'string' && x.trim()).join(' ').trim()
      await pull(`file_p${i}`, `el documento de identidad del pasajero ${existing + i + 1}${name ? ` (${name.slice(0, 60)})` : ''}`, false)
    }
    for (let j = 0; j < MAX_EXTRA_FILES; j++) await pull(`file_x${j}`, `el archivo complementario ${j + 1}`, false)
    if (total > MAX_FILES_TOTAL_BYTES) problems.push('Los archivos superan el tamaño total permitido (40 MB).')
    if (problems.length || !data) return fail(422, problems[0] ?? 'Revisa los datos de la solicitud.', { errors: problems })

    const up = await uploadAll(info.id, entries)
    if ('error' in up) return up.error
    const rec = (k: string) => up.stored.get(k) ?? null
    const r = await rpc('portal_update_request', {
      p_hash: hash,
      p_data: { ...data, passengers: data.passengers.map((p, i) => ({ ...p, file: rec(`file_p${i}`) })), extras: [...up.stored.entries()].filter(([k]) => k.startsWith('file_x')).map(([, s]) => s) },
    })
    if (r.failed) { await removeObjects([...up.stored.values()].map(s => s.storage_path)); return r.code && PORTAL_ERRORS[r.code] ? fail409(r.code) : fail(500, 'No se pudo actualizar la solicitud. Inténtalo de nuevo.') }
    return reply(200, { ok: true, changed: !!r.data?.changed })
  }

  // Additional requirements inside the same conversation: 'add_item' creates one, 'update_item' edits it. Both reuse the request file pipeline.
  if (action === 'add_item' || action === 'update_item') {
    if (!form) return fail(400, 'Solicitud no válida.')
    if (info.status === 'closed') return fail409('portal:closed')
    let payload: any
    try { payload = JSON.parse(String(form.get('payload') ?? '')) } catch { return fail(400, 'Solicitud no válida.') }
    const itemId = action === 'update_item' ? String(json?.item_id ?? form.get('item_id') ?? '') : ''
    if (action === 'update_item' && !/^[0-9a-f-]{36}$/i.test(itemId)) return fail(400, 'Requerimiento no válido.')
    const current = await rpc('portal_get', { p_hash: hash })
    if (current.failed || !current.data) return fail(500, 'No se pudo procesar la solicitud. Inténtalo de nuevo.')
    const item = (current.data.items ?? []).find((i: any) => i.id === itemId)
    if (action === 'update_item' && !item) return fail(404, 'El requerimiento ya no existe.')
    const existing = (item?.passengers ?? []).length as number
    const { data, errors } = validateItem(payload, existing)
    const problems = [...errors]
    const entries: { file: CheckedFile; key: string }[] = []
    let total = 0
    const pull = async (key: string, label: string, required: boolean) => {
      const v = form!.get(key)
      if (!(v instanceof File) || v.size === 0) { if (required) problems.push(`Falta ${label}.`); return }
      const c = await checkFile(v, label)
      if ('error' in c) { problems.push(c.error); return }
      total += c.size; entries.push({ file: c, key })
    }
    const fresh = Array.isArray(payload?.passengers) ? Math.min(payload.passengers.length, 10) : 0
    for (let i = 0; i < fresh; i++) {
      const p = payload.passengers[i]
      const name = [p?.first_names, p?.last_names].filter((x: unknown) => typeof x === 'string' && x.trim()).join(' ').trim()
      await pull(`file_p${i}`, `el documento de identidad del pasajero ${existing + i + 1}${name ? ` (${name.slice(0, 60)})` : ''}`, false)
    }
    for (let j = 0; j < MAX_EXTRA_FILES; j++) await pull(`file_x${j}`, `el archivo complementario ${j + 1}`, false)
    if (total > MAX_FILES_TOTAL_BYTES) problems.push('Los archivos superan el tamaño total permitido (40 MB).')
    if (problems.length || !data) return fail(422, problems[0] ?? 'Revisa los datos del requerimiento.', { errors: problems })

    const up = await uploadAll(info.id, entries)
    if ('error' in up) return up.error
    const rec = (k: string) => up.stored.get(k) ?? null
    const pData = { ...data, passengers: data.passengers.map((p, i) => ({ ...p, file: rec(`file_p${i}`) })), extras: [...up.stored.entries()].filter(([k]) => k.startsWith('file_x')).map(([, s]) => s) }
    const r = action === 'add_item'
      ? await rpc('portal_add_item', { p_hash: hash, p_data: pData })
      : await rpc('portal_update_item', { p_hash: hash, p_item: itemId, p_data: pData })
    if (r.failed) { await removeObjects([...up.stored.values()].map(s => s.storage_path)); return r.code && PORTAL_ERRORS[r.code] ? fail409(r.code) : fail(500, 'No se pudo guardar el requerimiento. Inténtalo de nuevo.') }
    return reply(200, { ok: true, id: r.data?.id })
  }

  if (action === 'delete_attachment') {
    if (info.status === 'closed') return fail409('portal:closed')
    const id = String(json?.attachment_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'Archivo no válido.')
    const r = await rpc('portal_delete_attachment', { p_hash: hash, p_attachment: id })
    if (r.failed) return r.code && PORTAL_ERRORS[r.code] ? fail409(r.code) : fail(500, 'No se pudo eliminar el archivo. Inténtalo de nuevo.')
    const cleaned = await removeAndDequeue(String(r.data?.storage_path ?? ''))
    return reply(200, { ok: true, message_deleted: !!r.data?.message_deleted, storage_cleaned: cleaned })
  }

  if (action === 'message') {
    if (!form) return fail(400, 'Solicitud no válida.')
    if (info.status === 'closed') return fail409('portal:closed')
    const body = String(form.get('body') ?? '')
    if (body.length > 5000) return fail409('portal:too_long')
    const problems: string[] = []
    const entries: { file: CheckedFile; key: string }[] = []
    let total = 0
    for (let i = 0; i < MAX_MESSAGE_FILES + 1; i++) {
      const v = form.get(`file_${i}`)
      if (!(v instanceof File)) continue
      if (i >= MAX_MESSAGE_FILES) { problems.push(`Máximo ${MAX_MESSAGE_FILES} archivos por mensaje.`); break }
      const c = await checkFile(v, `Archivo ${i + 1}`)
      if ('error' in c) problems.push(c.error); else { total += c.size; entries.push({ file: c, key: `file_${i}` }) }
    }
    if (total > MAX_FILES_TOTAL_BYTES) problems.push('Los archivos superan el tamaño total permitido (40 MB).')
    if (problems.length) return fail(422, problems[0], { errors: problems })
    if (!body.trim() && !entries.length) return fail409('portal:empty')

    const up = await uploadAll(info.id, entries)
    if ('error' in up) return up.error
    const r = await rpc('portal_post_message', { p_hash: hash, p_body: body, p_attachments: [...up.stored.values()] })
    if (r.failed) { await removeObjects([...up.stored.values()].map(s => s.storage_path)); return r.code && PORTAL_ERRORS[r.code] ? fail409(r.code) : fail(500, 'No se pudo enviar el mensaje. Inténtalo de nuevo.') }
    return reply(200, { ok: true, id: r.data?.id })
  }

  return fail(400, 'Acción no válida.')
})
