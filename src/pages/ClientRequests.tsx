import { useEffect, useState } from 'react'
import { FilterX, Link2, MessageSquare } from 'lucide-react'
import RequestConversation, { LinkModal } from '../components/RequestConversation'
import { Empty, FilterBar, Loading, Modal, PageHeader, Select, Spinner } from '../components/ui'
import { refreshAll, useAsync, useDebounced } from '../hooks'
import { dataService } from '../services'
import { companyAccessAdmin } from '../services/companyPortal'
import { requestsService, type RequestFilters } from '../services/requests'
import { APPROVAL_CLS, APPROVAL_LABEL, type ApprovalStatus } from '../types/company'
import { displayStatus, REQUEST_TYPE_LABEL, STATUS_FILTERS, typeLabel, type ClientRequestRow, type RequestType } from '../types/requests'

const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`
}
const TYPES = Object.keys(REQUEST_TYPE_LABEL) as RequestType[]
const APPROVALS = Object.keys(APPROVAL_LABEL) as ApprovalStatus[]

export default function ClientRequests() {
  const [f, setF] = useState<RequestFilters>({})
  const q = useDebounced(f.search)
  const filters = { ...f, search: q }
  const { data, loading, error, reload } = useAsync(() => requestsService.list(filters), [JSON.stringify(filters)])
  const { data: pending, reload: reloadPending } = useAsync(() => requestsService.pendingCleanup().catch(() => 0), [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [genName, setGenName] = useState('')
  const [genError, setGenError] = useState('')
  const [link, setLink] = useState<{ token: string; name: string; company?: string } | null>(null)
  const [genCompany, setGenCompany] = useState('')
  const { data: companies } = useAsync(() => dataService.getCompanies().catch(() => []), [])
  const [retrying, setRetrying] = useState(false)
  const set = (k: keyof RequestFilters) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))

  // Retries any pending Storage cleanup when the section opens, and checks the inbox periodically (only while the tab is visible).
  useEffect(() => { requestsService.processCleanup().then(reloadPending, () => undefined) }, [])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshAll() }, 30_000)
    return () => clearInterval(t)
  }, [])

  // Creates an empty conversation + private link; the optional name is stored on the request so the portal can greet the client.
  const generate = async () => {
    setGenerating(true); setGenError('')
    try {
      if (genCompany) {
        const company = companies?.find(c => c.id === genCompany)?.name ?? ''
        setLink({ token: await companyAccessAdmin.generateLink(genCompany), name: '', company }); setGenOpen(false); setGenCompany('')
      } else { const r = await requestsService.create(genName); setLink({ token: r.token, name: genName.trim() }); setGenOpen(false); setGenName(''); reload() }
    }
    catch (e) { setGenError(e instanceof Error ? e.message : 'No se pudo generar el enlace.') } finally { setGenerating(false) }
  }
  const retry = async () => { setRetrying(true); try { await requestsService.processCleanup() } finally { setRetrying(false); reloadPending() } }
  const rows = data ?? []

  return (
    <>
      <PageHeader title="Solicitudes de clientes" subtitle={`${rows.length} conversaciones`} actions={<button className="btn-primary" onClick={() => { setGenError(''); setGenOpen(true) }}><Link2 size={16} />Generar enlace</button>} />
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generar enlace de solicitud">
        <form className="space-y-3 text-sm" onSubmit={e => { e.preventDefault(); generate() }}>
          <label className="label" htmlFor="gen-company">¿Para qué empresa es el enlace?</label>
          <Select id="gen-company" value={genCompany} onChange={e => setGenCompany(e.target.value)}>
            <option value="">Cliente sin empresa</option>
            {(companies ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {genCompany ? (
            <p className="text-muted">Se generará el enlace de la empresa. Cada empleado escribirá su nombre al abrirlo y tendrá su propia conversación con chat y formulario; la empresa aprueba o rechaza desde su portal.</p>
          ) : (
            <>
              <p className="text-muted">Se creará una conversación vacía con un enlace privado. El cliente completará sus datos y elegirá qué necesita.</p>
              <label className="label" htmlFor="gen-name">Nombre del cliente (opcional)</label>
              <input id="gen-name" className="input" value={genName} maxLength={160} onChange={e => setGenName(e.target.value)} placeholder="Ej.: Carlos Pérez" autoComplete="off" />
              <p className="text-xs text-muted">Si lo escribes, el portal saludará al cliente por su nombre y el mensaje de WhatsApp lo incluirá.</p>
            </>
          )}
          {genError && <p role="alert" className="text-sm text-red-500">{genError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={generating} onClick={() => setGenOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={generating}>{generating && <Spinner />}Generar enlace</button>
          </div>
        </form>
      </Modal>
      {!!pending && pending > 0 && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          Hay {pending} archivo(s) pendientes de eliminar del almacenamiento privado.<button className="btn-ghost !py-1" disabled={retrying} onClick={retry}>{retrying && <Spinner />}Reintentar limpieza</button></p>
      )}
      <FilterBar search={f.search ?? ''} onSearch={v => setF(p => ({ ...p, search: v }))} active={Object.entries(f).filter(([k, x]) => k !== 'search' && x).length}>
        <div className="md:w-52"><Select value={f.status ?? ''} onChange={set('status')} aria-label="Estado">{STATUS_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></div>
        <div className="md:w-52"><Select value={f.approval ?? ''} onChange={set('approval')} aria-label="Aprobación"><option value="">Toda aprobación</option><option value="none">Sin empresa</option>{APPROVALS.map(a => <option key={a} value={a}>{APPROVAL_LABEL[a]}</option>)}</Select></div>
        <div className="md:w-44"><Select value={f.type ?? ''} onChange={set('type')} aria-label="Tipo"><option value="">Todos los tipos</option>{TYPES.map(t => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}</Select></div>
        <input type="date" className="input md:!w-40" aria-label="Creada desde" value={f.date_from ?? ''} onChange={set('date_from')} />
        <input type="date" className="input md:!w-40" aria-label="Creada hasta" value={f.date_to ?? ''} onChange={set('date_to')} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => setF({})}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>

      <div className="card overflow-hidden">
        {loading && !data ? <Loading /> : error ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : rows.length === 0 ? <Empty>No hay solicitudes con estos filtros.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="border-b border-line bg-surface2/50">{['Cliente', 'Empresa', 'Tipo', 'Estado', 'Aprobación', 'Creada', 'Última actividad', 'Sin leer'].map(h => <th key={h} className="th !px-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r: ClientRequestRow) => {
              const st = displayStatus(r)
              return (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-surface2/60">
                  <td className="td !px-3 !whitespace-normal"><p className={r.client_name ? 'font-medium' : 'font-medium text-muted'}>{r.client_name || 'Cliente sin identificar'}</p><p className="text-xs text-muted">{r.client_email || r.client_phone || (r.company_id ? 'Empleado de la empresa' : 'Aún no abre el enlace')}</p></td>
                  <td className="td !px-3 !whitespace-normal">{r.company_name || <span className="text-muted">—</span>}</td>
                  <td className="td !px-3">{typeLabel(r.request_type)}</td>
                  <td className="td !px-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>{!r.link_active && <span className="ml-2 text-xs text-muted">enlace revocado</span>}</td>
                  <td className="td !px-3">{r.approval_status ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${APPROVAL_CLS[r.approval_status]}`}>{APPROVAL_LABEL[r.approval_status]}</span> : <span className="text-muted">—</span>}</td>
                  <td className="td !px-3">{when(r.created_at)}</td>
                  <td className="td !px-3" title={when(r.last_activity_at)}>{ago(r.last_activity_at)}</td>
                  <td className="td !px-3">{r.agency_unread > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white dark:text-slate-900"><MessageSquare size={11} />{r.agency_unread}</span> : <span className="text-muted">—</span>}</td>
                </tr>)
            })}</tbody>
          </table></div>
        )}
      </div>

      <LinkModal link={link} onClose={() => setLink(null)} />
      <RequestConversation id={openId} onClose={() => setOpenId(null)} onChanged={() => { reload(); reloadPending() }} />
    </>
  )
}
