// Supabase Edge Function: push-notify  (called ONLY by the database trigger through pg_net; deploy with --no-verify-jwt, authorised by x-push-secret)
// POST { message_id, request_id } -> sends a Web Push notification to every registered agency device.
// Secrets: PUSH_WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...). The service-role key lives only here.
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:soporte@airesydestinos.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const rest = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  if (!SUPABASE_URL || !SERVICE_KEY || !SECRET || !VAPID_PUBLIC || !VAPID_PRIVATE) return json(500, { error: 'not configured' })
  if (!same(req.headers.get('x-push-secret') ?? '', SECRET)) return json(401, { error: 'unauthorized' })

  let body: { message_id?: string; request_id?: string }
  try { body = await req.json() } catch { return json(400, { error: 'bad json' }) }
  if (!UUID.test(body.message_id ?? '') || !UUID.test(body.request_id ?? '')) return json(400, { error: 'bad ids' })

  const [m, r, atts, unread, subs] = await Promise.all([
    rest(`client_request_messages?select=author,body&id=eq.${body.message_id}`),
    rest(`client_requests?select=client_name,companies(name)&id=eq.${body.request_id}`),
    rest(`client_request_attachments?select=id&message_id=eq.${body.message_id}`),
    rest('client_requests?select=id&agency_unread=gt.0', { method: 'HEAD', headers: { Prefer: 'count=exact' } }),
    rest('push_subscriptions?select=id,endpoint,p256dh,auth'),
  ])
  if (!m.ok || !r.ok || !subs.ok) return json(500, { error: 'lookup failed' })
  const msg = (await m.json())[0] as { author: string; body: string } | undefined
  const req0 = (await r.json())[0] as { client_name: string; companies: { name: string } | null } | undefined
  if (!msg || msg.author !== 'client' || !req0) return json(200, { sent: 0 })
  const files = atts.ok ? (await atts.json()).length : 0
  const count = Number((unread.headers.get('content-range') ?? '').split('/')[1])

  const who = req0.client_name?.trim() || 'Cliente'
  const payload = JSON.stringify({
    title: clip(req0.companies?.name ? `${req0.companies.name} · ${who}` : who, 60),
    body: clip(msg.body.trim() || (files ? `Envió ${files === 1 ? 'un archivo' : `${files} archivos`}` : 'Nuevo mensaje'), 140),
    tag: `req-${body.request_id}`, url: '/solicitudes', unread: Number.isFinite(count) ? count : undefined,
  })

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  const list = (await subs.json()) as { id: string; endpoint: string; p256dh: string; auth: string }[]
  let sent = 0
  await Promise.all(list.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // the device unsubscribed or the subscription expired: forget it
      if (status === 404 || status === 410) await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' })
      else console.error('push failed', status)
    }
  }))
  return json(200, { sent, total: list.length })
})
