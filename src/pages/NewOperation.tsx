import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileUp, Paperclip, PenLine } from 'lucide-react'
import LoanIntake from '../components/LoanIntake'
import PdfIntake from '../components/PdfIntake'
import ServiceForm from '../components/ServiceForm'
import { PageHeader, BackButton } from '../components/ui'
import { SERVICE_LABEL } from '../lib/format'
import { requestToInitial } from '../lib/requestConversion'
import { SECTIONS, type SectionKey } from '../lib/sections'
import { dataService } from '../services'
import { requestsService } from '../services/requests'
import type { OperationInput } from '../types'

const Choice = ({ icon: I, title, text, onClick }: { icon: typeof FileUp; title: string; text: string; onClick: () => void }) => (
  <button onClick={onClick} className="card p-6 text-left hover:border-brand transition flex flex-col gap-3">
    <span className="h-10 w-10 rounded-lg bg-brand/10 text-brand grid place-items-center"><I size={20} /></span>
    <span className="font-medium">{title}</span><span className="text-sm text-muted">{text}</span>
  </button>
)

export default function NewOperation({ section }: { section: SectionKey }) {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const sec = SECTIONS[section]
  const mode = params.get('modo')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const back = () => nav(sec.path)
  // Opened from "Solicitudes de clientes > Crear operación": pre-fills the form for review; nothing is created automatically.
  const reqId = params.get('solicitud')
  const [prefill, setPrefill] = useState<{ initial: Partial<OperationInput>; name: string } | null>(null)
  const [prefillError, setPrefillError] = useState('')
  useEffect(() => {
    if (!reqId || (section !== 'flight' && section !== 'hotel')) return
    requestsService.get(reqId).then(r => (r ? setPrefill({ initial: requestToInitial(r, section), name: r.client_name }) : setPrefillError('La solicitud ya no existe.')), e => setPrefillError(e instanceof Error ? e.message : 'No se pudo cargar la solicitud.'))
  }, [reqId, section])

  if ((section === 'flight' || section === 'hotel' || section === 'loan' || section === 'food') && !mode) return (
    <>
      <PageHeader title={sec.newLabel} subtitle="¿Cómo quieres registrarlo?" actions={<BackButton onClick={back} />} />
      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl mx-auto">
        <Choice icon={FileUp} title={section === 'hotel' ? 'Cargar PDF / voucher' : section === 'loan' ? 'Cargar comprobante' : section === 'food' ? 'Cargar documento' : 'Cargar PDF'} text={section === 'loan' || section === 'food' ? 'Pega (Ctrl+V) o sube un PDF, imagen o screenshot, analízalo y corrige los datos.' : 'Sube el documento, analízalo y corrige los datos detectados.'} onClick={() => setParams({ modo: 'pdf' })} />
        <Choice icon={PenLine} title="Registrar manualmente" text="Abre directamente el formulario." onClick={() => setParams({ modo: 'manual' })} />
      </div>
    </>
  )
  if (section === 'loan') return <LoanIntake key={mode} start={mode === 'manual' ? 'manual' : 'idle'} onBack={() => setParams({})} />
  if (mode === 'pdf' && section === 'food') return <LoanIntake key="food" kind="food" onBack={() => setParams({})} />
  if (mode === 'pdf' && (section === 'flight' || section === 'hotel')) return <PdfIntake type={section} onBack={() => setParams({})} />

  const type = sec.types[0]
  const waiting = !!reqId && (section === 'flight' || section === 'hotel') && !prefill && !prefillError
  return (
    <>
      <PageHeader title={`Nuevo registro: ${SERVICE_LABEL[type]}`} actions={<BackButton onClick={back} />} />
      {prefill && <p role="status" className="mx-auto mb-3 max-w-4xl rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm">Datos precargados desde la solicitud de <b>{prefill.name}</b>. Revisa y corrige todo antes de guardar: no se crea nada automáticamente.</p>}
      {prefillError && <p role="alert" className="mx-auto mb-3 max-w-4xl rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{prefillError} Puedes registrar la operación manualmente.</p>}
      {waiting ? <div className="py-16 text-center text-muted">Cargando solicitud…</div> : <div className="card p-5 max-w-4xl mx-auto">
        <ServiceForm key={type + (prefill ? 'p' : '')} type={type} initial={prefill?.initial} busy={busy} onCancel={back}
          onSubmit={async input => {
            setBusy(true)
            const row = await dataService.createOperation(input, files[0] ?? null)
            if (reqId && prefill) await requestsService.linkOperation(reqId, row.id).catch(() => undefined)
            try { for (const f of files.slice(1)) await dataService.addDocument(row.id, f) }
            catch (e) { alert(`El registro se guardó, pero no se pudo subir un archivo adicional: ${e instanceof Error ? e.message : 'error desconocido'}. Puedes adjuntarlo desde el detalle.`) }
            back()
          }}>
          <div>
            <label className="label">Documentos adjuntos (opcional, puedes elegir varios)</label>
            <label className="btn-ghost cursor-pointer"><Paperclip size={14} />{files.length ? (files.length === 1 ? files[0].name : `${files.length} archivos seleccionados`) : 'Adjuntar archivos'}
              <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e => setFiles([...(e.target.files ?? [])])} /></label>
            {files.length > 1 && <p className="mt-1 text-xs text-muted">{files.map(f => f.name).join(', ')}</p>}
          </div>
        </ServiceForm>
      </div>}
    </>
  )
}
