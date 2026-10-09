import { fdate, money } from './format'
import type { OperationRow, OperationType } from '../types'

export type ReportGroup = 'flight' | 'hotel' | 'transport' | 'food' | 'loan' | 'additional'

export const GROUP_ORDER: ReportGroup[] = ['flight', 'hotel', 'transport', 'food', 'loan', 'additional']
export const GROUP_TITLE: Record<ReportGroup, string> = { flight: 'Vuelos', hotel: 'Hoteles', transport: 'Transporte', food: 'Alimentación', loan: 'Préstamos', additional: 'Servicios adicionales' }
export const groupOf = (t: OperationType): ReportGroup => (t === 'other' ? 'additional' : t)

export interface ReportColumn {
  key: string
  label: string
  group: ReportGroup | 'common'
  money?: boolean
  get: (r: OperationRow) => string | number | null
}
export interface ReportTable { group: ReportGroup; title: string; cols: ReportColumn[]; body: string[][]; foot: string[] | null }

type Row<K extends OperationType> = Extract<OperationRow, { type: K }>
const on = <K extends OperationType>(t: K, f: (r: Row<K>) => string | number | null) => (r: OperationRow) => (r.type === t ? f(r as Row<K>) : null)
const dt = (x?: string | null) => (x ? fdate(x) : '')

export const REPORT_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Fecha', group: 'common', get: r => dt(r.date) },
  { key: 'company', label: 'Cliente / empresa', group: 'common', get: r => r.company_name },
  { key: 'provider', label: 'Proveedor', group: 'common', get: r => r.provider },
  { key: 'invoice', label: 'Factura', group: 'common', get: r => r.invoice_number },
  { key: 'amount', label: 'Valor (costo)', group: 'common', money: true, get: r => r.amount },
  { key: 'charge', label: 'Valor a cobrar', group: 'common', money: true, get: r => r.charge_amount },
  { key: 'observations', label: 'Observaciones', group: 'common', get: r => r.observations },

  { key: 'f_pax', label: 'Pasajeros', group: 'flight', get: on('flight', r => r.details.passengers.map(p => (p.names + ' ' + p.surnames).trim()).filter(Boolean).join(', ')) },
  { key: 'f_route', label: 'Ruta', group: 'flight', get: on('flight', r => r.details.route) },
  { key: 'f_dep', label: 'Fecha de ida', group: 'flight', get: on('flight', r => dt(r.details.departure_date)) },
  { key: 'f_ret', label: 'Fecha de vuelta', group: 'flight', get: on('flight', r => dt(r.details.return_date)) },
  { key: 'f_airline', label: 'Aerolínea', group: 'flight', get: on('flight', r => r.details.airline) },
  { key: 'f_booking', label: 'Código de reserva', group: 'flight', get: on('flight', r => r.details.booking_code) },
  { key: 'f_ticket', label: 'Número de tiquete', group: 'flight', get: on('flight', r => r.details.ticket_number) },
  { key: 'f_total', label: 'Total factura', group: 'flight', money: true, get: on('flight', r => r.details.total_invoice) },

  { key: 'h_hotel', label: 'Hotel', group: 'hotel', get: on('hotel', r => r.details.hotel) },
  { key: 'h_city', label: 'Ciudad', group: 'hotel', get: on('hotel', r => r.details.city) },
  { key: 'h_in', label: 'Check-in', group: 'hotel', get: on('hotel', r => dt(r.details.check_in)) },
  { key: 'h_out', label: 'Check-out', group: 'hotel', get: on('hotel', r => dt(r.details.check_out)) },
  { key: 'h_nights', label: 'Noches', group: 'hotel', get: on('hotel', r => r.details.nights) },
  { key: 'h_holder', label: 'Titular', group: 'hotel', get: on('hotel', r => r.details.holder) },
  { key: 'h_guests', label: 'Huéspedes', group: 'hotel', get: on('hotel', r => r.details.guests) },
  { key: 'h_res', label: 'N.º de reserva', group: 'hotel', get: on('hotel', r => r.details.reservation_number) },

  { key: 't_origin', label: 'Origen', group: 'transport', get: on('transport', r => r.details.origin) },
  { key: 't_dest', label: 'Destino', group: 'transport', get: on('transport', r => r.details.destination) },
  { key: 't_time', label: 'Hora', group: 'transport', get: on('transport', r => r.details.time) },
  { key: 't_pax', label: 'Pasajero', group: 'transport', get: on('transport', r => r.details.passenger) },
  { key: 't_num', label: 'N.º de servicio', group: 'transport', get: on('transport', r => r.details.service_number) },

  { key: 'fd_by', label: 'Quién solicitó', group: 'food', get: on('food', r => r.details.requested_by) },
  { key: 'fd_item', label: 'Qué solicitó', group: 'food', get: on('food', r => r.details.requested_item) },
  { key: 'fd_sup', label: 'Valor insumo', group: 'food', money: true, get: on('food', r => r.details.supplies_value) },
  { key: 'fd_tr', label: 'Valor transporte', group: 'food', money: true, get: on('food', r => r.details.transport_value) },
  { key: 'fd_tot', label: 'Costo total', group: 'food', money: true, get: on('food', r => r.details.total_cost) },

  { key: 'l_req', label: 'Solicitud', group: 'loan', get: on('loan', r => r.details.request) },
  { key: 'l_by', label: 'Solicitó', group: 'loan', get: on('loan', r => r.details.requested_by) },
  { key: 'l_cot', label: 'COT', group: 'loan', get: on('loan', r => r.details.cot) },
  { key: 'l_oc', label: 'OC', group: 'loan', get: on('loan', r => r.details.oc) },
  { key: 'l_inv', label: 'Fecha de factura', group: 'loan', get: on('loan', r => dt(r.details.invoice_date)) },
  { key: 'l_rec', label: 'Recibida', group: 'loan', get: on('loan', r => dt(r.details.received)) },
  { key: 'l_paid', label: 'Se pagó', group: 'loan', get: on('loan', r => dt(r.details.paid)) },

  { key: 'a_desc', label: 'Descripción', group: 'additional', get: r => (r.type === 'additional' || r.type === 'other' ? r.details.description : null) },
]

const DEFAULTS: Record<ReportGroup, string[]> = {
  flight: ['f_pax', 'f_route', 'f_airline', 'f_booking'],
  hotel: ['h_hotel', 'h_city', 'h_in', 'h_out'],
  transport: ['t_origin', 't_dest', 't_pax'],
  food: ['fd_item'],
  loan: ['l_req'],
  additional: ['a_desc'],
}

export const presentGroups = (rows: OperationRow[]) => GROUP_ORDER.filter(g => rows.some(r => groupOf(r.type) === g))

export const defaultColumns = (groups: ReportGroup[], withCompany: boolean) =>
  ['date', ...(withCompany ? ['company'] : []), ...groups.flatMap(g => DEFAULTS[g]), 'provider', 'amount', 'charge']

export const cellText = (c: ReportColumn, r: OperationRow) => {
  const v = c.get(r)
  if (v == null || v === '') return ''
  return c.money ? money(Number(v)) : String(v)
}

export function buildTables(rows: OperationRow[], keys: string[]): ReportTable[] {
  return GROUP_ORDER.map(g => {
    const gr = rows.filter(r => groupOf(r.type) === g).sort((a, b) => a.date.localeCompare(b.date))
    if (!gr.length) return null
    const cols = keys.map(k => REPORT_COLUMNS.find(c => c.key === k)).filter((c): c is ReportColumn => !!c && (c.group === 'common' || c.group === g))
    if (!cols.length) return null
    const foot = cols.some(c => c.money)
      ? cols.map((c, i) => (c.money ? money(gr.reduce((a, r) => a + (Number(c.get(r)) || 0), 0)) : i === 0 ? 'Total' : ''))
      : null
    return { group: g, title: `${GROUP_TITLE[g]} (${gr.length})`, cols, body: gr.map(r => cols.map(c => cellText(c, r))), foot }
  }).filter((t): t is ReportTable => !!t)
}
