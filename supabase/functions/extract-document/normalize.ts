// Pure helpers: turn the raw JSON returned by the LLM into the exact shapes the frontend expects
// (ExtractedFlight / ExtractedHotel / ExtractedLoan). Anything missing stays empty: nothing is invented.

const rid = () => Math.random().toString(36).slice(2, 9)

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.replace(/[^\d.,-]/g, '')
  if (!s) return null
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  else if (comma >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export const isoDate = (v: unknown): string => {
  const s = str(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return Number.isNaN(Date.parse(s)) ? '' : s
}

export const hhmm = (v: unknown): string => {
  const m = str(v).match(/^(\d{1,2}):(\d{2})/)
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

const int = (v: unknown): number | null => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

/** Only keep money values expressed in COP (or with no currency stated); never convert or guess. */
const cop = (amount: number | null, currency: unknown): number | null => {
  const c = str(currency).toUpperCase()
  return !c || c === 'COP' || c === '$' ? amount : null
}

const DOC_TYPES = ['CC', 'CE', 'TI', 'PA', 'NIT']
const list = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : [])

export function normalizeFlight(raw: any) {
  const segments = list(raw?.segments, 12).map((s: any) => ({
    id: rid(), flight_number: str(s?.flight_number), origin: str(s?.origin).toUpperCase(), destination: str(s?.destination).toUpperCase(),
    departure_date: isoDate(s?.departure_date), departure_time: hhmm(s?.departure_time), arrival_date: isoDate(s?.arrival_date), arrival_time: hhmm(s?.arrival_time), cabin: str(s?.cabin),
  }))
  if (!segments.length) segments.push({ id: rid(), flight_number: '', origin: '', destination: '', departure_date: '', departure_time: '', arrival_date: '', arrival_time: '', cabin: 'Economy' })

  const passengers = list(raw?.passengers, 20).map((p: any) => ({
    id: rid(), names: str(p?.names), surnames: str(p?.surnames), document_type: DOC_TYPES.includes(str(p?.document_type).toUpperCase()) ? str(p?.document_type).toUpperCase() : '',
    document_number: str(p?.document_number), birth_date: isoDate(p?.birth_date), email: str(p?.email), phone: str(p?.phone), frequent_flyer: str(p?.frequent_flyer), ticket_number: str(p?.ticket_number),
  }))
  if (!passengers.length) passengers.push({ id: rid(), names: '', surnames: '', document_type: 'CC', document_number: '', birth_date: '', email: '', phone: '', frequent_flyer: '', ticket_number: '' })

  const chain = segments.length && segments[0].origin ? [segments[0].origin, ...segments.map(s => s.destination)].filter(Boolean).join('-') : ''
  // The value is the total of the whole reservation; the app divides it among the passengers when saving.
  const paxAmounts = list(raw?.passengers, 20).map((p: any) => cop(num(p?.total_amount), raw?.currency))
  const paxSum = paxAmounts.length && paxAmounts.every(v => v != null) ? paxAmounts.reduce((acc: number, v) => acc + (v as number), 0) : null
  const value = cop(num(raw?.total_amount), raw?.currency) ?? paxSum
  const last = segments[segments.length - 1]
  return {
    provider: str(raw?.provider),
    amount: value ?? 0,
    details: {
      no: '', first_surname: passengers[0].surnames, names: passengers[0].names, route: str(raw?.route) || chain,
      departure_date: segments[0].departure_date, return_date: segments.length > 1 ? last.departure_date : '',
      airline: str(raw?.airline), booking_code: str(raw?.booking_code), internal_booking_code: '', ticket_number: str(raw?.ticket_number),
      value_with_taxes_tae: value, total_invoice: null, third_party_commission: null, provider_profit: null,
      ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null, card_number: '', purchase_invoice: '',
      segments, passengers,
    },
  }
}

export function normalizeHotel(raw: any) {
  const checkIn = isoDate(raw?.check_in), checkOut = isoDate(raw?.check_out)
  let nights = int(raw?.nights)
  if (nights == null && checkIn && checkOut) {
    const diff = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 864e5)
    if (diff > 0) nights = diff
  }
  const value = cop(num(raw?.total_amount), raw?.currency)
  return {
    provider: str(raw?.provider),
    ...(value != null ? { amount: value } : {}),
    details: {
      reservation_number: str(raw?.reservation_number), accommodation_code: str(raw?.accommodation_code), hotel: str(raw?.hotel), city: str(raw?.city),
      address: str(raw?.address), phone: str(raw?.phone), email: str(raw?.email), check_in: checkIn, check_in_time: hhmm(raw?.check_in_time),
      check_out: checkOut, check_out_time: hhmm(raw?.check_out_time), nights, holder: str(raw?.holder), guests: int(raw?.guests),
      room_type: str(raw?.room_type), board: str(raw?.board), special_requests: str(raw?.special_requests), purchase_invoice: '',
      total_invoice: null, third_party_commission: null, provider_profit: null, ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null,
    },
  }
}

export function normalizeLoan(raw: any) {
  const amount = cop(num(raw?.amount), raw?.currency)
  const details: Record<string, string | number> = {}
  const put = (k: string, v: string | number | null) => { if (v !== '' && v != null) details[k] = v }
  put('request', str(raw?.request)); put('invoice_date', isoDate(raw?.invoice_date)); put('cot', str(raw?.cot)); put('oc', str(raw?.oc))
  put('requested_by', str(raw?.requested_by)); put('iva', cop(num(raw?.iva), raw?.currency)); put('charged_quoted_value', cop(num(raw?.charged_quoted_value), raw?.currency))
  put('sent', isoDate(raw?.sent)); put('received', isoDate(raw?.received)); put('paid', isoDate(raw?.paid))
  const out: Record<string, unknown> = { details }
  const date = isoDate(raw?.date), provider = str(raw?.provider), invoice = str(raw?.invoice_number)
  if (date) out.date = date
  if (provider) out.provider = provider
  if (amount != null) out.amount = amount
  if (invoice) out.invoice_number = invoice
  return out
}

/** The model is asked for bare JSON, but tolerate code fences or surrounding text. */
export function parseJson(text: string): any {
  const t = text.replace(/```(?:json)?/gi, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('empty')
  return JSON.parse(t.slice(a, b + 1))
}
