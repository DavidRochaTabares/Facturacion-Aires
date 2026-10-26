import { useEffect, useState, type FormEvent } from 'react'
import { Eye, FilterX, FileText, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { DeleteDialog } from '../components/DeleteDialog'
import { Drawer, Empty, FilePreview, FilterBar, Loading, Modal, Select, Spinner, TextInput } from '../components/ui'
import { useAsync, useDebounced } from '../hooks'
import { fdate, fsize, money } from '../lib/format'
import { PERSONAL_CATEGORIES, PERSONAL_KIND_LABEL, PERSONAL_METHODS } from '../lib/service'
import { dataService } from '../services'
import type { PersonalDocument, PersonalFilters, PersonalKind, PersonalMovementInput, PersonalMovementRow } from '../types'

const blank = (): PersonalMovementInput => ({
  date: new Date().toISOString().slice(0, 10),
  kind: 'expense',
  category: '',
  description: '',
  amount: 0,
  payment_method: '',
  account: '',
  beneficiary: '',
  reference: '',
  notes: '',
})

/** Personal money tracking inside Bancos: its own table and storage folder, never mixed with agency movements or reports. */
export default function PersonalMovements({ editing, setEditing }: { editing: PersonalMovementRow | 'new' | null; setEditing: (v: PersonalMovementRow | 'new' | null) => void }) {
  const [f, setF] = useState<PersonalFilters>({})
  const q = useDebounced(f.search)
  const filters = { ...f, search: q }
  const { data: rows, loading, reload } = useAsync(() => dataService.getPersonalMovements(filters), [JSON.stringify(filters)])
  const set = (k: keyof PersonalFilters) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))

  const income = (rows ?? []).filter(r => r.kind === 'income').reduce((a, r) => a + r.amount, 0)
  const expense = (rows ?? []).filter(r => r.kind === 'expense').reduce((a, r) => a + r.amount, 0)

  const [detail, setDetail] = useState<string | null>(null)
  const [del, setDel] = useState<PersonalMovementRow | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [notice, setNotice] = useState('')
  const confirmDelete = async () => {
    if (!del) return
    setDelBusy(true); setDelError('')
    try {
      const r = await dataService.deletePersonalMovement(del.id)
      setNotice(`Se eliminó el movimiento.${r.filesNotRemoved ? ` No se pudieron borrar ${r.filesNotRemoved} archivo(s) del almacenamiento; el movimiento sí se eliminó.` : ''}`)
      if (detail === del.id) setDetail(null)
      setDel(null); reload()
    } catch (e) { setDelError(e instanceof Error ? e.message : 'No se pudo eliminar. No se borró nada.') } finally { setDelBusy(false) }
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        <div className="card p-4"><p className="text-xs text-muted font-medium">Ingresos</p><p className="mt-2 text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(income)}</p></div>
        <div className="card p-4"><p className="text-xs text-muted font-medium">Gastos</p><p className="mt-2 text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">{money(expense)}</p></div>
        <div className="card p-4"><p className="text-xs text-muted font-medium">Balance</p><p className={`mt-2 text-xl font-semibold tabular-nums ${income - expense < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{money(income - expense)}</p></div>
      </div>
      {notice && <p role="status" className="mb-4 rounded-lg border border-line bg-surface2 p-3 text-sm">{notice}</p>}
      <FilterBar search={f.search ?? ''} onSearch={v => setF(p => ({ ...p, search: v }))} active={Object.entries(f).filter(([k, x]) => k !== 'search' && x).length}>
        <div className="md:w-40"><Select value={f.kind ?? ''} onChange={set('kind')}><option value="">Ingresos y gastos</option><option value="income">Ingresos</option><option value="expense">Gastos</option></Select></div>
        <div className="md:w-48"><Select value={f.category ?? ''} onChange={set('category')}><option value="">Todas las categorías</option>{PERSONAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}</Select></div>
        <input type="date" className="input md:!w-40" aria-label="Desde" value={f.date_from ?? ''} onChange={set('date_from')} />
        <input type="date" className="input md:!w-40" aria-label="Hasta" value={f.date_to ?? ''} onChange={set('date_to')} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => setF({})}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !rows?.length ? <Empty>No hay movimientos personales.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="border-b border-line bg-surface2/50">
              {['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Medio', 'Valor'].map(h => <th key={h} className="th !px-2">{h}</th>)}
              <th className="th !px-2" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map(r => (
                <tr key={r.id} onClick={() => setDetail(r.id)} className="cursor-pointer hover:bg-surface2/60">
                  <td className="td !px-2 !py-1.5">{fdate(r.date)}</td>
                  <td className="td !px-2 !py-1.5">{PERSONAL_KIND_LABEL[r.kind]}</td>
                  <td className="td !px-2 !py-1.5">{r.category || '—'}</td>
                  <td className="td !px-2 !py-1.5 !whitespace-normal">{r.description || '—'}</td>
                  <td className="td !px-2 !py-1.5">{r.payment_method || '—'}</td>
                  <td className={`td !px-2 !py-1.5 text-right tabular-nums font-medium ${r.kind === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{r.kind === 'expense' ? '−' : '+'}{money(r.amount)}</td>
                  <td className="td !px-2 !py-1.5">
                    <span className="flex items-center justify-end gap-1 text-muted">
                      {r.documents.length > 0 && <Paperclip size={14} />}
                      <button title="Editar" aria-label="Editar" className="p-1 rounded hover:bg-surface2 hover:text-fg" onClick={e => { e.stopPropagation(); setEditing(r) }}><Pencil size={15} /></button>
                      <button title="Eliminar" aria-label="Eliminar" className="p-1 rounded hover:bg-red-500/10 hover:text-red-600" onClick={e => { e.stopPropagation(); setDelError(''); setDel(r) }}><Trash2 size={15} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <DeleteDialog open={!!del} title="Eliminar movimiento personal" busy={delBusy} error={delError} onCancel={() => setDel(null)} onConfirm={confirmDelete}>
        {del && <p><b>{fdate(del.date)}</b> · {PERSONAL_KIND_LABEL[del.kind]} · {del.category || 'Sin categoría'} · {del.description || 'Sin descripción'} · {money(del.amount)}</p>}
      </DeleteDialog>
      <PersonalDetail id={detail} onClose={() => setDetail(null)} onEdit={m => { setDetail(null); setEditing(m) }} onChanged={reload} />
      <PersonalForm editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />
    </>
  )
}

function PersonalForm({ editing, onClose, onSaved }: { editing: PersonalMovementRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<PersonalMovementInput>(blank())
  const [files, setFiles] = useState<File[]>([])
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (editing) {
      setV(editing === 'new' ? blank() : editing)
      setFiles([])
      setErr({})
      setSaveError('')
    }
  }, [editing])

  const t = (k: keyof PersonalMovementInput) => ({ value: v[k] as string, onChange: (e: { target: { value: string } }) => setV(p => ({ ...p, [k]: e.target.value })) })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const e2: Record<string, string> = {}
    if (!v.date) e2.date = 'Campo requerido'
    if (!v.description.trim()) e2.description = 'Campo requerido'
    if (!v.amount || v.amount <= 0) e2.amount = 'Ingresa un valor mayor que cero'
    setErr(e2)
    if (Object.keys(e2).length) return
    setBusy(true); setSaveError('')
    const { id: _i, created_at: _c, documents: _d, ...input } = v as PersonalMovementRow
    try {
      if (editing === 'new') {
        await dataService.createPersonalMovement(input, files)
      } else if (editing) {
        await dataService.updatePersonalMovement(editing.id, input)
        for (const f of files) await dataService.addPersonalDocument(editing.id, f)
      }
      onSaved()
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'No se pudo guardar') } finally { setBusy(false) }
  }

  return (
    <Modal open={!!editing} onClose={onClose} title={editing === 'new' ? 'Nuevo movimiento personal' : 'Editar movimiento personal'}>
      <form noValidate onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Fecha *" type="date" error={err.date} {...t('date')} />
          <Select label="Tipo *" value={v.kind} onChange={e => setV(p => ({ ...p, kind: e.target.value as PersonalKind }))}>
            <option value="expense">Gasto</option><option value="income">Ingreso</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Categoría" value={v.category} onChange={e => setV(p => ({ ...p, category: e.target.value }))}>
            <option value="">Sin categoría</option>{PERSONAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </Select>
          <TextInput label="Valor *" type="number" min={0} error={err.amount} value={v.amount || ''} onChange={e => setV(p => ({ ...p, amount: Number(e.target.value) || 0 }))} />
        </div>
        <TextInput label="Descripción / concepto *" error={err.description} {...t('description')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Medio de pago" value={v.payment_method} onChange={e => setV(p => ({ ...p, payment_method: e.target.value }))}>
            <option value="">Sin medio</option>{PERSONAL_METHODS.map(m => <option key={m}>{m}</option>)}
          </Select>
          <TextInput label="Cuenta o tarjeta" {...t('account')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Beneficiario / establecimiento" {...t('beneficiary')} />
          <TextInput label="Referencia / comprobante" {...t('reference')} />
        </div>
        <div>
          <label className="label">Observaciones</label>
          <textarea aria-label="Observaciones" className="input min-h-16" {...t('notes')} />
        </div>
        <div>
          <label className="label">Adjuntos (facturas, recibos, comprobantes)</label>
          <label className="btn-ghost cursor-pointer"><Paperclip size={14} />{files.length ? `${files.length} archivo(s) seleccionado(s)` : 'Adjuntar archivos'}
            <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e => setFiles(p => [...p, ...(e.target.files ?? [])])} /></label>
          {files.length > 0 && <ul className="mt-1 space-y-0.5">{files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-muted"><span className="truncate">{f.name}</span>
              <button type="button" aria-label="Quitar archivo" className="hover:text-red-500" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}><Trash2 size={12} /></button></li>))}</ul>}
        </div>
        {saveError && <p role="alert" className="text-sm text-red-500">{saveError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button>
        </div>
      </form>
    </Modal>
  )
}

function PersonalDetail({ id, onClose, onEdit, onChanged }: { id: string | null; onClose: () => void; onEdit: (m: PersonalMovementRow) => void; onChanged: () => void }) {
  const [row, setRow] = useState<PersonalMovementRow | null>(null)
  const [preview, setPreview] = useState<{ doc: PersonalDocument; url: string } | null>(null)
  const [delDoc, setDelDoc] = useState<PersonalDocument | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const load = async (i: string) => setRow((await dataService.getPersonalMovements()).find(m => m.id === i) ?? null)
  useEffect(() => { setRow(null); if (id) load(id) }, [id])
  const confirmDelDoc = async () => {
    if (!delDoc || !row) return
    setDelBusy(true); setDelError('')
    try { await dataService.deletePersonalDocument(delDoc.id); setDelDoc(null); onChanged(); load(row.id) }
    catch (e) { setDelError(e instanceof Error ? e.message : 'No se pudo eliminar el archivo.') } finally { setDelBusy(false) }
  }
  const KV = ({ k, v }: { k: string; v?: string }) => v ? <div><dt className="text-xs text-muted">{k}</dt><dd className="text-sm mt-0.5 break-words">{v}</dd></div> : null
  return (
    <>
      <Drawer open={!!id} onClose={onClose} title="Detalle del movimiento">
        {!row ? <Loading /> : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm text-muted">{PERSONAL_KIND_LABEL[row.kind]} · {fdate(row.date)}</p>
                <p className={`text-2xl font-semibold tabular-nums mt-1 ${row.kind === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{row.kind === 'expense' ? '−' : '+'}{money(row.amount)}</p></div>
              <button className="btn-ghost" onClick={() => onEdit(row)}><Pencil size={14} />Editar</button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-6"><KV k="Categoría" v={row.category} /><KV k="Descripción" v={row.description} />
              <KV k="Medio de pago" v={row.payment_method} /><KV k="Cuenta / tarjeta" v={row.account} />
              <KV k="Beneficiario / establecimiento" v={row.beneficiary} /><KV k="Referencia" v={row.reference} /><KV k="Registrado" v={fdate(row.created_at)} /></dl>
            {row.notes && <p className="text-sm mt-4">{row.notes}</p>}
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mt-6 mb-3">Adjuntos</h3>
            {row.documents.length === 0 && <p className="text-sm text-muted mb-2">Sin adjuntos.</p>}
            {row.documents.map(d => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line p-3 mb-2"><FileText size={18} className="text-brand" />
                <div className="flex-1 min-w-0"><p className="text-sm truncate">{d.name}</p><p className="text-xs text-muted">{fsize(d.size)} · {fdate(d.created_at)}</p></div>
                <button className="btn-ghost" onClick={async () => { try { setPreview({ doc: d, url: await dataService.getDocumentUrl(d) }) } catch (err) { alert(err instanceof Error ? err.message : 'No se pudo abrir el archivo') } }}><Eye size={14} />Ver</button>
                <button title="Eliminar archivo" aria-label="Eliminar archivo" className="p-1.5 rounded text-muted hover:bg-red-500/10 hover:text-red-600" onClick={() => { setDelError(''); setDelDoc(d) }}><Trash2 size={15} /></button></div>
            ))}
            <label className="btn-ghost cursor-pointer"><Paperclip size={14} />Adjuntar archivo
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { try { await dataService.addPersonalDocument(row.id, f); onChanged(); load(row.id) } catch (err) { alert(err instanceof Error ? err.message : 'No se pudo subir el archivo') } } e.target.value = '' }} /></label>
          </>
        )}
      </Drawer>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.doc.name ?? ''}><div className="h-[60vh]"><FilePreview url={preview?.url ?? null} mime={preview?.doc.mime_type} className="h-full" /></div></Modal>
      <DeleteDialog open={!!delDoc} title="Eliminar adjunto" busy={delBusy} error={delError} onCancel={() => setDelDoc(null)} onConfirm={confirmDelDoc}>
        {delDoc && <p><b>{delDoc.name}</b> · {fsize(delDoc.size)}</p>}
        <p className="mt-2 text-muted">Solo se elimina este archivo. El movimiento y sus demás adjuntos no se modifican.</p>
      </DeleteDialog>
    </>
  )
}
