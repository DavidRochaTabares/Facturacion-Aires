import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Paperclip, X } from 'lucide-react'
import { AttachmentCard, type UrlResolver } from '../../components/AttachmentPreview'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Select, Spinner, TextInput } from '../../components/ui'
import { useAsync } from '../../hooks'
import { fdate, fsize, money, MONTHS } from '../../lib/format'
import { rangeOfMonth, rangeOfYear, type Range } from '../../lib/leaseCalc'
import { leases } from '../../services/leases'
import { ATTACHMENT_KIND_LABEL, PAY_STATUS_CLS, type AttachmentEntity, type AttachmentKind, type LeaseAttachment, type PayStatus } from '../../types/lease'

export const toNum = (v: string) => (v.trim() === '' ? null : Number(v))
export const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export function StatusPill({ status, label, extra }: { status: PayStatus; label: string; extra?: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PAY_STATUS_CLS[status]}`}>{label}</span>{extra}</span>
}
export const OverdueTag = () => <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">Vencido</span>

export function usePaged<T>(rows: T[], size = 20, resetKey = '') {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(page, pages - 1)
  return { rows: useMemo(() => rows.slice(p * size, p * size + size), [rows, p, size]), page: p, pages, setPage, total: rows.length }
}
export function Pager({ page, pages, setPage, total }: { page: number; pages: number; setPage: (n: number) => void; total: number }) {
  if (pages <= 1) return <p className="px-4 py-2 text-xs text-muted">{total} registro{total === 1 ? '' : 's'}</p>
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
      <span>{total} registros · página {page + 1} de {pages}</span>
      <span className="flex gap-1">
        <button className="btn-ghost !px-2 !py-1" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Anterior"><ChevronLeft size={14} /></button>
        <button className="btn-ghost !px-2 !py-1" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Siguiente"><ChevronRight size={14} /></button>
      </span>
    </div>
  )
}

export function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; hint?: string }) {
  const cls = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''
  return <div className="card p-4"><p className="text-xs font-medium text-muted">{label}</p><p className={`mt-1.5 truncate text-lg font-semibold tabular-nums sm:text-xl ${cls}`} title={value}>{value}</p>{hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}</div>
}

// ---- period selection (month / year / custom range) -------------------------------------------------------------------------------------------------
export interface PeriodState { mode: 'month' | 'year' | 'range'; year: number; month: number; from: string; to: string }
export const defaultPeriod = (): PeriodState => {
  const d = new Date()
  return { mode: 'month', year: d.getFullYear(), month: d.getMonth() + 1, from: `${d.getFullYear()}-01-01`, to: d.toISOString().slice(0, 10) }
}
export const periodRange = (p: PeriodState): Range => (p.mode === 'month' ? rangeOfMonth(p.year, p.month) : p.mode === 'year' ? rangeOfYear(p.year) : { from: p.from || '1900-01-01', to: p.to || '2999-12-31' })
export const periodLabel = (p: PeriodState) => (p.mode === 'month' ? `${MONTHS[p.month - 1]} ${p.year}` : p.mode === 'year' ? `Año ${p.year}` : `${fdate(p.from)} a ${fdate(p.to)}`)

export function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (p: PeriodState) => void }) {
  const set = (patch: Partial<PeriodState>) => onChange({ ...value, ...patch })
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i)
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-36"><Select label="Periodo" value={value.mode} onChange={e => set({ mode: e.target.value as PeriodState['mode'] })}><option value="month">Mes</option><option value="year">Año</option><option value="range">Rango de fechas</option></Select></div>
      {value.mode === 'month' && <div className="w-40"><Select label="Mes" value={value.month} onChange={e => set({ month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></div>}
      {value.mode !== 'range' && <div className="w-28"><Select label="Año" value={value.year} onChange={e => set({ year: Number(e.target.value) })}>{years.map(y => <option key={y} value={y}>{y}</option>)}</Select></div>}
      {value.mode === 'range' && <><div className="w-40"><TextInput label="Desde" type="date" value={value.from} onChange={e => set({ from: e.target.value })} /></div><div className="w-40"><TextInput label="Hasta" type="date" value={value.to} onChange={e => set({ to: e.target.value })} /></div></>}
    </div>
  )
}

// ---- files: saved attachments of a record (with preview / delete) + new uploads ----------------------------------------------------------------------
export interface PendingFile { file: File; kind: AttachmentKind }

export function FilesField({ type, id, defaultKind, kinds, pending, onPending, label = 'Archivos adjuntos' }: {
  type: AttachmentEntity; id?: string; defaultKind: AttachmentKind; kinds?: AttachmentKind[]; pending: PendingFile[]; onPending: (p: PendingFile[]) => void; label?: string
}) {
  const [kind, setKind] = useState<AttachmentKind>(defaultKind)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<LeaseAttachment | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const saved = useAsync(() => (id ? leases.attachments(type, id) : Promise.resolve([] as LeaseAttachment[])), [type, id])
  const options = kinds ?? (Object.keys(ATTACHMENT_KIND_LABEL) as AttachmentKind[])
  const resolve: UrlResolver = a => leases.signedUrl(saved.data?.find(x => x.id === a.id)?.storage_path ?? '', a.file_name)

  const pick = async (list: FileList | null) => {
    const files = [...(list ?? [])].map(file => ({ file, kind }))
    if (!files.length) return
    if (!id) { onPending([...pending, ...files]); return }
    setBusy(true); setError('')
    try {
      const failed = await leases.uploadFiles(type, id, files)
      if (failed.length) setError(failed.join(' · '))
      saved.reload()
    } catch (e) { setError(errMsg(e, 'No se pudieron subir los archivos.')) } finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await leases.deleteAttachment(deleting); setDeleting(null); saved.reload() } catch (e) { setDelError(errMsg(e, 'No se pudo eliminar el archivo.')) } finally { setDelBusy(false) }
  }

  return (
    <div className="space-y-2">
      <p className="label !mb-0">{label}</p>
      {(saved.data ?? []).length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">{saved.data!.map(a => (
          <li key={a.id} className="min-w-0"><p className="mb-0.5 text-[11px] text-muted">{ATTACHMENT_KIND_LABEL[a.kind]} · {fsize(a.size_bytes)}</p><AttachmentCard att={a} resolve={resolve} onRemove={() => { setDelError(''); setDeleting(a) }} /></li>))}
        </ul>
      )}
      {pending.length > 0 && (
        <ul className="space-y-1">{pending.map((p, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm"><Paperclip size={14} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{p.file.name}</span><span className="text-xs text-muted">{ATTACHMENT_KIND_LABEL[p.kind]}</span>
            <button type="button" className="rounded p-1 text-muted hover:text-red-600" aria-label="Quitar" onClick={() => onPending(pending.filter((_, j) => j !== i))}><X size={14} /></button></li>))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {options.length > 1 && <select className="input !w-auto !py-1.5 text-xs" value={kind} onChange={e => setKind(e.target.value as AttachmentKind)} aria-label="Tipo de documento">{options.map(k => <option key={k} value={k}>{ATTACHMENT_KIND_LABEL[k]}</option>)}</select>}
        <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>{busy ? <Spinner /> : <Paperclip size={14} />}Adjuntar archivo
          <input type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={e => { pick(e.target.files); e.target.value = '' }} /></label>
        <span className="text-xs text-muted">PDF, PNG, JPG o WEBP · máx. 10 MB{!id ? ' · se suben al guardar' : ''}</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <ConfirmDialog open={!!deleting} title="Eliminar archivo" confirmLabel="Eliminar archivo" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará <b>{deleting?.file_name}</b> del registro y del almacenamiento privado. No se puede recuperar.</p>
      </ConfirmDialog>
    </div>
  )
}

/** Uploads the files chosen while creating a record; returns a warning text if any failed (the record itself is already saved). */
export async function uploadPending(type: AttachmentEntity, id: string, pending: PendingFile[]): Promise<string> {
  if (!pending.length) return ''
  const failed = await leases.uploadFiles(type, id, pending)
  return failed.length ? `El registro se guardó, pero no se pudieron subir: ${failed.join(' · ')}` : ''
}

// ---- optional bank reconciliation -----------------------------------------------------------------------------------------------------------------------
export function BankLink({ direction, value, onChange }: { direction: 'income' | 'expense'; value: string | null; onChange: (id: string | null) => void }) {
  const { data, loading } = useAsync(() => leases.bankCandidates(direction, value), [direction, value])
  return (
    <Select label="Movimiento bancario (conciliación, opcional)" value={value ?? ''} onChange={e => onChange(e.target.value || null)} disabled={loading}>
      <option value="">Sin vincular</option>
      {(data ?? []).map(m => <option key={m.id} value={m.id}>{fdate(m.date)} · {money(m.amount)} · {(m.description || m.beneficiary || 'Sin descripción').slice(0, 50)}</option>)}
    </Select>
  )
}
export const ReconciledTag = () => <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Conciliado</span>
