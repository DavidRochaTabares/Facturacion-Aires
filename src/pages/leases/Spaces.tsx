import { useState, type FormEvent } from 'react'
import { Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Empty, Modal, Select, Spinner, TextInput } from '../../components/ui'
import { fdate, money } from '../../lib/format'
import { leases } from '../../services/leases'
import { PERIODICITY_LABEL, type LeaseSnapshot, type LeaseSpace, type LeaseSpaceInput, type Periodicity } from '../../types/lease'
import { errMsg, FilesField, toNum, uploadPending, type PendingFile } from './shared'

const blank = (): LeaseSpaceInput => ({ name: '', description: '', location: '', start_date: null, rent_amount: null, periodicity: 'monthly', status: 'active', notes: '' })

export function Spaces({ operationId, snap }: { operationId: string; snap: LeaseSnapshot }) {
  const [editing, setEditing] = useState<LeaseSpace | 'new' | null>(null)
  const [f, setF] = useState<LeaseSpaceInput>(blank())
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<LeaseSpace | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')

  const open = (s: LeaseSpace | 'new') => { setF(s === 'new' ? blank() : { name: s.name, description: s.description, location: s.location, start_date: s.start_date, rent_amount: s.rent_amount, periodicity: s.periodicity, status: s.status, notes: s.notes }); setPending([]); setError(''); setEditing(s) }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return setError('Escribe el nombre del espacio.')
    setBusy(true); setError('')
    try {
      const s = await leases.saveSpace(operationId, f, editing && editing !== 'new' ? editing.id : undefined)
      const warn = await uploadPending('space', s.id, pending)
      if (warn) { setError(warn); setEditing(s); setPending([]) } else setEditing(null)
    } catch (err) { setError(errMsg(err, 'No se pudo guardar el espacio.')) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await leases.deleteSpace(deleting.id); await leases.processCleanup(); setDeleting(null) } catch (e) { setDelError(errMsg(e, 'No se pudo eliminar el espacio.')) } finally { setDelBusy(false) }
  }
  const usage = (id: string) => snap.expenses.filter(e => e.space_id === id).length + snap.invoices.filter(i => i.space_id === id).length

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2"><p className="text-sm text-muted">Espacios que Aires y Destinos toma en arrendamiento y alquila a sus clientes.</p><button className="btn-primary" onClick={() => open('new')}><Plus size={16} />Nuevo espacio</button></div>
      {snap.spaces.length === 0 ? <div className="card"><Empty>Aún no hay espacios. Crea el primero para relacionar gastos y facturas.</Empty></div> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{snap.spaces.map(s => (
          <div key={s.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate font-semibold">{s.name}</h3><p className="truncate text-xs text-muted">{s.location || 'Sin ubicación'}</p></div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.status === 'active' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'}`}>{s.status === 'active' ? 'Activo' : 'Inactivo'}</span></div>
            {s.description && <p className="mt-2 line-clamp-2 text-sm text-muted">{s.description}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-muted">Canon</dt><dd className="font-medium tabular-nums">{s.rent_amount == null ? '—' : money(s.rent_amount)}</dd></div>
              <div><dt className="text-xs text-muted">Periodicidad</dt><dd>{PERIODICITY_LABEL[s.periodicity]}</dd></div>
              <div><dt className="text-xs text-muted">Inicio</dt><dd>{fdate(s.start_date ?? undefined)}</dd></div>
              <div><dt className="text-xs text-muted">Registros</dt><dd>{usage(s.id)}</dd></div></dl>
            <div className="mt-3 flex justify-end gap-1 border-t border-line pt-2">
              <button className="btn-ghost !px-2" title="Contratos y documentos" onClick={() => open(s)}><Paperclip size={14} /></button>
              <button className="btn-ghost !px-2" title="Editar" onClick={() => open(s)}><Pencil size={14} /></button>
              <button className="btn-ghost !px-2 text-red-600 dark:text-red-400" title="Eliminar" onClick={() => { setDelError(''); setDeleting(s) }}><Trash2 size={14} /></button>
            </div>
          </div>))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo espacio' : 'Editar espacio'}>
        <form onSubmit={submit} className="space-y-3">
          <TextInput label="Nombre del espacio *" value={f.name} maxLength={160} onChange={e => setF(p => ({ ...p, name: e.target.value }))} />
          <TextInput label="Ubicación" value={f.location} maxLength={300} onChange={e => setF(p => ({ ...p, location: e.target.value }))} />
          <div><label className="label">Descripción</label><textarea className="input min-h-16" maxLength={2000} value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Inicio del arrendamiento" type="date" value={f.start_date ?? ''} onChange={e => setF(p => ({ ...p, start_date: e.target.value || null }))} />
            <TextInput label="Canon de arrendamiento" type="number" min={0} step="any" value={f.rent_amount ?? ''} onChange={e => setF(p => ({ ...p, rent_amount: toNum(e.target.value) }))} />
            <Select label="Periodicidad" value={f.periodicity} onChange={e => setF(p => ({ ...p, periodicity: e.target.value as Periodicity }))}>{(Object.keys(PERIODICITY_LABEL) as Periodicity[]).map(k => <option key={k} value={k}>{PERIODICITY_LABEL[k]}</option>)}</Select>
            <Select label="Estado" value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value as 'active' | 'inactive' }))}><option value="active">Activo</option><option value="inactive">Inactivo</option></Select>
          </div>
          <div><label className="label">Observaciones</label><textarea className="input min-h-16" maxLength={4000} value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} /></div>
          <FilesField type="space" id={editing && editing !== 'new' ? editing.id : undefined} defaultKind="contract" kinds={['contract', 'other']} pending={pending} onPending={setPending} label="Contratos y documentos" />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cerrar</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button></div>
        </form>
      </Modal>
      <ConfirmDialog open={!!deleting} title="Eliminar espacio" confirmLabel="Eliminar espacio" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará el espacio <b>{deleting?.name}</b> y sus documentos. Si tiene gastos o facturas asociados no se podrá eliminar: en ese caso márcalo como inactivo.</p>
      </ConfirmDialog>
    </>
  )
}
