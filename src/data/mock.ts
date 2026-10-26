import type { AdditionalService, BankDocument, BankMovement, Company, DocumentFile, Flight, FlightSegment, Food, Hotel, Loan, Operation, OperationGroup, OperationType, Passenger, Transport } from '../types'

export interface MockDb {
  companies: Company[]
  groups: OperationGroup[]
  operations: Operation[]
  flights: Flight[]
  segments: FlightSegment[]
  passengers: Passenger[]
  loans: Loan[]
  foods: Food[]
  hotels: Hotel[]
  transports: Transport[]
  additionals: AdditionalService[]
  documents: DocumentFile[]
  bank: BankMovement[]
  bankDocs: BankDocument[]
}

const db: MockDb = {
  companies: [
    { id: 'c1', name: 'SENCIA S.A.S.', nit: '900.123.456-7', contact: 'Laura Mendoza', email: 'compras@sencia.example', phone: '+57 601 555 0101', observations: 'Cliente corporativo principal. Facturación mensual.', ta: null, created_at: '2025-01-10' },
    { id: 'c2', name: 'Andina Construcciones Ltda.', nit: '800.987.654-3', contact: 'Carlos Ruiz', email: 'viajes@andina.example', phone: '+57 604 555 0202', observations: '', ta: null, created_at: '2025-02-03' },
    { id: 'c3', name: 'Grupo Vértice', nit: '901.222.333-1', contact: 'Marta Salcedo', email: 'admin@vertice.example', phone: '+57 602 555 0303', observations: 'Pago a 30 días.', ta: null, created_at: '2025-03-15' },
    { id: 'c4', name: 'Fundación Horizonte', nit: '890.456.789-0', contact: 'Julián Ortiz', email: 'info@horizonte.example', phone: '+57 605 555 0404', observations: 'Tarifas especiales ONG.', ta: null, created_at: '2025-05-21' },
  ],
  groups: [
    { id: 'g1', code: 'G-001', label: 'Familia Rivera', created_at: '2026-09-05' },
    { id: 'g2', code: 'G-002', label: 'Comisión SENCIA Madrid', created_at: '2026-03-05' },
  ],
  operations: [], flights: [], segments: [], passengers: [], loans: [], foods: [], hotels: [], transports: [], additionals: [], documents: [], bank: [], bankDocs: [],
}

const op = (id: string, company_id: string, type: OperationType, date: string, o: Partial<Operation> = {}) => {
  db.operations.push({ id, company_id, type, date, provider: '', invoice_number: '', amount: 0, charge_amount: 0, observations: '', group_id: null, created_at: date, ...o })
}
const doc = (operation_id: string, name: string, size: number, date: string, mime_type = 'application/pdf', folder = 'emisiones') =>
  db.documents.push({ id: `d-${operation_id}-${db.documents.length}`, operation_id, name, mime_type, size, storage_path: `${folder}/${operation_id}/${name}`, category: 'other', created_at: date })

type Seg = [string, string, string, string, string, string, string, string?]
function flight(id: string, company_id: string, date: string, o: {
  invoice: string; provider: string; airline: string; booking: string; ticket: string; value: number; charge: number
  surname: string; names: string; route: string; ida: string; vuelta?: string; segs: Seg[]; pax: [string, string, string, string?][]
  internal?: string; x?: Partial<Flight>; group?: string; obs?: string; withDoc?: boolean
}) {
  op(id, company_id, 'flight', date, { provider: o.provider, invoice_number: o.invoice, amount: o.value, charge_amount: o.charge, observations: o.obs ?? '', group_id: o.group ?? null })
  db.flights.push({
    id: `f-${id}`, operation_id: id, no: String(db.flights.length + 1), first_surname: o.surname, names: o.names, route: o.route, departure_date: o.ida, return_date: o.vuelta ?? '', airline: o.airline,
    booking_code: o.booking, internal_booking_code: o.internal ?? '', ticket_number: o.ticket, value_with_taxes_tae: o.value, total_invoice: o.charge, third_party_commission: null, provider_profit: null,
    ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null, card_number: '', purchase_invoice: '', ...o.x,
  })
  o.segs.forEach((s, i) => db.segments.push({ id: `${id}-s${i}`, flight_id: `f-${id}`, position: i, flight_number: s[0], origin: s[1], destination: s[2], departure_date: s[3], departure_time: s[4], arrival_date: s[5], arrival_time: s[6], cabin: s[7] ?? 'Economy' }))
  o.pax.forEach((p, i) => db.passengers.push({ id: `${id}-p${i}`, flight_id: `f-${id}`, names: p[0], surnames: '', document_type: p[2], document_number: p[1], birth_date: '', email: '', phone: '', frequent_flyer: '', ticket_number: p[3] ?? '' }))
  if (o.withDoc !== false) doc(id, `emision_${o.booking}.pdf`, 180_000 + o.value % 9000, date)
}

flight('s1', 'c1', '2026-01-14', { invoice: 'FV-1001', provider: 'LATAM Airlines', airline: 'LATAM', booking: 'XK4P2L', internal: 'INT-0141', ticket: '5452100334411', value: 538000, charge: 565000, surname: 'GOMEZ TORRES', names: 'ANDRES FELIPE', route: 'BOG-MDE-BOG', ida: '2026-02-02', vuelta: '2026-02-05', x: { ta: 38000, ta_without_iva: 31933, ta_with_iva: 38000, iva_ta: 6067, card_number: '**** 1180', purchase_invoice: 'FC-7701' },
  segs: [['LA4021', 'BOG', 'MDE', '2026-02-02', '07:10', '2026-02-02', '08:05'], ['LA4026', 'MDE', 'BOG', '2026-02-05', '18:40', '2026-02-05', '19:35']], pax: [['ANDRES FELIPE GOMEZ TORRES', '1020304050', 'CC', '5452100334411']] })
flight('s2', 'c1', '2026-01-22', { invoice: 'FV-1002', provider: 'LATAM Airlines', airline: 'LATAM', booking: 'QW8N7R', ticket: '5452100334455', value: 1602000, charge: 1750000, surname: 'RESTREPO LOPEZ', names: 'MARIA CAMILA +2', route: 'BOG-LIM-BOG', ida: '2026-03-10', vuelta: '2026-03-14', x: { third_party_commission: 90000, provider_profit: 62000, ta: 142000, ta_without_iva: 119328, ta_with_iva: 142000, iva_ta: 22672, card_number: '**** 4412', purchase_invoice: 'FC-7781' },
  segs: [['LA588', 'BOG', 'LIM', '2026-03-10', '06:00', '2026-03-10', '08:30', 'Business'], ['LA589', 'LIM', 'BOG', '2026-03-14', '21:15', '2026-03-15', '00:05', 'Business']],
  pax: [['MARIA CAMILA RESTREPO LOPEZ', '52111222', 'CC', '5452100334455'], ['JORGE IVAN PAEZ MONTOYA', '79888777', 'CC', '5452100334456'], ['SOFIA PAEZ RESTREPO', 'TI1100223344', 'TI', '5452100334457']] })
flight('s3', 'c2', '2026-02-03', { invoice: 'FV-1003', provider: 'Clic Colombia', airline: 'Clic', booking: 'CL93TD', ticket: '8892001122334', value: 245000, charge: 262000, surname: 'MARIN CASTRO', names: 'LUIS ALBERTO', route: 'MDE-CTG', ida: '2026-02-20',
  segs: [['VE1220', 'MDE', 'CTG', '2026-02-20', '11:25', '2026-02-20', '12:50']], pax: [['LUIS ALBERTO MARIN CASTRO', '71555444', 'CC', '8892001122334']] })
flight('s4', 'c3', '2026-02-18', { invoice: 'FV-1004', provider: 'Clic Colombia', airline: 'Clic', booking: 'CL55ZM', ticket: '8892001177890', value: 394000, charge: 420000, surname: 'VELEZ RUIZ', names: 'DIANA PATRICIA', route: 'BOG-CLO-BOG', ida: '2026-03-01', vuelta: '2026-03-03', withDoc: false,
  segs: [['VE1301', 'BOG', 'CLO', '2026-03-01', '09:00', '2026-03-01', '10:05'], ['VE1302', 'CLO', 'BOG', '2026-03-03', '16:30', '2026-03-03', '17:35']], pax: [['DIANA PATRICIA VELEZ RUIZ', '43999888', 'CC', '8892001177890'], ['HERNAN DARIO CUELLAR', '16777666', 'CC', '8892001177891']] })
flight('s5', 'c1', '2026-03-05', { invoice: 'FV-1005', provider: 'Avianca', airline: 'Avianca', booking: 'AV7H2K', internal: 'INT-0305', ticket: '1342200998877', value: 2760000, charge: 2980000, surname: 'GOMEZ TORRES', names: 'ANDRES FELIPE', route: 'BOG-MAD-BOG', ida: '2026-04-12', vuelta: '2026-04-26',
  x: { third_party_commission: 140000, provider_profit: 85000, ta: 610000, ta_without_iva: 512605, ta_with_iva: 610000, iva_ta: 97395, net_quote_minus_iva_ta: 2370000, card_number: '**** 9031', purchase_invoice: 'FC-9910' }, obs: 'Cotización COT-1180', group: 'g2',
  segs: [['AV010', 'BOG', 'MAD', '2026-04-12', '19:45', '2026-04-13', '11:30'], ['AV011', 'MAD', 'BOG', '2026-04-26', '13:10', '2026-04-26', '17:55']], pax: [['ANDRES FELIPE GOMEZ TORRES', 'AQ1234567', 'PA', '1342200998877']] })
flight('s6', 'c4', '2026-04-09', { invoice: 'FV-1006', provider: 'LATAM Airlines', airline: 'LATAM', booking: 'MN2B6V', ticket: '5452100445566', value: 348000, charge: 370000, surname: 'BUITRAGO SOTO', names: 'CLARA INES', route: 'BOG-BAQ', ida: '2026-04-22', x: { ta: 66000 },
  segs: [['LA4112', 'BOG', 'BAQ', '2026-04-22', '14:20', '2026-04-22', '15:50']], pax: [['CLARA INES BUITRAGO SOTO', '41222333', 'CC', '5452100445566']] })
flight('s16', 'c2', '2026-08-04', { invoice: 'FV-1007', provider: 'LATAM Airlines', airline: 'LATAM', booking: 'BT6Y1S', ticket: '5452100556677', value: 682000, charge: 720000, surname: 'RUIZ PINEDA', names: 'CARLOS EDUARDO', route: 'MDE-BOG-MIA', ida: '2026-08-18',
  segs: [['LA4301', 'MDE', 'BOG', '2026-08-18', '06:30', '2026-08-18', '07:25'], ['LA2402', 'BOG', 'MIA', '2026-08-18', '10:15', '2026-08-18', '14:50']], pax: [['CARLOS EDUARDO RUIZ PINEDA', '98777666', 'CC', '5452100556677']] })
flight('s17', 'c3', '2026-09-05', { invoice: 'FV-1008', provider: 'LATAM Airlines', airline: 'LATAM', booking: 'RV1A9C', ticket: '5452100661001', value: 612000, charge: 660000, surname: 'RIVERA', names: 'CARLOS', route: 'BOG-CTG-BOG', ida: '2026-10-10', vuelta: '2026-10-14', group: 'g1',
  segs: [['LA4033', 'BOG', 'CTG', '2026-10-10', '08:15', '2026-10-10', '09:45'], ['LA4038', 'CTG', 'BOG', '2026-10-14', '17:30', '2026-10-14', '19:00']], pax: [['CARLOS RIVERA', '80123456', 'CC', '5452100661001']] })
flight('s18', 'c3', '2026-09-05', { invoice: 'FV-1008', provider: 'LATAM Airlines', airline: 'LATAM', booking: 'RV1A9D', ticket: '5452100661002', value: 612000, charge: 660000, surname: 'RIVERA', names: 'MARÍA', route: 'BOG-CTG-BOG', ida: '2026-10-10', vuelta: '2026-10-14', group: 'g1',
  segs: [['LA4033', 'BOG', 'CTG', '2026-10-10', '08:15', '2026-10-10', '09:45'], ['LA4038', 'CTG', 'BOG', '2026-10-14', '17:30', '2026-10-14', '19:00']], pax: [['MARÍA RIVERA', '52123456', 'CC', '5452100661002']], withDoc: false })

const hotel = (id: string, company_id: string, date: string, o: Partial<Operation>, h: Partial<Omit<Hotel, 'id' | 'operation_id'>>) => {
  op(id, company_id, 'hotel', date, o)
  db.hotels.push({ id: `h-${id}`, operation_id: id, hotel: '', city: '', address: '', phone: '', email: '', check_in: '', check_in_time: '', check_out: '', check_out_time: '', nights: null, holder: '', guests: null, room_type: '', board: '', special_requests: '', accommodation_code: '', reservation_number: '', purchase_invoice: '', total_invoice: null, third_party_commission: null, provider_profit: null, ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null, ...h })
}
hotel('s7', 'c2', '2026-02-11', { provider: 'Estelar', amount: 1480000, charge_amount: 1600000, observations: 'Habitación doble, desayuno incluido' }, { hotel: 'Hotel Estelar Cartagena', city: 'Cartagena', address: 'Cra 1 # 10-50, Bocagrande', phone: '+57 605 555 7788', email: 'reservas@estelar.example', check_in: '2026-02-20', check_in_time: '15:00', check_out: '2026-02-23', check_out_time: '12:00', nights: 3, holder: 'Carlos Ruiz', guests: 2, room_type: 'Doble estándar', board: 'Desayuno incluido', special_requests: 'Piso alto', accommodation_code: 'ACC-33120', reservation_number: 'HE-778812', purchase_invoice: 'FC-5521' })
doc('s7', 'voucher_HE778812.pdf', 96_400, '2026-02-11')
hotel('s8', 'c1', '2026-03-12', { provider: 'Booking', amount: 6900000, charge_amount: 7350000, group_id: 'g2' }, { hotel: 'Hilton Madrid Airport', city: 'Madrid', check_in: '2026-04-13', check_out: '2026-04-26', guests: 1, reservation_number: 'HM-203311' })
hotel('s15', 'c4', '2026-07-07', { provider: 'Decameron', amount: 3200000, charge_amount: 3500000 }, { hotel: 'Decameron Cartagena', city: 'Cartagena', check_in: '2026-07-20', check_out: '2026-07-24', guests: 4, reservation_number: 'DC-556120' })
hotel('s19', 'c3', '2026-09-05', { provider: 'Despegar', amount: 2400000, charge_amount: 2650000, group_id: 'g1' }, { hotel: 'Hotel Caribe Plaza', city: 'Cartagena', check_in: '2026-10-10', check_in_time: '14:00', check_out: '2026-10-14', check_out_time: '11:00', nights: 4, holder: 'Carlos Rivera', guests: 4, room_type: 'Familiar', board: 'Todo incluido', reservation_number: 'CP-90211' })

const transport = (id: string, company_id: string, date: string, o: Partial<Operation>, t: Omit<Transport, 'id' | 'operation_id'>) => { op(id, company_id, 'transport', date, o); db.transports.push({ id: `t-${id}`, operation_id: id, ...t }) }
transport('s9', 'c3', '2026-03-02', { provider: 'Transportes Express', amount: 180000, charge_amount: 200000 }, { origin: 'Aeropuerto El Dorado', destination: 'Hotel Tequendama', time: '17:50', passenger: 'Diana Vélez', service_number: 'TE-4410' })
transport('s10', 'c1', '2026-04-02', { provider: 'Taxi Seguro', amount: 95000, charge_amount: 110000, group_id: 'g2' }, { origin: 'Oficina SENCIA', destination: 'Aeropuerto El Dorado', time: '15:30', passenger: 'Andrés Gómez', service_number: 'TS-9921' })

const food = (id: string, company_id: string, date: string, o: Partial<Operation>, f: Omit<Food, 'id' | 'operation_id' | 'total_cost'>) => {
  const total = (f.supplies_value ?? 0) + (f.transport_value ?? 0)
  op(id, company_id, 'food', date, { amount: total, ...o }); db.foods.push({ id: `fd-${id}`, operation_id: id, total_cost: total, ...f })
}
food('s11', 'c4', '2026-05-06', { charge_amount: 1344000, observations: 'Incluye bebidas' }, { requested_by: 'Julián Ortiz', requested_item: 'Almuerzos evento institucional (50 personas)', supplies_value: 1000000, transport_value: 120000 })
food('s20', 'c1', '2026-06-20', { charge_amount: 504000 }, { requested_by: 'Laura Mendoza', requested_item: 'Refrigerios reunión comercial', supplies_value: 400000, transport_value: 20000 })

const loan = (id: string, company_id: string, date: string, o: Partial<Operation>, l: Partial<Loan>) => {
  op(id, company_id, 'loan', date, o)
  db.loans.push({ id: `l-${id}`, operation_id: id, request: '', invoice_date: '', cot: '', sent: '', charged_quoted_value: null, iva: null, has_iva: false, oc: '', received: '', requested_by: '', paid: '', ...l })
}
loan('s12', 'c1', '2026-05-14', { provider: 'Tecnoplaza', amount: 860000, charge_amount: 1032000, invoice_number: 'TP-33210' },
  { request: 'Maletas de viaje corporativas', invoice_date: '2026-05-14', cot: 'COT-2101', sent: 'Sí', charged_quoted_value: 1032000, iva: 196080, oc: 'OC-2026-045', received: '2026-05-20', requested_by: 'Laura Mendoza', paid: 'Sí' })
loan('s21', 'c2', '2026-08-25', { provider: 'Ferretería Central', amount: 450000, charge_amount: 540000 },
  { request: 'Equipos para viaje de obra', cot: 'COT-2188', requested_by: 'Carlos Ruiz' })
doc('s21', 'captura_cotizacion.png', 210_400, '2026-08-25', 'image/png', 'prestamos')
loan('s22', 'c3', '2026-09-12', { provider: 'Papelería Nacional', amount: 0, charge_amount: 0 },
  { request: 'Material impreso para evento', requested_by: 'Marta Salcedo' })

op('s13', 'c1', 'additional', '2026-06-01', { provider: 'Assist Card', invoice_number: 'AC-87120', amount: 210000, charge_amount: 240000 }); db.additionals.push({ id: 'a-s13', operation_id: 's13', description: 'Seguro de asistencia en viaje' })
doc('s13', 'poliza_AC87120.pdf', 120_300, '2026-06-01', 'application/pdf', 'otros')
op('s14', 'c3', 'other', '2026-06-18', { provider: 'Migración Colombia', invoice_number: 'MC-1120', amount: 320000, charge_amount: 360000, observations: 'Gestión de documentos' }); db.additionals.push({ id: 'a-s14', operation_id: 's14', description: 'Trámite de visado' })


const bank = (
  id: string,
  date: string,
  movement_type: string,
  description: string,
  beneficiary: string,
  amount: number,
  refs: [string, string?, string?] = [''],
  observation = ''
) =>
  db.bank.push({
    id,
    date,
    kind: movement_type === 'Ingreso' ? 'income' : movement_type === 'Transferencia' ? 'transfer' : movement_type === 'Otro' ? 'other' : 'expense',
    bank_name: '',
    description,
    amount,
    invoice_number: '',
    client_name: '',
    movement_type,
    beneficiary,
    reference_1: refs[0],
    reference_2: refs[1] ?? '',
    reference_3: refs[2] ?? '',
    observation,
    created_at: date
  })

bank('b1', '2026-09-01', 'Ingreso', 'Pago factura FV-1005', 'SENCIA S.A.S.', 2980000, ['FV-1005', 'TRF-88123'])
bank('b2', '2026-09-03', 'Egreso', 'Pago tiquetes LATAM', 'LATAM Airlines', 1250000, ['BSP-0903'], 'Liquidación semanal')
bank('b3', '2026-09-08', 'Egreso', 'Pago hotel', 'Hotel Caribe Plaza', 2400000, ['CP-90211', 'TRF-90044'])
bank('b4', '2026-09-10', 'Ingreso', 'Anticipo grupo Rivera', 'Grupo Vértice', 3000000, ['G-001'])
bank('b5', '2026-09-15', 'Comisión bancaria', 'Cuota de manejo', 'Banco', 18500)
bank('b6', '2026-09-18', 'Transferencia', 'Traslado entre cuentas', 'Cuenta de ahorros', 1500000, ['TRF-90301'])
bank('b7', '2026-09-22', 'Egreso', 'Pago proveedor alimentación', 'Catering Sabores', 1120000, ['FD-s11'], 'Evento Horizonte')
bank('b8', '2026-09-29', 'Ingreso', 'Pago factura FV-1003', 'Andina Construcciones', 262000, ['FV-1003'])

db.bankDocs.push({
  id: 'bd1',
  movement_id: 'b2',
  name: 'comprobante_b2.pdf',
  mime_type: 'application/pdf',
  size: 88_000,
  storage_path: 'banco/b2/comprobante_b2.pdf',
  created_at: '2026-09-03'
})

export const mockDb = db
