import { useMemo, useState, type FormEvent } from 'react'
import { Ban, FilterX, Pencil, Plus, RotateCcw, Trash2, Wallet } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Empty, FilterBar, Modal, Select, Spinner, TextInput } from '../../components/ui'
import { fdate, money, MONTHS } from '../../lib/format'
import { isOverdue, today } from '../../lib/leaseCalc'
import { leases } from '../../services/leases'
import { INVOICE_STATUS_LABEL, type LeaseInvoice, type LeaseInvoiceInput, type LeaseSnapshot } from '../../types/lease'
import { PaymentsModal } from './PaymentsModal'
import { errMsg, FilesField, OverdueTag, Pager, StatusPill, toNum, uploadPending, usePaged, type PendingFile } from './shared'

const blank = (): LeaseInvoiceInput => {
  const d = new Date()
  return { space_id: null, customer_name: '', invoice_number: '', issue_date: today(), period_year: d.getFullYear(), period_month: d.getMonth() + 1, due_date: null, concept: '', subtotal: null, tax: null, total: 0, notes: '' }
}
const periodText = (i: Pick<LeaseInvoiceInput, 'period_year' | 'period_month'>) => `${MONTHS[i.period_month - 1]?.slice(0, 3)} ${i.period_year}`

export function Invoices({ operationId, snap }: { operationId: string; snap: LeaseSnapshot }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [space, setSpace] = useState('')
  const [month, setMonth] = useState('')
  const [editing, setEditing] = useState<LeaseInvoice | 'new' | null>(null)
  const [f, setF] = useState<LeaseInvoiceInput>(blank())
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<LeaseInvoice | null>(null)
  const [deleting, setDeleting] = useState<LeaseInvoice | null>(null)
  const [voiding, setVoiding] = useState<LeaseInvoice | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')

  const spaceName = (id: string | null) => (id ? snap.spaces.find(s => s.id === id)?.name ?? '—' : '—')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return snap.invoices.filter(i => (!status || i.payment_status === status) && (!month || `${i.period_year}-${String(i.period_month).padStart(2, '0')}` === month)
      && (!space || i.space_id === space) && (!s || `${i.customer_name} ${i.invoice_number} ${i.concept}`.toLowerCase().includes(s)))
  }, [snap.invoices, q, status, space, month])
  const page = usePaged(rows, 20, `${q}|${status}|${space}|${month}`)
  const live = rows.filter(i => i.status !== 'void')
  const totals = { total: live.reduce((a, i) => a + i.total, 0), received: live.reduce((a, i) => a + i.received, 0), balance: live.reduce((a, i) => a + i.balance, 0) }

  const open = (i: LeaseInvoice | 'new') => {
    setF(i === 'new' ? blank() : { space_id: i.space_id, customer_name: i.customer_name, invoice_number: i.invoice_number, issue_date: i.issue_date, period_year: i.period_year, period_month: i.period_month, due_date: i.due_date, concept: i.concept, subtotal: i.subtotal, tax: i.tax, total: i.total, notes: i.notes })
    setPending([]); setError(''); setEditing(i)
  }
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!f.customer_name.trim()) return setError('Escribe el cliente.')
    if (!f.invoice_number.trim()) return setError('Escribe el número de factura.')
    if (!(f.total > 0)) return setError('El valor total debe ser mayor a cero.')
    const id = editing && editing !== 'new' ? editing.id : undefined
    const dup = snap.invoices.find(i => i.id !== id && i.invoice_number.trim().toLowerCase() === f.invoice_number.trim().toLowerCase())
    if (dup) return setError(`Ya existe la factura ${dup.invoice_number} (${dup.customer_name}) en esta operación.`)
    setBusy(true); setError('')
    try {
      const saved = await leases.saveInvoice(operationId, f, id)
      const warn = await uploadPending('invoice', saved.id, pending)
      if (warn) { setError(warn); setEditing(saved); setPending([]) } else setEditing(null)
    } catch (err) { setError(errMsg(err, 'No se pudo guardar la factura.')) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await leases.deleteInvoice(deleting.id); await leases.processCleanup(); setDeleting(null) } catch (e) { setDelError(errMsg(e, 'No se pudo eliminar la factura.')) } finally { setDelBusy(false) }
  }
  const confirmVoid = async () => {
    if (!voiding) return
    setDelBusy(true); setDelError('')
    try { await leases.setInvoiceVoid(voiding.id, voiding.status !== 'void'); setVoiding(null) } catch (e) { setDelError(errMsg(e, 'No se pudo cambiar el estado.')) } finally { setDelBusy(false) }
  }
  const active = [status, space, month].filter(Boolean).length
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i)

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-muted">Facturas mensuales emitidas a clientes. Una factura solo cuenta como recibida cuando registras sus pagos.</p><button className="btn-primary" onClick={() => open('new')}><Plus size={16} />Nueva factura</button></div>
      <FilterBar search={q} onSearch={setQ} active={active}>
        <div className="md:w-44"><Select value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado"><option value="">Todos los estados</option>{(Object.keys(INVOICE_STATUS_LABEL) as (keyof typeof INVOICE_STATUS_LABEL)[]).map(k => <option key={k} value={k}>{INVOICE_STATUS_LABEL[k]}</option>)}</Select></div>
        <div className="md:w-44"><Select value={space} onChange={e => setSpace(e.target.value)} aria-label="Espacio"><option value="">Todos los espacios</option>{snap.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <input type="month" className="input md:!w-40" aria-label="Periodo facturado" value={month} onChange={e => setMonth(e.target.value)} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => { setQ(''); setStatus(''); setSpace(''); setMonth('') }}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>
      <div className="card overflow-hidden">
        {rows.length === 0 ? <Empty>{snap.invoices.length ? 'No hay facturas con estos filtros.' : 'Aún no hay facturas registradas.'}</Empty> : (
          <>
            <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr className="border-b border-line bg-surface2/50">{['Número', 'Cliente', 'Espacio', 'Periodo', 'Emisión', 'Vence', 'Total', 'Recibido', 'Saldo', 'Estado', ''].map((h, i) => <th key={i} className={`th !px-3 ${i >= 6 && i <= 8 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{page.rows.map(i => (
                <tr key={i.id} className={`hover:bg-surface2/60 ${i.status === 'void' ? 'opacity-60' : ''}`}>
                  <td className="td !px-3 font-medium">{i.invoice_number}</td><td className="td !px-3 !whitespace-normal">{i.customer_name}{i.concept && <span className="block text-[11px] text-muted">{i.concept}</span>}</td><td className="td !px-3">{spaceName(i.space_id)}</td>
                  <td className="td !px-3">{periodText(i)}</td><td className="td !px-3">{fdate(i.issue_date)}</td><td className="td !px-3">{fdate(i.due_date ?? undefined)}</td>
                  <td className="td !px-3 text-right tabular-nums">{money(i.total)}</td><td className="td !px-3 text-right tabular-nums">{money(i.received)}</td><td className="td !px-3 text-right tabular-nums font-medium">{i.status === 'void' ? '—' : money(i.balance)}</td>
                  <td className="td !px-3"><StatusPill status={i.payment_status} label={INVOICE_STATUS_LABEL[i.payment_status]} extra={i.status !== 'void' && isOverdue(i.due_date, i.balance) && <OverdueTag />} /></td>
                  <td className="td !px-3"><div className="flex justify-end gap-1">
                    {i.status !== 'void' && <button className="btn-ghost !px-2" title="Pagos recibidos" onClick={() => setPaying(i)}><Wallet size={14} /></button>}
                    <button className="btn-ghost !px-2" title="Editar y archivos" onClick={() => open(i)}><Pencil size={14} /></button>
                    <button className="btn-ghost !px-2" title={i.status === 'void' ? 'Reactivar' : 'Anular'} onClick={() => { setDelError(''); setVoiding(i) }}>{i.status === 'void' ? <RotateCcw size={14} /> : <Ban size={14} />}</button>
                    <button className="btn-ghost !px-2 text-red-600 dark:text-red-400" title="Eliminar" onClick={() => { setDelError(''); setDeleting(i) }}><Trash2 size={14} /></button></div></td>
                </tr>))}</tbody>
              <tfoot><tr className="border-t border-line bg-surface2/50 font-semibold"><td className="td !px-3" colSpan={6}>Total filtrado (sin anuladas)</td><td className="td !px-3 text-right tabular-nums">{money(totals.total)}</td><td className="td !px-3 text-right tabular-nums">{money(totals.received)}</td><td className="td !px-3 text-right tabular-nums">{money(totals.balance)}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
            <Pager {...page} />
          </>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nueva factura' : 'Editar factura'}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Cliente *" value={f.customer_name} maxLength={200} onChange={e => setF(p => ({ ...p, customer_name: e.target.value }))} />
            <TextInput label="Número de factura *" value={f.invoice_number} maxLength={60} onChange={e => setF(p => ({ ...p, invoice_number: e.target.value }))} />
            <Select label="Espacio" value={f.space_id ?? ''} onChange={e => setF(p => ({ ...p, space_id: e.target.value || null }))}><option value="">Sin espacio</option>{snap.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <TextInput label="Fecha de emisión *" type="date" value={f.issue_date} onChange={e => setF(p => ({ ...p, issue_date: e.target.value }))} />
            <Select label="Mes facturado *" value={f.period_month} onChange={e => setF(p => ({ ...p, period_month: Number(e.target.value) }))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
            <Select label="Año facturado *" value={f.period_year} onChange={e => setF(p => ({ ...p, period_year: Number(e.target.value) }))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select>
            <TextInput label="Fecha de vencimiento" type="date" value={f.due_date ?? ''} onChange={e => setF(p => ({ ...p, due_date: e.target.value || null }))} />
          </div>
          <TextInput label="Concepto" value={f.concept} maxLength={400} onChange={e => setF(p => ({ ...p, concept: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <TextInput label="Valor antes de impuestos" type="number" min={0} step="any" value={f.subtotal ?? ''} onChange={e => setF(p => ({ ...p, subtotal: toNum(e.target.value) }))} />
            <TextInput label="Impuestos" type="number" min={0} step="any" value={f.tax ?? ''} onChange={e => setF(p => ({ ...p, tax: toNum(e.target.value) }))} />
            <TextInput label="Valor total *" type="number" min={0} step="any" value={f.total || ''} onChange={e => setF(p => ({ ...p, total: toNum(e.target.value) ?? 0 }))} />
          </div>
          <p className="text-xs text-muted">Se guardan exactamente los valores que escribas: el sistema no calcula ni impone impuestos.</p>
          <div><label className="label">Observaciones</label><textarea className="input min-h-16" maxLength={4000} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></div>
          <FilesField type="invoice" id={editing && editing !== 'new' ? editing.id : undefined} defaultKind="invoice" kinds={['invoice', 'receipt', 'contract', 'other']} pending={pending} onPending={setPending} label="Archivo de la factura" />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cerrar</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button></div>
        </form>
      </Modal>
      <PaymentsModal open={!!paying} onClose={() => setPaying(null)} kind="customer" parentId={paying?.id ?? null} title={`Pagos recibidos · ${paying?.invoice_number ?? ''}`} total={snap.invoices.find(x => x.id === paying?.id)?.total ?? paying?.total ?? 0} />
      <ConfirmDialog open={!!voiding} title={voiding?.status === 'void' ? 'Reactivar factura' : 'Anular factura'} confirmLabel={voiding?.status === 'void' ? 'Reactivar' : 'Anular factura'} danger={voiding?.status !== 'void'} busy={delBusy} error={delError} onCancel={() => setVoiding(null)} onConfirm={confirmVoid}>
        <p>{voiding?.status === 'void' ? <>La factura <b>{voiding?.invoice_number}</b> volverá a contar en la facturación.</> : <>La factura <b>{voiding?.invoice_number}</b> dejará de contar como facturada y no admitirá pagos. Si ya tiene pagos registrados, primero debes eliminarlos.</>}</p>
      </ConfirmDialog>
      <ConfirmDialog open={!!deleting} title="Eliminar factura" confirmLabel="Eliminar factura" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará la factura <b>{deleting?.invoice_number}</b> ({money(deleting?.total)}) con todos sus <b>pagos registrados</b> y archivos adjuntos. No se puede recuperar. Si solo quieres que no cuente, usa «Anular».</p>
      </ConfirmDialog>
    </>
  )
}
