import { useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, FileText, Paperclip, Plus, Trash2 } from 'lucide-react'
import { useAsync } from '../hooks'
import { money } from '../lib/format'
import { DOC_CATEGORIES, DOC_CATEGORY_LABEL, flightMissing, GROUPABLE, isRealPassenger, loanIva, loanMissing, MARKUP, suggestCharge, TA_VAT } from '../lib/service'
import { dataService } from '../services'
import type { DetailsMap, DocCategory, OperationInput, OperationType, PassengerData, PendingDoc, SegmentData } from '../types'
import { AIRLINES } from '../constants/airlines'
import { CardSelect, SupplierSelect } from './SupplierFields'
import { Field, Select, Spinner, TextInput } from './ui'

const ValuesBox = ({ cost, charge }: { cost: ReactNode; charge: ReactNode }) => (
  <div className="rounded-lg border border-line p-4 space-y-4">
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Costo — lo que paga la agencia</p>
      {cost}
    </div>
    <div className="border-t border-line pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Cobro — lo que se factura al cliente</p>
      {charge}
    </div>
  </div>
)

const uid = () => Math.random().toString(36).slice(2, 9)
const emptySeg = (): SegmentData => ({ id: uid(), flight_number: '', origin: '', destination: '', departure_date: '', departure_time: '', arrival_date: '', arrival_time: '', cabin: 'Economy' })
const emptyPax = (): PassengerData => ({ id: uid(), names: '', surnames: '', document_type: 'CC', document_number: '', birth_date: '', email: '', phone: '', frequent_flyer: '', ticket_number: '' })

export function emptyDetails<T extends OperationType>(t: T): DetailsMap[T] {
  const d: { [K in OperationType]: DetailsMap[K] } = {
    flight: { no: '', first_surname: '', names: '', route: '', departure_date: '', return_date: '', airline: '', booking_code: '', internal_booking_code: '', ticket_number: '', value_with_taxes_tae: null, total_invoice: null, third_party_commission: null, provider_profit: null, ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null, card_number: '', purchase_invoice: '', segments: [emptySeg()], passengers: [emptyPax()] },
    hotel: { reservation_number: '', accommodation_code: '', hotel: '', city: '', address: '', phone: '', email: '', check_in: '', check_in_time: '', check_out: '', check_out_time: '', nights: null, holder: '', guests: null, room_type: '', board: '', special_requests: '', purchase_invoice: '', total_invoice: null, third_party_commission: null, provider_profit: null, ta: null, ta_without_iva: null, ta_with_iva: null, iva_ta: null, net_quote_minus_iva_ta: null },
    transport: { origin: '', destination: '', time: '', passenger: '', service_number: '' },
    food: { requested_by: '', requested_item: '', supplies_value: null, transport_value: null, total_cost: 0 },
    loan: { request: '', invoice_date: '', cot: '', sent: '', charged_quoted_value: null, iva: null, has_iva: false, oc: '', received: '', requested_by: '', paid: '' },
    additional: { description: '' },
    other: { description: '' },
  }
  return d[t]
}

const today = () => new Date().toISOString().slice(0, 10)
const netOf = (total: number | null, ta: number | null | undefined) => (total == null ? null : Math.round(total - (ta ?? 0)))
const costOf = (type: OperationType, amount: number, d: any) =>
  type === 'food' ? (d.supplies_value || 0) + (d.transport_value || 0) : type === 'flight' ? d.value_with_taxes_tae || 0 : amount || 0

interface Props {
  type: OperationType
  initial?: Partial<OperationInput>
  /** Files already chosen outside the form (e.g. the analyzed PDF): they appear categorized and can be changed or removed. */
  initialDocs?: PendingDoc[]
  submitLabel?: string
  busy?: boolean
  onSubmit: (input: OperationInput, docs: PendingDoc[]) => void | Promise<void>
  onCancel?: () => void
  children?: ReactNode
}

export default function ServiceForm({ type, initial, initialDocs, submitLabel = 'Guardar registro', busy, onSubmit, onCancel, children }: Props) {
  const { data: companies } = useAsync(() => dataService.getCompanies(), [])
  const { data: groups } = useAsync(() => dataService.getGroups(), [])
  const { data: suppliers } = useAsync(() => dataService.getSuppliers(), [])
  const { data: cards } = useAsync(() => dataService.getCards(), [])
  const [c, setC] = useState({
    company_id: initial?.company_id ?? '', date: initial?.date ?? today(), provider: initial?.provider ?? '', invoice_number: initial?.invoice_number ?? '',
    amount: initial?.amount ?? 0, charge_amount: initial?.charge_amount ?? 0, observations: initial?.observations ?? '',
  })
  const [d, setD] = useState<any>(() => {
    const x: any = structuredClone({ ...emptyDetails(type), ...(initial?.details as any) })
    // Older extractions stored the flight's own arrival date in "Fecha de regreso"; a same-day value is never a real return date, so it is not shown as one.
    if (type === 'flight') x.segments = (x.segments ?? []).map((sg: SegmentData) => (sg.arrival_date && sg.arrival_date === sg.departure_date ? { ...sg, arrival_date: '' } : sg))
    return x
  })
  const [groupSel, setGroupSel] = useState(initial?.group_id ?? '')
  const [groupLabel, setGroupLabel] = useState('')
  const [docs, setDocs] = useState<PendingDoc[]>(initialDocs ?? [])
  const [err, setErr] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')

  const canGroup = GROUPABLE.includes(type)
  const editing = !!(initial as { id?: string } | undefined)?.id
  const realPax = type === 'flight' ? (d.passengers as PassengerData[]).filter(isRealPassenger).length : 0
  const isBilled = type === 'flight' || type === 'hotel'
  const auto = MARKUP[type] !== undefined
  const pct = Math.round(((MARKUP[type] ?? 1) - 1) * 100)
  const cost = costOf(type, c.amount, d)
  // When editing, a stored value is the definitive one the user saved: suggestions never overwrite it silently.
  const [touched, setTouched] = useState(() => {
    const ch = initial?.charge_amount ?? 0
    return ch > 0 && (editing || ch !== suggestCharge(costOf(type, initial?.amount ?? 0, initial?.details ?? {}), type))
  })
  const charge = auto && !touched ? suggestCharge(cost, type) : c.charge_amount
  const initCharge = (initial?.charge_amount ?? 0) > 0 ? (initial?.charge_amount as number) : suggestCharge(costOf(type, initial?.amount ?? 0, initial?.details ?? {}), type)
  const [totalTouched, setTotalTouched] = useState(() => {
    const x: any = initial?.details
    return isBilled && x?.total_invoice != null && (editing || x.total_invoice !== initCharge)
  })
  const totalShown: number | null = totalTouched ? d.total_invoice ?? null : (charge || null)
  const [netTouched, setNetTouched] = useState(() => {
    const x: any = initial?.details
    return isBilled && x?.net_quote_minus_iva_ta != null && (editing || x.net_quote_minus_iva_ta !== netOf(x.total_invoice ?? initCharge, x.ta))
  })
  const netShown: number | null = netTouched ? d.net_quote_minus_iva_ta ?? null : netOf(totalShown, d.ta)

  const sc = (k: 'company_id' | 'date' | 'provider' | 'invoice_number' | 'observations') => ({ value: c[k], onChange: (e: { target: { value: string } }) => setC(p => ({ ...p, [k]: e.target.value })) })
  const cn = (k: 'amount') => ({ value: c[k] || '', onChange: (e: { target: { value: string } }) => setC(p => ({ ...p, [k]: Number(e.target.value) || 0 })) })
  const tv = (k: string) => ({ value: d[k] ?? '', onChange: (e: { target: { value: string } }) => setD((p: any) => ({ ...p, [k]: e.target.value })) })
  const nv = (k: string) => ({ type: 'number' as const, min: 0, value: d[k] ?? '', onChange: (e: { target: { value: string } }) => setD((p: any) => ({ ...p, [k]: e.target.value === '' ? null : Number(e.target.value) })) })
  const taPatch = (ta: number | null) => {
    const sin = ta == null ? null : Math.round(ta / TA_VAT)
    return { ta, ta_with_iva: ta, ta_without_iva: sin, iva_ta: ta == null || sin == null ? null : ta - sin }
  }
  const onCompany = (id: string) => {
    setC(p => ({ ...p, company_id: id }))
    if (type === 'flight' || type === 'hotel') setD((p: any) => ({ ...p, ...taPatch(companies?.find(x => x.id === id)?.ta ?? null) }))
  }
  const onTa = (e: { target: { value: string } }) => setD((p: any) => ({ ...p, ...taPatch(e.target.value === '' ? null : Number(e.target.value)) }))
  const onTotal = (e: { target: { value: string } }) => {
    setTotalTouched(true)
    setD((p: any) => ({ ...p, total_invoice: e.target.value === '' ? null : Number(e.target.value) }))
  }
  const onNet = (e: { target: { value: string } }) => {
    setNetTouched(true)
    setD((p: any) => ({ ...p, net_quote_minus_iva_ta: e.target.value === '' ? null : Number(e.target.value) }))
  }
  // "Valor cobrado / cotizado" is the value quoted/charged by the supplier: typing it sets the same value as the base ("Valor"); the 20% margin is derived from it and IVA from "Valor a cobrar"
  const onQuote = (e: { target: { value: string } }) => {
    const q = e.target.value === '' ? null : Number(e.target.value)
    setD((p: any) => ({ ...p, charged_quoted_value: q }))
    if (!q || q <= 0) return
    setC(p => ({ ...p, amount: q }))
    setTouched(false)
  }
  const onIva = (e: { target: { value: string } }) => {
    const on = e.target.value === 'si'
    setD((p: any) => ({ ...p, has_iva: on, iva: on ? loanIva(charge) : null }))
  }
  const loanValue = { value: c.amount || '', onChange: (e: { target: { value: string } }) => { setC(p => ({ ...p, amount: Number(e.target.value) || 0 })); setTouched(false) } }
  const hdate = (k: 'check_in' | 'check_out') => ({
    value: d[k] ?? '',
    onChange: (e: { target: { value: string } }) => setD((p: any) => {
      const n = { ...p, [k]: e.target.value }
      if (n.check_in && n.check_out) { const diff = Math.round((new Date(n.check_out).getTime() - new Date(n.check_in).getTime()) / 864e5); if (diff > 0) n.nights = diff }
      return n
    }),
  })
  const row = (key: 'segments' | 'passengers', i: number, k: string, v: string) =>
    setD((p: any) => ({ ...p, [key]: p[key].map((x: any, j: number) => (j === i ? { ...x, [k]: v } : x)) }))
  const add = (key: 'segments' | 'passengers') => setD((p: any) => ({ ...p, [key]: [...p[key], key === 'segments' ? emptySeg() : emptyPax()] }))
  const del = (key: 'segments' | 'passengers', i: number) => setD((p: any) => ({ ...p, [key]: p[key].filter((_: unknown, j: number) => j !== i) }))

  const miss = type === 'loan' ? loanMissing(c.amount, c.invoice_number, d) : type === 'flight' ? flightMissing(d, editing ? ((initial as { documents?: { category?: string }[] } | undefined)?.documents ?? []) : docs) : []
  const warn = (l: string) => miss.includes(l)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const need: Record<string, boolean> = { company_id: !c.company_id, date: !c.date }
    if (type === 'flight') need.airline = !d.airline?.trim()
    else if (type === 'hotel') need.hotel = !d.hotel?.trim()
    else if (type === 'transport') need.provider = !c.provider.trim()
    else if (type === 'food') need.requested_item = !d.requested_item?.trim()
    else if (type === 'additional' || type === 'other') need.description = !d.description?.trim()
    const e2 = Object.fromEntries(Object.entries(need).filter(([, v]) => v).map(([k]) => [k, 'Campo requerido']))
    setErr(e2)
    if (Object.keys(e2).length) return
    const details = { ...d }
    let amount = c.amount
    if (type === 'flight') {
      amount = d.value_with_taxes_tae ?? 0
      delete details.iva_5; delete details.no_iva_19_tkt_national
      details.total_invoice = totalShown
      details.net_quote_minus_iva_ta = netShown
      details.ta_with_iva = details.ta ?? null
      const p0 = d.passengers[0]
      if (p0?.surnames?.trim()) { details.first_surname = p0.surnames; details.names = p0.names }
      else if (p0?.names?.trim() && !details.first_surname && !details.names) details.names = p0.names
      const s0 = d.segments[0]
      if (s0?.departure_date) details.departure_date = s0.departure_date
      const back = d.segments.map((sg: SegmentData) => sg.arrival_date).filter(Boolean).sort()
      details.return_date = back[back.length - 1] ?? ''
      if (!details.route?.trim() && d.segments.length) details.route = [d.segments[0].origin, ...d.segments.map((s: SegmentData) => s.destination)].filter(Boolean).join('-')
    } else if (type === 'hotel') {
      details.total_invoice = totalShown
      details.net_quote_minus_iva_ta = netShown
      details.ta_with_iva = details.ta ?? null
    } else if (type === 'loan') {
      if (d.has_iva) details.iva = loanIva(charge)
    } else if (type === 'food') { amount = cost; details.total_cost = cost }
    setSubmitError('')
    Promise.resolve(onSubmit({
      ...c, amount, charge_amount: charge, type, details,
      group_id: canGroup ? (groupSel && groupSel !== '__new__' ? groupSel : null) : initial?.group_id ?? null, group_label: canGroup && groupSel === '__new__' ? groupLabel : undefined,
    } as OperationInput, docs)).catch(e => setSubmitError(e instanceof Error ? e.message : 'No se pudo guardar'))
  }

  const grid = 'grid gap-3 sm:grid-cols-2'
  const chargeField = (
    <Field label={isBilled ? 'Valor a cobrar (sugerido)' : 'Valor a cobrar'}>
      <input className="input" type="number" min={0} value={charge || ''} onChange={e => { setTouched(true); setC(p => ({ ...p, charge_amount: Number(e.target.value) || 0 })) }} />
      {auto && (touched
        ? <button type="button" className="text-xs text-brand mt-1" onClick={() => setTouched(false)}>Usar sugerido (+{pct}%)</button>
        : <p className="text-xs text-muted mt-1">Sugerido: {type === 'flight' ? 'Valor TKT' : type === 'hotel' ? 'Valor del hotel' : type === 'loan' ? `Valor (${money(cost)})` : 'costo'} + {pct}%. Puedes modificarlo.</p>)}
    </Field>
  )
  const billing = (cost: ReactNode[], charge: ReactNode[]) => (
    <>
      <H>Valores y facturación</H>
      <ValuesBox
        cost={<div className={cost.length > 1 ? grid : 'grid gap-3'}>{cost.map((n, i) => <div key={i}>{n}</div>)}</div>}
        charge={<div className={charge.length > 1 ? grid : 'grid gap-3'}>{charge.map((n, i) => <div key={i}>{n}</div>)}</div>} />
    </>
  )
  const taFields = (
    <>
      <TextInput label="TA" type="number" min={0} value={d.ta ?? ''} onChange={onTa} />
      <TextInput label="TA sin IVA" {...nv('ta_without_iva')} />
      <TextInput label="IVA incluido en TA" {...nv('iva_ta')} />
    </>
  )
  const totalField = (
    <Field label="Total factura">
      <input className="input" type="number" min={0} value={totalShown ?? ''} onChange={onTotal} />
      {totalTouched
        ? <button type="button" className="text-xs text-brand mt-1" onClick={() => setTotalTouched(false)}>Igualar al valor a cobrar</button>
        : <p className="text-xs text-muted mt-1">Igual al valor a cobrar. Puedes modificarlo.</p>}
    </Field>
  )
  const commissionFields = (
    <div className={grid}>
      <TextInput label="Comisión terceros" {...nv('third_party_commission')} />
      <TextInput label="Ganancia proveedor" {...nv('provider_profit')} />
    </div>
  )
  const taxGrid = (
    <div className={grid}>
      {taFields}
      <Field label="Valor neto cotización TA con IVA">
        <input className="input" type="number" value={netShown ?? ''} onChange={onNet} />
        {netTouched
          ? <button type="button" className="text-xs text-brand mt-1" onClick={() => setNetTouched(false)}>Usar calculado (Total factura − TA)</button>
          : <p className="text-xs text-muted mt-1">Total factura − TA. Puedes modificarlo.</p>}
      </Field>
    </div>
  )
  const H = ({ children }: { children: ReactNode }) => (
    <div className="!mt-7 flex items-center gap-2.5 rounded-lg bg-brand/5 px-3 py-2">
      <span className="h-4 w-1 rounded-full bg-brand" />
      <h3 className="text-sm font-semibold tracking-tight">{children}</h3>
    </div>
  )
  const typeLabel = type === 'additional' || type === 'other'
  const valueLabel = type === 'flight' ? '' : type === 'loan' ? 'Valor' : 'Valor (costo)'

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {(type === 'loan' || type === 'flight') && miss.length > 0 && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300"><AlertTriangle size={16} />Información incompleta</p>
          <p className="mt-1 text-muted">Faltan: {miss.join(', ')}. Puedes guardar igual; el registro quedará marcado como incompleto.</p>
        </div>
      )}
      {type === 'flight' ? (
        <>
          <H>Información general</H>
          <div className={grid}>
            <TextInput label="NO" {...tv('no')} />
            <TextInput label="Fecha *" error={err.date} type="date" {...sc('date')} />
            <TextInput label="Factura" {...sc('invoice_number')} />
            <Select label="Cliente *" error={err.company_id} value={c.company_id} onChange={e => onCompany(e.target.value)}>
              <option value="">Seleccionar…</option>{companies?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </div>
        </>
      ) : (
        <>
          <H>Información general</H>
          <div className={grid}>
          <Select label="Empresa *" error={err.company_id} value={c.company_id} onChange={e => onCompany(e.target.value)}>
            <option value="">Seleccionar…</option>{companies?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
          <TextInput label={type === 'food' ? 'Fecha de solicitud *' : 'Fecha *'} error={err.date} type="date" {...sc('date')} />
          <SupplierSelect label={type === 'transport' ? 'Proveedor *' : 'Proveedor'} error={err.provider} value={c.provider} onChange={v => setC(p => ({ ...p, provider: v }))} suppliers={suppliers} />
          {(type === 'loan' || typeLabel) && <TextInput label="Factura" warn={warn('Factura')} {...sc('invoice_number')} />}
          </div>
        </>
      )}

      {type === 'flight' && (
        <>
          <H>Pasajeros</H>
          {!editing && realPax > 1 && <p className="text-xs text-muted">Se creará un registro por pasajero, agrupados por el código de reserva. El número de tiquete de cada uno es el campo «Ticket» de su tarjeta.</p>}
          {d.passengers.map((p: PassengerData, i: number) => (
            <div key={p.id} className="rounded-lg border border-line p-3 grid gap-3 grid-cols-2 sm:grid-cols-3 relative">
              <TextInput label="Nombres" value={p.names} onChange={e => row('passengers', i, 'names', e.target.value)} />
              <TextInput label="Apellidos" value={p.surnames} onChange={e => row('passengers', i, 'surnames', e.target.value)} />
              <Select label="Tipo doc." value={p.document_type} onChange={e => row('passengers', i, 'document_type', e.target.value)}>{['CC', 'CE', 'TI', 'PA', 'NIT'].map(t => <option key={t}>{t}</option>)}</Select>
              <TextInput label="N.º documento" value={p.document_number} onChange={e => row('passengers', i, 'document_number', e.target.value)} />
              <TextInput label="Nacimiento" type="date" value={p.birth_date} onChange={e => row('passengers', i, 'birth_date', e.target.value)} />
              <TextInput label="Email" type="email" value={p.email} onChange={e => row('passengers', i, 'email', e.target.value)} />
              <TextInput label="Teléfono" value={p.phone} onChange={e => row('passengers', i, 'phone', e.target.value)} />
              <TextInput label="Viajero frecuente" value={p.frequent_flyer} onChange={e => row('passengers', i, 'frequent_flyer', e.target.value)} />
              <TextInput label="Ticket" value={p.ticket_number} onChange={e => row('passengers', i, 'ticket_number', e.target.value)} />
              {d.passengers.length > 1 && <button type="button" onClick={() => del('passengers', i)} className="absolute top-2 right-2 text-muted hover:text-red-500" aria-label="Quitar pasajero"><Trash2 size={14} /></button>}
            </div>
          ))}
          {(!editing || d.passengers.length > 1) && <button type="button" className="btn-ghost" onClick={() => add('passengers')}><Plus size={14} />Agregar pasajero</button>}
          <H>Itinerario</H>
          <div className={grid}>
            <TextInput className="sm:col-span-2" label="Ruta" placeholder="BOG-MDE-BOG" {...tv('route')} />
          </div>
          {d.segments.map((s: SegmentData, i: number) => (
            <div key={s.id} className="rounded-lg border border-line p-3 grid gap-3 grid-cols-2 sm:grid-cols-4 relative">
              <TextInput label="Vuelo" value={s.flight_number} onChange={e => row('segments', i, 'flight_number', e.target.value)} />
              <TextInput label="Origen" value={s.origin} onChange={e => row('segments', i, 'origin', e.target.value)} />
              <TextInput label="Destino" value={s.destination} onChange={e => row('segments', i, 'destination', e.target.value)} />
              <TextInput label="Cabina / clase" value={s.cabin} onChange={e => row('segments', i, 'cabin', e.target.value)} />
              <TextInput label="Fecha salida" type="date" value={s.departure_date} onChange={e => row('segments', i, 'departure_date', e.target.value)} />
              <TextInput label="Hora salida" type="time" value={s.departure_time} onChange={e => row('segments', i, 'departure_time', e.target.value)} />
              <TextInput label="Fecha de regreso" type="date" value={s.arrival_date} onChange={e => row('segments', i, 'arrival_date', e.target.value)} />
              <TextInput label="Hora llegada" type="time" value={s.arrival_time} onChange={e => row('segments', i, 'arrival_time', e.target.value)} />
              {d.segments.length > 1 && <button type="button" onClick={() => del('segments', i)} className="absolute top-2 right-2 text-muted hover:text-red-500" aria-label="Quitar tramo"><Trash2 size={14} /></button>}
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => add('segments')}><Plus size={14} />Agregar tramo</button>
          <H>Reserva</H>
          <div className={grid}>
            <TextInput label="Aerolínea *" error={err.airline} list="airlines-list" autoComplete="off" placeholder="Busca o escribe una aerolínea" {...tv('airline')} />
            <datalist id="airlines-list">{AIRLINES.map(a => <option key={a} value={a} />)}</datalist>
            <TextInput label="Código de reserva" {...tv('booking_code')} />
            <TextInput label="Código de reserva INT" {...tv('internal_booking_code')} />
            <TextInput label="Número de tiquete" {...tv('ticket_number')} />
          </div>
          {billing(
            [<TextInput label="Valor TKT con impuestos TA y FEE" {...nv('value_with_taxes_tae')} />, <TextInput label="Factura de compra" {...tv('purchase_invoice')} />],
            [chargeField, totalField])}
          {!editing && realPax > 1 && <p className="text-xs text-muted">Estos valores son el total de la reserva: al guardar se dividen entre los {realPax} pasajeros (con ajuste de redondeo para que la suma coincida). Luego puedes editar el valor de cada pasajero en su propia fila.</p>}
          <H>Comisiones y ganancias</H>
          {commissionFields}
          <H>Impuestos / TA</H>
          {taxGrid}
          <H>Proveedor</H>
          <div className={grid}>
            <CardSelect label="Número tarjeta" value={d.card_number ?? ''} onChange={v => setD((p: any) => ({ ...p, card_number: v }))} cards={cards} />
            <SupplierSelect label="Proveedor" value={c.provider} onChange={v => setC(p => ({ ...p, provider: v }))} suppliers={suppliers} />
          </div>
        </>
      )}

      {type === 'hotel' && (
        <>
          <H>Reserva</H>
          <div className={grid}>
            <TextInput label="Número de reserva" {...tv('reservation_number')} />
            <TextInput label="Código de alojamiento" {...tv('accommodation_code')} />
          </div>
          <H>Hotel</H>
          <div className={grid}>
            <TextInput label="Nombre del hotel *" error={err.hotel} {...tv('hotel')} />
            <TextInput label="Ciudad / destino" {...tv('city')} />
            <TextInput className="sm:col-span-2" label="Dirección" {...tv('address')} />
            <TextInput label="Teléfono" {...tv('phone')} />
            <TextInput label="Email" type="email" {...tv('email')} />
          </div>
          <H>Estadía</H>
          <div className={grid}>
            <TextInput label="Check-in" type="date" {...hdate('check_in')} />
            <TextInput label="Hora check-in" type="time" {...tv('check_in_time')} />
            <TextInput label="Check-out" type="date" {...hdate('check_out')} />
            <TextInput label="Hora check-out" type="time" {...tv('check_out_time')} />
            <TextInput label="Número de noches" {...nv('nights')} min={1} />
          </div>
          <H>Huésped</H>
          <div className={grid}>
            <TextInput label="Titular de la reserva" {...tv('holder')} />
            <TextInput label="Número de huéspedes" {...nv('guests')} min={1} />
          </div>
          <H>Habitación</H>
          <div className={grid}>
            <TextInput label="Tipo de habitación" {...tv('room_type')} />
            <TextInput label="Régimen" {...tv('board')} />
          </div>
        </>
      )}

      {type === 'transport' && (
        <>
        <H>Servicio</H>
        <div className={grid}>
          <TextInput label="Pasajero / cliente" {...tv('passenger')} />
          <TextInput label="Origen" {...tv('origin')} />
          <TextInput label="Destino" {...tv('destination')} />
          <TextInput label="Hora" type="time" {...tv('time')} />
          <TextInput label="N.º de servicio / reserva" {...tv('service_number')} />
        </div>
        </>
      )}

      {type === 'food' && (
        <>
        <H>Solicitud</H>
        <div className={grid}>
          <TextInput label="Quién solicitó" {...tv('requested_by')} />
          <TextInput label="Qué solicitó *" error={err.requested_item} {...tv('requested_item')} />
          <TextInput label="Valor insumo" {...nv('supplies_value')} />
          <TextInput label="Valor transporte" {...nv('transport_value')} />
          <Field label="Costo total (insumo + transporte)"><input className="input bg-surface2" readOnly value={cost || ''} /></Field>
        </div>
        </>
      )}

      {type === 'loan' && (
        <>
        <H>Préstamo</H>
        <div className={grid}>
          <TextInput className="sm:col-span-2" label="Solicitud" warn={warn('Solicitud')} {...tv('request')} />
          <TextInput label="Solicitó" warn={warn('Solicitó')} {...tv('requested_by')} />
          <TextInput label="Fecha de factura" type="date" warn={warn('Fecha de factura')} {...tv('invoice_date')} />
          <TextInput label="COT" {...tv('cot')} />
          <TextInput label="Enviada" type="date" {...tv('sent')} />
          <TextInput label="OC" warn={warn('OC')} {...tv('oc')} />
          <TextInput label="Recibida" type="date" warn={warn('Recibida')} {...tv('received')} />
          <TextInput label="Se pagó" type="date" {...tv('paid')} />
          <TextInput label="Valor de costo" type="number" min={0} value={d.charged_quoted_value ?? ''} onChange={onQuote} />
          <Select label="¿Incluye IVA del 19%?" value={d.has_iva ? 'si' : 'no'} onChange={onIva}><option value="no">No</option><option value="si">Sí</option></Select>
        </div>
        </>
      )}

      {typeLabel && (
        <>
          <H>Servicio</H>
          <div className={grid}><TextInput className="sm:col-span-2" label="Descripción *" error={err.description} {...tv('description')} /></div>
        </>
      )}

      {type === 'hotel' && (
        <>
          {billing(
            [<TextInput label="Valor del hotel" type="number" min={0} {...cn('amount')} />, <TextInput label="Factura de compra" {...tv('purchase_invoice')} />],
            [chargeField, totalField])}
          <H>Comisiones y ganancias</H>
          {commissionFields}
          <H>Impuestos / TA</H>
          {taxGrid}
        </>
      )}

      {type !== 'flight' && type !== 'hotel' && (
        <>
          <H>Valores</H>
          <div className={grid}>
            {type !== 'food' && <TextInput label={type === 'loan' ? (d.has_iva ? 'Valor base (sin IVA)' : 'Valor ingresado') : valueLabel} type="number" min={0} warn={warn('Valor')} {...(type === 'loan' ? loanValue : cn('amount'))} />}
            {chargeField}
            {type === 'loan' && d.has_iva && (
              <div role="status" className="rounded-lg border border-line bg-surface2 p-3 text-sm sm:col-span-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Cálculo con IVA del 19%</p>
                <dl className="grid grid-cols-3 gap-3">
                  <div><dt className="text-xs text-muted">Valor a cobrar</dt><dd className="tabular-nums">{money(charge)}</dd></div>
                  <div><dt className="text-xs text-muted">IVA 19%</dt><dd className="tabular-nums">{money(loanIva(charge))}</dd></div>
                  <div><dt className="text-xs text-muted">Total con IVA</dt><dd className="font-semibold tabular-nums">{money(charge + loanIva(charge))}</dd></div>
                </dl>
              </div>
            )}
          </div>
        </>
      )}

      {canGroup && <><H>Agrupación</H>
      <div className={grid}>
        <Select label="Grupo (opcional)" value={groupSel} onChange={e => setGroupSel(e.target.value)}>
          <option value="">Sin grupo</option>
          {groups?.map(g => <option key={g.id} value={g.id}>{g.code} · {g.label}</option>)}
          <option value="__new__">+ Nuevo grupo…</option>
        </Select>
        {groupSel === '__new__' && <TextInput label="Nombre del nuevo grupo" value={groupLabel} onChange={e => setGroupLabel(e.target.value)} />}
      </div></>}

      {!editing && (
        <>
          <H>Documentos</H>
          <div className="space-y-2">
            {docs.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-line p-2.5">
                <FileText size={16} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1 truncate text-sm" title={f.file.name}>{f.file.name}</span>
                <select className="input !w-auto !px-2 !py-1 text-xs" value={f.category} aria-label="Categoría del documento"
                  onChange={e => setDocs(p => p.map((x, j) => (j === i ? { ...x, category: e.target.value as DocCategory } : x)))}>
                  {DOC_CATEGORIES.map(c => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}
                </select>
                <button type="button" aria-label="Quitar archivo" className="p-1 rounded text-muted hover:bg-red-500/10 hover:text-red-600" onClick={() => setDocs(p => p.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <label className="btn-ghost w-fit cursor-pointer"><Paperclip size={14} />Adjuntar documento
              <input type="file" multiple accept="application/pdf,image/*" className="hidden"
                onChange={e => { const fs = [...(e.target.files ?? [])]; if (fs.length) setDocs(p => [...p, ...fs.map(file => ({ file, category: 'other' as DocCategory }))]); e.target.value = '' }} /></label>
          </div>
        </>
      )}

      <H>Observaciones</H>
      <textarea aria-label="Observaciones" className="input min-h-20" {...sc('observations')} />
      {children}
      {submitError && <p role="alert" className="text-sm text-red-500">{submitError}</p>}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>}
        <button className="btn-primary" disabled={busy && !submitError}>{busy && !submitError && <Spinner />}{submitLabel}</button>
      </div>
    </form>
  )
}
