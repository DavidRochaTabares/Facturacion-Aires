import { useMemo, useState, type FormEvent } from 'react'
import { FilterX, Pencil, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Empty, FilterBar, Modal, Select, Spinner, TextInput } from '../../components/ui'
import { fdate, money } from '../../lib/format'
import { monthInputToPeriod, periodToMonthInput, today } from '../../lib/leaseCalc'
import { leases } from '../../services/leases'
import { PAY_METHODS, type LeaseSnapshot, type SlbPayment, type SlbPaymentInput } from '../../types/lease'
import { BankLink, errMsg, FilesField, Pager, ReconciledTag, toNum, uploadPending, usePaged, type PendingFile } from './shared'

const blank = (): SlbPaymentInput => ({ received_at: today(), period: monthInputToPeriod(today().slice(0, 7)), concept: '', amount: 0, method: PAY_METHODS[0], bank_account: '', reference: '', notes: '', bank_movement_id: null })

/** Money that Aires y Destinos RECEIVES from SLB: an independent income source, never assumed to belong to a customer invoice. */
export function SlbPayments({ operationId, snap }: { operationId: string; snap: LeaseSnapshot }) {
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')
  const [editing, setEditing] = useState<SlbPayment | 'new' | null>(null)
  const [f, setF] = useState<SlbPaymentInput>(blank())
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<SlbPayment | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return snap.slbPayments.filter(p => (!month || p.period.slice(0, 7) === month) && (!s || `${p.concept} ${p.reference} ${p.bank_account} ${p.notes}`.toLowerCase().includes(s)))
  }, [snap.slbPayments, q, month])
  const page = usePaged(rows, 20, `${q}|${month}`)
  const total = rows.reduce((a, p) => a + p.amount, 0)

  const open = (p: SlbPayment | 'new') => {
    setF(p === 'new' ? blank() : { received_at: p.received_at, period: p.period, concept: p.concept, amount: p.amount, method: p.method, bank_account: p.bank_account, reference: p.reference, notes: p.notes, bank_movement_id: p.bank_movement_id })
    setPending([]); setError(''); setEditing(p)
  }
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!f.concept.trim()) return setError('Escribe el concepto.')
    if (!(f.amount > 0)) return setError('El valor recibido debe ser mayor a cero.')
    if (!f.received_at || !f.period) return setError('Indica la fecha de recepción y el periodo.')
    setBusy(true); setError('')
    try {
      const saved = await leases.saveSlbPayment(operationId, f, editing && editing !== 'new' ? editing.id : undefined)
      const warn = await uploadPending('slb_payment', saved.id, pending)
      if (warn) { setError(warn); setEditing(saved); setPending([]) } else setEditing(null)
    } catch (err) { setError(errMsg(err, 'No se pudo guardar el pago.')) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await leases.deleteSlbPayment(deleting.id); await leases.processCleanup(); setDeleting(null) } catch (e) { setDelError(errMsg(e, 'No se pudo eliminar el pago.')) } finally { setDelBusy(false) }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Dinero que Aires y Destinos <b>recibe de SLB</b>. Es un ingreso independiente: no se relaciona con las facturas de clientes ni con los pagos que Aires hace por el arriendo.</p>
        <button className="btn-primary shrink-0" onClick={() => open('new')}><Plus size={16} />Nuevo pago de SLB</button>
      </div>
      <FilterBar search={q} onSearch={setQ} active={month ? 1 : 0}>
        <input type="month" className="input md:!w-40" aria-label="Periodo" value={month} onChange={e => setMonth(e.target.value)} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => { setQ(''); setMonth('') }}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>
      <div className="card overflow-hidden">
        {rows.length === 0 ? <Empty>{snap.slbPayments.length ? 'No hay pagos con estos filtros.' : 'Aún no hay pagos de SLB registrados.'}</Empty> : (
          <>
            <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr className="border-b border-line bg-surface2/50">{['Recibido', 'Periodo', 'Concepto', 'Medio', 'Cuenta destino', 'Referencia', 'Valor', ''].map((h, i) => <th key={i} className={`th !px-3 ${i === 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{page.rows.map(p => (
                <tr key={p.id} className="hover:bg-surface2/60">
                  <td className="td !px-3">{fdate(p.received_at)}</td><td className="td !px-3">{periodToMonthInput(p.period)}</td>
                  <td className="td !px-3 !whitespace-normal font-medium">{p.concept} {p.bank_movement_id && <ReconciledTag />}</td>
                  <td className="td !px-3">{p.method || '—'}</td><td className="td !px-3">{p.bank_account || '—'}</td><td className="td !px-3">{p.reference || '—'}</td>
                  <td className="td !px-3 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{money(p.amount)}</td>
                  <td className="td !px-3"><div className="flex justify-end gap-1">
                    <button className="btn-ghost !px-2" title="Editar y soportes" onClick={() => open(p)}><Pencil size={14} /></button>
                    <button className="btn-ghost !px-2 text-red-600 dark:text-red-400" title="Eliminar" onClick={() => { setDelError(''); setDeleting(p) }}><Trash2 size={14} /></button></div></td>
                </tr>))}</tbody>
              <tfoot><tr className="border-t border-line bg-surface2/50 font-semibold"><td className="td !px-3" colSpan={6}>Total filtrado</td><td className="td !px-3 text-right tabular-nums">{money(total)}</td><td /></tr></tfoot>
            </table></div>
            <Pager {...page} />
          </>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo pago recibido de SLB' : 'Editar pago de SLB'}>
        <form onSubmit={submit} className="space-y-3">
          <p className="rounded-lg bg-surface2 px-3 py-2 text-xs text-muted">Operación: <b>SLB</b> · ingreso recibido por Aires y Destinos.</p>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Fecha de recepción *" type="date" value={f.received_at} onChange={e => setF(p => ({ ...p, received_at: e.target.value }))} />
            <TextInput label="Periodo al que corresponde *" type="month" value={periodToMonthInput(f.period)} onChange={e => setF(p => ({ ...p, period: e.target.value ? monthInputToPeriod(e.target.value) : '' }))} />
            <TextInput label="Valor recibido *" type="number" min={0} step="any" value={f.amount || ''} onChange={e => setF(p => ({ ...p, amount: toNum(e.target.value) ?? 0 }))} />
            <Select label="Medio de pago" value={f.method} onChange={e => setF(p => ({ ...p, method: e.target.value }))}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</Select>
            <TextInput label="Cuenta bancaria de destino" value={f.bank_account} maxLength={120} onChange={e => setF(p => ({ ...p, bank_account: e.target.value }))} />
            <TextInput label="Referencia o comprobante" value={f.reference} maxLength={200} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} />
          </div>
          <TextInput label="Concepto *" value={f.concept} maxLength={400} onChange={e => setF(p => ({ ...p, concept: e.target.value }))} />
          <div><label className="label">Observaciones</label><textarea className="input min-h-16" maxLength={4000} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></div>
          <BankLink direction="income" value={f.bank_movement_id} onChange={id => setF(p => ({ ...p, bank_movement_id: id }))} />
          <FilesField type="slb_payment" id={editing && editing !== 'new' ? editing.id : undefined} defaultKind="payment_proof" kinds={['payment_proof', 'receipt', 'other']} pending={pending} onPending={setPending} label="Soporte del pago" />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cerrar</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button></div>
        </form>
      </Modal>
      <ConfirmDialog open={!!deleting} title="Eliminar pago de SLB" confirmLabel="Eliminar pago" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará el pago de <b>{money(deleting?.amount)}</b> del {fdate(deleting?.received_at)} y sus soportes. Los totales del módulo se recalcularán.</p>
      </ConfirmDialog>
    </>
  )
}
