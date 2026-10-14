// Supabase Edge Function: extract-document
// POST multipart/form-data { kind: 'flight' | 'hotel' | 'loan', file: PDF | PNG | JPEG | WEBP }
// -> JSON in the shape of ExtractedFlight / ExtractedHotel / ExtractedLoan. Nothing is stored.
import { normalizeFlight, normalizeFood, normalizeHotel, normalizeLoan, parseJson, sniffMime } from './normalize.ts'
import { PROMPTS } from './prompts.ts'

const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 60_000
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const NORMALIZERS = { flight: normalizeFlight, hotel: normalizeHotel, loan: normalizeLoan, food: normalizeFood } as const

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (status: number, error: string) => reply(status, { error })

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'Método no permitido')

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return fail(500, 'El servicio de análisis no está configurado (falta GEMINI_API_KEY).')

  let form: FormData
  try { form = await req.formData() } catch { return fail(400, 'Solicitud inválida: se esperaba un formulario con el archivo.') }

  const kind = String(form.get('kind') ?? '') as keyof typeof NORMALIZERS
  const file = form.get('file')
  if (!(kind in NORMALIZERS)) return fail(400, 'Tipo de documento no válido.')
  if (!(file instanceof File)) return fail(400, 'No se recibió ningún archivo.')
  if (file.size === 0) return fail(400, 'El archivo está vacío.')
  if (file.size > MAX_BYTES) return fail(413, 'El archivo supera los 10 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffMime(bytes) ?? ''
  const allowed = mime === 'application/pdf' || ((kind === 'loan' || kind === 'food') && IMAGE_TYPES.includes(mime))
  if (!allowed) return fail(415, (kind === 'loan' || kind === 'food' ? 'Formato no soportado. Usa PDF, PNG, JPG o WEBP.' : 'Solo se admiten archivos PDF.') + ' El archivo no parece un documento válido o está dañado.')

  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite'
  const t0 = Date.now()
  console.log('extract start', kind, mime, file.size, model)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const data = toBase64(bytes)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPTS[kind] }, { inlineData: { mimeType: mime, data } }] }],
        generationConfig: { maxOutputTokens: 16384 },
      }),
      signal: ctrl.signal,
    })
    console.log('gemini responded', res.status, Date.now() - t0, 'ms')
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400)
      console.error('gemini error', res.status, detail)
      if (res.status === 429) return fail(502, 'El servicio de análisis está saturado. Intenta de nuevo en unos minutos.')
      let reason = ''
      try { reason = JSON.parse(detail)?.error?.message ?? '' } catch { /* not JSON */ }
      return fail(502, `El servicio de análisis respondió con error ${res.status}${reason ? ': ' + String(reason).slice(0, 160) : ''}`)
    }
    const json = await res.json()
    if (json?.promptFeedback?.blockReason) return fail(422, 'El documento no pudo ser analizado.')
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('')
    let raw: unknown
    try { raw = parseJson(text) } catch { return fail(502, 'No se pudo interpretar la respuesta del análisis. Intenta de nuevo o llena el formulario manualmente.') }
    return reply(200, NORMALIZERS[kind](raw))
  } catch (e) {
    console.error('extract failed after', Date.now() - t0, 'ms', (e as Error)?.name, (e as Error)?.message)
    if ((e as Error)?.name === 'AbortError') return fail(504, 'El análisis tardó demasiado. Intenta de nuevo o llena el formulario manualmente.')
    console.error('extract-document failed', (e as Error)?.message)
    return fail(500, 'Error inesperado al analizar el documento.')
  } finally {
    clearTimeout(timer)
  }
})
