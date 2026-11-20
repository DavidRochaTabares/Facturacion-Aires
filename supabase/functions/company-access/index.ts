// Supabase Edge Function: company-access  (PUBLIC: deploy with --no-verify-jwt; authorised only by the company's private link token)
// POST JSON { action: 'check' | 'start', token, name? }
//  - check: validates the company link and returns the company name.
//  - start: creates a NEW conversation for the company in the employee's name and returns that conversation's own private token, so the employee
//           continues in the existing portal (/solicitud#<token>). The company id is resolved from the token in the database, never from the browser.
// The service-role key lives only inside this function.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const headers = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
const fail = (status: number, error: string) => reply(status, { error })
const INVALID = 'Este enlace no es válido o ha sido desactivado. Contacta a Aires y Destinos para recibir uno nuevo.'

const ERRORS: Record<string, [number, string]> = {
  'portal:invalid_link': [404, INVALID],
  'portal:name_required': [400, 'Escribe tu nombre para iniciar la conversación.'],
  'portal:rate_limited': [429, 'Se han creado muchas conversaciones en poco tiempo. Inténtalo de nuevo en unos minutos.'],
}

const misses = new Map<string, { n: number; t: number }>()
const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
const blocked = (ip: string) => { const m = misses.get(ip); return !!m && Date.now() - m.t < 60_000 && m.n >= 20 }
const miss = (ip: string) => { const m = misses.get(ip); misses.set(ip, m && Date.now() - m.t < 60_000 ? { n: m.n + 1, t: m.t } : { n: 1, t: Date.now() }) }

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('')
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function rpc(name: string, args: Record<string, unknown>): Promise<{ data?: any; code?: string; failed?: boolean }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (res.ok) return { data: res.status === 204 ? null : await res.json() }
  let msg = ''
  try { msg = (await res.json())?.message ?? '' } catch { /* not JSON */ }
  console.error('rpc failed', name, res.status, msg.startsWith('portal:') ? msg : '(internal)')
  return msg.startsWith('portal:') ? { code: msg, failed: true } : { failed: true }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'Método no permitido')
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(500, 'Servicio no configurado.')

  const ip = clientIp(req)
  if (blocked(ip)) return fail(429, 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.')
  let json: { action?: unknown; token?: unknown; name?: unknown }
  try { json = await req.json() } catch { return fail(400, 'Solicitud no válida.') }
  const token = String(json.token ?? '')
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) { miss(ip); return fail(404, INVALID) }
  const hash = await sha256(token)

  if (json.action === 'check') {
    const r = await rpc('company_link_lookup', { p_hash: hash })
    if (r.failed) return fail(500, 'No se pudo procesar la solicitud. Inténtalo de nuevo.')
    if (!r.data) { miss(ip); return fail(404, INVALID) }
    return reply(200, { company_name: r.data.company_name })
  }

  if (json.action === 'start') {
    const name = String(json.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    if (!name) return fail(400, ERRORS['portal:name_required'][1])
    if (name.length > 160) return fail(400, 'El nombre es demasiado largo.')
    const conv = newToken()
    const r = await rpc('company_link_start', { p_hash: hash, p_name: name, p_conv_hash: await sha256(conv) })
    if (r.failed) {
      if (r.code === 'portal:invalid_link') miss(ip)
      const e = r.code ? ERRORS[r.code] : undefined
      return e ? fail(e[0], e[1]) : fail(500, 'No se pudo iniciar la conversación. Inténtalo de nuevo.')
    }
    return reply(200, { conversation_token: conv })
  }

  return fail(400, 'Acción no válida.')
})
