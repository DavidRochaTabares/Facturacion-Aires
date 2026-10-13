import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, RotateCcw } from 'lucide-react'
import { fdate, fsize, money } from '../lib/format'
import { dataService } from '../services'
import type { ExtractedLoan, OperationInput } from '../types'
import ServiceForm, { emptyDetails } from './ServiceForm'
import { FilePreview, PageHeader, Spinner, BackButton } from './ui'

type Stage = 'idle' | 'selected' | 'processing' | 'done' | 'manual'

export default function LoanIntake({ onBack, start = 'idle' }: { onBack: () => void; start?: 'idle' | 'manual' }) {
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>(start)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [ex, setEx] = useState<ExtractedLoan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = (f?: File) => {
    if (!f) return
    if (!f.type.startsWith('image/') && f.type !== 'application/pdf') return setError('Selecciona un PDF o una imagen')
    setError(''); setFile(f); setUrl(URL.createObjectURL(f)); setEx(null); setStage('selected')
  }
  useEffect(() => {
    if (stage !== 'idle' && stage !== 'selected') return
    const h = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/') || x.type === 'application/pdf')
      if (f) { e.preventDefault(); pick(f) }
    }
    addEventListener('paste', h)
    return () => removeEventListener('paste', h)
  }, [stage])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const analyze = async () => {
    if (!file) return
    setStage('processing'); setError('')
    try {
      setEx(await dataService.extractLoanDocument(file))
      setStage('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo analizar el documento.')
      setStage('selected')
    }
  }
  const reset = () => { setFile(null); setUrl(null); setEx(null); setStage('idle') }
  const save = async (v: OperationInput) => { setBusy(true); await dataService.createOperation(v, file); nav('/prestamos') }

  const initial = ex && { company_id: '', date: ex.date, provider: ex.provider ?? '', invoice_number: ex.invoice_number ?? '', amount: ex.amount ?? 0, details: { ...emptyDetails('loan'), ...ex.details } }
  const detected = ex ? ([
    ['Fecha', ex.date && fdate(ex.date)], ['Proveedor', ex.provider], ['Valor', ex.amount ? money(ex.amount) : ''], ['Factura', ex.invoice_number],
    ['Solicitud', ex.details.request], ['Fecha de factura', ex.details.invoice_date && fdate(ex.details.invoice_date)], ['COT', ex.details.cot],
    ['OC', ex.details.oc], ['Solicitó', ex.details.requested_by],
  ] as [string, string | undefined][]).filter(([, v]) => v) : []

  if (stage === 'idle') return (
    <>
      <PageHeader title="Nuevo préstamo" actions={<BackButton onClick={onBack} />} />
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]) }} onClick={() => input.current?.click()} tabIndex={0}
        className="card border-dashed grid place-items-center text-center py-20 cursor-pointer hover:border-brand transition outline-none focus:border-brand">
        <div><ClipboardPaste className="mx-auto text-brand mb-3" size={36} />
          <p className="font-medium">Pega una imagen con <kbd className="px-1.5 py-0.5 rounded border border-line text-xs">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded border border-line text-xs">V</kbd></p>
          <p className="text-sm text-muted mt-1">o arrastra / haz clic para subir un PDF, imagen o screenshot</p>
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}</div>
        <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => pick(e.target.files?.[0])} />
      </div>
    </>
  )

  if (stage === 'manual') return (
    <>
      <PageHeader title="Nuevo préstamo" actions={<button className="btn-ghost" onClick={reset}>Adjuntar documento</button>} />
      <div className="card p-5 max-w-4xl mx-auto"><ServiceForm type="loan" busy={busy} onCancel={onBack} onSubmit={save} /></div>
    </>
  )

  return (
    <>
      <PageHeader title="Nuevo préstamo" subtitle={file ? `${file.name} · ${fsize(file.size)}` : ''} actions={<button className="btn-ghost" onClick={reset}><RotateCcw size={14} />Otro archivo</button>} />
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="card p-3 lg:sticky lg:top-6 h-[70vh]"><FilePreview url={url} mime={file?.type} className="h-full" /></div>
        <div className="card p-5">
          {stage === 'selected' && (
            <div className="text-center py-16"><p className="font-medium">Archivo listo</p><p className="text-sm text-muted mt-1 mb-4">Revisa la vista previa y analiza el documento.</p>
              <div className="flex justify-center gap-2"><button className="btn-primary" onClick={analyze}>Analizar documento</button><button className="btn-ghost" onClick={() => setStage('manual')}>Llenar manualmente</button></div>
              {error && <p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}</div>
          )}
          {stage === 'processing' && <div className="text-center py-16 text-muted flex flex-col items-center gap-3"><Spinner className="text-brand" /><p className="text-sm">Analizando documento…</p></div>}
          {stage === 'done' && initial && (
            <>
              <div className="rounded-lg bg-surface2 p-3 mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Datos detectados</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{detected.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-muted">{k}:</dt><dd className="truncate">{v}</dd></div>)}</dl>
              </div>
              <ServiceForm key="loan-extracted" type="loan" initial={initial} busy={busy} onCancel={reset} onSubmit={save} />
            </>
          )}
        </div>
      </div>
    </>
  )
}
