import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Plus, FilterX, ChevronDown, ChevronRight, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { DeleteDialog } from '../components/DeleteDialog'
import ServiceDetail from '../components/ServiceDetail'
import { Empty, FilterBar, Loading, PageHeader, Select, TypeBadge } from '../components/ui'
import { useAsync, useDebounced } from '../hooks'
import { fdate, money, MONTHS, SERVICE_LABEL, SERVICE_TYPES } from '../lib/format'
import { SECTIONS, type SectionKey } from '../lib/sections'
import { reservationKey, summary } from '../lib/service'
import { dataService } from '../services'
import type { OperationFilters, OperationRow, OperationType } from '../types'

type Row<K extends OperationType> = Extract<OperationRow, { type: K }>
interface Col { h: string; sticky?: string; right?: boolean; mono?: boolean; cell: (r: OperationRow) => ReactNode }
const on = <K extends OperationType>(t: K, f: (r: Row<K>) => ReactNode) => (r: OperationRow) => (r.type === t ? f(r as Row<K>) : null)
const v = (x?: string | number | null) => (x === '' || x == null ? '—' : x)
const d = (x?: string) => (x ? fdate(x) : '—')
const n = (x: number | null) => (x == null ? '—' : money(x))

const date = (h = 'Fecha'): Col => ({ h, cell: r => d(r.date) })
const company: Col = { h: 'Empresa', cell: r => r.company_name }
const provider: Col = { h: 'Proveedor', cell: r => v(r.provider) }
const invoice: Col = { h: 'Factura', mono: true, cell: r => v(r.invoice_number) }
const cost = (h = 'Valor de costo'): Col => ({ h, right: true, cell: r => money(r.amount) })
const charge: Col = { h: 'A cobrar', right: true, cell: r => <b className="font-medium">{money(r.charge_amount)}</b> }

const TABS: { key: string; label: string; types: OperationType[]; cols: Col[] }[] = [
  { key: 'all', label: 'Todos', types: [], cols: [date(), company, { h: 'Tipo', cell: r => <TypeBadge type={r.type} /> }, provider, cost(), charge] },
  { key: 'flight', label: 'Vuelos', types: ['flight'], cols: [
    { h: 'NO', sticky: '0', cell: on('flight', r => v(r.details.no)) }, { ...date('Fecha'), sticky: '3rem' }, invoice, { h: 'Cliente', cell: r => r.company_name },
    { h: 'Primer apellido', cell: on('flight', r => v(r.details.first_surname)) }, { h: 'Nombres', cell: on('flight', r => v(r.details.names)) },
    { h: 'Ruta', cell: on('flight', r => v(r.details.route)) }, { h: 'Fecha de ida', cell: on('flight', r => d(r.details.departure_date)) }, { h: 'Fecha de vuelta', cell: on('flight', r => d(r.details.return_date)) },
    { h: 'Aerolínea', cell: on('flight', r => v(r.details.airline)) }, { h: 'Código de reserva', mono: true, cell: on('flight', r => v(r.details.booking_code)) },
    { h: 'Código de reserva INT', mono: true, cell: on('flight', r => v(r.details.internal_booking_code)) }, { h: 'Número de tiquete', mono: true, cell: on('flight', r => v(r.details.ticket_number)) },
    { h: 'Valor TKT c/ imp. TA y FEE', right: true, cell: on('flight', r => n(r.details.value_with_taxes_tae)) }, { h: 'Total factura', right: true, cell: on('flight', r => n(r.details.total_invoice)) },
    { h: 'Comisión terceros', right: true, cell: on('flight', r => n(r.details.third_party_commission)) }, { h: 'Ganancia proveedor', right: true, cell: on('flight', r => n(r.details.provider_profit)) },
    { h: 'TA', right: true, cell: on('flight', r => n(r.details.ta)) }, { h: 'TA sin IVA', right: true, cell: on('flight', r => n(r.details.ta_without_iva)) }, { h: 'IVA incluido en TA', right: true, cell: on('flight', r => n(r.details.iva_ta)) },
    { h: 'Valor neto cotización TA con IVA', right: true, cell: on('flight', r => n(r.details.net_quote_minus_iva_ta)) },
    { h: 'Número tarjeta', mono: true, cell: on('flight', r => v(r.details.card_number)) }, provider, { h: 'Factura de compra', mono: true, cell: on('flight', r => v(r.details.purchase_invoice)) },
    charge, { h: 'Observación', cell: r => v(r.observations) }] },
  { key: 'hotel', label: 'Hoteles', types: ['hotel'], cols: [date(), company,
    { h: 'Hotel', cell: on('hotel', r => v(r.details.hotel)) }, { h: 'Ciudad', cell: on('hotel', r => v(r.details.city)) },
    { h: 'Check-in', cell: on('hotel', r => d(r.details.check_in)) }, { h: 'Check-out', cell: on('hotel', r => d(r.details.check_out)) }, { h: 'Noches', cell: on('hotel', r => v(r.details.nights)) },
    { h: 'Titular', cell: on('hotel', r => v(r.details.holder)) }, { h: 'Huéspedes', cell: on('hotel', r => v(r.details.guests)) },
    { h: 'Habitación', cell: on('hotel', r => v(r.details.room_type)) }, { h: 'Régimen', cell: on('hotel', r => v(r.details.board)) },
    provider, { h: 'N.º reserva', mono: true, cell: on('hotel', r => v(r.details.reservation_number)) }, invoice,
    cost(), charge, { h: 'Total factura', right: true, cell: on('hotel', r => n(r.details.total_invoice)) }, { h: 'Comisión terceros', right: true, cell: on('hotel', r => n(r.details.third_party_commission)) }, { h: 'Ganancia proveedor', right: true, cell: on('hotel', r => n(r.details.provider_profit)) },
    { h: 'TA', right: true, cell: on('hotel', r => n(r.details.ta)) }, { h: 'TA sin IVA', right: true, cell: on('hotel', r => n(r.details.ta_without_iva)) }, { h: 'IVA incluido en TA', right: true, cell: on('hotel', r => n(r.details.iva_ta)) },
    { h: 'Valor neto cotización TA con IVA', right: true, cell: on('hotel', r => n(r.details.net_quote_minus_iva_ta)) },
    { h: 'Observaciones', cell: r => v(r.observations) }] },
  { key: 'transport', label: 'Transporte', types: ['transport'], cols: [date(), company, provider,
    { h: 'Origen', cell: on('transport', r => v(r.details.origin)) }, { h: 'Destino', cell: on('transport', r => v(r.details.destination)) }, { h: 'Hora', cell: on('transport', r => v(r.details.time)) },
    { h: 'Pasajero', cell: on('transport', r => v(r.details.passenger)) }, { h: 'N.º servicio', mono: true, cell: on('transport', r => v(r.details.service_number)) },
    cost(), charge, { h: 'Observaciones', cell: r => v(r.observations) }] },
  { key: 'food', label: 'Alimentación', types: ['food'], cols: [date('Fecha de solicitud'), company,
    { h: 'Quién solicitó', cell: on('food', r => v(r.details.requested_by)) }, { h: 'Qué solicitó', cell: on('food', r => v(r.details.requested_item)) },
    { h: 'Valor insumo', right: true, cell: on('food', r => n(r.details.supplies_value)) }, { h: 'Valor transporte', right: true, cell: on('food', r => n(r.details.transport_value)) },
    { h: 'Costo total', right: true, cell: on('food', r => money(r.details.total_cost)) }, charge, provider, { h: 'Observaciones', cell: r => v(r.observations) }] },
  { key: 'loan', label: 'Préstamos', types: ['loan'], cols: [date(), company,
    { h: 'Solicitud', cell: on('loan', r => v(r.details.request)) },
    { h: 'Valor de costo', right: true, cell: on('loan', r => n(r.details.charged_quoted_value ?? r.amount)) }, charge,
    invoice, { h: 'Fecha factura', cell: on('loan', r => d(r.details.invoice_date)) },
    { h: 'COT', mono: true, cell: on('loan', r => v(r.details.cot)) }, { h: 'Enviada', cell: on('loan', r => d(r.details.sent)) },
    { h: 'IVA', right: true, cell: on('loan', r => n(r.details.iva)) }, { h: 'Total con IVA', right: true, cell: on('loan', r => (r.details.has_iva ? n(r.charge_amount + (r.details.iva ?? 0)) : '—')) },
    { h: 'OC', mono: true, cell: on('loan', r => v(r.details.oc)) }, { h: 'Recibida', cell: on('loan', r => d(r.details.received)) },
    { h: 'Solicitó', cell: on('loan', r => v(r.details.requested_by)) }, { h: 'Se pagó', cell: on('loan', r => d(r.details.paid)) }, provider] },
  { key: 'other', label: 'Otros', types: ['additional', 'other'], cols: [date(), company, { h: 'Tipo', cell: r => <TypeBadge type={r.type} /> }, provider,
    { h: 'Descripción', cell: r => (r.type === 'additional' || r.type === 'other' ? v(r.details.description) : null) }, invoice, cost(), charge, { h: 'Observaciones', cell: r => v(r.observations) }] },
]

export default function Records({ section }: { section?: SectionKey }) {
  const [params, setParams] = useSearchParams()
  const [f, setF] = useState<OperationFilters>({ company_id: params.get('empresa') ?? '' })
  const [selected, setSelected] = useState<{ id: string; edit: boolean } | null>(null)
  const [del, setDel] = useState<OperationRow[] | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [notice, setNotice] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const set = (k: keyof OperationFilters) => (e: { target: { value: string } }) => { setF(p => ({ ...p, [k]: e.target.value })); if (k === 'company_id') setParams(e.target.value ? { empresa: e.target.value } : {}) }
  const q = useDebounced(f.search)
  const cur = TABS.find(t => t.key === (section ?? 'all'))!
  const sec = section ? SECTIONS[section] : null
  const types = cur.types
  const filters = { ...f, search: q, type: (types.length === 1 ? types[0] : f.type) as OperationType | '' | undefined }

  const { data: rows, loading, reload } = useAsync(() => dataService.getOperations(filters), [JSON.stringify(filters)])
  const { data: alerts } = useAsync(() => dataService.getInvoiceAlerts(), [rows?.length])
  const alertByOp = useMemo(() => new Map((alerts ?? []).map(a => [a.operation_id, a])), [alerts])
  const { data: companies } = useAsync(() => dataService.getCompanies(), [])
  const { data: providers } = useAsync(() => dataService.getProviders(), [])
  const shown = useMemo(() => (rows ?? []).filter(r => types.length < 2 || types.includes(r.type)), [rows, types])
  const items = useMemo(() => {
    const seen = new Set<string>()
    const seenRes = new Set<string>()
    const resCount = new Map<string, number>()
    shown.forEach(r => { const k = !r.group ? reservationKey(r) : ''; if (k) resCount.set(k, (resCount.get(k) ?? 0) + 1) })
    const out: ({ group: NonNullable<OperationRow['group']>; members: OperationRow[] } | { res: string; members: OperationRow[] } | { row: OperationRow })[] = []
    shown.forEach(r => {
      if (!r.group) {
        const k = reservationKey(r)
        if (!k || (resCount.get(k) ?? 0) < 2) return out.push({ row: r })
        if (seenRes.has(k)) return
        seenRes.add(k)
        return out.push({ res: k, members: shown.filter(x => !x.group && reservationKey(x) === k) })
      }
      if (seen.has(r.group.id)) return
      seen.add(r.group.id)
      out.push({ group: r.group, members: shown.filter(x => x.group_id === r.group!.id) })
    })
    return out
  }, [shown])
  const askDelete = (rows: OperationRow[]) => { setDel(rows); setDelError('') }
  const confirmDelete = async () => {
    if (!del) return
    setDelBusy(true); setDelError('')
    try {
      const r = await dataService.deleteOperations(del.map(x => x.id))
      setNotice(`${r.deleted === 1 ? 'Se eliminó 1 registro' : `Se eliminaron ${r.deleted} registros`}.${r.filesNotRemoved ? ` No se pudieron borrar ${r.filesNotRemoved} archivo(s) del almacenamiento; el registro sí se eliminó.` : ''}`)
      if (selected && del.some(x => x.id === selected.id)) setSelected(null)
      setDel(null); reload()
    } catch (e) { setDelError(e instanceof Error ? e.message : 'No se pudo eliminar. No se borró nada.') } finally { setDelBusy(false) }
  }
  const toggle = (id: string) => setCollapsed(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const colSpan = cur.cols.length + 2
  const flight = cur.key === 'flight'

  const line = (r: OperationRow, prefix = '', grouped = false) => (
    <tr key={r.id} onClick={() => setSelected({ id: r.id, edit: false })} className={`cursor-pointer hover:bg-surface2/60 ${grouped ? '[&>td:first-child]:border-l-4 [&>td:first-child]:border-brand/50' : ''}`}>
      {cur.cols.map((c, i) => (
        <td key={c.h} style={c.sticky ? { left: c.sticky } : undefined} className={`td !px-2 !py-1.5 ${flight ? '!whitespace-nowrap' : '!whitespace-normal'} ${c.sticky ? 'lg:sticky lg:z-10 lg:bg-surface' : ''} ${c.h === 'Observación' ? 'max-w-[16rem] truncate' : ''} ${c.right ? 'text-right tabular-nums' : ''} ${c.mono ? 'font-mono text-xs' : ''}`}>
          {i === 0 && prefix && <span className="text-muted">{prefix}</span>}{c.cell(r)}
          {i === 0 && r.missing.length > 0 && <span title={`Faltan: ${r.missing.join(', ')}`} className="mt-1 flex w-fit items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300"><AlertTriangle size={11} />Incompleto</span>}
          {i === 0 && alertByOp.has(r.id) && <span title={`Factura pendiente de cobro · vence ${fdate(alertByOp.get(r.id)!.due_date)}`} className="mt-1 flex w-fit items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-600 dark:text-red-400"><AlertTriangle size={11} />Por cobrar · {fdate(alertByOp.get(r.id)!.due_date)}</span>}
        </td>
      ))}
      <td className="td !px-2 !py-1.5 text-muted">{r.documents.length > 0 && <Paperclip size={14} aria-label="Con documentos" />}</td>
      <td className="td !px-2 !py-1.5 text-muted"><button title="Editar" aria-label="Editar" className="p-1 rounded hover:bg-surface2 hover:text-fg" onClick={e => { e.stopPropagation(); setSelected({ id: r.id, edit: true }) }}><Pencil size={15} /></button>
        <button title="Eliminar" aria-label="Eliminar" className="p-1 rounded hover:bg-red-500/10 hover:text-red-600" onClick={e => { e.stopPropagation(); askDelete([r]) }}><Trash2 size={15} /></button></td>
    </tr>
  )

  const reservation = (it: { res: string; members: OperationRow[] }) => {
    const id = `res:${it.res}`, d0 = it.members[0].details as any, closed = collapsed.has(id)
    return (
      <Fragment key={id}>
        <tr onClick={() => toggle(id)} className="cursor-pointer bg-brand/5 hover:bg-brand/10">
          <td colSpan={colSpan} className="px-2 py-2 text-[13px] font-medium">
            <span className="flex flex-wrap items-center gap-2">{closed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              <span className="rounded bg-brand/15 px-1.5 py-0.5 text-xs text-brand">RESERVA {d0.booking_code}</span>{[d0.airline, d0.route].filter(Boolean).join(' · ')}
              <span className="text-muted font-normal">· {it.members.length} pasajeros · {money(it.members.reduce((a, x) => a + x.charge_amount, 0))} a cobrar · {money(it.members.reduce((a, x) => a + x.amount, 0))} costo</span>
              <button title="Eliminar reserva completa" aria-label="Eliminar reserva completa" className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal text-muted hover:bg-red-500/10 hover:text-red-600" onClick={e => { e.stopPropagation(); askDelete(it.members) }}><Trash2 size={14} />Eliminar reserva</button></span>
            {closed && <span className="mt-1 block pl-6 text-xs font-normal text-muted">{it.members.map(x => `${(x.details as any).names ?? ''} ${(x.details as any).first_surname ?? ''}`.trim() || '—').join('  |  ')}</span>}
          </td>
        </tr>
        {!closed && it.members.map((m, i) => line(m, i === it.members.length - 1 ? '└ ' : '├ ', true))}
      </Fragment>
    )
  }

  return (
    <>
      <PageHeader title={sec?.title ?? 'Registros'} subtitle={`${shown.length} registros`}
        actions={sec && <Link to={`${sec.path}/nuevo`} className="btn-primary"><Plus size={16} />{sec.newLabel}</Link>} />
      {notice && <p role="status" className="mb-4 rounded-lg border border-line bg-surface2 p-3 text-sm">{notice}</p>}
      <FilterBar search={f.search ?? ''} onSearch={v => setF(p => ({ ...p, search: v }))} active={Object.entries(f).filter(([k, x]) => k !== 'search' && x).length}>
        <div className="md:w-48"><Select value={f.company_id} onChange={set('company_id')}><option value="">Todas las empresas</option>{companies?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        {!section && <div className="md:w-44"><Select value={f.type ?? ''} onChange={set('type')}><option value="">Todos los tipos</option>{SERVICE_TYPES.map(t => <option key={t} value={t}>{SERVICE_LABEL[t]}</option>)}</Select></div>}
        <div className="md:w-48"><Select value={f.provider ?? ''} onChange={set('provider')}><option value="">Aerolínea / proveedor</option>{providers?.map(p => <option key={p}>{p}</option>)}</Select></div>
        <input type="date" className="input md:!w-40" value={f.date ?? ''} onChange={set('date')} aria-label="Fecha" />
        <div className="md:w-24"><Select value={f.year ?? ''} onChange={set('year')}><option value="">Año</option>{['2025', '2026'].map(y => <option key={y}>{y}</option>)}</Select></div>
        <div className="md:w-36 col-span-2 md:col-span-1"><Select value={f.month ?? ''} onChange={set('month')}><option value="">Mes</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</Select></div>
        <div className="col-span-2 grid grid-cols-2 gap-2 md:contents">
          {(!section || section === 'loan' || section === 'flight') && (
            <button type="button" onClick={() => setF(p => ({ ...p, incomplete: !p.incomplete }))} className={`btn border ${f.incomplete ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300' : 'bg-surface border-line text-muted hover:text-fg'}`}><AlertTriangle size={14} />Incompletos</button>
          )}
          <button type="button" className="btn-ghost" onClick={() => { setF({}); setParams({}) }}><FilterX size={14} />Limpiar filtros</button>
        </div>
      </FilterBar>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : shown.length === 0 ? <Empty>No hay registros con estos filtros.</Empty> : (
          <div className={`overflow-auto ${flight ? 'max-h-[72vh]' : ''}`}><table className={`w-full text-[13px] ${flight ? 'min-w-max' : ''}`}>
            <thead><tr className="border-b border-line bg-surface2/50">{cur.cols.map(c => <th key={c.h} style={c.sticky ? { left: c.sticky } : undefined} className={`th !px-2 ${c.right ? 'text-right' : ''} ${flight ? `${c.sticky ? 'lg:sticky lg:top-0 lg:z-20' : 'sticky top-0 z-10'} bg-surface2` : ''}`}>{c.h}</th>)}<th className={`th !px-2 ${flight ? 'sticky top-0 z-10 bg-surface2' : ''}`}>Doc.</th><th className={`th !px-2 ${flight ? 'sticky top-0 z-10 bg-surface2' : ''}`}>Acciones</th></tr></thead>
            <tbody className="divide-y divide-line">{items.map(it => 'row' in it ? line(it.row) : 'res' in it ? reservation(it) : (
              <Fragment key={it.group.id}>
                <tr onClick={() => toggle(it.group.id)} className="cursor-pointer bg-brand/5 hover:bg-brand/10">
                  <td colSpan={colSpan} className="px-2 py-2 text-[13px] font-medium">
                    <span className="flex items-center gap-2">{collapsed.has(it.group.id) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      <span className="rounded bg-brand/15 px-1.5 py-0.5 text-xs text-brand">GRUPO {it.group.code}</span>{it.group.label}
                      <span className="text-muted font-normal">· {it.members.length} registros · {money(it.members.reduce((a, x) => a + x.charge_amount, 0))} a cobrar</span></span>
                    {collapsed.has(it.group.id) && <span className="mt-1 block pl-6 text-xs font-normal text-muted">{it.members.map(x => `${SERVICE_LABEL[x.type]} · ${summary(x).client || summary(x).route || x.provider}`).join('  |  ')}</span>}
                  </td>
                </tr>
                {!collapsed.has(it.group.id) && it.members.map((m, i) => line(m, i === it.members.length - 1 ? '└ ' : '├ ', true))}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <DeleteDialog open={!!del} title={del && del.length > 1 ? 'Eliminar reserva completa' : 'Eliminar registro'} busy={delBusy} error={delError} onCancel={() => setDel(null)} onConfirm={confirmDelete}>
        {del?.map(r => {
          const s = summary(r)
          return <p key={r.id} className="py-0.5"><b>{SERVICE_LABEL[r.type]}</b> · {fdate(r.date)} · {r.company_name} · {s.client || s.route || r.provider || '—'}{s.booking ? ` · ${s.booking}` : ''} · {money(r.charge_amount)}</p>
        })}
        {del && del.length > 1 && <p className="mt-2 text-muted">Se eliminarán los {del.length} pasajeros de esta reserva.</p>}
        {del?.length === 1 && reservationKey(del[0]) && (rows ?? []).some(x => x.id !== del[0].id && reservationKey(x) === reservationKey(del[0])) && <p className="mt-2 text-muted">Pertenece a una reserva con más pasajeros: los demás conservan sus valores y no se modifican.</p>}
      </DeleteDialog>
      <ServiceDetail id={selected?.id ?? null} startEdit={selected?.edit} onClose={() => setSelected(null)} onChanged={reload} onNavigate={id => setSelected({ id, edit: false })} />
    </>
  )
}
