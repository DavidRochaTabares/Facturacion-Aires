// Authoritative server-side cleanup of the public request form (the frontend repeats these rules only for convenience).
// Nothing is required: a client can save a request with every field empty. Only malformed values that WERE provided are rejected
// or dropped; missing data is simply not stored. The only standing rule is the international-flight return field, which is a
// UI concern (it must be shown), not a blocker: it may stay empty.
export const TYPES = ['flight', 'hotel', 'transport', 'food', 'package', 'other'] as const
export const DOC_TYPES = ['CC', 'CE', 'TI', 'RC', 'PA', 'NIT'] as const
/** Types whose form collects passengers. */
export const PASSENGERS_REQUIRED = ['flight', 'hotel', 'package']
export const MAX_PASSENGERS = 10

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '')
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s
const int = (v: unknown, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null }

export interface CleanPassenger { first_names: string; last_names: string; document_type: string; document_number: string; birth_date: string }
export interface CleanSubmission {
  client_name: string; client_email: string; client_phone: string; request_type: string; description: string; observations: string
  details: Record<string, string | number>; passengers: CleanPassenger[]; privacy_accepted: boolean
}

export const validType = (t: unknown): t is (typeof TYPES)[number] => typeof t === 'string' && (TYPES as readonly string[]).includes(t)

/** Fields that belong to each kind of request. Unknown keys are dropped; only what the client chose is stored (nothing is filled in automatically). */
export function cleanDetails(type: string, raw: unknown, errors: string[]): Record<string, string | number> {
  const d: any = raw && typeof raw === 'object' ? raw : {}
  const details: Record<string, string | number> = {}
  const put = (k: string, v: string | number) => { if (v !== '' && v != null) details[k] = v }
  // Optional: only validates a date that was actually provided.
  const dateIn = (k: string, label: string) => {
    const v = str(d[k], 10)
    if (v && !isDate(v)) { errors.push(`${label[0].toUpperCase()}${label.slice(1)} no es válida.`); return '' }
    return v
  }
  if (type === 'flight') {
    const ret = str(d.return_date, 10), dep = dateIn('departure_date', 'la fecha de salida')
    const scope = str(d.scope, 20), trip = str(d.trip_type, 20)
    if (ret && !isDate(ret)) errors.push('La fecha de regreso no es válida.')
    else if (ret && dep && ret < dep) errors.push('La fecha de regreso no puede ser anterior a la de salida.')
    put('origin', str(d.origin, 80)); put('destination', str(d.destination, 80)); put('departure_date', dep)
    if (['national', 'international'].includes(scope)) put('scope', scope)
    if (['oneway', 'roundtrip'].includes(trip)) put('trip_type', trip)
    if (ret && isDate(ret) && (scope === 'international' || trip === 'roundtrip')) put('return_date', ret) // never filled automatically
    put('itinerary_notes', str(d.itinerary_notes, 1000))
  } else if (type === 'hotel') {
    const cin = dateIn('check_in', 'la fecha de entrada'), cout = str(d.check_out, 10)
    if (cout && !isDate(cout)) errors.push('La fecha de salida no es válida.')
    else if (cin && cout && cout <= cin) errors.push('La fecha de salida debe ser posterior a la de entrada.')
    const guests = int(d.guests, 1, 50), rooms = int(d.rooms, 1, 30)
    put('destination', str(d.destination, 120)); put('check_in', cin); put('check_out', isDate(cout) ? cout : '')
    if (guests != null) put('guests', guests); if (rooms != null) put('rooms', rooms)
    put('preferences', str(d.preferences, 1000))
  } else if (type === 'transport') {
    const date = dateIn('service_date', 'la fecha del servicio'), back = str(d.return_date, 10)
    if (back && !isDate(back)) errors.push('La fecha de regreso no es válida.')
    else if (back && date && back < date) errors.push('La fecha de regreso no puede ser anterior a la del servicio.')
    put('origin', str(d.origin, 120)); put('destination', str(d.destination, 120)); put('service_date', date); put('return_date', isDate(back) ? back : '')
    put('time', str(d.time, 20)); const people = int(d.people, 1, 500); if (people != null) put('people', people)
  } else if (type === 'food') {
    put('service_date', dateIn('service_date', 'la fecha del servicio')); put('location', str(d.location, 200))
    const people = int(d.people, 1, 5000); if (people != null) put('people', people)
  } else if (type === 'package') {
    const from = dateIn('date_from', 'la fecha de inicio'), to = str(d.date_to, 10)
    if (to && !isDate(to)) errors.push('La fecha de finalización no es válida.')
    else if (from && to && to < from) errors.push('La fecha de finalización no puede ser anterior a la de inicio.')
    put('destination', str(d.destination, 120)); put('date_from', from); put('date_to', isDate(to) ? to : ''); put('preferences', str(d.preferences, 1000))
  } else if (type === 'other') {
    put('dates', str(d.dates, 200)); put('extra', str(d.extra, 1000))
  }
  return details
}

export function cleanDescription(_type: string, raw: unknown, _errors: string[]): string {
  return str(raw, 4000)
}

/** New passengers in this request body. Fully empty rows are dropped; partial rows are kept as provided. */
export function cleanPassengers(type: string, raw: unknown, existing: number, errors: string[]): CleanPassenger[] {
  const list: any[] = Array.isArray(raw) ? raw : []
  const out: CleanPassenger[] = []
  if (existing + list.length > MAX_PASSENGERS) errors.push(`Máximo ${MAX_PASSENGERS} pasajeros por solicitud.`)
  const allowed = PASSENGERS_REQUIRED.includes(type) || type === 'transport'
  list.slice(0, Math.max(0, MAX_PASSENGERS - existing)).forEach(p => {
    const first = str(p?.first_names, 120), last = str(p?.last_names, 120), dt = str(p?.document_type, 4).toUpperCase(), num = str(p?.document_number, 40), birth = str(p?.birth_date, 10)
    if (!allowed || (!first && !last && !num && !birth)) return // drop completely empty rows
    out.push({ first_names: first, last_names: last, document_type: (DOC_TYPES as readonly string[]).includes(dt) ? dt : '', document_number: num, birth_date: isDate(birth) ? birth : '' })
  })
  return out
}

export function validateSubmission(raw: any): { data?: CleanSubmission; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { errors: ['Solicitud no válida.'] }
  const type = String(raw.request_type ?? '')
  if (type && !validType(type)) errors.push('Tipo de requerimiento no válido.')
  const client_name = str(raw.client_name, 160)
  const client_email = str(raw.client_email, 200).toLowerCase()
  const client_phone = str(raw.client_phone, 40)
  if (client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(client_email)) errors.push('El correo electrónico no es válido.')
  if (client_phone && !/^\+?[0-9 ()-]{7,20}$/.test(client_phone)) errors.push('El teléfono no es válido.')
  if (errors.length) return { errors }
  const description = cleanDescription(type, raw.description, errors)
  const details = cleanDetails(type, raw.details, errors)
  const passengers = cleanPassengers(type, raw.passengers, 0, errors)
  if (errors.length) return { errors }
  return { errors, data: { client_name, client_email, client_phone, request_type: type, description, observations: str(raw.observations, 4000), details, passengers, privacy_accepted: raw.privacy_accepted === true } }
}

/** A single requirement item (additional service inside the same conversation): same shape as an update, minus request-level fields. */
export function validateItem(raw: any, existingPassengers: number): { data?: { request_type: string; description: string; observations: string; details: Record<string, string | number>; passengers: CleanPassenger[] }; errors: string[] } {
  return validateUpdate(raw, existingPassengers)
}

/** Update of an already submitted request (open conversation only): new type/details/description and optionally NEW passengers. */
export function validateUpdate(raw: any, existingPassengers: number): { data?: { request_type: string; description: string; observations: string; details: Record<string, string | number>; passengers: CleanPassenger[] }; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { errors: ['Solicitud no válida.'] }
  const type = String(raw.request_type ?? '')
  if (type && !validType(type)) return { errors: ['Tipo de requerimiento no válido.'] }
  const description = cleanDescription(type, raw.description, errors)
  const details = cleanDetails(type, raw.details, errors)
  const passengers = cleanPassengers(type, raw.passengers, existingPassengers, errors)
  if (errors.length) return { errors }
  return { errors, data: { request_type: type, description, observations: str(raw.observations, 4000), details, passengers } }
}
