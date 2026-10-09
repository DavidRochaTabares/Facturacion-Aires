import type { LoanData, OperationRow, OperationType } from '../types'

export const GROUPABLE: OperationType[] = ['flight', 'hotel']
export const MARKUP: Partial<Record<OperationType, number>> = { flight: 1.3, hotel: 1.3, loan: 1.2, food: 1.2 }
export const suggestCharge = (cost: number, type: OperationType) => Math.round((cost || 0) * (MARKUP[type] ?? 1))
export const TA_VAT = 1.19

/** Loan fields required to consider the record complete. Missing ones only mark it as incomplete; saving is never blocked. */
export function loanMissing(amount: number, invoice_number: string, d: Partial<LoanData>): string[] {
  const m: [string, unknown][] = [
    ['Solicitud', d.request], ['Valor', amount > 0], ['Factura', invoice_number], ['Fecha de factura', d.invoice_date],
    ['OC', d.oc], ['Recibida', d.received], ['Solicitó', d.requested_by],
  ]
  return m.filter(([, v]) => !(typeof v === 'string' ? v.trim() : v)).map(([k]) => k)
}

export function summary(r: OperationRow) {
  switch (r.type) {
    case 'flight': {
      const d = r.details
      const names = d.passengers.map(p => (p.names + ' ' + p.surnames).trim())
      const client = names.length > 1 ? names[0] : names[0] || `${d.names} ${d.first_surname}`.trim()
      return { client, extra: names.length > 1 ? names.length : 0, provider: r.provider || d.airline, route: d.route, booking: d.booking_code, ticket: d.ticket_number }
    }
    case 'hotel': return { client: '', extra: 0, provider: r.provider, route: `${r.details.hotel}${r.details.city ? ` · ${r.details.city}` : ''}`, booking: r.details.reservation_number, ticket: '' }
    case 'transport': return { client: r.details.passenger, extra: 0, provider: r.provider, route: [r.details.origin, r.details.destination].filter(Boolean).join(' → '), booking: r.details.service_number, ticket: '' }
    case 'food': return { client: r.details.requested_by, extra: 0, provider: r.provider, route: r.details.requested_item, booking: '', ticket: '' }
    case 'loan': return { client: r.details.requested_by, extra: 0, provider: r.provider, route: r.details.request, booking: r.details.oc, ticket: '' }
    default: return { client: '', extra: 0, provider: r.provider, route: r.details.description, booking: '', ticket: '' }
  }
}
