import { useEffect, useState, type FormEvent } from 'react'
import { ChevronDown, Paperclip, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Loading, Modal, Select, Spinner, TextInput } from '../../components/ui'
import { useAsync } from '../../hooks'
import { fdate, money } from '../../lib/format'
import { today } from '../../lib/leaseCalc'
import { leases } from '../../services/leases'
import { PAY_METHODS, type CustomerPayment, type ExpensePayment } from '../../types/lease'
import { BankLink, errMsg, FilesField, ReconciledTag, uploadPending, type PendingFile } from './shared'

type Pay = ExpensePayment | CustomerPayment

/** Partial payments of an expense (money paid out) or of a customer invoice (money received). The original value is never overwritten; balance = value - payments. */
export function PaymentsModal({ open, onClose, kind, parentId, title, total }: { open: boolean; onClose: () => void; kind: 'expense' | 'customer'; parentId: string | null; title: string; total: number }) {
  const { data, loading, reload } = useAsync(() => (parentId ? leases.payments(kind, parentId) : Promise.resolve([] as Pay[])), [kind, parentId])
  const paid = (data ?? []).reduce((a, p) => a + p.amount, 0)
  const balance = total - paid
  const blank = () => ({ paid_at: today(), amount: '', method: PAY_METHODS[0], reference: '', notes: '', bank_movement_id: null as string | null })
  const [f, setF] = useState(blank())
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<Pay | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [openFiles, setOpenFiles] = useState<string | null>(null)
  const money_ = kind === 'expense' ? 'Pagado' : 'Recibido'

  useEffect(() => { if (open) { setF({ ...blank(), amount: '' }); setPending([]); setError(''); setOpenFiles(null) } }, [open, parentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && data && f.amount === '' && balance > 0) setF(p => ({ ...p, amount: String(balance) })) }, [open, data]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const amount = Number(f.amount)
    if (!parentId) return
    if (!f.paid_at) return setError('Indica la fecha del pago.')
    if (!(amount > 0)) return setError('El valor del pago debe ser mayor a cero.')
    if (amount > balance) return setError(`El pago supera el saldo pendiente (${money(balance)}).`)
    setBusy(true); setError('')
    try {
      const p = await leases.savePayment(kind, parentId, { paid_at: f.paid_at, amount, method: f.method, reference: f.reference, notes: f.notes, bank_movement_id: f.bank_movement_id })
      const warn = await uploadPending(kind === 'expense' ? 'expense_payment' : 'customer_payment', p.id, pending)
      setPending([]); setF({ ...blank(), amount: '' }); reload()
      if (warn) setError(warn)
    } catch (err) { setError(errMsg(err, 'No se pudo registrar el pago.')) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await leases.deletePayment(kind, deleting.id); await leases.processCleanup(); setDeleting(null); setF(p => ({ ...p, amount: '' })); reload() } catch (e) { setDelError(errMsg(e, 'No se pudo eliminar el pago.')) } finally { setDelBusy(false) }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={title}>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-surface2 p-2"><p className="text-[11px] text-muted">Valor total</p><p className="font-semibold tabular-nums">{money(total)}</p></div>
            <div className="rounded-lg bg-surface2 p-2"><p className="text-[11px] text-muted">{money_}</p><p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(paid)}</p></div>
            <div className="rounded-lg bg-surface2 p-2"><p className="text-[11px] text-muted">Saldo pendiente</p><p className={`font-semibold tabular-nums ${balance > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{money(balance)}</p></div>
          </div>

          {loading && !data ? <Loading /> : (data ?? []).length === 0 ? <p className="text-muted">Aún no hay pagos registrados.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line">{data!.map(p => (
              <li key={p.id} className="p-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><p className="font-medium tabular-nums">{money(p.amount)} <span className="font-normal text-muted">· {fdate(p.paid_at)}{p.method ? ` · ${p.method}` : ''}</span> {p.bank_movement_id && <ReconciledTag />}</p>
                    {(p.reference || p.notes) && <p className="truncate text-xs text-muted">{[p.reference, p.notes].filter(Boolean).join(' · ')}</p>}</div>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setOpenFiles(openFiles === p.id ? null : p.id)} aria-expanded={openFiles === p.id}><Paperclip size={12} />Soportes<ChevronDown size={12} className={openFiles === p.id ? 'rotate-180' : ''} /></button>
                  <button className="rounded p-1.5 text-muted hover:bg-red-500/10 hover:text-red-600" aria-label="Eliminar pago" onClick={() => { setDelError(''); setDeleting(p) }}><Trash2 size={14} /></button>
                </div>
                {openFiles === p.id && <div className="mt-2"><FilesField type={kind === 'expense' ? 'expense_payment' : 'customer_payment'} id={p.id} defaultKind="payment_proof" kinds={['payment_proof', 'receipt', 'other']} pending={[]} onPending={() => undefined} label="Soportes del pago" /></div>}
              </li>))}
            </ul>
          )}

          {balance > 0 ? (
            <form onSubmit={submit} className="space-y-3 rounded-lg border border-line p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Registrar pago</p>
              <div className="grid grid-cols-2 gap-3">
                <TextInput label="Fecha *" type="date" value={f.paid_at} onChange={e => setF(p => ({ ...p, paid_at: e.target.value }))} />
                <TextInput label="Valor *" type="number" min={0} step="any" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} />
                <Select label="Medio de pago" value={f.method} onChange={e => setF(p => ({ ...p, method: e.target.value }))}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</Select>
                <TextInput label="Referencia" value={f.reference} maxLength={200} onChange={e => setF(p => ({ ...p, reference: e.target.value }))} />
              </div>
              <TextInput label="Observaciones" value={f.notes} maxLength={2000} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} />
              <BankLink direction={kind === 'expense' ? 'expense' : 'income'} value={f.bank_movement_id} onChange={id => setF(p => ({ ...p, bank_movement_id: id }))} />
              <FilesField type={kind === 'expense' ? 'expense_payment' : 'customer_payment'} defaultKind="payment_proof" kinds={['payment_proof', 'receipt', 'other']} pending={pending} onPending={setPending} label="Soporte del pago" />
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Registrar pago</button></div>
            </form>
          ) : <p className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-300">Saldo en cero: no quedan pagos por registrar.</p>}
          {balance <= 0 && error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end"><button className="btn-ghost" onClick={onClose}>Cerrar</button></div>
        </div>
      </Modal>
      <ConfirmDialog open={!!deleting} title="Eliminar pago" confirmLabel="Eliminar pago" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará el pago de <b>{money(deleting?.amount)}</b> del {fdate(deleting?.paid_at)} y sus soportes. El saldo pendiente aumentará.</p>
      </ConfirmDialog>
    </>
  )
}
