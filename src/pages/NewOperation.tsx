import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileUp, Paperclip, PenLine } from 'lucide-react'
import LoanIntake from '../components/LoanIntake'
import PdfIntake from '../components/PdfIntake'
import ServiceForm from '../components/ServiceForm'
import { PageHeader, BackButton } from '../components/ui'
import { SERVICE_LABEL } from '../lib/format'
import { SECTIONS, type SectionKey } from '../lib/sections'
import { dataService } from '../services'

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

  if ((section === 'flight' || section === 'hotel' || section === 'loan') && !mode) return (
    <>
      <PageHeader title={sec.newLabel} subtitle="¿Cómo quieres registrarlo?" actions={<BackButton onClick={back} />} />
      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl mx-auto">
        <Choice icon={FileUp} title={section === 'hotel' ? 'Cargar PDF / voucher' : section === 'loan' ? 'Cargar comprobante' : 'Cargar PDF'} text={section === 'loan' ? 'Pega (Ctrl+V) o sube un PDF, imagen o screenshot, analízalo y corrige los datos.' : 'Sube el documento, analízalo y corrige los datos detectados.'} onClick={() => setParams({ modo: 'pdf' })} />
        <Choice icon={PenLine} title="Registrar manualmente" text="Abre directamente el formulario." onClick={() => setParams({ modo: 'manual' })} />
      </div>
    </>
  )
  if (section === 'loan') return <LoanIntake key={mode} start={mode === 'manual' ? 'manual' : 'idle'} onBack={() => setParams({})} />
  if (mode === 'pdf' && (section === 'flight' || section === 'hotel')) return <PdfIntake type={section} onBack={() => setParams({})} />

  const type = sec.types[0]
  return (
    <>
      <PageHeader title={`Nuevo registro: ${SERVICE_LABEL[type]}`} actions={<BackButton onClick={back} />} />
      <div className="card p-5 max-w-4xl mx-auto">
        <ServiceForm key={type} type={type} busy={busy} onCancel={back}
          onSubmit={async input => {
            setBusy(true)
            const row = await dataService.createOperation(input, files[0] ?? null)
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
      </div>
    </>
  )
}
