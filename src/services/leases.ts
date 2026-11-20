import { supabase } from '../lib/supabase'
import { normalizeDocFile } from '../lib/files'
import { queueRefresh } from '../lib/refresh'
import type {
  AttachmentEntity, AttachmentKind, BankCandidate, CustomerPayment, ExpensePayment, LeaseAttachment, LeaseExpense, LeaseExpenseInput, LeaseInvoice, LeaseInvoiceInput,
  LeaseOperation, LeasePaymentInput, LeaseSnapshot, LeaseSpace, LeaseSpaceInput, SlbPayment, SlbPaymentInput,
} from '../types/lease'

const BUCKET = 'lease-docs'
const MAX_FILE = 10 * 1024 * 1024
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const SESSION_MSG = 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.'

function fail(e: { message: string; code?: string; status?: number }): never {
  if (e.code === 'PGRST301' || /jwt|not authenticated/i.test(e.message) || e.status === 401) throw new Error(SESSION_MSG)
  if (e.code === '23505') throw new Error(/invoice|number|uq/i.test(e.message) ? 'Ya existe una factura con ese número en esta operación.' : /bank/i.test(e.message) ? 'Ese movimiento bancario ya está conciliado con otro pago.' : 'Ya existe un registro igual.')
  if (e.code === '23503') throw new Error('No se puede eliminar: tiene registros asociados (gastos, facturas o pagos). Puedes desactivarlo en su lugar.')
  throw new Error(e.message)
}
const num = (v: unknown) => (v == null ? 0 : Number(v))
const sanitize = <T extends Record<string, unknown>>(row: T): T => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && !['status', 'category', 'periodicity'].includes(k) ? v.trim() : v])) as T

const mapExpense = (r: any): LeaseExpense => ({ ...r, amount: num(r.amount), paid: num(r.paid), balance: num(r.balance) })
const mapInvoice = (r: any): LeaseInvoice => ({ ...r, total: num(r.total), subtotal: r.subtotal == null ? null : num(r.subtotal), tax: r.tax == null ? null : num(r.tax), received: num(r.received), balance: num(r.balance) })
const mapSpace = (r: any): LeaseSpace => ({ ...r, rent_amount: r.rent_amount == null ? null : num(r.rent_amount) })
const mapPay = <T extends { amount: unknown }>(r: T) => ({ ...r, amount: num(r.amount) })

async function save<T>(table: string, row: Record<string, unknown>, id?: string): Promise<T> {
  const q = id ? supabase.from(table).update(sanitize(row)).eq('id', id) : supabase.from(table).insert(sanitize(row))
  const { data, error } = await q.select().single()
  if (error) fail(error)
  queueRefresh()
  return data as T
}
async function remove(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) fail(error)
  queueRefresh()
}

export const leases = {
  async operations(): Promise<LeaseOperation[]> {
    const { data, error } = await supabase.from('lease_operations').select('id,name,status,notes').order('name')
    if (error) fail(error)
    return (data ?? []) as LeaseOperation[]
  },

  /** One round trip per table for the operation; the screens filter and summarise in the browser. */
  async snapshot(operationId: string): Promise<LeaseSnapshot> {
    const [sp, ex, inv, ep, cp, slb] = await Promise.all([
      supabase.from('lease_spaces').select('*').eq('operation_id', operationId).order('name'),
      supabase.from('lease_expenses_view').select('*').eq('operation_id', operationId).order('expense_date', { ascending: false }),
      supabase.from('lease_invoices_view').select('*').eq('operation_id', operationId).order('issue_date', { ascending: false }),
      supabase.from('lease_expense_payments').select('*, lease_expenses!inner(operation_id)').eq('lease_expenses.operation_id', operationId).order('paid_at', { ascending: false }),
      supabase.from('lease_customer_payments').select('*, lease_customer_invoices!inner(operation_id)').eq('lease_customer_invoices.operation_id', operationId).order('paid_at', { ascending: false }),
      supabase.from('lease_slb_payments').select('*').eq('operation_id', operationId).order('received_at', { ascending: false }),
    ])
    for (const x of [sp, ex, inv, ep, cp, slb]) if (x.error) fail(x.error)
    const strip = (r: any) => { const { lease_expenses, lease_customer_invoices, ...rest } = r; void lease_expenses; void lease_customer_invoices; return mapPay(rest) }
    return {
      spaces: (sp.data ?? []).map(mapSpace), expenses: (ex.data ?? []).map(mapExpense), invoices: (inv.data ?? []).map(mapInvoice),
      expensePayments: (ep.data ?? []).map(strip) as ExpensePayment[], customerPayments: (cp.data ?? []).map(strip) as CustomerPayment[], slbPayments: (slb.data ?? []).map(mapPay) as SlbPayment[],
    }
  },

  saveSpace: (operationId: string, input: LeaseSpaceInput, id?: string) => save<LeaseSpace>('lease_spaces', id ? { ...input } : { ...input, operation_id: operationId }, id),
  deleteSpace: (id: string) => remove('lease_spaces', id),

  saveExpense: (operationId: string, input: LeaseExpenseInput, id?: string) => save<LeaseExpense>('lease_expenses', id ? { ...input } : { ...input, operation_id: operationId }, id),
  deleteExpense: (id: string) => remove('lease_expenses', id),

  saveInvoice: (operationId: string, input: LeaseInvoiceInput, id?: string) => save<LeaseInvoice>('lease_customer_invoices', id ? { ...input } : { ...input, operation_id: operationId }, id),
  setInvoiceVoid: (id: string, isVoid: boolean) => save<LeaseInvoice>('lease_customer_invoices', { status: isVoid ? 'void' : 'active' }, id),
  deleteInvoice: (id: string) => remove('lease_customer_invoices', id),

  async payments(kind: 'expense' | 'customer', parentId: string): Promise<(ExpensePayment | CustomerPayment)[]> {
    const table = kind === 'expense' ? 'lease_expense_payments' : 'lease_customer_payments'
    const { data, error } = await supabase.from(table).select('*').eq(kind === 'expense' ? 'expense_id' : 'invoice_id', parentId).order('paid_at').order('created_at')
    if (error) fail(error)
    return (data ?? []).map(mapPay) as (ExpensePayment | CustomerPayment)[]
  },
  savePayment: (kind: 'expense' | 'customer', parentId: string, input: LeasePaymentInput) =>
    save<ExpensePayment | CustomerPayment>(kind === 'expense' ? 'lease_expense_payments' : 'lease_customer_payments', { ...input, [kind === 'expense' ? 'expense_id' : 'invoice_id']: parentId }),
  deletePayment: (kind: 'expense' | 'customer', id: string) => remove(kind === 'expense' ? 'lease_expense_payments' : 'lease_customer_payments', id),

  saveSlbPayment: (operationId: string, input: SlbPaymentInput, id?: string) => save<SlbPayment>('lease_slb_payments', id ? { ...input } : { ...input, operation_id: operationId }, id),
  deleteSlbPayment: (id: string) => remove('lease_slb_payments', id),

  // ---- files: private bucket; the database row is the source of truth and every deletion is queued for Storage cleanup by a trigger ----
  async attachments(type: AttachmentEntity, id: string): Promise<LeaseAttachment[]> {
    const { data, error } = await supabase.from('lease_attachments').select('*').eq('entity_type', type).eq('entity_id', id).order('created_at')
    if (error) fail(error)
    return (data ?? []) as LeaseAttachment[]
  },
  /** Uploads each file and registers it; if registering fails the file is removed again. Returns the names that could not be saved. */
  async uploadFiles(type: AttachmentEntity, id: string, files: { file: File; kind: AttachmentKind }[]): Promise<string[]> {
    const { data: s } = await supabase.auth.getSession()
    if (!s.session) throw new Error(SESSION_MSG)
    const failed: string[] = []
    for (const { file, kind } of files) {
      let path = ''
      try {
        const ok = await normalizeDocFile(file, 'pdf-or-image')
        if (ok.size > MAX_FILE) throw new Error('supera los 10 MB')
        path = `${type}/${id}/${crypto.randomUUID()}.${EXT[ok.type]}`
        const up = await supabase.storage.from(BUCKET).upload(path, ok, { contentType: ok.type, upsert: false })
        if (up.error) throw up.error
        const ins = await supabase.from('lease_attachments').insert({ entity_type: type, entity_id: id, kind, file_name: ok.name.slice(0, 200), mime_type: ok.type, size_bytes: ok.size, storage_path: path })
        if (ins.error) { await supabase.storage.from(BUCKET).remove([path]); throw ins.error }
      } catch (e) { failed.push(`${file.name}: ${e instanceof Error ? e.message : 'no se pudo subir'}`) }
    }
    queueRefresh()
    return failed
  },
  async deleteAttachment(a: LeaseAttachment) {
    const { error } = await supabase.from('lease_attachments').delete().eq('id', a.id)
    if (error) fail(error)
    await this.processCleanup()
  },
  /** Removes from Storage every file whose row is gone (queued by the trigger); anything that fails stays queued and is retried on the next call. */
  async processCleanup(): Promise<number> {
    const { data, error } = await supabase.from('lease_cleanup').select('storage_path').limit(100)
    if (error || !data?.length) return 0
    const paths = data.map(r => r.storage_path as string)
    const rm = await supabase.storage.from(BUCKET).remove(paths)
    if (rm.error) return paths.length
    await supabase.from('lease_cleanup').delete().in('storage_path', paths)
    return 0
  },
  async signedUrl(path: string, name: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60, { download: name })
    if (error && /not found|does not exist|object/i.test(error.message)) throw new Error('gone')
    if (error || !data) fail(error ?? { message: 'No se pudo preparar la descarga.' })
    return data!.signedUrl
  },

  /** Bank movements of the right direction that are not yet reconciled with any lease payment (no changes to the bank module itself). */
  async bankCandidates(direction: 'income' | 'expense', includeId?: string | null): Promise<BankCandidate[]> {
    const [mv, a, b, c] = await Promise.all([
      supabase.from('bank_movements').select('id,movement_date,amount,description,beneficiary').eq('movement_type', direction).order('movement_date', { ascending: false }).limit(200),
      supabase.from('lease_expense_payments').select('bank_movement_id').not('bank_movement_id', 'is', null),
      supabase.from('lease_customer_payments').select('bank_movement_id').not('bank_movement_id', 'is', null),
      supabase.from('lease_slb_payments').select('bank_movement_id').not('bank_movement_id', 'is', null),
    ])
    for (const x of [mv, a, b, c]) if (x.error) fail(x.error)
    const linked = new Set([...(a.data ?? []), ...(b.data ?? []), ...(c.data ?? [])].map(r => r.bank_movement_id as string))
    const rows = (mv.data ?? []).filter(m => !linked.has(m.id) || m.id === includeId)
    if (includeId && !rows.some(m => m.id === includeId)) {
      const one = await supabase.from('bank_movements').select('id,movement_date,amount,description,beneficiary').eq('id', includeId).maybeSingle()
      if (one.data) rows.unshift(one.data)
    }
    return rows.map(m => ({ id: m.id, date: String(m.movement_date).slice(0, 10), amount: num(m.amount), description: m.description ?? '', beneficiary: m.beneficiary ?? '' }))
  },
}
