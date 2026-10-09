import { mockDb, type MockDb } from '../data/mock'
import { SERVICE_LABEL } from '../lib/format'
import { GROUPABLE, loanMissing } from '../lib/service'
import type {
  BankDocument, BankFilters, BankMovementInput, BankMovementRow, Company, CompanyInput, DocumentFile, ExtractedFlight, ExtractedHotel, ExtractedLoan,
  Operation, OperationFilters, OperationInput, OperationRow, Slice,
} from '../types'
import type { DataService } from './types'

const wait = <T,>(v: T, ms = 250) => new Promise<T>(r => setTimeout(() => r(structuredClone(v)), ms))
const uid = () => Math.random().toString(36).slice(2, 10)
const todayStr = () => new Date().toISOString().slice(0, 10)

const group = (rows: OperationRow[], keyOf: (r: OperationRow) => string, labelOf: (r: OperationRow) => string = keyOf): Slice[] => {
  const m = new Map<string, Slice>()
  rows.forEach(r => {
    const k = keyOf(r)
    const s = m.get(k) ?? { key: k, label: labelOf(r), count: 0, amount: 0 }
    s.count++; s.amount += r.amount
    m.set(k, s)
  })
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}

const DETAIL_KEY = { flight: 'flights', hotel: 'hotels', transport: 'transports', food: 'foods', loan: 'loans', additional: 'additionals', other: 'additionals' } as const
const strip = ({ id: _i, operation_id: _o, ...rest }: any) => rest

export class MockDataService implements DataService {
  private db: MockDb = structuredClone(mockDb)

  private details(o: Operation): any {
    const d = this.db
    const rec = (d[DETAIL_KEY[o.type]] as any[]).find(x => x.operation_id === o.id)
    if (!rec) return {}
    if (o.type !== 'flight') return strip(rec)
    return {
      ...strip(rec),
      segments: d.segments.filter(s => s.flight_id === rec.id).sort((a, b) => a.position - b.position),
      passengers: d.passengers.filter(p => p.flight_id === rec.id),
    }
  }
  private compose(o: Operation): OperationRow {
    const details = this.details(o)
    return {
      ...o, details,
      company_name: this.db.companies.find(c => c.id === o.company_id)?.name ?? '—',
      documents: this.db.documents.filter(x => x.operation_id === o.id),
      group: this.db.groups.find(g => g.id === o.group_id) ?? null,
      missing: o.type === 'loan' ? loanMissing(o.amount, o.invoice_number, details) : [],
    } as OperationRow
  }
  private rows() { return [...this.db.operations].sort((a, b) => b.date.localeCompare(a.date)).map(o => this.compose(o)) }
  private filter(f: OperationFilters = {}) {
    const q = f.search?.trim().toLowerCase()
    return this.rows().filter(r => {
      if (f.company_id && r.company_id !== f.company_id) return false
      if (f.type && r.type !== f.type) return false
      if (f.provider && r.provider !== f.provider && (r.details as any).airline !== f.provider) return false
      if (f.date && r.date !== f.date) return false
      if (f.year && r.date.slice(0, 4) !== f.year) return false
      if (f.month && r.date.slice(5, 7) !== f.month) return false
      if (f.date_from && r.date < f.date_from) return false
      if (f.date_to && r.date > f.date_to) return false
      if (f.incomplete && !r.missing.length) return false
      if (q && !JSON.stringify([r.company_name, r.provider, r.invoice_number, r.group?.code, r.group?.label, r.details]).toLowerCase().includes(q)) return false
      return true
    })
  }

  private saveDetails(o: Operation, details: any) {
    const d = this.db
    const key = DETAIL_KEY[o.type]
    const old = (d[key] as any[]).find(x => x.operation_id === o.id)
    const id = old?.id ?? `${o.type[0]}-${o.id}`
    d.segments = d.segments.filter(s => s.flight_id !== id)
    d.passengers = d.passengers.filter(p => p.flight_id !== id)
    ;(d[key] as any[]) = (d[key] as any[]).filter(x => x.operation_id !== o.id)
    const { segments, passengers, ...rest } = details
    ;(d[key] as any[]).push({ ...rest, id, operation_id: o.id })
    if (o.type === 'flight') {
      segments.forEach((s: any, i: number) => d.segments.push({ ...s, id: s.id ?? uid(), flight_id: id, position: i }))
      passengers.forEach((p: any) => d.passengers.push({ ...p, id: p.id ?? uid(), flight_id: id }))
    }
  }
  private resolveGroup(input: OperationInput) {
    if (input.group_id) return input.group_id
    if (!input.group_label?.trim()) return null
    const code = `G-${String(this.db.groups.length + 1).padStart(3, '0')}`
    const g = { id: uid(), code, label: input.group_label.trim(), created_at: todayStr() }
    this.db.groups.push(g)
    return g.id
  }
  private base(input: OperationInput, id: string, created_at: string): Operation {
    const { details: _d, group_label: _g, ...rest } = input
    return { ...rest, id, created_at, group_id: GROUPABLE.includes(input.type) ? this.resolveGroup(input) : null } as Operation
  }
  private makeDoc(opId: string, file: File, folder: string): DocumentFile {
    return { id: uid(), operation_id: opId, name: file.name, mime_type: file.type || 'application/pdf', size: file.size, storage_path: `${folder}/${opId}/${file.name}`, created_at: todayStr(), url: URL.createObjectURL(file) }
  }

  getCompanies(search?: string) {
    const q = search?.trim().toLowerCase()
    return wait(this.db.companies.filter(c => !q || `${c.name} ${c.nit} ${c.contact} ${c.email}`.toLowerCase().includes(q)))
  }
  getCompanyById(id: string) { return wait(this.db.companies.find(c => c.id === id) ?? null, 100) }
  async createCompany(input: CompanyInput) {
    const c: Company = { ...input, id: uid(), created_at: todayStr() }
    this.db.companies.push(c)
    return wait(c)
  }
  async updateCompany(id: string, input: CompanyInput) {
    const i = this.db.companies.findIndex(c => c.id === id)
    this.db.companies[i] = { ...this.db.companies[i], ...input }
    return wait(this.db.companies[i])
  }
  getCompanyOperations(companyId: string) { return wait(this.rows().filter(r => r.company_id === companyId)) }

  getOperations(filters?: OperationFilters) { return wait(this.filter(filters)) }
  getOperationById(id: string) { return wait(this.rows().find(r => r.id === id) ?? null, 150) }
  async createOperation(input: OperationInput, file?: File | null) {
    const o = this.base(input, uid(), todayStr())
    this.db.operations.push(o)
    this.saveDetails(o, input.details)
    if (file) this.db.documents.push(this.makeDoc(o.id, file, o.type === 'loan' ? 'prestamos' : 'emisiones'))
    return wait(this.compose(o), 500)
  }
  async updateOperation(id: string, input: OperationInput) {
    const i = this.db.operations.findIndex(o => o.id === id)
    const o = this.base(input, id, this.db.operations[i].created_at)
    this.db.operations[i] = o
    this.saveDetails(o, input.details)
    return wait(this.compose(o), 400)
  }
  getGroups() { return wait(this.db.groups) }
  getProviders() {
    const set = new Set(this.db.operations.map(o => o.provider).filter(Boolean))
    this.db.flights.forEach(f => f.airline && set.add(f.airline))
    return wait([...set].sort())
  }

  private one = (type: Operation['type'], id: string) => {
    const o = this.db.operations.find(x => x.id === id && x.type === type)
    return wait(o ? this.details(o) : null, 100)
  }
  getFlight(id: string) { return this.one('flight', id) }
  getLoan(id: string) { return this.one('loan', id) }
  getFood(id: string) { return this.one('food', id) }
  getHotel(id: string) { return this.one('hotel', id) }
  getTransport(id: string) { return this.one('transport', id) }
  createFlight(i: OperationInput, f?: File | null) { return this.createOperation(i, f) }
  updateFlight(id: string, i: OperationInput) { return this.updateOperation(id, i) }
  createLoan(i: OperationInput, f?: File | null) { return this.createOperation(i, f) }
  updateLoan(id: string, i: OperationInput) { return this.updateOperation(id, i) }
  createFood(i: OperationInput) { return this.createOperation(i) }
  updateFood(id: string, i: OperationInput) { return this.updateOperation(id, i) }
  createHotel(i: OperationInput) { return this.createOperation(i) }
  updateHotel(id: string, i: OperationInput) { return this.updateOperation(id, i) }
  createTransport(i: OperationInput) { return this.createOperation(i) }
  updateTransport(id: string, i: OperationInput) { return this.updateOperation(id, i) }

  getDocuments(operationId: string) { return wait(this.db.documents.filter(d => d.operation_id === operationId)) }
  async addDocument(operationId: string, file: File) {
    const d = this.makeDoc(operationId, file, 'documentos')
    this.db.documents.push(d)
    return wait(d, 300)
  }
  async getDocumentUrl(doc: { name: string; mime_type: string; url?: string }) {
    if (doc.url) return doc.url
    const name = doc.name.replace(/[()\\<>&]/g, '')
    if (doc.mime_type.startsWith('image/')) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="24" y="160" font-size="20" font-family="sans-serif" fill="#374151">${name}</text></svg>`
      return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    }
    const text = `BT /F1 16 Tf 40 150 Td (${name}) Tj ET`
    const pdf = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${text.length}>>stream\n${text}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF`
    return URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
  }

  private bankRows(f: BankFilters = {}): BankMovementRow[] {
    const q = f.search?.trim().toLowerCase()
    return this.db.bank
      .filter(m => (!f.movement_type || m.movement_type === f.movement_type) && (!f.date_from || m.date >= f.date_from) && (!f.date_to || m.date <= f.date_to)
        && (!q || JSON.stringify(m).toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(m => ({ ...m, documents: this.db.bankDocs.filter(d => d.movement_id === m.id) }))
  }
  getBankMovements(filters?: BankFilters) { return wait(this.bankRows(filters)) }
  getBankMovementById(id: string) { return wait(this.bankRows().find(m => m.id === id) ?? null, 100) }
  async createBankMovement(input: BankMovementInput, file?: File | null) {
    const m = { ...input, id: uid(), created_at: todayStr() }
    this.db.bank.push(m)
    if (file) await this.addBankDocument(m.id, file)
    return wait(this.bankRows().find(x => x.id === m.id)!, 400)
  }
  async updateBankMovement(id: string, input: BankMovementInput) {
    const i = this.db.bank.findIndex(m => m.id === id)
    this.db.bank[i] = { ...this.db.bank[i], ...input }
    return wait(this.bankRows().find(x => x.id === id)!, 300)
  }
  async addBankDocument(movementId: string, file: File) {
    const d: BankDocument = { id: uid(), movement_id: movementId, name: file.name, mime_type: file.type || 'application/pdf', size: file.size, storage_path: `banco/${movementId}/${file.name}`, created_at: todayStr(), url: URL.createObjectURL(file) }
    this.db.bankDocs.push(d)
    return wait(d, 200)
  }

  async getDashboardStats() {
    const rows = this.rows()
    const n = (t: string) => rows.filter(r => r.type === t).length
    return wait({
      total_operations: rows.length,
      total_cost: rows.reduce((a, r) => a + r.amount, 0),
      total_charge: rows.reduce((a, r) => a + r.charge_amount, 0),
      total_flights: n('flight'), total_hotels: n('hotel'), total_loans: n('loan'),
      total_others: rows.length - n('flight') - n('hotel') - n('loan'),
      by_type: group(rows, r => r.type, r => SERVICE_LABEL[r.type]),
      by_company: group(rows, r => r.company_id, r => r.company_name),
      recent: rows.slice(0, 6),
    })
  }
  async getServiceReports(filters: OperationFilters) {
    const rows = this.filter(filters)
    const cost = rows.reduce((a, r) => a + r.amount, 0)
    return wait({
      total_operations: rows.length,
      total_cost: cost,
      total_charge: rows.reduce((a, r) => a + r.charge_amount, 0),
      average: rows.length ? Math.round(cost / rows.length) : 0,
      by_type: group(rows, r => r.type, r => SERVICE_LABEL[r.type]),
      by_company: group(rows, r => r.company_id, r => r.company_name),
      by_provider: group(rows, r => r.provider || '—'),
      by_month: group(rows, r => r.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
    })
  }
  async getBankReports(filters?: BankFilters) {
    const rows = this.bankRows(filters)
    const m = new Map<string, Slice>()
    rows.forEach(r => { const s = m.get(r.movement_type) ?? { key: r.movement_type, label: r.movement_type, count: 0, amount: 0 }; s.count++; s.amount += r.amount; m.set(r.movement_type, s) })
    return wait({ count: rows.length, total_amount: rows.reduce((a, r) => a + r.amount, 0), by_type: [...m.values()].sort((a, b) => b.amount - a.amount), last_date: rows[0]?.date ?? '' })
  }

  async extractEmission(_file: File): Promise<ExtractedFlight> {
    return wait({
      amount: 770000,
      details: {
        no: '', first_surname: 'ROJAS MEJIA', names: 'VALENTINA', route: 'BOG-CTG-BOG', departure_date: '2026-10-20', return_date: '2026-10-24', airline: 'LATAM',
        booking_code: 'RT5K9D', internal_booking_code: '', ticket_number: '5452100778899', value_with_taxes_tae: 770000, total_invoice: null, third_party_commission: null, provider_profit: null, ta: null, ta_without_iva: null, ta_with_iva: null,
        iva_ta: null, net_quote_minus_iva_ta: null, card_number: '', purchase_invoice: '',
        segments: [
          { id: uid(), flight_number: 'LA4033', origin: 'BOG', destination: 'CTG', departure_date: '2026-10-20', departure_time: '08:15', arrival_date: '2026-10-20', arrival_time: '09:45', cabin: 'Economy' },
          { id: uid(), flight_number: 'LA4038', origin: 'CTG', destination: 'BOG', departure_date: '2026-10-24', departure_time: '17:30', arrival_date: '2026-10-24', arrival_time: '19:00', cabin: 'Economy' },
        ],
        passengers: [
          { id: uid(), names: 'VALENTINA', surnames: 'ROJAS MEJIA', document_type: 'CC', document_number: '1037555666', ticket_number: '5452100778899', birth_date: '', email: 'vrojas@example.com', phone: '', frequent_flyer: '' },
          { id: uid(), names: 'SEBASTIAN', surnames: 'ROJAS MEJIA', document_type: 'CC', document_number: '1037555777', ticket_number: '5452100778900', birth_date: '', email: '', phone: '', frequent_flyer: '' },
        ],
      },
    }, 2800)
  }
  async extractHotelVoucher(_file: File): Promise<ExtractedHotel> {
    return wait({
      provider: 'Despegar', amount: 1860000,
      details: {
        reservation_number: 'HV-482913', accommodation_code: 'ACC-77412', hotel: 'Hotel Santa Clara Sofitel', city: 'Cartagena', address: 'Calle del Torno # 39-29, Centro Histórico',
        phone: '+57 605 650 4700', email: 'reservas@santaclara.example', check_in: '2026-11-05', check_in_time: '15:00', check_out: '2026-11-08', check_out_time: '12:00', nights: 3,
        holder: 'LAURA MENDOZA', guests: 2, room_type: 'Superior King', board: 'Desayuno', special_requests: 'Cama king, habitación tranquila', purchase_invoice: '', total_invoice: null, third_party_commission: null, provider_profit: null, ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null,
      },
    }, 2400)
  }
  async extractLoanDocument(_file: File): Promise<ExtractedLoan> {
    return wait({
      date: todayStr(), provider: 'Distribuidora Andina', amount: 850000,
      details: { request: 'Materiales para evento', invoice_date: '2026-09-28', cot: 'COT-2214', requested_by: 'Laura Mendoza' },
    }, 2200)
  }
}
