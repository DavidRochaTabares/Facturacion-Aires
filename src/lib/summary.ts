import type { OperationRow } from '../types'

// One-line, paste-friendly text built only from the saved record (nothing is stored; it is recomputed from the row every time).
const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim()
const dmy = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
const peso = (n: number | null | undefined) => (n == null ? '' : `${n < 0 ? '-' : ''}$${String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`)
const join = (items: [string, string | number | null | undefined][]) =>
  items.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(' | ')

export function billingSummary(r: OperationRow): string {
  const client = clean(r.company_name === '—' ? '' : r.company_name)
  const charge = r.charge_amount > 0 ? peso(r.charge_amount) : ''
  switch (r.type) {
    case 'flight': {
      const d = r.details
      const names = d.passengers.map(p => clean(`${p.names} ${p.surnames}`)).filter(Boolean)
      if (!names.length) names.push(clean(`${d.names} ${d.first_surname}`))
      const tickets = [...new Set([clean(d.ticket_number), ...d.passengers.map(p => clean(p.ticket_number))].filter(Boolean))]
      const value = d.total_invoice != null ? peso(d.total_invoice) : charge
      return join([
        [names.length > 1 ? 'Pasajeros' : 'Pasajero', names.filter(Boolean).join(', ')], ['Ruta', clean(d.route)],
        ['Fecha', dmy(d.departure_date || d.segments[0]?.departure_date)], ['Regreso', dmy(d.return_date)],
        ['Tiquete', tickets.join(', ')], ['Reserva', clean(d.booking_code)], ['Valor', value],
      ])
    }
    case 'hotel': {
      const d = r.details
      return join([
        ['Hotel', clean(d.hotel)], ['Ciudad', clean(d.city)], ['Cliente', client], ['Titular', clean(d.holder)],
        ['Entrada', dmy(d.check_in)], ['Salida', dmy(d.check_out)], ['Noches', d.nights], ['Habitación', clean(d.room_type)],
        ['Reserva', clean(d.reservation_number)], ['Valor', d.total_invoice != null ? peso(d.total_invoice) : charge],
      ])
    }
    case 'loan': {
      const d = r.details
      return join([
        ['Cliente', client], ['Solicitud', clean(d.request)], ['Solicitó', clean(d.requested_by)], ['Proveedor', clean(r.provider)],
        ['Factura', clean(r.invoice_number)], ['COT', clean(d.cot)], ['OC', clean(d.oc)], ['Valor', charge],
      ])
    }
    case 'food': {
      const d = r.details
      return join([['Cliente', client], ['Fecha', dmy(r.date)], ['Solicitó', clean(d.requested_by)], ['Pedido', clean(d.requested_item)], ['Proveedor', clean(r.provider)], ['Valor', charge]])
    }
    case 'transport': {
      const d = r.details
      return join([
        ['Cliente', client], ['Fecha', `${dmy(r.date)}${d.time ? ` ${d.time}` : ''}`.trim()], ['Pasajero', clean(d.passenger)],
        ['Ruta', [clean(d.origin), clean(d.destination)].filter(Boolean).join(' - ')], ['Servicio', clean(d.service_number)], ['Proveedor', clean(r.provider)], ['Valor', charge],
      ])
    }
    default:
      return join([
        ['Cliente', client], ['Fecha', dmy(r.date)], ['Descripción', clean(r.details.description)], ['Proveedor', clean(r.provider)],
        ['Factura', clean(r.invoice_number)], ['Valor', charge],
      ])
  }
}
