import { useMemo, useState, type FormEvent } from 'react'
import { FilterX, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Empty, FilterBar, Modal, Select, Spinner, TextInput } from '../../components/ui'
import { fdate, money } from '../../lib/format'
import { isOverdue, monthInputToPeriod, periodToMonthInput, today } from '../../lib/leaseCalc'
import { leases } from '../../services/leases'
import { LEASE_CATEGORIES, LEASE_CATEGORY_LABEL, PAY_STATUS_LABEL, type LeaseCategory, type LeaseExpense, type LeaseExpenseInput, type LeaseSnapshot } from '../../types/lease'
import { PaymentsModal } from './PaymentsModal'
import { errMsg, FilesField, OverdueTag, Pager, StatusPill, toNum, uploadPending, usePaged, type PendingFile } from './shared'

const blank = (): LeaseExpenseInput => ({ space_id: null, category: 'rent', concept: '', beneficiary: '', amount: 0, expense_date: today(), period: monthInputToPeriod(today().slice(0, 7)), due_date: null, notes: '' })

export function Expenses({ operationId, snap }: { operationId: string; snap: LeaseSnapshot }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [space, setSpace] = useState('')
  const [status, setStatus] = useState('')
  const [month, setMonth] = useState('')
  const [editing, setEditing] = useState<LeaseExpense | 'new' | null>(null)
  const [f, setF] = useState<LeaseExpenseInput>(blank())
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<LeaseExpense | null>(null)
  const [deleting, setDeleting] = useState<LeaseExpense | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')

  const spaceName = (id: string | null) => (id ? snap.spaces.find(s => s.id === id)?.name ?? '—' : 'General SLB')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return snap.expenses.filter(e => (!cat || e.category === cat) && (!status || e.payment_status === status) && (!month || e.period.slice(0, 7) === month)
      && (!space || (space === 'none' ? !e.space_id : e.space_id === space)) && (!s || `${e.concept} ${e.beneficiary} ${e.notes}`.toLowerCase().includes(s)))
  }, [snap.expenses, q, cat, space, status, month])
  const page = usePaged(rows, 20, `${q}|${cat}|${space}|${status}|${month}`)
  const totals = { amount: rows.reduce((a, e) => a + e.amount, 0), paid: rows.reduce((a, e) => a + e.paid, 0), balance: rows.reduce((a, e) => a + e.balance, 0) }

  const open = (e: LeaseExpense | 'new') => {
    setF(e === 'new' ? blank() : { space_id: e.space_id, category: e.category, concept: e.concept, beneficiary: e.beneficiary, amount: e.amount, expense_date: e.expense_date, period: e.period, due_date: e.due_date, notes: e.notes })
    setPending([]); setError(''); setEditing(e)
  }
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!f.concept.trim()) return setError('Escribe el concepto del gasto.')
    if (!(f.amount > 0)) return setError('El valor debe ser mayor a cero.')
    if (!f.expense_date || !f.period) return setError('Indica la fecha del gasto y el periodo al que corresponde.')
    setBusy(true); setError('')
    try {
      const saved = await leases.saveExpense(operationId, f, editing && editing !== 'new' ? editing.id : undefined)
      const warn = await uploadPending('expense', saved.id, pending)
      if (warn) { setError(warn); setEditing(saved); setPending([]) } else setEditing(null)
    } catch (err) { setError(errMsg(err, 'No se pudo guardar el gasto.')) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await leases.deleteExpense(deleting.id); await leases.processCleanup(); setDeleting(null) } catch (e) { setDelError(errMsg(e, 'No se pudo eliminar el gasto.')) } finally { setDelBusy(false) }
  }
  const active = [cat, space, status, month].filter(Boolean).length

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-muted">Gastos y obligaciones de la operación. Los pagos parciales no modifican el valor original.</p><button className="btn-primary" onClick={() => open('new')}><Plus size={16} />Nuevo gasto</button></div>
      <FilterBar search={q} onSearch={setQ} active={active}>
        <div className="md:w-44"><Select value={cat} onChange={e => setCat(e.target.value)} aria-label="Categoría"><option value="">Todas las categorías</option>{LEASE_CATEGORIES.map(c => <option key={c} value={c}>{LEASE_CATEGORY_LABEL[c]}</option>)}</Select></div>
        <div className="md:w-44"><Select value={space} onChange={e => setSpace(e.target.value)} aria-label="Espacio"><option value="">Todos los espacios</option><option value="none">General SLB</option>{snap.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div className="md:w-40"><Select value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado"><option value="">Todos los estados</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option></Select></div>
        <input type="month" className="input md:!w-40" aria-label="Periodo" value={month} onChange={e => setMonth(e.target.value)} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => { setQ(''); setCat(''); setSpace(''); setStatus(''); setMonth('') }}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>
      <div className="card overflow-hidden">
        {rows.length === 0 ? <Empty>{snap.expenses.length ? 'No hay gastos con estos filtros.' : 'Aún no hay gastos registrados.'}</Empty> : (
          <>
            <div className="overflow-x-auto"><table className="w-full text-[13px]">
              <thead><tr className="border-b border-line bg-surface2/50">{['Fecha', 'Periodo', 'Categoría', 'Concepto', 'Beneficiario', 'Espacio', 'Valor', 'Pagado', 'Saldo', 'Estado', ''].map((h, i) => <th key={i} className={`th !px-3 ${i >= 6 && i <= 8 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{page.rows.map(e => (
                <tr key={e.id} className="hover:bg-surface2/60">
                  <td className="td !px-3">{fdate(e.expense_date)}</td><td className="td !px-3">{periodToMonthInput(e.period)}</td><td className="td !px-3">{LEASE_CATEGORY_LABEL[e.category]}</td>
                  <td className="td !px-3 !whitespace-normal font-medium">{e.concept}{e.due_date && <span className="block text-[11px] font-normal text-muted">Vence {fdate(e.due_date)}</span>}</td>
                  <td className="td !px-3">{e.beneficiary || '—'}</td><td className="td !px-3">{spaceName(e.space_id)}</td>
                  <td className="td !px-3 text-right tabular-nums">{money(e.amount)}</td><td className="td !px-3 text-right tabular-nums">{money(e.paid)}</td><td className="td !px-3 text-right tabular-nums font-medium">{money(e.balance)}</td>
                  <td className="td !px-3"><StatusPill status={e.payment_status} label={PAY_STATUS_LABEL[e.payment_status]} extra={isOverdue(e.due_date, e.balance) && <OverdueTag />} /></td>
                  <td className="td !px-3"><div className="flex justify-end gap-1">
                    <button className="btn-ghost !px-2" title="Pagos" onClick={() => setPaying(e)}><Wallet size={14} /></button>
                    <button className="btn-ghost !px-2" title="Editar y archivos" onClick={() => open(e)}><Pencil size={14} /></button>
                    <button className="btn-ghost !px-2 text-red-600 dark:text-red-400" title="Eliminar" onClick={() => { setDelError(''); setDeleting(e) }}><Trash2 size={14} /></button></div></td>
                </tr>))}</tbody>
              <tfoot><tr className="border-t border-line bg-surface2/50 font-semibold"><td className="td !px-3" colSpan={6}>Total filtrado</td><td className="td !px-3 text-right tabular-nums">{money(totals.amount)}</td><td className="td !px-3 text-right tabular-nums">{money(totals.paid)}</td><td className="td !px-3 text-right tabular-nums">{money(totals.balance)}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
            <Pager {...page} />
          </>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo gasto' : 'Editar gasto'}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Categoría *" value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value as LeaseCategory }))}>{LEASE_CATEGORIES.map(c => <option key={c} value={c}>{LEASE_CATEGORY_LABEL[c]}</option>)}</Select>
            <Select label="Espacio" value={f.space_id ?? ''} onChange={e => setF(p => ({ ...p, space_id: e.target.value || null }))}><option value="">General SLB (sin espacio)</option>{snap.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </div>
          <TextInput label={f.category === 'additional' ? 'Concepto * (mantenimiento, reparaciones, compras, adecuaciones…)' : 'Concepto *'} value={f.concept} maxLength={400} onChange={e => setF(p => ({ ...p, concept: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Beneficiario / proveedor" value={f.beneficiary} maxLength={200} onChange={e => setF(p => ({ ...p, beneficiary: e.target.value }))} />
            <TextInput label="Valor *" type="number" min={0} step="any" value={f.amount || ''} onChange={e => setF(p => ({ ...p, amount: toNum(e.target.value) ?? 0 }))} />
            <TextInput label="Fecha del gasto *" type="date" value={f.expense_date} onChange={e => setF(p => ({ ...p, expense_date: e.target.value, period: p.period || monthInputToPeriod(e.target.value.slice(0, 7)) }))} />
            <TextInput label="Periodo al que corresponde *" type="month" value={periodToMonthInput(f.period)} onChange={e => setF(p => ({ ...p, period: e.target.value ? monthInputToPeriod(e.target.value) : '' }))} />
            <TextInput label="Fecha de vencimiento" type="date" value={f.due_date ?? ''} onChange={e => setF(p => ({ ...p, due_date: e.target.value || null }))} />
          </div>
          <div><label className="label">Observaciones</label><textarea className="input min-h-16" maxLength={4000} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></div>
          <FilesField type="expense" id={editing && editing !== 'new' ? editing.id : undefined} defaultKind={f.category === 'payroll' ? 'payroll' : 'invoice'} kinds={['invoice', 'receipt', 'payroll', 'contract', 'other']} pending={pending} onPending={setPending} />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cerrar</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button></div>
        </form>
      </Modal>
      <PaymentsModal open={!!paying} onClose={() => setPaying(null)} kind="expense" parentId={paying?.id ?? null} title={`Pagos · ${paying?.concept ?? ''}`} total={snap.expenses.find(x => x.id === paying?.id)?.amount ?? paying?.amount ?? 0} />
      <ConfirmDialog open={!!deleting} title="Eliminar gasto" confirmLabel="Eliminar gasto" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará el gasto <b>{deleting?.concept}</b> ({money(deleting?.amount)}) junto con sus <b>pagos registrados</b> y todos los archivos adjuntos. No se puede recuperar.</p>
      </ConfirmDialog>
    </>
  )
}
