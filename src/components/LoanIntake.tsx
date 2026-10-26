import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, RotateCcw } from 'lucide-react'
import { blockStrayFileDrops, normalizeDocFile } from '../lib/files'
import { fdate, fsize, money } from '../lib/format'
import { loanIva } from '../lib/service'
import { dataService } from '../services'
import type { ExtractedFood, ExtractedLoan, OperationInput } from '../types'
import ServiceForm, { emptyDetails } from './ServiceForm'
import { FilePreview, PageHeader, Spinner, BackButton } from './ui'

type Stage = 'idle' | 'processing' | 'done' | 'manual'

const COPY = { loan: { title: 'Nuevo préstamo', path: '/prestamos' }, food: { title: 'Nueva alimentación', path: '/alimentacion' } } as const

/** Document intake (PDF / image / paste) shared by Préstamos and Alimentación: same extraction function, same review form, same Storage upload. */
export default function LoanIntake({ onBack, start = 'idle', kind = 'loan' }: { onBack: () => void; start?: 'idle' | 'manual'; kind?: 'loan' | 'food' }) {
  const { title, path } = COPY[kind]
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(false)
  const discard = useRef(false)
  const [stage, setStage] = useState<Stage>(start)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [ex, setEx] = useState<ExtractedLoan | ExtractedFood | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const analyze = async (f: File) => {
    if (running.current) return
    running.current = true
    discard.current = false
    setStage('processing'); setError('')
    try {
      const r = kind === 'food' ? await dataService.extractFoodDocument(f) : await dataService.extractLoanDocument(f)
      if (!discard.current) { setEx(r); setStage('done') }
    } catch (e) {
      if (!discard.current) setError(e instanceof Error ? e.message : 'No se pudo analizar el documento.')
    } finally { running.current = false }
  }
  const pick = async (f?: File) => {
    if (!f) return
    try {
      const n = await normalizeDocFile(f, 'pdf-or-image')
      setError(''); setFile(n); setUrl(URL.createObjectURL(n)); setEx(null)
      void analyze(n)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.') }
  }
  useEffect(() => blockStrayFileDrops(), [])
  useEffect(() => {
    if (stage !== 'idle') return
    const h = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0]
      if (f) { e.preventDefault(); pick(f) }
    }
    addEventListener('paste', h)
    return () => removeEventListener('paste', h)
  }, [stage])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const manual = () => { discard.current = true; setEx(null); setStage('manual') }
  const reset = () => { discard.current = true; setFile(null); setUrl(null); setEx(null); setStage('idle') }
  const save = async (v: OperationInput, docs?: { file: File; category: 'ticket' | 'payment' | 'supplier_invoice' | 'agency_invoice' | 'other' }[]) => { setBusy(true); await dataService.createOperation(v, docs ?? (file ? [{ file, category: 'payment' as const }] : [])); nav(path) }

  const exLoan = ex as ExtractedLoan | null
  const det = (ex?.details ?? {}) as Record<string, any>
  const docIva = kind === 'loan' ? exLoan?.details.iva ?? 0 : 0
  const docTotal = exLoan?.amount ?? 0
  const withIva = kind === 'loan' && docIva > 0 && docTotal > docIva && Math.abs(loanIva(docTotal - docIva) - docIva) <= 1
  const initial = ex && { company_id: '', date: ex.date, provider: ex.provider ?? '', invoice_number: exLoan?.invoice_number ?? '', amount: withIva ? docTotal - docIva : docTotal,
    details: { ...emptyDetails(kind), ...ex.details, ...(withIva ? { has_iva: true, iva: loanIva(docTotal - docIva) } : {}) } } as Partial<OperationInput>
  const detected = ex ? ((kind === 'food' ? [
    ['Fecha', ex.date && fdate(ex.date)], ['Proveedor', ex.provider], ['Solicitó', det.requested_by], ['Qué solicitó', det.requested_item],
    ['Valor insumo', det.supplies_value ? money(det.supplies_value) : ''], ['Valor transporte', det.transport_value ? money(det.transport_value) : ''],
  ] : [
    ['Fecha', ex.date && fdate(ex.date)], ['Proveedor', ex.provider], ['Valor', exLoan?.amount ? money(exLoan.amount) : ''], ['Factura', exLoan?.invoice_number],
    ['Solicitud', det.request], ['Fecha de factura', det.invoice_date && fdate(det.invoice_date)], ['COT', det.cot],
    ['OC', det.oc], ['Solicitó', det.requested_by],
  ]) as [string, string | undefined][]).filter(([, v]) => v) : []

  if (stage === 'idle') return (
    <>
      <PageHeader title={title} actions={<BackButton onClick={onBack} />} />
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]) }} onClick={() => input.current?.click()} tabIndex={0}
        className="card border-dashed grid place-items-center text-center py-20 cursor-pointer hover:border-brand transition outline-none focus:border-brand">
        <div><ClipboardPaste className="mx-auto text-brand mb-3" size={36} />
          <p className="font-medium">Pega una imagen con <kbd className="px-1.5 py-0.5 rounded border border-line text-xs">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded border border-line text-xs">V</kbd></p>
          <p className="text-sm text-muted mt-1">o arrastra / haz clic para subir un PDF, imagen o screenshot</p>
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}</div>
        <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </>
  )

  if (stage === 'manual') return (
    <>
      <PageHeader title={title} actions={<button className="btn-ghost" onClick={reset}>Adjuntar documento</button>} />
      <div className="card p-5 max-w-4xl mx-auto"><ServiceForm type={kind} busy={busy} onCancel={onBack} onSubmit={(v, docs) => save(v, docs)} /></div>
    </>
  )

  return (
    <>
      <PageHeader title={title} subtitle={file ? `${file.name} · ${fsize(file.size)}` : ''} actions={<button className="btn-ghost" onClick={reset}><RotateCcw size={14} />Otro archivo</button>} />
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="card p-3 lg:sticky lg:top-6 h-[70vh]"><FilePreview url={url} mime={file?.type} className="h-full" /></div>
        <div className="card p-5">
          {stage === 'processing' && (
            <div className="text-center py-16 text-muted flex flex-col items-center gap-3"><Spinner className="text-brand" /><p className="text-sm">Analizando documento…</p>
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2 mt-2">
                {error && file && <button className="btn-ghost" onClick={() => file && analyze(file)}>Reintentar</button>}
                <button className="btn-ghost" onClick={manual}>Llenar manualmente sin esperar</button>
              </div>
            </div>
          )}
          {stage === 'done' && initial && (
            <>
              <div className="rounded-lg bg-surface2 p-3 mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Datos detectados</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{detected.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-muted">{k}:</dt><dd className="truncate">{v}</dd></div>)}</dl>
              </div>
              <ServiceForm key={`${kind}-extracted`} type={kind} initial={initial} busy={busy} onCancel={reset} onSubmit={(v, docs) => save(v, docs)}
                initialDocs={file ? [{ file, category: kind === 'loan' ? 'payment' : 'other' }] : []} />
            </>
          )}
        </div>
      </div>
    </>
  )
}
