// Supabase Edge Function: extract-document
// POST multipart/form-data { kind: 'flight' | 'hotel' | 'loan', file: PDF | PNG | JPEG | WEBP }
// -> JSON in the shape of ExtractedFlight / ExtractedHotel / ExtractedLoan. Nothing is stored.
import { normalizeFlight, normalizeFood, normalizeHotel, normalizeLoan, parseJson, sniffMime } from './normalize.ts'
import { PROMPTS } from './prompts.ts'

const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 25_000
const OPENAI_TIMEOUT_MS = 40_000
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

async function extractOpenAI(apiKey: string, kind: keyof typeof NORMALIZERS, mime: string, data: string) {
  const model = Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-5.6-luna'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS)
  console.log('openai fallback start', kind, model)
  try {
    const document = mime === 'application/pdf'
      ? { type: 'input_file', filename: 'document.pdf', file_data: `data:${mime};base64,${data}` }
      : { type: 'input_image', image_url: `data:${mime};base64,${data}`, detail: 'high' }
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 16384,
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_object' } },
        input: [{ role: 'user', content: [{ type: 'input_text', text: PROMPTS[kind] }, document] }],
      }),
      signal: ctrl.signal,
    })
    console.log('openai responded', res.status)
    if (!res.ok) {
      await res.body?.cancel()
      return fail(502, 'El servicio alternativo de análisis no está disponible. Intenta nuevamente o llena el formulario manualmente.')
    }
    const json = await res.json()
    const content = (json.output ?? []).flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []) as { type: string; text?: string }[]
    if (content.some(part => part.type === 'refusal')) return fail(422, 'El documento no pudo ser analizado.')
    if (json.status !== 'completed') return fail(502, 'El servicio alternativo no pudo completar el análisis. Intenta nuevamente o llena el formulario manualmente.')
    const raw = parseJson(content.filter(part => part.type === 'output_text').map(part => part.text ?? '').join(''))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid extraction')
    return reply(200, NORMALIZERS[kind](raw))
  } catch (e) {
    console.error('openai fallback failed', (e as Error)?.name)
    return fail((e as Error)?.name === 'AbortError' ? 504 : 502, 'No se pudo completar el análisis con el servicio alternativo. Intenta nuevamente o llena el formulario manualmente.')
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'Método no permitido')

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey && !openaiKey) return fail(500, 'El servicio de análisis no está configurado.')

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

  const data = toBase64(bytes)
  if (!apiKey) return extractOpenAI(openaiKey!, kind, mime, data)
  const fallback = () => openaiKey
    ? extractOpenAI(openaiKey, kind, mime, data)
    : fail(502, 'El servicio de análisis no está disponible y el respaldo no está configurado. Intenta nuevamente o llena el formulario manualmente.')
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite'
  const t0 = Date.now()
  console.log('extract start', kind, mime, file.size, model)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPTS[kind] }, { inlineData: { mimeType: mime, data } }] }],
        generationConfig: { maxOutputTokens: 16384, responseMimeType: 'application/json' },
      }),
      signal: ctrl.signal,
    })
    console.log('gemini responded', res.status, Date.now() - t0, 'ms')
    if (!res.ok) {
      let reason = ''
      try { reason = (await res.json())?.error?.status ?? '' } catch { /* not JSON */ }
      console.error('gemini error', res.status)
      if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') return fail(422, 'El documento no pudo ser analizado.')
      clearTimeout(timer)
      return fallback()
    }
    const json = await res.json()
    if (json?.promptFeedback?.blockReason) return fail(422, 'El documento no pudo ser analizado.')
    const candidate = json?.candidates?.[0]
    if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(candidate?.finishReason)) return fail(422, 'El documento no pudo ser analizado.')
    if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete extraction')
    const text = (candidate?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('')
    const raw = parseJson(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid extraction')
    return reply(200, NORMALIZERS[kind](raw))
  } catch (e) {
    console.error('extract failed after', Date.now() - t0, 'ms', (e as Error)?.name)
    clearTimeout(timer)
    return fallback()
  } finally {
    clearTimeout(timer)
  }
})
