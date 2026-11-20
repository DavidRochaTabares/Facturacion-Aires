import { useCallback, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { companyAccessAdmin } from '../services/companyPortal'
import { APPROVAL_ACTION_LABEL, APPROVAL_CLS, APPROVAL_LABEL, type ApprovalEvent, type ApprovalStatus } from '../types/company'
import { Spinner } from './ui'

const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
type AgencyStatus = Exclude<ApprovalStatus, 'approved' | 'rejected'>
const AGENCY_STATUSES: AgencyStatus[] = ['in_management', 'completed', 'pending_approval']

/** Agency view of a company conversation's approval state: current state, full history (never edited), and the agency's own status changes. */
export function ApprovalPanel({ requestId, companyName, status, version, onChanged }: { requestId: string; companyName: string; status: ApprovalStatus | null; version: string; onChanged: () => void }) {
  const [events, setEvents] = useState<ApprovalEvent[] | null>(null)
  const [error, setError] = useState('')
  const [next, setNext] = useState<AgencyStatus | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setEvents(await companyAccessAdmin.approvals(requestId)); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.') }
  }, [requestId])
  useEffect(() => { load() }, [load, status, version])
  useEffect(() => { setNext(''); setNote('') }, [requestId])

  const apply = async () => {
    if (!next) return
    setBusy(true); setError('')
    try { await companyAccessAdmin.setApproval(requestId, next, note.trim()); setNext(''); setNote(''); await load(); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar el estado.') } finally { setBusy(false) }
  }

  const last = events?.length ? events[events.length - 1] : null
  const reopened = status === 'pending_approval' && last?.action === 'reopen' && last.actor_type === 'system'
  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Aprobación de {companyName}</h3>
        {status && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${APPROVAL_CLS[status]}`}>{APPROVAL_LABEL[status]}</span>}
      </div>
      {reopened && <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"><RotateCcw size={14} className="mt-0.5 shrink-0" />Estaba aprobada y volvió a pendiente porque se agregó un nuevo requerimiento ({when(last!.created_at)}).</p>}
      <p className="mt-2 text-xs text-muted">Aprobar o rechazar lo hace el administrador de la empresa. La agencia puede marcar la conversación como en gestión, finalizada o devolverla a pendiente.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-44"><label className="label" htmlFor="ap-next">Cambiar estado</label>
          <select id="ap-next" className="input" value={next} onChange={e => setNext(e.target.value as AgencyStatus | '')}>
            <option value="">Selecciona…</option>{AGENCY_STATUSES.filter(s => s !== status).map(s => <option key={s} value={s}>{APPROVAL_LABEL[s]}</option>)}
          </select></div>
        <div className="min-w-48 flex-1"><label className="label" htmlFor="ap-note">Observación (opcional)</label><input id="ap-note" className="input" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></div>
        <button className="btn-primary" disabled={!next || busy} onClick={apply}>{busy && <Spinner />}Aplicar</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
      <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Historial</h4>
      {!events ? <p className="text-sm text-muted">Cargando…</p> : events.length === 0 ? <p className="text-sm text-muted">Sin movimientos.</p> : (
        <ol className="space-y-2 border-l-2 border-line pl-4">{[...events].reverse().map(h => (
          <li key={h.id} className="relative text-sm">
            <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
            <p className="font-medium">{APPROVAL_ACTION_LABEL[h.action]}{h.to_status && h.action !== 'created' ? ` → ${APPROVAL_LABEL[h.to_status]}` : ''}</p>
            <p className="text-xs text-muted">{when(h.created_at)} · {h.actor_type === 'company_admin' ? `Administrador (${h.actor_label})` : h.actor_type === 'agency' ? 'Aires y Destinos' : 'Sistema'}</p>
            {h.note && <p className="mt-1 whitespace-pre-wrap text-sm">{h.note}</p>}
          </li>))}</ol>
      )}
    </section>
  )
}
