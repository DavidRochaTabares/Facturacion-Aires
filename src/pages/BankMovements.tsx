import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, ChevronDown, Eye, FilterX, FileText, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { DeleteDialog } from '../components/DeleteDialog'
import { Drawer, Empty, FilePreview, FilterBar, Loading, Modal, PageHeader, Select, Spinner, TextInput } from '../components/ui'
import { useAsync, useDebounced } from '../hooks'
import { useTableCopy } from '../hooks/useTableCopy'
import { fdate, fsize, money, SERVICE_LABEL } from '../lib/format'
import { dataService } from '../services'
import type { BankDocument, BankFilters, BankMovementInput, BankMovementRow, PersonalMovementRow } from '../types'
import PersonalMovements from './PersonalMovements'

const TYPES = ['Ingreso', 'Egreso', 'Transferencia', 'Comisión bancaria', 'Otro']

const blank = (): BankMovementInput => ({
  date: new Date().toISOString().slice(0, 10),
  bank_name: '',
  description: '',
  amount: 0,
  invoice_number: '',
  client_name: '',

  // Campos históricos conservados por compatibilidad
  movement_type: '',
  beneficiary: '',
  reference_1: '',
  reference_2: '',
  reference_3: '',
  observation: '',
})

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function BankMovements() {
  const [tab, setTab] = useState<'agency' | 'personal'>('agency')
  const [personalEditing, setPersonalEditing] = useState<PersonalMovementRow | 'new' | null>(null)
  const [f, setF] = useState<BankFilters>({})
  const q = useDebounced(f.search)
  const filters = { ...f, search: q }
  const { data: rows, loading, reload } = useAsync(() => dataService.getBankMovements(filters), [JSON.stringify(filters)])
  const { data: report } = useAsync(() => dataService.getBankReports(filters), [JSON.stringify(filters)])
  const { data: all } = useAsync(() => dataService.getBankReports(), [rows?.length])
  const { data: alerts, reload: reloadAlerts } = useAsync(() => dataService.getInvoiceAlerts(), [rows?.length])
  const types = [...new Set([...TYPES, ...(all?.by_type.map(t => t.key) ?? [])])]
  const set = (k: keyof BankFilters) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))

  const [detail, setDetail] = useState<string | null>(null)
  // Cell selection + Ctrl+C + auto-sum; only the "Valor" column (index 3) counts toward the total.
  const copy = useTableCopy(6, [false, false, false, true, false, false], id => setDetail(id), tab)
  const [editing, setEditing] = useState<BankMovementRow | 'new' | null>(null)
  const [del, setDel] = useState<BankMovementRow | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [notice, setNotice] = useState('')
  const confirmDelete = async () => {
    if (!del) return
    setDelBusy(true); setDelError('')
    try {
      const r = await dataService.deleteBankMovement(del.id)
      setNotice(`Se eliminó el movimiento.${r.filesNotRemoved ? ` No se pudieron borrar ${r.filesNotRemoved} archivo(s) del almacenamiento; el movimiento sí se eliminó.` : ''}`)
      if (detail === del.id) setDetail(null)
      setDel(null); reload()
    } catch (e) { setDelError(e instanceof Error ? e.message : 'No se pudo eliminar. No se borró nada.') } finally { setDelBusy(false) }
  }

  return (
    <>
      <PageHeader title="Movimientos bancarios" subtitle="Control de la cuenta bancaria de la agencia (independiente de los registros de servicios)"
        actions={<button className="btn-primary" onClick={() => (tab === 'agency' ? setEditing('new') : setPersonalEditing('new'))}><Plus size={16} />Nuevo movimiento</button>} />
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-surface2/60 p-1 w-fit">
        {([['agency', 'Agencia'], ['personal', 'Gastos personales']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`rounded-md px-4 py-1.5 text-sm transition ${tab === k ? 'bg-surface font-medium shadow-sm' : 'text-muted hover:text-fg'}`}>{l}</button>
        ))}
      </div>
      {tab === 'personal' ? <PersonalMovements editing={personalEditing} setEditing={setPersonalEditing} /> : (<>
      {(alerts ?? []).length > 0 && (
        <details className="card group mb-4 p-0" open={(alerts ?? []).filter(a => a.due_date <= todayStr()).length > 0 && (alerts ?? []).length <= 6}>
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-xs font-semibold uppercase tracking-wide text-muted [&::-webkit-details-marker]:hidden">
            <AlertTriangle size={14} className="text-amber-500" />Facturas por cobrar
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 normal-case text-amber-700 dark:text-amber-300">{alerts!.length}</span>
            {(alerts ?? []).some(a => a.due_date <= todayStr()) && <span className="rounded-full bg-red-500/10 px-2 py-0.5 normal-case text-red-600 dark:text-red-400">{alerts!.filter(a => a.due_date <= todayStr()).length} vencidas</span>}
            <ChevronDown size={15} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-line px-4 py-3 text-sm">
            {(alerts ?? []).map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="font-medium">{a.invoice_number ? `Factura ${a.invoice_number}` : `${SERVICE_LABEL[a.operation_type ?? 'other']} sin número de factura`}</span>
                <span className="text-muted">{a.company_name || '—'} · {money(a.amount)}</span>
                <span className={a.due_date <= todayStr() ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted'}>Cobrar el {fdate(a.due_date)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        <div className="card p-4"><p className="text-xs text-muted font-medium">Movimientos</p><p className="mt-2 text-xl font-semibold">{report?.count ?? '—'}</p></div>
        <div className="card p-4"><p className="text-xs text-muted font-medium">Suma de valores</p><p className="mt-2 text-xl font-semibold tabular-nums">{report ? money(report.total_amount) : '—'}</p></div>
        <div className="card p-4"><p className="text-xs text-muted font-medium mb-1">Por tipo</p><ul className="text-sm space-y-0.5">{report?.by_type.map(t => <li key={t.key} className="flex justify-between"><span>{t.label} ({t.count})</span><span className="tabular-nums">{money(t.amount)}</span></li>)}</ul></div>
      </div>
      {notice && <p role="status" className="mb-4 rounded-lg border border-line bg-surface2 p-3 text-sm">{notice}</p>}
      <FilterBar search={f.search ?? ''} onSearch={v => setF(p => ({ ...p, search: v }))} active={Object.entries(f).filter(([k, x]) => k !== 'search' && x).length}>
        <div className="md:w-48"><Select value={f.movement_type ?? ''} onChange={set('movement_type')}><option value="">Todos los tipos</option>{types.map(t => <option key={t}>{t}</option>)}</Select></div>
        <input type="date" className="input md:!w-40" aria-label="Desde" value={f.date_from ?? ''} onChange={set('date_from')} />
        <input type="date" className="input md:!w-40" aria-label="Hasta" value={f.date_to ?? ''} onChange={set('date_to')} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => setF({})}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !rows?.length ? <Empty>No hay movimientos.</Empty> : (
          <div {...copy.props} className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                {['Fecha', 'Banco', 'Descripción', 'Valor', 'Factura', 'Cliente'].map(h => (
                  <th key={h} className="th !px-2">{h}</th>
                ))}
                <th className="th !px-2" />
              </tr>
            </thead>            
            <tbody className="divide-y divide-line">
              {rows.map((r, ri) => (
                <tr
                  key={r.id}
                  data-rr={ri}
                  data-id={r.id}
                  className="cursor-pointer hover:bg-surface2/60"
                >
                  <td className={`td select-none !px-2 !py-1.5 ${copy.inSel(ri, 0) ? '!bg-brand/20' : ''}`}>
                    {fdate(r.date)}
                  </td>

                  <td className={`td select-none !px-2 !py-1.5 ${copy.inSel(ri, 1) ? '!bg-brand/20' : ''}`}>
                    {r.bank_name || '—'}
                  </td>

                  <td className={`td select-none !px-2 !py-1.5 !whitespace-normal ${copy.inSel(ri, 2) ? '!bg-brand/20' : ''}`}>
                    {r.description || '—'}
                  </td>

                  <td className={`td select-none !px-2 !py-1.5 text-right tabular-nums font-medium ${copy.inSel(ri, 3) ? '!bg-brand/20' : ''}`}>
                    {money(r.amount)}
                  </td>

                  <td className={`td select-none !px-2 !py-1.5 ${copy.inSel(ri, 4) ? '!bg-brand/20' : ''}`}>
                    {r.invoice_number || '—'}
                  </td>

                  <td className={`td select-none !px-2 !py-1.5 ${copy.inSel(ri, 5) ? '!bg-brand/20' : ''}`}>
                    {r.client_name || '—'}
                  </td>

                  <td className="td !px-2 !py-1.5">
                    <span className="flex items-center justify-end gap-1 text-muted">
                      {r.documents.length > 0 && <Paperclip size={14} />}

                      <button
                        title="Editar"
                        aria-label="Editar"
                        className="p-1 rounded hover:bg-surface2 hover:text-fg"
                        onClick={e => {
                          e.stopPropagation()
                          setEditing(r)
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        title="Eliminar"
                        aria-label="Eliminar"
                        className="p-1 rounded hover:bg-red-500/10 hover:text-red-600"
                        onClick={e => {
                          e.stopPropagation()
                          setDelError('')
                          setDel(r)
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {copy.sum.count > 0 && (
          <div role="status" className="fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-0.5 rounded-full border border-line bg-surface px-4 py-1.5 text-xs text-muted shadow-lg">
            <span>{copy.sum.count} {copy.sum.count === 1 ? 'celda numérica' : 'celdas numéricas'}</span>
            <span className="font-semibold text-fg tabular-nums">Suma: {money(copy.sum.total)} COP</span>
          </div>
        )}
      </div>
      <DeleteDialog open={!!del} title="Eliminar movimiento bancario" busy={delBusy} error={delError} onCancel={() => setDel(null)} onConfirm={confirmDelete}>
        {del && <p><b>{fdate(del.date)}</b> · {del.bank_name || 'Sin banco'} · {del.description || 'Sin descripción'} · {money(del.amount)}{del.client_name ? ` · ${del.client_name}` : ''}</p>}
      </DeleteDialog>
      <MovementDetail id={detail} onClose={() => setDetail(null)} onEdit={m => { setDetail(null); setEditing(m) }} onChanged={() => { reload(); reloadAlerts() }} />
      <MovementForm
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
          reloadAlerts()
        }}
      />
      </>)}
    </>
  )
}


function MovementForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: BankMovementRow | 'new' | null
  onClose: () => void
  onSaved: () => void
}) {
  const [v, setV] = useState<BankMovementInput>(blank())
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (editing) {
      setV(editing === 'new' ? blank() : editing)
      setFile(null)
      setErr({})
      setSaveError('')
    }
  }, [editing])

  const t = (k: keyof BankMovementInput) => ({
    value: v[k] as string,
    onChange: (e: { target: { value: string } }) =>
      setV(p => ({ ...p, [k]: e.target.value })),
  })

  const save = async (e: FormEvent) => {
    e.preventDefault()

    const e2: Record<string, string> = {}

    if (!v.date) {
      e2.date = 'Campo requerido'
    }

    if (!v.bank_name.trim()) {
      e2.bank_name = 'Campo requerido'
    }

    if (!v.amount || v.amount <= 0) {
      e2.amount = 'Ingresa un valor mayor que cero'
    }

    setErr(e2)

    if (Object.keys(e2).length > 0) return

    setBusy(true)
    setSaveError('')

    const {
      id: _i,
      created_at: _c,
      documents: _d,
      ...input
    } = v as BankMovementRow

    try {
      if (editing === 'new') {
        await dataService.createBankMovement(input, file)
      } else if (editing) {
        await dataService.updateBankMovement(editing.id, input)

        if (file) {
          await dataService.addBankDocument(editing.id, file)
        }
      }

      onSaved()
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'No se pudo guardar'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      title={editing === 'new' ? 'Nuevo movimiento' : 'Editar movimiento'}
    >
      <form noValidate onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Fecha *"
            type="date"
            error={err.date}
            {...t('date')}
          />

          <TextInput
            label="Banco *"
            error={err.bank_name}
            {...t('bank_name')}
          />
        </div>

        <TextInput
          label="Descripción"
          {...t('description')}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Valor *"
            type="number"
            min={0}
            error={err.amount}
            value={v.amount || ''}
            onChange={e =>
              setV(p => ({
                ...p,
                amount: Number(e.target.value) || 0,
              }))
            }
          />

          <TextInput
            label="Factura"
            {...t('invoice_number')}
          />
        </div>

        <TextInput
          label="Cliente"
          {...t('client_name')}
        />

        <div>
          <label className="label">Comprobante (opcional)</label>

          <label className="btn-ghost cursor-pointer">
            <Paperclip size={14} />
            {file ? file.name : 'Adjuntar archivo'}

            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {saveError && (
          <p role="alert" className="text-sm text-red-500">
            {saveError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
          >
            Cancelar
          </button>

          <button
            type="submit"
            className="btn-primary"
            disabled={busy}
          >
            {busy && <Spinner />}
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  )
}


function MovementDetail({ id, onClose, onEdit, onChanged }: { id: string | null; onClose: () => void; onEdit: (m: BankMovementRow) => void; onChanged: () => void }) {
  const [row, setRow] = useState<BankMovementRow | null>(null)
  const [preview, setPreview] = useState<{ doc: BankDocument; url: string } | null>(null)
  const [delDoc, setDelDoc] = useState<BankDocument | null>(null)
  const [delDocBusy, setDelDocBusy] = useState(false)
  const [delDocError, setDelDocError] = useState('')
  const confirmDelDoc = async () => {
    if (!delDoc || !row) return
    setDelDocBusy(true); setDelDocError('')
    try { await dataService.deleteBankDocument(delDoc.id); setDelDoc(null); onChanged(); load(row.id) }
    catch (e) { setDelDocError(e instanceof Error ? e.message : 'No se pudo eliminar el archivo.') } finally { setDelDocBusy(false) }
  }
  const load = (i: string) => dataService.getBankMovementById(i).then(setRow)
  useEffect(() => { setRow(null); if (id) load(id) }, [id])
  const KV = ({ k, v }: { k: string; v?: string }) => v ? <div><dt className="text-xs text-muted">{k}</dt><dd className="text-sm mt-0.5 break-words">{v}</dd></div> : null
  return (
    <>
      <Drawer open={!!id} onClose={onClose} title="Detalle del movimiento">
        {!row ? <Loading /> : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm text-muted">{row.movement_type} · {fdate(row.date)}</p><p className="text-2xl font-semibold tabular-nums mt-1">{money(row.amount)}</p></div>
              <button className="btn-ghost" onClick={() => onEdit(row)}><Pencil size={14} />Editar</button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-6"><KV k="Descripción / motivo" v={row.description} /><KV k="Beneficiario / destino" v={row.beneficiary} />
              <KV k="Referencia 1" v={row.reference_1} /><KV k="Referencia 2" v={row.reference_2} /><KV k="Referencia 3" v={row.reference_3} /><KV k="Registrado" v={fdate(row.created_at)} /></dl>
            {row.observation && <p className="text-sm mt-4">{row.observation}</p>}
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mt-6 mb-3">Comprobantes</h3>
            {row.documents.length === 0 && <p className="text-sm text-muted mb-2">Sin comprobantes.</p>}
            {row.documents.map(d => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line p-3 mb-2"><FileText size={18} className="text-brand" />
                <div className="flex-1 min-w-0"><p className="text-sm truncate">{d.name}</p><p className="text-xs text-muted">{fsize(d.size)} · {fdate(d.created_at)}</p></div>
                <button className="btn-ghost" onClick={async () => { try { setPreview({ doc: d, url: await dataService.getDocumentUrl(d) }) } catch (err) { alert(err instanceof Error ? err.message : 'No se pudo abrir el comprobante') } }}><Eye size={14} />Ver</button>
                <button title="Eliminar archivo" aria-label="Eliminar archivo" className="p-1.5 rounded text-muted hover:bg-red-500/10 hover:text-red-600" onClick={() => { setDelDocError(''); setDelDoc(d) }}><Trash2 size={15} /></button></div>
            ))}
            <label className="btn-ghost cursor-pointer"><Paperclip size={14} />Adjuntar comprobante
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { try { await dataService.addBankDocument(row.id, f); onChanged(); load(row.id) } catch (err) { alert(err instanceof Error ? err.message : 'No se pudo subir el comprobante') } } e.target.value = '' }} /></label>
          </>
        )}
      </Drawer>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.doc.name ?? ''}><div className="h-[60vh]"><FilePreview url={preview?.url ?? null} mime={preview?.doc.mime_type} className="h-full" /></div></Modal>
      <DeleteDialog open={!!delDoc} title="Eliminar comprobante" busy={delDocBusy} error={delDocError} onCancel={() => setDelDoc(null)} onConfirm={confirmDelDoc}>
        {delDoc && <p><b>{delDoc.name}</b> · {fsize(delDoc.size)}</p>}
        <p className="mt-2 text-muted">Solo se elimina este archivo. El movimiento y sus demás comprobantes no se modifican.</p>
      </DeleteDialog>
    </>
  )
}
