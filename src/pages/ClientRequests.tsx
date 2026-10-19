import { useEffect, useState } from 'react'
import { FilterX, Link2, MessageSquare } from 'lucide-react'
import RequestConversation, { LinkModal } from '../components/RequestConversation'
import { Empty, FilterBar, Loading, PageHeader, Select, Spinner } from '../components/ui'
import { refreshAll, useAsync, useDebounced } from '../hooks'
import { requestsService, type RequestFilters } from '../services/requests'
import { displayStatus, REQUEST_TYPE_LABEL, STATUS_FILTERS, typeLabel, type ClientRequestRow, type RequestType } from '../types/requests'

const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`
}
const TYPES = Object.keys(REQUEST_TYPE_LABEL) as RequestType[]

export default function ClientRequests() {
  const [f, setF] = useState<RequestFilters>({})
  const q = useDebounced(f.search)
  const filters = { ...f, search: q }
  const { data, loading, error, reload } = useAsync(() => requestsService.list(filters), [JSON.stringify(filters)])
  const { data: pending, reload: reloadPending } = useAsync(() => requestsService.pendingCleanup().catch(() => 0), [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [link, setLink] = useState<{ token: string; name: string } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const set = (k: keyof RequestFilters) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))

  // Retries any pending Storage cleanup when the section opens, and checks the inbox periodically (only while the tab is visible).
  useEffect(() => { requestsService.processCleanup().then(reloadPending, () => undefined) }, [])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshAll() }, 30_000)
    return () => clearInterval(t)
  }, [])

  // One click: an empty conversation + private link (the client fills in name, contact and what they need)
  const generate = async () => {
    setGenerating(true); setGenError('')
    try { const r = await requestsService.create(); setLink({ token: r.token, name: '' }); reload() }
    catch (e) { setGenError(e instanceof Error ? e.message : 'No se pudo generar el enlace.') } finally { setGenerating(false) }
  }
  const retry = async () => { setRetrying(true); try { await requestsService.processCleanup() } finally { setRetrying(false); reloadPending() } }
  const rows = data ?? []

  return (
    <>
      <PageHeader title="Solicitudes de clientes" subtitle={`${rows.length} conversaciones`} actions={<button className="btn-primary" disabled={generating} onClick={generate}>{generating ? <Spinner /> : <Link2 size={16} />}Generar enlace</button>} />
      {genError && <p role="alert" className="mb-4 text-sm text-red-500">{genError}</p>}
      {!!pending && pending > 0 && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          Hay {pending} archivo(s) pendientes de eliminar del almacenamiento privado.<button className="btn-ghost !py-1" disabled={retrying} onClick={retry}>{retrying && <Spinner />}Reintentar limpieza</button></p>
      )}
      <FilterBar search={f.search ?? ''} onSearch={v => setF(p => ({ ...p, search: v }))} active={Object.entries(f).filter(([k, x]) => k !== 'search' && x).length}>
        <div className="md:w-52"><Select value={f.status ?? ''} onChange={set('status')} aria-label="Estado">{STATUS_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></div>
        <div className="md:w-44"><Select value={f.type ?? ''} onChange={set('type')} aria-label="Tipo"><option value="">Todos los tipos</option>{TYPES.map(t => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}</Select></div>
        <input type="date" className="input md:!w-40" aria-label="Creada desde" value={f.date_from ?? ''} onChange={set('date_from')} />
        <input type="date" className="input md:!w-40" aria-label="Creada hasta" value={f.date_to ?? ''} onChange={set('date_to')} />
        <button type="button" className="btn-ghost col-span-2 md:col-span-1" onClick={() => setF({})}><FilterX size={14} />Limpiar filtros</button>
      </FilterBar>

      <div className="card overflow-hidden">
        {loading && !data ? <Loading /> : error ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : rows.length === 0 ? <Empty>No hay solicitudes con estos filtros.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="border-b border-line bg-surface2/50">{['Cliente', 'Tipo', 'Estado', 'Creada', 'Última actividad', 'Sin leer'].map(h => <th key={h} className="th !px-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r: ClientRequestRow) => {
              const st = displayStatus(r)
              return (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-surface2/60">
                  <td className="td !px-3 !whitespace-normal"><p className={r.client_name ? 'font-medium' : 'font-medium text-muted'}>{r.client_name || 'Cliente sin identificar'}</p><p className="text-xs text-muted">{r.client_email || r.client_phone || 'Aún no abre el enlace'}</p></td>
                  <td className="td !px-3">{typeLabel(r.request_type)}</td>
                  <td className="td !px-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>{!r.link_active && <span className="ml-2 text-xs text-muted">enlace revocado</span>}</td>
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
