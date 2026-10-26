import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, RotateCcw } from 'lucide-react'
import { blockStrayFileDrops, normalizeDocFile } from '../lib/files'
import { fsize } from '../lib/format'
import { SECTIONS } from '../lib/sections'
import { dataService } from '../services'
import type { OperationInput } from '../types'
import ServiceForm from './ServiceForm'
import { FilePreview, PageHeader, Spinner, BackButton } from './ui'

type Stage = 'idle' | 'selected' | 'processing' | 'done'
const LABEL = { flight: 'vuelo', hotel: 'hotel' } as const

export default function PdfIntake({ type, onBack }: { type: 'flight' | 'hotel'; onBack: () => void }) {
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [result, setResult] = useState<{ provider?: string; amount?: number; details: any } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = `Nuevo ${LABEL[type]} desde PDF`

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  useEffect(() => blockStrayFileDrops(), [])

  const pick = async (f?: File) => {
    if (!f) return
    try {
      const n = await normalizeDocFile(f, 'pdf')
      setError(''); setFile(n); setUrl(URL.createObjectURL(n)); setResult(null); setStage('selected')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.') }
  }
  const analyze = async () => {
    if (!file) return
    setStage('processing'); setError('')
    try {
      setResult(type === 'flight' ? await dataService.extractEmission(file) : await dataService.extractHotelVoucher(file))
      setStage('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo analizar el documento.')
      setStage('selected')
    }
  }
  const reset = () => { setFile(null); setUrl(null); setResult(null); setStage('idle') }

  if (stage === 'idle') return (
    <>
      <PageHeader title={title} subtitle="Un PDF por vez" actions={<BackButton onClick={onBack} />} />
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]) }} onClick={() => input.current?.click()}
        className="card border-dashed grid place-items-center text-center py-24 cursor-pointer hover:border-brand transition">
        <div><FileUp className="mx-auto text-brand mb-3" size={36} /><p className="font-medium">Arrastra un PDF o haz clic para seleccionarlo</p><p className="text-sm text-muted mt-1">Solo archivos .pdf</p>
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}</div>
        <input ref={input} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </>
  )

  const initial = result && { provider: result.provider ?? '', amount: result.amount ?? 0, details: result.details } as Partial<OperationInput>

  return (
    <>
      <PageHeader title={title} subtitle={file ? `${file.name} · ${fsize(file.size)}` : ''} actions={<button className="btn-ghost" onClick={reset}><RotateCcw size={14} />Otro archivo</button>} />
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="card p-3 lg:sticky lg:top-6 h-[70vh]"><FilePreview url={url} className="h-full" /></div>
        <div className="card p-5">
          {stage === 'selected' && (
            <div className="text-center py-16"><p className="font-medium">Archivo listo</p><p className="text-sm text-muted mt-1 mb-4">Revisa la vista previa y analiza el documento.</p>
              <button className="btn-primary" onClick={analyze}>Analizar PDF</button>
              {error && <p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}</div>
          )}
          {stage === 'processing' && <div className="text-center py-16 text-muted flex flex-col items-center gap-3"><Spinner className="text-brand" /><p className="text-sm">Analizando documento…</p></div>}
          {stage === 'done' && initial && (
            <>
              <p className="text-sm text-muted mb-4">Información extraída. Corrige y completa lo que falte antes de guardar.</p>
              <ServiceForm key={type + (result?.details.booking_code ?? result?.details.reservation_number)} type={type} initial={initial} busy={busy} onCancel={reset}
                initialDocs={file ? [{ file, category: 'ticket' }] : []}
                onSubmit={async (v, docs) => { setBusy(true); await dataService.createOperation(v, docs); nav(SECTIONS[type].path) }} />
            </>
          )}
        </div>
      </div>
    </>
  )
}
