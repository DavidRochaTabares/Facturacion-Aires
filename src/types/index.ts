export interface Company {
  id: string
  name: string
  nit: string
  contact: string
  email: string
  phone: string
  observations: string
  ta: number | null
  created_at: string
}
export type CompanyInput = Omit<Company, 'id' | 'created_at'>

export type OperationType = 'flight' | 'hotel' | 'transport' | 'food' | 'loan' | 'additional' | 'other'

export interface OperationGroup { id: string; code: string; label: string; created_at: string }

/** Base entity: only cross-cutting data. Type-specific data lives in its own structure. */
export interface Operation {
  id: string
  company_id: string
  type: OperationType
  date: string
  provider: string
  invoice_number: string
  amount: number
  charge_amount: number
  observations: string
  group_id: string | null
  created_at: string
}

export interface FlightSegment {
  id: string
  flight_id: string
  position: number
  flight_number: string
  origin: string
  destination: string
  departure_date: string
  departure_time: string
  arrival_date: string
  arrival_time: string
  cabin: string
}
export interface Passenger {
  id: string
  flight_id: string
  names: string
  surnames: string
  document_type: string
  document_number: string
  birth_date: string
  email: string
  phone: string
  frequent_flyer: string
  ticket_number: string
}
export type SegmentData = Omit<FlightSegment, 'flight_id' | 'position'>
export type PassengerData = Omit<Passenger, 'flight_id'>

export interface FlightBase {
  no: string
  first_surname: string
  names: string
  route: string
  departure_date: string
  return_date: string
  airline: string
  booking_code: string
  internal_booking_code: string
  ticket_number: string
  value_with_taxes_tae: number | null
  total_invoice: number | null
  third_party_commission: number | null
  provider_profit: number | null
  ta: number | null
  ta_without_iva: number | null
  ta_with_iva: number | null
  iva_ta: number | null
  net_quote_minus_iva_ta: number | null
  card_number: string
  purchase_invoice: string
}
export interface Flight extends FlightBase { id: string; operation_id: string }
export interface FlightData extends FlightBase { segments: SegmentData[]; passengers: PassengerData[] }

export interface LoanData {
  request: string
  invoice_date: string
  cot: string
  sent: string
  charged_quoted_value: number | null
  iva: number | null
  /** The base value (operations.amount) carries 19% IVA. Historical loans are false: they are never assumed to have IVA. */
  has_iva: boolean
  oc: string
  received: string
  requested_by: string
  paid: string
}
export interface Loan extends LoanData { id: string; operation_id: string }

export interface FoodData {
  requested_by: string
  requested_item: string
  supplies_value: number | null
  transport_value: number | null
  total_cost: number
}
export interface Food extends FoodData { id: string; operation_id: string }

export interface HotelData {
  reservation_number: string
  accommodation_code: string
  hotel: string
  city: string
  address: string
  phone: string
  email: string
  check_in: string
  check_in_time: string
  check_out: string
  check_out_time: string
  nights: number | null
  holder: string
  guests: number | null
  room_type: string
  board: string
  special_requests: string
  purchase_invoice: string
  total_invoice: number | null
  third_party_commission: number | null
  provider_profit: number | null
  ta: number | null
  ta_without_iva: number | null
  ta_with_iva: number | null
  iva_ta: number | null
  net_quote_minus_iva_ta: number | null
}
export interface Hotel extends HotelData { id: string; operation_id: string }

export interface TransportData {
  origin: string
  destination: string
  time: string
  passenger: string
  service_number: string
}
export interface Transport extends TransportData { id: string; operation_id: string }

export interface AdditionalData { description: string }
export interface AdditionalService extends AdditionalData { id: string; operation_id: string }

export interface DetailsMap {
  flight: FlightData
  hotel: HotelData
  transport: TransportData
  food: FoodData
  loan: LoanData
  additional: AdditionalData
  other: AdditionalData
}

export type DocCategory = 'ticket' | 'payment' | 'supplier_invoice' | 'agency_invoice' | 'other'
export interface PendingDoc { file: File; category: DocCategory }

export interface DocumentFile {
  id: string
  operation_id: string
  name: string
  mime_type: string
  size: number
  storage_path: string
  category: DocCategory
  created_at: string
  url?: string
}

type Typed<K extends OperationType> = { type: K; details: DetailsMap[K] }
export type OperationInput = { [K in OperationType]: Omit<Operation, 'id' | 'created_at' | 'group_id' | 'type'> & Typed<K> & { group_id?: string | null; group_label?: string } }[OperationType]
export type OperationInputOf<K extends OperationType> = Extract<OperationInput, { type: K }>
export type OperationRow = {
  [K in OperationType]: Omit<Operation, 'type'> & Typed<K> & { company_name: string; documents: DocumentFile[]; group: OperationGroup | null; missing: string[] }
}[OperationType]

export interface OperationFilters {
  search?: string
  company_id?: string
  type?: OperationType | ''
  provider?: string
  date?: string
  year?: string
  month?: string
  date_from?: string
  date_to?: string
  incomplete?: boolean
}

export interface Slice { key: string; label: string; count: number; amount: number }
export interface DashboardStats {
  total_operations: number
  total_cost: number
  total_charge: number
  total_flights: number
  total_hotels: number
  total_loans: number
  total_others: number
  by_type: Slice[]
  by_company: Slice[]
  recent: OperationRow[]
}
export interface ServiceReport {
  total_operations: number
  total_cost: number
  total_charge: number
  average: number
  by_type: Slice[]
  by_company: Slice[]
  by_provider: Slice[]
  by_month: Slice[]
}

export type BankKind = 'income' | 'expense' | 'transfer' | 'other'
export interface BankMovement {
  id: string
  date: string
  kind: BankKind
  bank_name: string
  description: string
  amount: number
  invoice_number: string
  client_name: string

  // Campos históricos conservados por compatibilidad
  movement_type: string
  beneficiary: string
  reference_1: string
  reference_2: string
  reference_3: string
  observation: string
  created_at: string
}

export type BankMovementInput = Omit<BankMovement, 'id' | 'created_at'>
export interface BankDocument { id: string; movement_id: string; name: string; mime_type: string; size: number; storage_path: string; created_at: string; url?: string }
export type BankMovementRow = BankMovement & { documents: BankDocument[] }
export interface BankFilters { search?: string; kind?: BankKind | ''; movement_type?: string; date_from?: string; date_to?: string }
export interface BankReport { count: number; total_amount: number; by_type: Slice[]; last_date: string }

export interface ExtractedFlight { provider?: string; amount: number; details: FlightData }
export interface ExtractedHotel { provider?: string; amount?: number; details: HotelData }
export interface ExtractedFood { date?: string; provider?: string; details: Partial<FoodData> }
export interface ExtractedLoan { date?: string; provider?: string; amount?: number; invoice_number?: string; details: Partial<LoanData> }

export interface AuthSession { email: string }

export interface PaymentCard {
  id: string
  alias: string
  last_four: string
  bank: string
  holder: string
  is_active: boolean
  created_at: string
}
export type PaymentCardInput = Omit<PaymentCard, 'id' | 'created_at'>
export interface Supplier {
  id: string
  name: string
  nit: string
  contact: string
  email: string
  phone: string
  is_active: boolean
  created_at: string
}
export type SupplierInput = Omit<Supplier, 'id' | 'created_at'>
export type DeleteResult = 'deleted' | 'deactivated'
export interface DeleteSummary { deleted: number; filesNotRemoved: number }

/** Pending collection reminder for an operation whose invoice has not been paid. One per operation. */
export interface InvoiceAlert {
  id: string
  operation_id: string
  invoice_number: string
  amount: number
  due_date: string
  status: 'pending' | 'paid'
  created_at: string
  operation_type?: OperationType
  operation_date?: string
  company_name?: string
}

export type PersonalKind = 'income' | 'expense'
export interface PersonalMovement {
  id: string
  date: string
  kind: PersonalKind
  category: string
  description: string
  amount: number
  payment_method: string
  account: string
  beneficiary: string
  reference: string
  notes: string
  created_at: string
}
export type PersonalMovementInput = Omit<PersonalMovement, 'id' | 'created_at'>
export interface PersonalDocument { id: string; movement_id: string; name: string; mime_type: string; size: number; storage_path: string; created_at: string; url?: string }
export type PersonalMovementRow = PersonalMovement & { documents: PersonalDocument[] }
export interface PersonalFilters { search?: string; kind?: PersonalKind | ''; category?: string; date_from?: string; date_to?: string }
