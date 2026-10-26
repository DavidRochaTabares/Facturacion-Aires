import { supabase } from '../lib/supabase'
import { SERVICE_LABEL } from '../lib/format'
import { mimeFromName, normalizeDocFile, withMime } from '../lib/files'
import { queueRefresh } from '../lib/refresh'
import { normCode, RESERVATION_SHARED, splitFlightPassengers } from '../lib/service'
import type { DeleteResult, DeleteSummary, DocCategory, ExtractedFood, PaymentCard, PaymentCardInput, Supplier, SupplierInput, ExtractedFlight, ExtractedHotel, ExtractedLoan, BankDocument, BankFilters, BankMovementInput, BankMovementRow, BankReport, Company, CompanyInput, DashboardStats, DocumentFile, InvoiceAlert, OperationFilters, OperationGroup, OperationInput, OperationRow, OperationType, PendingDoc, PersonalDocument, PersonalFilters, PersonalMovementInput, PersonalMovementRow, ServiceReport, Slice } from '../types'
import { MockDataService } from './mock'
import { bankEnumOfLabel, bankPayload, mapBankDocument, mapBankMovement, mapCompany, mapDocument, mapGroup, mapPaymentCard, mapSupplier, mapViewRow } from './supabaseMappers'

const fail = (e: { message: string }): never => { throw new Error(e.message) }
const pick = (i: CompanyInput): CompanyInput => ({ name: i.name, nit: i.nit, contact: i.contact, email: i.email, phone: i.phone, observations: i.observations, ta: i.ta })
const pickSupplier = (i: SupplierInput): SupplierInput => ({ name: i.name.trim(), nit: i.nit.trim(), contact: i.contact.trim(), email: i.email.trim(), phone: i.phone.trim(), is_active: i.is_active })
const pickCard = (i: PaymentCardInput): PaymentCardInput => ({ alias: i.alias.trim(), last_four: i.last_four.trim(), bank: i.bank.trim(), holder: i.holder.trim(), is_active: i.is_active })
const dupMsg = (e: { message: string; code?: string }, what: string) => (e.code === '23505' ? `Ya existe ${what} con esos datos.` : e.message)
const slices = (v: any, labelOf?: (key: string) => string): Slice[] =>
  (v ?? []).map((x: any) => ({ key: x.key, label: labelOf ? labelOf(x.key) : x.label, count: Number(x.count), amount: Number(x.amount) }))
const BUCKET = 'documents'
const SESSION_EXPIRED = 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.'
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('El análisis tardó demasiado. Intenta de nuevo o llena el formulario manualmente.')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
const safeName = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100)
const warnUpload = (e: unknown) => alert(`El registro se guardó, pero no se pudo subir el archivo: ${e instanceof Error ? e.message : 'error desconocido'}. Puedes adjuntarlo de nuevo desde el detalle.`)
const dayStr = (v: unknown) => String(v ?? '').slice(0, 10)
const mergeOther = (list: Slice[]): Slice[] => {
  const m = new Map<string, Slice>()
  list.forEach(x => {
    const k = x.key === 'other' ? 'additional' : x.key
    const cur = m.get(k)
    if (cur) { cur.count += x.count; cur.amount += x.amount } else m.set(k, { ...x, key: k, label: SERVICE_LABEL[k as OperationType] ?? x.label })
  })
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}
const like = (s: string) => s.replace(/[%_\\]/g, m => '\\' + m)
const quote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`

export class SupabaseDataService extends MockDataService {
  async getCompanies(search?: string): Promise<Company[]> {
    let q = supabase.from('companies').select('*').order('name')
    const s = search?.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) q = q.or(['name', 'nit', 'contact', 'email'].map(c => `${c}.ilike.%${s}%`).join(','))
    const { data, error } = await q
    if (error) fail(error)
    return (data ?? []).map(mapCompany)
  }
  async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await supabase.from('companies').select('*').eq('id', id).maybeSingle()
    if (error) fail(error)
    return data ? mapCompany(data) : null
  }
  async createCompany(input: CompanyInput): Promise<Company> {
    const { data, error } = await supabase.from('companies').insert(pick(input)).select().single()
    if (error) fail(error)
    queueRefresh()
    return mapCompany(data)
  }
  async updateCompany(id: string, input: CompanyInput): Promise<Company> {
    const { data, error } = await supabase.from('companies').update(pick(input)).eq('id', id).select().single()
    if (error) fail(error)
    queueRefresh()
    return mapCompany(data)
  }
  getCompanyOperations(companyId: string) { return this.getOperations({ company_id: companyId }) }

  async getOperations(f: OperationFilters = {}): Promise<OperationRow[]> {
    const search = f.search?.trim().toLowerCase()
    const build = () => {
      let q = supabase.from('operations_view').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')
      if (f.company_id) q = q.eq('company_id', f.company_id)
      if (f.type) q = f.type === 'additional' ? q.in('type', ['additional', 'other']) : q.eq('type', f.type)
      if (f.provider) q = q.or(`provider.eq.${quote(f.provider)},airline.eq.${quote(f.provider)}`)
      if (f.date) q = q.eq('date', f.date)
      if (f.year) q = q.eq('year', Number(f.year))
      if (f.month) q = q.eq('month', Number(f.month))
      if (f.date_from) q = q.gte('date', f.date_from)
      if (f.date_to) q = q.lte('date', f.date_to)
      if (f.incomplete) q = q.eq('is_incomplete', true)
      if (search) q = q.ilike('search_text', `%${like(search)}%`)
      return q
    }
    const out: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build().range(from, from + 999)
      if (error) fail(error)
      out.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    return out.map(mapViewRow)
  }
  async getOperationById(id: string): Promise<OperationRow | null> {
    const { data, error } = await supabase.from('operations_view').select('*').eq('id', id).maybeSingle()
    if (error) fail(error)
    return data ? mapViewRow(data) : null
  }
  private async save(input: OperationInput, id?: string): Promise<OperationRow> {
    const { data, error } = await supabase.rpc('save_operation', { p: { ...input, id } })
    if (error) fail(error)
    return (await this.getOperationById(data as string))!
  }
  async createOperation(input: OperationInput, docs: PendingDoc[] = []) {
    const parts = splitFlightPassengers(input)
    const first = await this.save(parts[0])
    const rows = [first]
    try {
      for (const p of parts.slice(1)) rows.push(await this.save({ ...p, group_id: first.group_id, group_label: undefined } as OperationInput))
    } catch (e) {
      throw new Error(`Se guardaron ${rows.length} de ${parts.length} pasajeros. Revisa la tabla antes de reintentar. Detalle: ${e instanceof Error ? e.message : 'error desconocido'}`)
    }
    if (!docs.length) { queueRefresh(); return first }
    try {
      for (const { file, category } of docs) {
        const doc = await this.addDocument(first.id, file, category)
        for (const r of rows.slice(1)) {
          const { error } = await supabase.from('documents').insert({ operation_id: r.id, name: doc.name, mime_type: doc.mime_type || null, size: doc.size, storage_path: doc.storage_path, category: doc.category })
          if (error) fail(error)
        }
      }
    } catch (e) { warnUpload(e) }
    queueRefresh()
    return (await this.getOperationById(first.id)) ?? first
  }
  async updateOperation(id: string, input: OperationInput) {
    const before = input.type === 'flight' ? await this.getOperationById(id) : null
    const row = await this.save(input, id)
    if (before && row.type === 'flight') await this.syncReservation(before, row)
    queueRefresh()
    return row
  }
  /** Keeps reservation-level data coherent across the passengers of the same reservation (same booking code). Each passenger keeps its own data and values. */
  private async syncReservation(before: OperationRow, after: OperationRow) {
    const code = normCode((before.details as any).booking_code)
    if (!code || code !== normCode((after.details as any).booking_code)) return
    const ad: any = after.details
    const segs = (x: any[] = []) => JSON.stringify(x.map(({ id: _i, ...r }) => r))
    const sibs = (await this.getOperations({ type: 'flight', search: code })).filter(r => r.id !== after.id && normCode((r.details as any).booking_code) === code)
    for (const s of sibs) {
      const sd: any = s.details
      const same = s.company_id === after.company_id && s.date === after.date && s.provider === after.provider
        && RESERVATION_SHARED.every(k => sd[k] === ad[k]) && segs(sd.segments) === segs(ad.segments)
      if (same) continue
      const shared = Object.fromEntries(RESERVATION_SHARED.map(k => [k, ad[k]]))
      await this.save({
        company_id: after.company_id, type: 'flight', date: after.date, provider: after.provider, invoice_number: s.invoice_number, amount: s.amount,
        charge_amount: s.charge_amount, observations: s.observations, group_id: s.group_id, details: { ...sd, ...shared, segments: ad.segments },
      } as OperationInput, s.id)
    }
  }

  /** Removes from Storage the files the database function reported as no longer used by any record. Failing here never undoes the (already committed) delete. */
  private async removeFiles(paths: string[]): Promise<number> {
    if (!paths.length) return 0
    const { data, error } = await supabase.storage.from(BUCKET).remove(paths)
    return error ? paths.length : Math.max(0, paths.length - (data?.length ?? 0))
  }
  async deleteOperations(ids: string[]): Promise<DeleteSummary> {
    const { data, error } = await supabase.rpc('delete_operations', { p_ids: ids })
    if (error) fail(error)
    const out = { deleted: Number(data.deleted), filesNotRemoved: await this.removeFiles(data.storage_paths ?? []) }
    queueRefresh()
    return out
  }
  async deleteBankMovement(id: string): Promise<DeleteSummary> {
    const { data, error } = await supabase.rpc('delete_bank_movement', { p_id: id })
    if (error) fail(error)
    const out = { deleted: Number(data.deleted), filesNotRemoved: await this.removeFiles(data.storage_paths ?? []) }
    queueRefresh()
    return out
  }
  async getGroups(): Promise<OperationGroup[]> {
    const { data, error } = await supabase.from('operation_groups').select('*').order('code')
    if (error) fail(error)
    return (data ?? []).map(mapGroup)
  }
  async getSuppliers(): Promise<Supplier[]> {
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) fail(error)
    return (data ?? []).map(mapSupplier)
  }
  async createSupplier(input: SupplierInput): Promise<Supplier> {
    const { data, error } = await supabase.from('suppliers').insert(pickSupplier(input)).select('*').single()
    if (error) fail({ message: dupMsg(error, 'un proveedor') })
    queueRefresh()
    return mapSupplier(data)
  }
  async updateSupplier(id: string, input: SupplierInput): Promise<Supplier> {
    const { data, error } = await supabase.from('suppliers').update(pickSupplier(input)).eq('id', id).select('*').single()
    if (error) fail({ message: dupMsg(error, 'un proveedor') })
    queueRefresh()
    return mapSupplier(data)
  }
  async deleteSupplier(id: string): Promise<DeleteResult> {
    const { data, error } = await supabase.rpc('delete_supplier', { p_id: id })
    if (error) fail(error)
    queueRefresh()
    return data as DeleteResult
  }
  async getCards(): Promise<PaymentCard[]> {
    const { data, error } = await supabase.from('payment_cards').select('*').order('alias')
    if (error) fail(error)
    return (data ?? []).map(mapPaymentCard)
  }
  async createCard(input: PaymentCardInput): Promise<PaymentCard> {
    const { data, error } = await supabase.from('payment_cards').insert(pickCard(input)).select().single()
    if (error) fail({ message: dupMsg(error, 'una tarjeta') })
    queueRefresh()
    return mapPaymentCard(data)
  }
  async updateCard(id: string, input: PaymentCardInput): Promise<PaymentCard> {
    const { data, error } = await supabase.from('payment_cards').update(pickCard(input)).eq('id', id).select().single()
    if (error) fail({ message: dupMsg(error, 'una tarjeta') })
    queueRefresh()
    return mapPaymentCard(data)
  }
  async deleteCard(id: string): Promise<DeleteResult> {
    const { data, error } = await supabase.rpc('delete_payment_card', { p_id: id })
    if (error) fail(error)
    queueRefresh()
    return data as DeleteResult
  }
  async getProviders(): Promise<string[]> {
    const { data, error } = await supabase.from('operations_view').select('provider,airline')
    if (error) fail(error)
    const set = new Set<string>()
    ;(data ?? []).forEach(r => { if (r.provider) set.add(r.provider); if (r.airline) set.add(r.airline) })
    return [...set].sort()
  }

  async getServiceReports(f: OperationFilters): Promise<ServiceReport> {
    const { data, error } = await supabase.rpc('service_report', { p: { company_id: f.company_id, type: f.type, provider: f.provider, date_from: f.date_from, date_to: f.date_to } })
    if (error) fail(error)
    return {
      total_operations: Number(data.total_operations), total_cost: Number(data.total_cost), total_charge: Number(data.total_charge), average: Number(data.average),
      by_type: mergeOther(slices(data.by_type, k => SERVICE_LABEL[k as OperationType] ?? k)), by_company: slices(data.by_company), by_provider: slices(data.by_provider), by_month: slices(data.by_month),
    }
  }
  async getDashboardStats(): Promise<DashboardStats> {
    const [rep, recent] = await Promise.all([
      this.getServiceReports({}),
      supabase.from('operations_view').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(6),
    ])
    if (recent.error) fail(recent.error)
    const n = (t: OperationType) => rep.by_type.find(x => x.key === t)?.count ?? 0
    return {
      total_operations: rep.total_operations, total_cost: rep.total_cost, total_charge: rep.total_charge,
      total_flights: n('flight'), total_hotels: n('hotel'), total_loans: n('loan'), total_others: rep.total_operations - n('flight') - n('hotel') - n('loan'),
      by_type: rep.by_type, by_company: rep.by_company, recent: (recent.data ?? []).map(mapViewRow),
    }
  }

  async getBankMovements(f: BankFilters = {}): Promise<BankMovementRow[]> {
    let q = supabase.from('bank_movements').select('*, bank_documents(*)').order('movement_date', { ascending: false }).order('created_at', { ascending: false })
    if (f.kind) q = q.eq('movement_type', f.kind)
    if (f.movement_type) {
      const e = bankEnumOfLabel(f.movement_type)
      q = q.or(`category.eq.${quote(f.movement_type)}${e ? `,and(category.eq."",movement_type.eq.${e})` : ''}`)
    }
    if (f.date_from) q = q.gte('movement_date', f.date_from)
    if (f.date_to) q = q.lte('movement_date', f.date_to)
    const s = f.search?.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) q = q.or(['description', 'beneficiary', 'category', 'reference_1', 'reference_2', 'reference_3', 'observation'].map(c => `${c}.ilike.%${s}%`).join(','))
    const { data, error } = await q
    if (error) fail(error)
    return (data ?? []).map(mapBankMovement)
  }
  async getBankMovementById(id: string): Promise<BankMovementRow | null> {
    const { data, error } = await supabase.from('bank_movements').select('*, bank_documents(*)').eq('id', id).maybeSingle()
    if (error) fail(error)
    return data ? mapBankMovement(data) : null
  }
  async createBankMovement(input: BankMovementInput, file?: File | null): Promise<BankMovementRow> {
    const { data, error } = await supabase.from('bank_movements').insert(bankPayload(input)).select('*, bank_documents(*)').single()
    if (error) fail(error)
    const row = mapBankMovement(data)
    if (!file) { queueRefresh(); return row }
    try { await this.addBankDocument(row.id, file) } catch (e) { warnUpload(e) }
    queueRefresh()
    return (await this.getBankMovementById(row.id)) ?? row
  }
  async updateBankMovement(id: string, input: BankMovementInput): Promise<BankMovementRow> {
    const { data, error } = await supabase.from('bank_movements').update(bankPayload(input)).eq('id', id).select('*, bank_documents(*)').single()
    if (error) fail(error)
    queueRefresh()
    return mapBankMovement(data)
  }
  private async upload(folder: 'operations' | 'bank' | 'personal', ownerId: string, file: File) {
    file = await withMime(file)
    const path = `${folder}/${ownerId}/${crypto.randomUUID()}-${safeName(file.name)}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' })
    if (error) fail(error)
    return path
  }
  async addBankDocument(movementId: string, file: File): Promise<BankDocument> {
    file = await withMime(file)
    const storage_path = await this.upload('bank', movementId, file)
    const { data, error } = await supabase.from('bank_documents').insert({ bank_movement_id: movementId, name: file.name, mime_type: file.type || null, size: file.size, storage_path }).select().single()
    if (error) fail(error)
    queueRefresh()
    return mapBankDocument(data)
  }
  /** Deletes a single attachment row; the storage object is removed only when no other record references it. */
  private async deleteAttachment(table: 'documents' | 'bank_documents' | 'personal_documents', docId: string): Promise<DeleteSummary> {
    const { data, error } = await supabase.rpc('delete_attachment', { p_table: table, p_id: docId })
    if (error) fail(error)
    const out = { deleted: Number(data.deleted), filesNotRemoved: await this.removeFiles(data.storage_paths ?? []) }
    queueRefresh()
    return out
  }
  async deleteBankDocument(docId: string): Promise<DeleteSummary> {
    return this.deleteAttachment('bank_documents', docId)
  }
  async getInvoiceAlerts(): Promise<InvoiceAlert[]> {
    const { data, error } = await supabase.from('invoice_alerts')
      .select('id, operation_id, invoice_number, amount, due_date, status, created_at')
      .eq('status', 'pending').order('due_date')
    if (error) fail(error)
    const alerts = data ?? []
    const ids = [...new Set(alerts.map((a: any) => a.operation_id as string))]
    const ops = new Map<string, { type: OperationType; date: string; company_name: string }>()
    if (ids.length) {
      const { data: os, error: e2 } = await supabase.from('operations_view').select('id, type, date, company_name').in('id', ids)
      if (e2) fail(e2)
      ;(os ?? []).forEach((o: any) => ops.set(o.id, { type: o.type, date: dayStr(o.date), company_name: o.company_name ?? '' }))
    }
    return alerts.map((a: any) => ({
      id: a.id, operation_id: a.operation_id, invoice_number: a.invoice_number ?? '', amount: Number(a.amount ?? 0),
      due_date: dayStr(a.due_date), status: a.status, created_at: dayStr(a.created_at),
      operation_type: ops.get(a.operation_id)?.type, operation_date: ops.get(a.operation_id)?.date, company_name: ops.get(a.operation_id)?.company_name ?? '',
    }))
  }

  private mapPersonal = (r: any): PersonalMovementRow => ({
    id: r.id, date: dayStr(r.movement_date), kind: r.kind === 'income' ? 'income' : 'expense', category: r.category ?? '',
    description: r.description ?? '', amount: Number(r.amount ?? 0), payment_method: r.payment_method ?? '', account: r.account ?? '',
    beneficiary: r.beneficiary ?? '', reference: r.reference ?? '', notes: r.notes ?? '', created_at: dayStr(r.created_at),
    documents: (r.personal_documents ?? []).map((d: any): PersonalDocument => ({
      id: d.id, movement_id: d.personal_movement_id, name: d.name, mime_type: d.mime_type ?? '', size: Number(d.size ?? 0), storage_path: d.storage_path, created_at: dayStr(d.created_at),
    })),
  })
  async getPersonalMovements(f: PersonalFilters = {}): Promise<PersonalMovementRow[]> {
    let q = supabase.from('personal_movements').select('*, personal_documents(*)').order('movement_date', { ascending: false }).order('created_at', { ascending: false })
    if (f.kind) q = q.eq('kind', f.kind)
    if (f.category) q = q.eq('category', f.category)
    if (f.date_from) q = q.gte('movement_date', f.date_from)
    if (f.date_to) q = q.lte('movement_date', f.date_to)
    const s = f.search?.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) q = q.or(['description', 'beneficiary', 'category', 'account', 'reference', 'notes'].map(c => `${c}.ilike.%${s}%`).join(','))
    const { data, error } = await q
    if (error) fail(error)
    return (data ?? []).map(this.mapPersonal)
  }
  async createPersonalMovement(input: PersonalMovementInput, files: File[] = []): Promise<PersonalMovementRow> {
    const { data, error } = await supabase.from('personal_movements').insert({
      movement_date: input.date, kind: input.kind, category: input.category.trim(), description: input.description,
      amount: input.amount, payment_method: input.payment_method, account: input.account.trim(), beneficiary: input.beneficiary.trim(),
      reference: input.reference.trim(), notes: input.notes,
    }).select('*, personal_documents(*)').single()
    if (error) fail(error)
    const row = this.mapPersonal(data)
    for (const f of files) {
      try { await this.addPersonalDocument(row.id, f) } catch (e) { warnUpload(e) }
    }
    queueRefresh()
    return files.length ? (await supabase.from('personal_movements').select('*, personal_documents(*)').eq('id', row.id).single().then(r => r.error ? row : this.mapPersonal(r.data))) : row
  }
  async updatePersonalMovement(id: string, input: PersonalMovementInput): Promise<PersonalMovementRow> {
    const { data, error } = await supabase.from('personal_movements').update({
      movement_date: input.date, kind: input.kind, category: input.category.trim(), description: input.description,
      amount: input.amount, payment_method: input.payment_method, account: input.account.trim(), beneficiary: input.beneficiary.trim(),
      reference: input.reference.trim(), notes: input.notes,
    }).eq('id', id).select('*, personal_documents(*)').single()
    if (error) fail(error)
    queueRefresh()
    return this.mapPersonal(data)
  }
  async deletePersonalMovement(id: string): Promise<DeleteSummary> {
    const { data, error } = await supabase.rpc('delete_personal_movement', { p_id: id })
    if (error) fail(error)
    const out = { deleted: Number(data.deleted), filesNotRemoved: await this.removeFiles(data.storage_paths ?? []) }
    queueRefresh()
    return out
  }
  async addPersonalDocument(movementId: string, file: File): Promise<PersonalDocument> {
    file = await withMime(file)
    const storage_path = await this.upload('personal', movementId, file)
    const { data, error } = await supabase.from('personal_documents').insert({ personal_movement_id: movementId, name: file.name, mime_type: file.type || null, size: file.size, storage_path }).select().single()
    if (error) fail(error)
    queueRefresh()
    return { id: data.id, movement_id: data.personal_movement_id, name: data.name, mime_type: data.mime_type ?? '', size: Number(data.size ?? 0), storage_path: data.storage_path, created_at: dayStr(data.created_at) }
  }
  async deletePersonalDocument(docId: string): Promise<DeleteSummary> {
    return this.deleteAttachment('personal_documents', docId)
  }
  async getDocuments(operationId: string): Promise<DocumentFile[]> {
    const { data, error } = await supabase.from('documents').select('*').eq('operation_id', operationId).order('created_at')
    if (error) fail(error)
    return (data ?? []).map(mapDocument)
  }
  async addDocument(operationId: string, file: File, category: DocCategory = 'other'): Promise<DocumentFile> {
    file = await withMime(file)
    const storage_path = await this.upload('operations', operationId, file)
    const { data, error } = await supabase.from('documents').insert({ operation_id: operationId, name: file.name, mime_type: file.type || null, size: file.size, storage_path, category }).select().single()
    if (error) fail(error)
    queueRefresh()
    return mapDocument(data)
  }
  async updateDocumentCategory(docId: string, category: DocCategory): Promise<void> {
    const { error } = await supabase.from('documents').update({ category }).eq('id', docId)
    if (error) fail(error)
    queueRefresh()
  }
  async deleteDocument(docId: string): Promise<DeleteSummary> {
    return this.deleteAttachment('documents', docId)
  }
  async getDocumentUrl(doc: { name: string; mime_type: string; storage_path?: string; url?: string }): Promise<string> {
    if (!doc.storage_path) return super.getDocumentUrl(doc)
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60)
    if (signed.error) fail(signed.error)
    const res = await fetch(signed.data!.signedUrl)
    if (!res.ok) throw new Error('No se pudo descargar el archivo')
    const type = doc.mime_type && doc.mime_type !== 'application/octet-stream' ? doc.mime_type : mimeFromName(doc.name) || 'application/octet-stream'
    return URL.createObjectURL(new Blob([await res.blob()], { type }))
  }

  async getBankReports(f: BankFilters = {}): Promise<BankReport> {
    const { data, error } = await supabase.rpc('bank_report', { p: { search: f.search, movement_type: f.movement_type, date_from: f.date_from, date_to: f.date_to } })
    if (error) fail(error)
    return { count: Number(data.count), total_amount: Number(data.total_amount), by_type: slices(data.by_type), last_date: data.last_date ?? '' }
  }

  private async extract<T>(kind: 'flight' | 'hotel' | 'loan' | 'food', file: File): Promise<T> {
    const checked = await normalizeDocFile(file, kind === 'loan' || kind === 'food' ? 'pdf-or-image' : 'pdf')
    const { data: auth } = await supabase.auth.getSession()
    if (!auth.session) throw new Error(SESSION_EXPIRED)
    const body = new FormData()
    body.append('kind', kind)
    body.append('file', checked)
    const { data, error } = await withTimeout(supabase.functions.invoke('extract-document', { body }), 75_000)
    if (error) {
      const res = (error as { context?: Response }).context
      if (error.name === 'FunctionsFetchError') throw new Error('No se pudo conectar con el servicio de análisis. Revisa tu conexión a internet e inténtalo de nuevo.')
      if (res?.status === 401) throw new Error(SESSION_EXPIRED)
      let msg = error.message
      try { const j = await res?.json(); if (j?.error) msg = j.error } catch { /* keep generic message */ }
      throw new Error(msg)
    }
    if (!data || typeof data !== 'object' || 'error' in data) throw new Error((data as { error?: string } | null)?.error ?? 'Respuesta inválida del análisis.')
    return data as T
  }
  extractEmission(file: File): Promise<ExtractedFlight> { return this.extract('flight', file) }
  extractHotelVoucher(file: File): Promise<ExtractedHotel> { return this.extract('hotel', file) }
  extractLoanDocument(file: File): Promise<ExtractedLoan> { return this.extract('loan', file) }
  extractFoodDocument(file: File): Promise<ExtractedFood> { return this.extract('food', file) }

  private async detailsOf(id: string, type: OperationType): Promise<any> {
    const r = await this.getOperationById(id)
    return r && r.type === type ? r.details : null
  }
  getFlight(id: string): Promise<any> { return this.detailsOf(id, 'flight') }
  getLoan(id: string): Promise<any> { return this.detailsOf(id, 'loan') }
  getFood(id: string): Promise<any> { return this.detailsOf(id, 'food') }
  getHotel(id: string): Promise<any> { return this.detailsOf(id, 'hotel') }
  getTransport(id: string): Promise<any> { return this.detailsOf(id, 'transport') }
}
