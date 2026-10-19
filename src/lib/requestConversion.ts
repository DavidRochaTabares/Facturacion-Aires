import { emptyDetails } from '../components/ServiceForm'
import type { OperationInput } from '../types'
import type { ClientRequestFull } from '../types/requests'

const uid = () => Math.random().toString(36).slice(2, 9)
const nights = (a: string, b: string) => { const n = Math.round((Date.parse(b) - Date.parse(a)) / 864e5); return n > 0 ? n : null }

/**
 * Pre-fills the operation form from a client request. Nothing is created here: the agency reviews and corrects everything before saving.
 * Only what the client actually provided is copied (the return date, for example, is never invented). Identity documents stay in the request's
 * private bucket and are not duplicated.
 */
export function requestToInitial(r: ClientRequestFull, type: 'flight' | 'hotel'): Partial<OperationInput> {
  const d = r.details
  const note = [r.description, r.observations, d.itinerary_notes && `Itinerario: ${d.itinerary_notes}`, d.preferences && `Preferencias: ${d.preferences}`].filter(Boolean).join('\n')
  if (type === 'flight') {
    const base = emptyDetails('flight')
    const dep = String(d.departure_date ?? ''), ret = String(d.return_date ?? '')
    return {
      observations: note,
      details: {
        ...base,
        route: [d.origin, d.destination].filter(Boolean).join('-'),
        departure_date: dep, return_date: ret,
        segments: [{ id: uid(), flight_number: '', origin: String(d.origin ?? ''), destination: String(d.destination ?? ''), departure_date: dep, departure_time: '', arrival_date: ret, arrival_time: '', cabin: 'Economy' }],
        passengers: r.passengers.length
          ? r.passengers.map(p => ({ id: uid(), names: p.first_names, surnames: p.last_names, document_type: p.document_type === 'RC' ? 'TI' : p.document_type, document_number: p.document_number, birth_date: p.birth_date, email: '', phone: '', frequent_flyer: '', ticket_number: '' }))
          : base.passengers,
      },
    } as Partial<OperationInput>
  }
  const base = emptyDetails('hotel')
  const cin = String(d.check_in ?? ''), cout = String(d.check_out ?? '')
  const p0 = r.passengers[0]
  return {
    observations: note,
    details: { ...base, city: String(d.destination ?? ''), check_in: cin, check_out: cout, nights: cin && cout ? nights(cin, cout) : null, guests: d.guests ? Number(d.guests) : null, holder: p0 ? `${p0.first_names} ${p0.last_names}` : r.client_name },
  } as Partial<OperationInput>
}
