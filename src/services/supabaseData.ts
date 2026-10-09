import { supabase } from '../lib/supabase'
import { SERVICE_LABEL } from '../lib/format'
import type { BankDocument, BankFilters, BankMovementInput, BankMovementRow, BankReport, Company, CompanyInput, DashboardStats, DocumentFile, OperationFilters, OperationGroup, OperationInput, OperationRow, OperationType, ServiceReport, Slice } from '../types'
import { MockDataService } from './mock'
import { bankEnumOfLabel, bankPayload, mapBankDocument, mapBankMovement, mapCompany, mapDocument, mapGroup, mapViewRow } from './supabaseMappers'

const fail = (e: { message: string }): never => { throw new Error(e.message) }
const pick = (i: CompanyInput): CompanyInput => ({ name: i.name, nit: i.nit, contact: i.contact, email: i.email, phone: i.phone, observations: i.observations, ta: i.ta })
const slices = (v: any, labelOf?: (key: string) => string): Slice[] =>
  (v ?? []).map((x: any) => ({ key: x.key, label: labelOf ? labelOf(x.key) : x.label, count: Number(x.count), amount: Number(x.amount) }))
const BUCKET = 'documents'
const safeName = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100)
const warnUpload = (e: unknown) => alert(`El registro se guardó, pero no se pudo subir el archivo: ${e instanceof Error ? e.message : 'error desconocido'}. Puedes adjuntarlo de nuevo desde el detalle.`)
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
    return mapCompany(data)
  }
  async updateCompany(id: string, input: CompanyInput): Promise<Company> {
    const { data, error } = await supabase.from('companies').update(pick(input)).eq('id', id).select().single()
    if (error) fail(error)
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
  async createOperation(input: OperationInput, file?: File | null) {
    const row = await this.save(input)
    if (!file) return row
    try { await this.addDocument(row.id, file) } catch (e) { warnUpload(e) }
    return (await this.getOperationById(row.id)) ?? row
  }
  async updateOperation(id: string, input: OperationInput) { return this.save(input, id) }

  async getGroups(): Promise<OperationGroup[]> {
    const { data, error } = await supabase.from('operation_groups').select('*').order('code')
    if (error) fail(error)
    return (data ?? []).map(mapGroup)
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
    if (!file) return row
    try { await this.addBankDocument(row.id, file) } catch (e) { warnUpload(e) }
    return (await this.getBankMovementById(row.id)) ?? row
  }
  async updateBankMovement(id: string, input: BankMovementInput): Promise<BankMovementRow> {
    const { data, error } = await supabase.from('bank_movements').update(bankPayload(input)).eq('id', id).select('*, bank_documents(*)').single()
    if (error) fail(error)
    return mapBankMovement(data)
  }
  private async upload(folder: 'operations' | 'bank', ownerId: string, file: File) {
    const path = `${folder}/${ownerId}/${crypto.randomUUID()}-${safeName(file.name)}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' })
    if (error) fail(error)
    return path
  }
  async addBankDocument(movementId: string, file: File): Promise<BankDocument> {
    const storage_path = await this.upload('bank', movementId, file)
    const { data, error } = await supabase.from('bank_documents').insert({ bank_movement_id: movementId, name: file.name, mime_type: file.type || null, size: file.size, storage_path }).select().single()
    if (error) fail(error)
    return mapBankDocument(data)
  }
  async getDocuments(operationId: string): Promise<DocumentFile[]> {
    const { data, error } = await supabase.from('documents').select('*').eq('operation_id', operationId).order('created_at')
    if (error) fail(error)
    return (data ?? []).map(mapDocument)
  }
  async addDocument(operationId: string, file: File): Promise<DocumentFile> {
    const storage_path = await this.upload('operations', operationId, file)
    const { data, error } = await supabase.from('documents').insert({ operation_id: operationId, name: file.name, mime_type: file.type || null, size: file.size, storage_path }).select().single()
    if (error) fail(error)
    return mapDocument(data)
  }
  async getDocumentUrl(doc: { name: string; mime_type: string; storage_path?: string; url?: string }): Promise<string> {
    if (!doc.storage_path) return super.getDocumentUrl(doc)
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60)
    if (signed.error) fail(signed.error)
    const res = await fetch(signed.data!.signedUrl)
    if (!res.ok) throw new Error('No se pudo descargar el archivo')
    return URL.createObjectURL(new Blob([await res.blob()], { type: doc.mime_type || 'application/octet-stream' }))
  }

  async getBankReports(f: BankFilters = {}): Promise<BankReport> {
    const { data, error } = await supabase.rpc('bank_report', { p: { search: f.search, movement_type: f.movement_type, date_from: f.date_from, date_to: f.date_to } })
    if (error) fail(error)
    return { count: Number(data.count), total_amount: Number(data.total_amount), by_type: slices(data.by_type), last_date: data.last_date ?? '' }
  }

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
