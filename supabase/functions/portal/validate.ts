// Authoritative server-side validation of the public request form (the frontend repeats these rules only for convenience).
export const TYPES = ['flight', 'hotel', 'transport', 'food', 'package', 'other'] as const
export const DOC_TYPES = ['CC', 'CE', 'TI', 'RC', 'PA', 'NIT'] as const
/** Travel requests need every passenger's data and identity document. */
export const PASSENGERS_REQUIRED = ['flight', 'hotel', 'package']
export const MAX_PASSENGERS = 10

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '')
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s
const today = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10) // Colombia (UTC-5)
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
  const dateIn = (k: string, label: string, required: boolean, min = today()) => {
    const v = str(d[k], 10)
    if (!v) { if (required) errors.push(`Selecciona ${label}.`); return '' }
    if (!isDate(v)) { errors.push(`${label[0].toUpperCase()}${label.slice(1)} no es válida.`); return '' }
    if (min && v < min) errors.push(`${label[0].toUpperCase()}${label.slice(1)} no puede estar en el pasado.`)
    return v
  }
  if (type === 'flight') {
    const origin = str(d.origin, 80), destination = str(d.destination, 80), ret = str(d.return_date, 10), scope = str(d.scope, 20), trip = str(d.trip_type, 20)
    if (origin.length < 2) errors.push('Indica el origen del vuelo.')
    if (destination.length < 2) errors.push('Indica el destino del vuelo.')
    const dep = dateIn('departure_date', 'la fecha de salida', true)
    if (!['national', 'international'].includes(scope)) errors.push('Indica si el viaje es nacional o internacional.')
    if (!['oneway', 'roundtrip'].includes(trip)) errors.push('Indica si es solo ida o ida y vuelta.')
    const returnRequired = scope === 'international'
    if (returnRequired && !isDate(ret)) errors.push('Selecciona la fecha de regreso (obligatoria en viajes internacionales).')
    if (ret && !isDate(ret)) errors.push('La fecha de regreso no es válida.')
    else if (ret && dep && ret < dep) errors.push('La fecha de regreso no puede ser anterior a la de salida.')
    put('origin', origin); put('destination', destination); put('departure_date', dep); put('scope', scope); put('trip_type', trip)
    if (ret && (scope === 'international' || trip !== 'oneway')) put('return_date', ret) // never filled automatically: only what the client chose
    put('itinerary_notes', str(d.itinerary_notes, 1000))
  } else if (type === 'hotel') {
    const destination = str(d.destination, 120)
    if (destination.length < 2) errors.push('Indica el destino o la ubicación del hotel.')
    const cin = dateIn('check_in', 'la fecha de entrada', true), cout = str(d.check_out, 10)
    if (!isDate(cout)) errors.push('Selecciona la fecha de salida.')
    else if (cin && cout <= cin) errors.push('La fecha de salida debe ser posterior a la de entrada.')
    const guests = int(d.guests, 1, 50), rooms = d.rooms === '' || d.rooms == null ? null : int(d.rooms, 1, 30)
    if (guests == null) errors.push('Indica el número de huéspedes (1 a 50).')
    if (d.rooms !== '' && d.rooms != null && rooms == null) errors.push('El número de habitaciones no es válido.')
    put('destination', destination); put('check_in', cin); put('check_out', isDate(cout) ? cout : ''); if (guests != null) put('guests', guests); if (rooms != null) put('rooms', rooms)
    put('preferences', str(d.preferences, 1000))
  } else if (type === 'transport') {
    const origin = str(d.origin, 120), destination = str(d.destination, 120)
    if (origin.length < 2) errors.push('Indica el origen del servicio de transporte.')
    if (destination.length < 2) errors.push('Indica el destino del servicio de transporte.')
    const date = dateIn('service_date', 'la fecha del servicio', true)
    const back = str(d.return_date, 10)
    if (back && !isDate(back)) errors.push('La fecha de regreso no es válida.')
    else if (back && date && back < date) errors.push('La fecha de regreso no puede ser anterior a la del servicio.')
    put('origin', origin); put('destination', destination); put('service_date', date); put('return_date', back)
    put('time', str(d.time, 20)); put('people', int(d.people, 1, 500) ?? '')
  } else if (type === 'food') {
    const location = str(d.location, 200), people = int(d.people, 1, 5000)
    if (location.length < 3) errors.push('Indica la ubicación donde se necesita el servicio de alimentación.')
    if (people == null) errors.push('Indica la cantidad de personas (1 a 5.000).')
    const date = dateIn('service_date', 'la fecha del servicio', true)
    put('service_date', date); put('location', location); if (people != null) put('people', people)
  } else if (type === 'package') {
    const destination = str(d.destination, 120)
    if (destination.length < 2) errors.push('Indica el destino del paquete turístico.')
    const from = dateIn('date_from', 'la fecha de inicio', true), to = str(d.date_to, 10)
    if (!isDate(to)) errors.push('Selecciona la fecha de finalización.')
    else if (from && to < from) errors.push('La fecha de finalización no puede ser anterior a la de inicio.')
    put('destination', destination); put('date_from', from); put('date_to', isDate(to) ? to : ''); put('preferences', str(d.preferences, 1000))
  } else if (type === 'other') {
    put('dates', str(d.dates, 200)); put('extra', str(d.extra, 1000))
  }
  return details
}

export function cleanDescription(type: string, raw: unknown, errors: string[]): string {
  const description = str(raw, 4000)
  if (!['flight', 'hotel'].includes(type) && description.length < 10) errors.push(type === 'other' ? 'Cuéntanos con detalle lo que necesitas (mínimo 10 caracteres).' : 'Describe con más detalle lo que necesitas (mínimo 10 caracteres).')
  return description
}

/** Validates NEW passengers (the ones in this request body). `existing` = passengers already saved for the conversation. */
export function cleanPassengers(type: string, raw: unknown, existing: number, errors: string[]): CleanPassenger[] {
  const list: any[] = Array.isArray(raw) ? raw : []
  const out: CleanPassenger[] = []
  if (existing + list.length > MAX_PASSENGERS) errors.push(`Máximo ${MAX_PASSENGERS} pasajeros por solicitud.`)
  if (PASSENGERS_REQUIRED.includes(type) && existing + list.length === 0) errors.push('Agrega al menos un pasajero.')
  list.slice(0, MAX_PASSENGERS).forEach((p, i) => {
    const who = `Pasajero ${existing + i + 1}`
    const first = str(p?.first_names, 120), last = str(p?.last_names, 120), dt = String(p?.document_type ?? ''), num = str(p?.document_number, 40), birth = str(p?.birth_date, 10)
    if (first.length < 2 || last.length < 2) errors.push(`${who}: escribe nombres y apellidos.`)
    if (!(DOC_TYPES as readonly string[]).includes(dt)) errors.push(`${who}: selecciona el tipo de documento.`)
    if (!/^[A-Za-z0-9.-]{4,30}$/.test(num)) errors.push(`${who}: el número de documento no es válido.`)
    if (!isDate(birth)) errors.push(`${who}: selecciona la fecha de nacimiento.`)
    else if (birth > today() || birth < '1900-01-01') errors.push(`${who}: la fecha de nacimiento no es válida.`)
    out.push({ first_names: first, last_names: last, document_type: dt, document_number: num, birth_date: birth })
  })
  return out
}

export function validateSubmission(raw: any): { data?: CleanSubmission; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { errors: ['Solicitud no válida.'] }
  const type = String(raw.request_type ?? '')
  if (!validType(type)) errors.push('Selecciona qué necesitas (tipo de requerimiento).')
  const client_name = str(raw.client_name, 160)
  if (client_name.length < 3) errors.push('Escribe tu nombre completo.')
  const client_email = str(raw.client_email, 200).toLowerCase()
  const client_phone = str(raw.client_phone, 40)
  if (!client_email && !client_phone) errors.push('Escribe un correo electrónico o un teléfono de contacto.')
  if (client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(client_email)) errors.push('El correo electrónico no es válido.')
  if (client_phone && !/^\+?[0-9 ()-]{7,20}$/.test(client_phone)) errors.push('El teléfono no es válido.')
  if (raw.privacy_accepted !== true) errors.push('Debes aceptar el aviso de privacidad para enviar la solicitud.')
  if (!validType(type)) return { errors }
  const description = cleanDescription(type, raw.description, errors)
  const details = cleanDetails(type, raw.details, errors)
  const passengers = cleanPassengers(type, raw.passengers, 0, errors)
  if (errors.length) return { errors }
  return { errors, data: { client_name, client_email, client_phone, request_type: type, description, observations: str(raw.observations, 4000), details, passengers, privacy_accepted: true } }
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
  if (!validType(type)) return { errors: ['Selecciona qué necesitas (tipo de requerimiento).'] }
  const description = cleanDescription(type, raw.description, errors)
  const details = cleanDetails(type, raw.details, errors)
  const passengers = cleanPassengers(type, raw.passengers, existingPassengers, errors)
  if (errors.length) return { errors }
  return { errors, data: { request_type: type, description, observations: str(raw.observations, 4000), details, passengers } }
}
