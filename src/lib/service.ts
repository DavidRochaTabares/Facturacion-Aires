import type { BankKind, DocCategory, FlightData, LoanData, OperationInput, OperationRow, OperationType, PersonalKind } from '../types'

export const DOC_CATEGORIES: DocCategory[] = ['ticket', 'payment', 'supplier_invoice', 'agency_invoice', 'other']
export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  ticket: 'Tiquete / itinerario',
  payment: 'Soporte de pago',
  supplier_invoice: 'Factura proveedor',
  agency_invoice: 'Factura Aires y Destinos',
  other: 'Otros documentos',
}
export const PERSONAL_CATEGORIES = ['Alimentación', 'Transporte', 'Vivienda', 'Servicios', 'Salud', 'Compras', 'Entretenimiento', 'Transferencias', 'Otros']
export const PERSONAL_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta débito', 'Tarjeta crédito', 'Otro']
export const PERSONAL_KIND_LABEL: Record<PersonalKind, string> = { income: 'Ingreso', expense: 'Gasto' }
export const BANK_KIND_LABEL: Record<BankKind, string> = { income: 'Ingreso', expense: 'Egreso', transfer: 'Transferencia', other: 'Otro' }

export const GROUPABLE: OperationType[] = ['flight', 'hotel']
export const MARKUP: Partial<Record<OperationType, number>> = { flight: 1.3, hotel: 1.3, loan: 1.2, food: 1.2 }
export const suggestCharge = (cost: number, type: OperationType) => Math.round((cost || 0) * (MARKUP[type] ?? 1))
export const TA_VAT = 1.19
export const LOAN_IVA = 0.19
/** IVA (19%) of a loan's base value, in whole pesos. The base is never modified: IVA is always derived from it, so it cannot be applied twice. */
export const loanIva = (base: number) => Math.round((base || 0) * LOAN_IVA)
/** Value the 20% margin is applied to: the base value, or base + IVA when the loan includes IVA. */
export const loanReference = (base: number, hasIva?: boolean) => (base || 0) + (hasIva ? loanIva(base) : 0)

/** Loan fields required to consider the record complete. Missing ones only mark it as incomplete; saving is never blocked. */
export function loanMissing(amount: number, invoice_number: string, d: Partial<LoanData>): string[] {
  const m: [string, unknown][] = [
    ['Solicitud', d.request], ['Valor', amount > 0], ['Factura', invoice_number], ['Fecha de factura', d.invoice_date],
    ['OC', d.oc], ['Recibida', d.received], ['Solicitó', d.requested_by],
  ]
  return m.filter(([, v]) => !(typeof v === 'string' ? v.trim() : v)).map(([k]) => k)
}

/** Flight requirements for a complete record: itinerary data plus the three document categories. Never blocks saving. */
export function flightMissing(d: Partial<FlightData>, docs: { category?: string }[]): string[] {
  const m: [string, unknown][] = [
    ['Aerolínea', d.airline?.trim()],
    ['Itinerario', (d.segments ?? []).some(s => s.origin?.trim() && s.destination?.trim() && s.departure_date)],
    ['Soporte de pago', docs.some(x => x.category === 'payment')],
    ['Factura proveedor', docs.some(x => x.category === 'supplier_invoice')],
    ['Factura Aires y Destinos', docs.some(x => x.category === 'agency_invoice')],
  ]
  return m.filter(([, v]) => !v).map(([k]) => k)
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

/** Flights are stored one record per passenger; records sharing the same reservation code are shown grouped. */
export const normCode = (s?: string | null) => (s ?? '').trim().toLowerCase()
export const reservationKey = (r: OperationRow) => (r.type === 'flight' ? normCode((r.details as { booking_code?: string }).booking_code) : '')
/** Reservation-level fields kept coherent across the passengers of one reservation. */
export const RESERVATION_SHARED = ['route', 'departure_date', 'return_date', 'airline', 'booking_code', 'internal_booking_code', 'card_number'] as const

/** Splits a total into n whole-peso parts whose sum is exactly the total (the rounding remainder goes 1 peso at a time to the first parts). */
export function distribute(total: number, n: number): number[] {
  const sign = total < 0 ? -1 : 1
  const t = Math.round(Math.abs(total))
  const base = Math.floor(t / n), rem = t - base * n
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rem ? 1 : 0)))
}
export const isRealPassenger = (p: { names?: string; surnames?: string; document_number?: string; ticket_number?: string; email?: string; phone?: string }) =>
  [p.names, p.surnames, p.document_number, p.ticket_number, p.email, p.phone].some(x => (x ?? '').trim() !== '')

const SPLIT_MONEY = ['value_with_taxes_tae', 'total_invoice', 'third_party_commission', 'provider_profit'] as const

/**
 * A flight with several real passengers becomes one input per passenger. The values entered in the form are the TOTALS of the reservation
 * (TKT value, total invoice, amount to charge, commission, profit): each is divided among the passengers so the sum of the rows equals the total.
 * TA is per ticket and is not divided. Anything else is returned as is.
 */
export function splitFlightPassengers(input: OperationInput): OperationInput[] {
  if (input.type !== 'flight') return [input]
  const d = input.details as any
  const all: any[] = d?.passengers ?? []
  const real = all.filter(isRealPassenger)
  const pax = real.length ? real : all.slice(0, 1)
  if (pax.length < 2) return [pax.length === all.length ? input : ({ ...input, details: { ...d, passengers: pax } } as OperationInput)]
  const n = pax.length
  const charges = distribute(input.charge_amount || 0, n)
  const parts = Object.fromEntries(SPLIT_MONEY.map(k => [k, d[k] == null ? null : distribute(Number(d[k]), n)])) as Record<(typeof SPLIT_MONEY)[number], number[] | null>
  const netAuto = d.net_quote_minus_iva_ta != null && d.net_quote_minus_iva_ta === Math.round((d.total_invoice ?? 0) - (d.ta ?? 0))
  const netParts = d.net_quote_minus_iva_ta == null || netAuto ? null : distribute(Number(d.net_quote_minus_iva_ta), n)
  return pax.map((p, i) => {
    const money = Object.fromEntries(SPLIT_MONEY.map(k => [k, parts[k] ? parts[k]![i] : d[k] ?? null]))
    const net = d.net_quote_minus_iva_ta == null ? null : netParts ? netParts[i] : Math.round(((money.total_invoice as number | null) ?? 0) - (d.ta ?? 0))
    const details = { ...d, ...money, net_quote_minus_iva_ta: net, passengers: [p], first_surname: p.surnames ?? '', names: p.names ?? '', ticket_number: (p.ticket_number ?? '').trim(), no: i === 0 ? d.no : '' }
    return { ...input, charge_amount: charges[i], amount: details.value_with_taxes_tae ?? 0, details } as OperationInput
  })
}
