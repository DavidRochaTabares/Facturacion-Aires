import { flightMissing, loanMissing } from '../lib/service'
import type { BankDocument, BankMovementInput, BankMovementRow, Company, DocCategory, DocumentFile, OperationGroup, OperationRow, OperationType, PaymentCard, Supplier } from '../types'

const DOC_CATS = new Set(['ticket', 'payment', 'supplier_invoice', 'agency_invoice', 'other'])

const NULLABLE = new Set([
  'value_with_taxes_tae', 'total_invoice', 'third_party_commission', 'provider_profit', 'ta', 'ta_without_iva', 'ta_with_iva', 'iva_ta', 'net_quote_minus_iva_ta',
  'charged_quoted_value', 'iva', 'supplies_value', 'transport_value', 'nights', 'guests',
])
const DROP = new Set(['id', 'operation_id', 'flight_id', 'position'])

const day = (v: unknown) => String(v ?? '').slice(0, 10)

function norm(row: any, keepId = false) {
  const o: any = {}
  for (const [k, v] of Object.entries(row)) {
    if (DROP.has(k) && !(keepId && k === 'id')) continue
    if (v == null) o[k] = NULLABLE.has(k) ? null : ''
    else if (NULLABLE.has(k) || k === 'total_cost') o[k] = Number(v)
    else if (typeof v === 'string' && (k === 'time' || k.endsWith('_time'))) o[k] = v.slice(0, 5)
    else o[k] = v
  }
  return o
}

export const mapCompany = (r: any): Company => ({
  id: r.id, name: r.name ?? '', nit: r.nit ?? '', contact: r.contact ?? '', email: r.email ?? '', phone: r.phone ?? '', observations: r.observations ?? '', ta: r.ta == null ? null : Number(r.ta), created_at: day(r.created_at),
})

export const mapPaymentCard = (r: any): PaymentCard => ({
  id: r.id, alias: r.alias ?? '', last_four: r.last_four ?? '', bank: r.bank ?? '', holder: r.holder ?? '', is_active: r.is_active !== false, created_at: day(r.created_at),
})
export const mapSupplier = (r: any): Supplier => ({
  id: r.id, name: r.name ?? '', nit: r.nit ?? '', contact: r.contact ?? '', email: r.email ?? '', phone: r.phone ?? '', is_active: r.is_active !== false, created_at: day(r.created_at),
})

export const mapGroup = (g: any): OperationGroup => ({ id: g.id, code: g.code, label: g.name ?? g.label, created_at: day(g.created_at) })

export const mapDocument = (d: any): DocumentFile => ({
  id: d.id, operation_id: d.operation_id, name: d.name, mime_type: d.mime_type ?? '', size: Number(d.size ?? 0), storage_path: d.storage_path,
  category: (DOC_CATS.has(d.category) ? d.category : 'other') as DocCategory, created_at: day(d.created_at),
})

export function mapViewRow(r: any): OperationRow {
  const type = r.type as OperationType
  const { segments, passengers, ...rest } = r.details ?? {}
  const details: any = norm(rest)
  if (type === 'flight') {
    details.segments = (segments ?? []).map((s: any) => norm(s, true))
    details.passengers = (passengers ?? []).map((p: any) => norm(p, true))
  }
  const amount = Number(r.amount ?? 0)
  return {
    id: r.id, company_id: r.company_id, type, date: day(r.date), provider: r.provider ?? '', invoice_number: r.invoice_number ?? '', amount,
    charge_amount: Number(r.charge_amount ?? 0), observations: r.observations ?? '', group_id: r.group_id ?? null, created_at: day(r.created_at), details,
    company_name: r.company_name ?? '—', documents: (r.documents ?? []).map(mapDocument), group: r.group_info ? mapGroup(r.group_info) : null,
    missing: type === 'loan' ? loanMissing(amount, r.invoice_number ?? '', details) : type === 'flight' ? flightMissing(details, r.documents ?? []) : [],
  } as OperationRow
}

const BANK_LABEL: Record<string, string> = { income: 'Ingreso', expense: 'Egreso', transfer: 'Transferencia', other: 'Otro' }
const BANK_ENUM: Record<string, string> = { ingreso: 'income', egreso: 'expense', transferencia: 'transfer' }
const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export const bankEnumOf = (text: string) => BANK_ENUM[plain(text)] ?? 'other'
export const bankEnumOfLabel = (label: string) => Object.entries(BANK_LABEL).find(([, l]) => l === label)?.[0]

export const bankPayload = (i: BankMovementInput) => ({
  movement_date: i.date,
  bank_name: i.bank_name.trim(),
  invoice_number: i.invoice_number.trim(),
  client_name: i.client_name.trim(),
  description: i.description,
  amount: i.amount,

  // Compatibilidad con campos históricos
  movement_type: ['income','expense','transfer','other'].includes(i.kind) ? i.kind : bankEnumOf(i.movement_type),
  category: i.movement_type.trim(),
  beneficiary: i.beneficiary,
  reference_1: i.reference_1,
  reference_2: i.reference_2,
  reference_3: i.reference_3,
  observation: i.observation,
})

export const mapBankDocument = (d: any): BankDocument => ({
  id: d.id, movement_id: d.bank_movement_id, name: d.name, mime_type: d.mime_type ?? '', size: Number(d.size ?? 0), storage_path: d.storage_path, created_at: day(d.created_at),
})

export const mapBankMovement = (r: any): BankMovementRow => ({
  id: r.id,
  date: day(r.movement_date),

  // Nuevos campos bancarios
  kind: (['income','expense','transfer'].includes(r.movement_type) ? r.movement_type : 'other') as BankMovementRow['kind'],
  bank_name: r.bank_name ?? '',
  description: r.description ?? '',
  amount: Number(r.amount ?? 0),
  invoice_number: r.invoice_number ?? '',
  client_name: r.client_name ?? '',

  // Campos históricos conservados
  movement_type:
    r.category?.trim() ||
    BANK_LABEL[r.movement_type] ||
    'Otro',
  beneficiary: r.beneficiary ?? '',
  reference_1: r.reference_1 ?? '',
  reference_2: r.reference_2 ?? '',
  reference_3: r.reference_3 ?? '',
  observation: r.observation ?? '',

  created_at: day(r.created_at),
  documents: (r.bank_documents ?? []).map(mapBankDocument),
})
