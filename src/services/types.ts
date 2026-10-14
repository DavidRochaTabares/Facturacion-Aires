import type {
  AuthSession, BankFilters, BankMovementInput, BankMovementRow, BankReport, Company, CompanyInput, DashboardStats, DocumentFile, ExtractedFlight, ExtractedFood, ExtractedHotel, ExtractedLoan,
  DeleteResult, DeleteSummary, OperationFilters, OperationGroup, OperationInput, OperationInputOf, OperationRow, ServiceReport, BankDocument, PaymentCard, PaymentCardInput, Supplier, SupplierInput,
} from '../types'

export interface AuthService {
  getSession(): Promise<AuthSession | null>
  signIn(email: string, password: string): Promise<AuthSession>
  signOut(): Promise<void>
  onChange(cb: (s: AuthSession | null) => void): () => void
}

export interface DataService {
  getCompanies(search?: string): Promise<Company[]>
  getCompanyById(id: string): Promise<Company | null>
  createCompany(input: CompanyInput): Promise<Company>
  updateCompany(id: string, input: CompanyInput): Promise<Company>
  getCompanyOperations(companyId: string): Promise<OperationRow[]>

  getOperations(filters?: OperationFilters): Promise<OperationRow[]>
  getOperationById(id: string): Promise<OperationRow | null>
  createOperation(input: OperationInput, file?: File | null): Promise<OperationRow>
  updateOperation(id: string, input: OperationInput): Promise<OperationRow>
  deleteOperations(ids: string[]): Promise<DeleteSummary>
  deleteBankMovement(id: string): Promise<DeleteSummary>
  getGroups(): Promise<OperationGroup[]>
  getProviders(): Promise<string[]>

  getSuppliers(): Promise<Supplier[]>
  createSupplier(input: SupplierInput): Promise<Supplier>
  updateSupplier(id: string, input: SupplierInput): Promise<Supplier>
  deleteSupplier(id: string): Promise<DeleteResult>
  getCards(): Promise<PaymentCard[]>
  createCard(input: PaymentCardInput): Promise<PaymentCard>
  updateCard(id: string, input: PaymentCardInput): Promise<PaymentCard>
  deleteCard(id: string): Promise<DeleteResult>

  getFlight(operationId: string): Promise<OperationInputOf<'flight'>['details'] | null>
  createFlight(input: OperationInputOf<'flight'>, file?: File | null): Promise<OperationRow>
  updateFlight(id: string, input: OperationInputOf<'flight'>): Promise<OperationRow>
  getLoan(operationId: string): Promise<OperationInputOf<'loan'>['details'] | null>
  createLoan(input: OperationInputOf<'loan'>, file?: File | null): Promise<OperationRow>
  updateLoan(id: string, input: OperationInputOf<'loan'>): Promise<OperationRow>
  getFood(operationId: string): Promise<OperationInputOf<'food'>['details'] | null>
  createFood(input: OperationInputOf<'food'>): Promise<OperationRow>
  updateFood(id: string, input: OperationInputOf<'food'>): Promise<OperationRow>
  getHotel(operationId: string): Promise<OperationInputOf<'hotel'>['details'] | null>
  createHotel(input: OperationInputOf<'hotel'>): Promise<OperationRow>
  updateHotel(id: string, input: OperationInputOf<'hotel'>): Promise<OperationRow>
  getTransport(operationId: string): Promise<OperationInputOf<'transport'>['details'] | null>
  createTransport(input: OperationInputOf<'transport'>): Promise<OperationRow>
  updateTransport(id: string, input: OperationInputOf<'transport'>): Promise<OperationRow>

  getDocuments(operationId: string): Promise<DocumentFile[]>
  addDocument(operationId: string, file: File): Promise<DocumentFile>
  getDocumentUrl(doc: { name: string; mime_type: string; storage_path?: string; url?: string }): Promise<string>

  getBankMovements(filters?: BankFilters): Promise<BankMovementRow[]>
  getBankMovementById(id: string): Promise<BankMovementRow | null>
  createBankMovement(input: BankMovementInput, file?: File | null): Promise<BankMovementRow>
  updateBankMovement(id: string, input: BankMovementInput): Promise<BankMovementRow>
  addBankDocument(movementId: string, file: File): Promise<BankDocument>

  getDashboardStats(): Promise<DashboardStats>
  getServiceReports(filters: OperationFilters): Promise<ServiceReport>
  getBankReports(filters?: BankFilters): Promise<BankReport>

  extractEmission(file: File): Promise<ExtractedFlight>
  extractHotelVoucher(file: File): Promise<ExtractedHotel>
  extractLoanDocument(file: File): Promise<ExtractedLoan>
  extractFoodDocument(file: File): Promise<ExtractedFood>
}
