// Supabase Edge Function: company-admin  (agency only: requires the caller's Supabase session; deployed WITH jwt verification)
// POST JSON { action: 'create' | 'reset' | 'set_active', company_id, email?, active? }
// Creates / disables / enables the single administrator of a company and generates a secure password-setup (recovery) link.
// The service-role key lives only here. The caller must be agency staff: a company administrator can never run these actions.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const fail = (status: number, error: string) => reply(status, { error })
const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function callerId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` } })
  if (!r.ok) return null
  const u = await r.json()
  return typeof u?.id === 'string' ? u.id : null
}
const rest = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } })

async function recoveryLink(email: string, redirect: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: svc, body: JSON.stringify({ type: 'recovery', email, redirect_to: redirect }) })
  if (!r.ok) { console.error('generate_link failed', r.status); return null }
  const j = await r.json()
  return typeof j?.action_link === 'string' ? j.action_link : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'Método no permitido')
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(500, 'Servicio no configurado.')

  const uid = await callerId(req)
  if (!uid) return fail(401, 'Sesión no válida. Vuelve a iniciar sesión.')
  const isAdmin = await rest(`company_admins?select=user_id&user_id=eq.${uid}`)
  if (!isAdmin.ok) return fail(500, 'No se pudo validar el permiso.')
  if ((await isAdmin.json()).length) return fail(403, 'No tienes permiso para esta acción.')

  let body: { action?: unknown; company_id?: unknown; email?: unknown; active?: unknown }
  try { body = await req.json() } catch { return fail(400, 'Solicitud no válida.') }
  const companyId = String(body.company_id ?? '')
  if (!UUID.test(companyId)) return fail(400, 'Empresa no válida.')
  const redirect = `${APP_URL || (req.headers.get('origin') ?? '').replace(/\/+$/, '')}/empresa`
  if (!/^https?:\/\//.test(redirect)) return fail(500, 'Falta configurar APP_URL en la función.')

  const company = await rest(`companies?select=id,name&id=eq.${companyId}`)
  if (!company.ok || !(await company.json()).length) return fail(404, 'La empresa no existe.')
  const cur = await rest(`company_admins?select=user_id,email,active&company_id=eq.${companyId}`)
  if (!cur.ok) return fail(500, 'No se pudo consultar el administrador.')
  const admin = (await cur.json())[0] as { user_id: string; email: string; active: boolean } | undefined

  if (body.action === 'create') {
    if (admin) return fail(409, 'La empresa ya tiene un administrador.')
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email) || email.length > 200) return fail(400, 'Escribe un correo válido.')
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: svc, body: JSON.stringify({ email, email_confirm: true }) })
    if (!created.ok) return created.status === 422 ? fail(409, 'Ese correo ya está registrado. Usa otro correo.') : fail(502, 'No se pudo crear el usuario.')
    const user = await created.json()
    const ins = await rest('company_admins', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: user.id, company_id: companyId, email, created_by: uid }) })
    if (!ins.ok) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: svc })
      return fail(500, 'No se pudo asociar el administrador a la empresa.')
    }
    return reply(200, { ok: true, email, link: await recoveryLink(email, redirect) })
  }

  if (!admin) return fail(404, 'La empresa no tiene administrador.')

  if (body.action === 'reset') {
    const link = await recoveryLink(admin.email, redirect)
    return link ? reply(200, { ok: true, email: admin.email, link }) : fail(502, 'No se pudo generar el enlace de acceso.')
  }

  if (body.action === 'set_active') {
    const active = body.active === true
    const upd = await rest(`company_admins?company_id=eq.${companyId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active, updated_at: new Date().toISOString() }) })
    if (!upd.ok) return fail(500, 'No se pudo actualizar el acceso.')
    const ban = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${admin.user_id}`, { method: 'PUT', headers: svc, body: JSON.stringify({ ban_duration: active ? 'none' : '876000h' }) })
    if (!ban.ok) console.error('ban update failed', ban.status)
    return reply(200, { ok: true, active })
  }

  return fail(400, 'Acción no válida.')
})
