export type LeaseCategory = 'rent' | 'cleaning' | 'utilities' | 'payroll' | 'additional'
export const LEASE_CATEGORY_LABEL: Record<LeaseCategory, string> = { rent: 'Arriendo', cleaning: 'Aseo', utilities: 'Servicios públicos', payroll: 'Nómina', additional: 'Adicionales' }
export const LEASE_CATEGORIES = Object.keys(LEASE_CATEGORY_LABEL) as LeaseCategory[]

export type Periodicity = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual'
export const PERIODICITY_LABEL: Record<Periodicity, string> = { monthly: 'Mensual', bimonthly: 'Bimestral', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual' }

export type PayStatus = 'pending' | 'partial' | 'paid' | 'void'
export const PAY_STATUS_LABEL: Record<PayStatus, string> = { pending: 'Pendiente', partial: 'Parcial', paid: 'Pagado', void: 'Anulada' }
export const INVOICE_STATUS_LABEL: Record<PayStatus, string> = { pending: 'Pendiente de pago', partial: 'Pago parcial', paid: 'Pagada', void: 'Anulada' }
export const PAY_STATUS_CLS: Record<PayStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  partial: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  paid: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  void: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 line-through',
}

export const PAY_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'Tarjeta', 'Otro']

export type AttachmentKind = 'contract' | 'invoice' | 'receipt' | 'payment_proof' | 'payroll' | 'other'
export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = { contract: 'Contrato', invoice: 'Factura', receipt: 'Recibo', payment_proof: 'Comprobante de pago', payroll: 'Soporte de nómina', other: 'Otro documento' }
export type AttachmentEntity = 'space' | 'expense' | 'expense_payment' | 'invoice' | 'customer_payment' | 'slb_payment'

export interface LeaseOperation { id: string; name: string; status: 'active' | 'inactive'; notes: string }
export interface LeaseSpace {
  id: string; operation_id: string; name: string; description: string; location: string; start_date: string | null; rent_amount: number | null
  periodicity: Periodicity; status: 'active' | 'inactive'; notes: string
}
export type LeaseSpaceInput = Omit<LeaseSpace, 'id' | 'operation_id'>

export interface LeaseExpense {
  id: string; operation_id: string; space_id: string | null; category: LeaseCategory; concept: string; beneficiary: string; amount: number
  expense_date: string; period: string; due_date: string | null; notes: string
  paid: number; balance: number; last_paid_at: string | null; payment_status: Exclude<PayStatus, 'void'>
}
export type LeaseExpenseInput = Pick<LeaseExpense, 'space_id' | 'category' | 'concept' | 'beneficiary' | 'amount' | 'expense_date' | 'period' | 'due_date' | 'notes'>

export interface LeaseInvoice {
  id: string; operation_id: string; space_id: string | null; customer_name: string; invoice_number: string; issue_date: string; period_year: number; period_month: number
  due_date: string | null; concept: string; subtotal: number | null; tax: number | null; total: number; status: 'active' | 'void'; notes: string
  received: number; balance: number; last_paid_at: string | null; payment_status: PayStatus
}
export type LeaseInvoiceInput = Pick<LeaseInvoice, 'space_id' | 'customer_name' | 'invoice_number' | 'issue_date' | 'period_year' | 'period_month' | 'due_date' | 'concept' | 'subtotal' | 'tax' | 'total' | 'notes'>

export interface LeasePayment {
  id: string; paid_at: string; amount: number; method: string; reference: string; notes: string; bank_movement_id: string | null
}
export interface LeasePaymentInput { paid_at: string; amount: number; method: string; reference: string; notes: string; bank_movement_id: string | null }
export interface ExpensePayment extends LeasePayment { expense_id: string }
export interface CustomerPayment extends LeasePayment { invoice_id: string }

export interface SlbPayment {
  id: string; operation_id: string; received_at: string; period: string; concept: string; amount: number; method: string; bank_account: string; reference: string; notes: string; bank_movement_id: string | null
}
export type SlbPaymentInput = Omit<SlbPayment, 'id' | 'operation_id'>

export interface LeaseAttachment { id: string; entity_type: AttachmentEntity; entity_id: string; kind: AttachmentKind; file_name: string; mime_type: string; size_bytes: number; storage_path: string; created_at: string }

export interface BankCandidate { id: string; date: string; amount: number; description: string; beneficiary: string }

/** Everything the module screens need for one operation (small data set: filtered and summarised in the browser). */
export interface LeaseSnapshot {
  spaces: LeaseSpace[]
  expenses: LeaseExpense[]
  invoices: LeaseInvoice[]
  expensePayments: ExpensePayment[]
  customerPayments: CustomerPayment[]
  slbPayments: SlbPayment[]
}
