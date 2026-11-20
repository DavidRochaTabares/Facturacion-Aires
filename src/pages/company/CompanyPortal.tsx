import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Check, Eye, EyeOff, LogOut, MessageSquare, Moon, Send, Sun, X } from 'lucide-react'
import { AttachmentCard, type UrlResolver } from '../../components/AttachmentPreview'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { detailFacts } from '../../components/RequestConversation'
import { AgencyLogo, Drawer, Empty, Loading, Spinner } from '../../components/ui'
import { useTheme } from '../../hooks'
import { ACTIVATION_TOKEN, AUTH_LINK_ERROR, OPENED_FROM_RECOVERY_LINK } from '../../lib/authHash'
import { supabase } from '../../lib/supabase'
import { companyPortal } from '../../services/companyPortal'
import { APPROVAL_ACTION_LABEL, APPROVAL_CLS, APPROVAL_LABEL, type ApprovalStatus, type CompanyConversation, type CompanyConversationRow, type CompanyPortalMe } from '../../types/company'
import { typeLabel, type RequestAttachment, type RequestPassenger } from '../../types/requests'

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const dmy = (d?: string | number) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const STATUSES = Object.keys(APPROVAL_LABEL) as ApprovalStatus[]
const POLL_MS = 20_000

function Badge({ status }: { status: ApprovalStatus | null }) {
  if (!status) return <span className="rounded-full bg-slate-500/10 px-2.5 py-0.5 text-xs font-medium text-muted">Sin estado</span>
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${APPROVAL_CLS[status]}`}>{APPROVAL_LABEL[status]}</span>
}

function Frame({ children, company, onSignOut }: { children: React.ReactNode; company?: string; onSignOut?: () => void }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2.5 sm:px-5">
          <AgencyLogo size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight sm:text-base">{company || 'Aires y Destinos'}</p>
            <p className="truncate text-[10px] uppercase tracking-[0.18em] text-muted">Portal empresarial · Aires y Destinos</p>
          </div>
          <button type="button" onClick={toggle} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition hover:text-brand">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          {onSignOut && <button type="button" className="btn-ghost" onClick={onSignOut}><LogOut size={14} /><span className="hidden sm:inline">Cerrar sesión</span></button>}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-5">{children}</main>
    </div>
  )
}

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div><label className="label">{label}</label>
      <div className="relative">
        <input className="input pr-10" type={show ? 'text' : 'password'} required autoComplete={autoComplete} value={value} onChange={e => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted" aria-label="Mostrar contraseña">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </div>
    </div>
  )
}

// The one-time token must be exchanged exactly once (React StrictMode runs effects twice in development).
let activation: Promise<boolean> | null = null
const activate = () => (activation ??= supabase.auth.verifyOtp({ token_hash: ACTIVATION_TOKEN, type: 'recovery' }).then(({ error }) => !error))

function Login({ expired }: { expired: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(AUTH_LINK_ERROR || expired ? 'El enlace de acceso venció o ya fue usado. Pide a Aires y Destinos uno nuevo o usa «Olvidé mi contraseña».' : '')
  const [info, setInfo] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setInfo('')
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (err) setError('Correo o contraseña incorrectos, o el acceso está desactivado.')
    setBusy(false)
  }
  const forgot = async () => {
    if (!email.trim()) { setError('Escribe tu correo para enviarte el enlace de restablecimiento.'); return }
    setBusy(true); setError(''); setInfo('')
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/empresa` })
    setInfo('Si el correo corresponde a un administrador, recibirás un enlace para definir una nueva contraseña.')
    setBusy(false)
  }
  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <div className="mb-6 text-center"><h1 className="text-xl font-semibold">Portal empresarial</h1><p className="mt-1 text-sm text-muted">Ingresa con la cuenta de administrador de tu empresa</p></div>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <div><label className="label">Correo electrónico</label><input className="input" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <PasswordField label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {info && <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{info}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Ingresar</button>
        <button type="button" className="w-full text-center text-xs text-brand hover:underline" disabled={busy} onClick={forgot}>Olvidé mi contraseña</button>
      </form>
    </div>
  )
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (p1.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (p1 !== p2) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password: p1 })
    setBusy(false)
    if (err) setError(err.message); else onDone()
  }
  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <div className="mb-6 text-center"><h1 className="text-xl font-semibold">Define tu contraseña</h1><p className="mt-1 text-sm text-muted">Será la que uses para entrar al portal empresarial.</p></div>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <PasswordField label="Nueva contraseña" value={p1} onChange={setP1} autoComplete="new-password" />
        <PasswordField label="Repite la contraseña" value={p2} onChange={setP2} autoComplete="new-password" />
        {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Guardar contraseña</button>
      </form>
    </div>
  )
}

function Requirement({ title, type, description, observations, details, passengers, files, resolve }: {
  title: string; type: CompanyConversation['request']['request_type']; description: string; observations: string; details: Record<string, string | number>
  passengers: RequestPassenger[]; files: RequestAttachment[]; resolve: UrlResolver
}) {
  const facts = detailFacts(details)
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium">{title} <span className="font-normal text-muted">· {typeLabel(type)}</span></p>
      {facts.length > 0 && <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">{facts.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="break-words text-sm">{v}</dd></div>)}</dl>}
      {description && <p className="mt-2 whitespace-pre-wrap text-sm">{description}</p>}
      {observations && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{observations}</p>}
      {passengers.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{passengers.map(p => (
          <div key={p.id} className="rounded-lg border border-line p-2 text-sm">
            <p className="font-medium">{p.first_names} {p.last_names}</p>
            <p className="text-xs text-muted">{[p.document_type, p.document_number].filter(Boolean).join(' ')}{p.birth_date ? ` · Nac. ${dmy(p.birth_date)}` : ''}</p>
            {files.filter(a => a.passenger_id === p.id).map(a => <div key={a.id} className="mt-2 w-72 max-w-full"><AttachmentCard att={a} resolve={resolve} /></div>)}
          </div>))}</div>
      )}
      {files.filter(a => a.kind === 'supporting').length > 0 && <ul className="mt-2 space-y-1">{files.filter(a => a.kind === 'supporting').map(a => <li key={a.id} className="w-72 max-w-full"><AttachmentCard att={a} resolve={resolve} /></li>)}</ul>}
    </div>
  )
}

function ConversationDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<CompanyConversation | null>(null)
  const [loadError, setLoadError] = useState('')
  const [note, setNote] = useState('')
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async (quiet = false) => {
    if (!id) return
    try { setData(await companyPortal.get(id)); setLoadError('') }
    catch (e) { if (!quiet) setLoadError(e instanceof Error ? e.message : 'No se pudo cargar la conversación.') }
  }, [id])
  useEffect(() => { setData(null); setLoadError(''); setNote(''); setText(''); setSendError(''); setActionError(''); lastCount.current = 0; if (id) load() }, [id, load])
  useEffect(() => {
    if (!id) return
    const tick = () => { if (document.visibilityState === 'visible') load(true) }
    const t = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [id, load])
  useEffect(() => { const n = data?.messages.length ?? 0; if (n !== lastCount.current) { lastCount.current = n; const el = list.current; if (el) el.scrollTop = el.scrollHeight } }, [data?.messages.length])

  const resolve: UrlResolver = a => companyPortal.signedUrl(data?.attachments.find(x => x.id === a.id)?.storage_path ?? '', a.file_name)
  const r = data?.request
  const pending = r?.approval_status === 'pending_approval'
  const mainPassengers = data?.passengers.filter(p => !p.item_id) ?? []
  const mainFiles = data?.attachments.filter(a => !a.item_id && a.kind !== 'message') ?? []
  const hasMain = !!r && (r.request_type || r.description || r.observations || Object.keys(r.details ?? {}).length || mainPassengers.length || mainFiles.length)

  const confirm = async () => {
    if (!id || !decision) return
    setBusy(true); setActionError('')
    try { await companyPortal.decide(id, decision, note.trim()); setDecision(null); setNote(''); await load(true); onChanged() }
    catch (e) { setActionError(e instanceof Error ? e.message : 'No se pudo registrar la decisión.'); load(true) }
    finally { setBusy(false) }
  }
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!id || sending || !text.trim()) return
    setSending(true); setSendError('')
    try { await companyPortal.post(id, text.trim()); setText(''); await load(true); onChanged() }
    catch (err) { setSendError(err instanceof Error ? err.message : 'No se pudo enviar.') } finally { setSending(false) }
  }

  return (
    <>
      <Drawer open={!!id} onClose={onClose} title="Conversación" wide>
        {!data || !r ? (loadError ? <p role="alert" className="text-sm text-red-500">{loadError}</p> : <Loading />) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-lg font-semibold">{r.employee_name}</h2><p className="text-xs text-muted">Iniciada {when(r.created_at)} · Última actividad {when(r.last_activity_at)}</p></div>
              <Badge status={r.approval_status} />
            </div>

            {pending && (
              <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <h3 className="text-sm font-semibold">Esta conversación espera tu decisión</h3>
                <p className="mt-1 text-xs text-muted">La decisión aplica a toda la conversación, con todos sus requerimientos. Queda registrada con tu usuario y la fecha.</p>
                <label className="label mt-3" htmlFor="decision-note">Observaciones (opcional)</label>
                <textarea id="decision-note" className="input min-h-16" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={() => { setActionError(''); setDecision('approve') }}><Check size={14} />Aprobar</button>
                  <button className="btn-ghost text-red-600 dark:text-red-400" onClick={() => { setActionError(''); setDecision('reject') }}><X size={14} />Rechazar</button>
                </div>
              </section>
            )}

            <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Requerimientos</h3>
              <div className="space-y-3">
                {hasMain && <Requirement title="Solicitud principal" type={r.request_type} description={r.description} observations={r.observations} details={r.details} passengers={mainPassengers} files={mainFiles} resolve={resolve} />}
                {data.items.map((it, i) => (
                  <Requirement key={it.id} title={`Requerimiento ${i + 1}`} type={it.request_type} description={it.description} observations={it.observations} details={it.details}
                    passengers={data.passengers.filter(p => p.item_id === it.id)} files={data.attachments.filter(a => a.item_id === it.id && a.kind !== 'message')} resolve={resolve} />))}
                {!hasMain && data.items.length === 0 && <p className="text-sm text-muted">El empleado aún no ha registrado requerimientos con formulario; revisa la conversación.</p>}
              </div>
            </section>

            <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Conversación</h3>
              <div ref={list} className="max-h-[50dvh] space-y-3 overflow-y-auto rounded-lg border border-line p-3">
                {data.messages.length === 0 && <p className="py-4 text-center text-sm text-muted">Aún no hay mensajes.</p>}
                {data.messages.map(m => (
                  <div key={m.id} className={`flex ${m.author === 'agency' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`min-w-0 max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.author === 'agency' ? 'bg-surface2 rounded-bl-sm' : 'bg-brand text-white dark:text-slate-900 rounded-br-sm'}`}>
                      <p className={`mb-0.5 text-[11px] font-medium ${m.author === 'agency' ? 'text-muted' : 'opacity-80'}`}>{m.author === 'agency' ? 'Aires y Destinos' : r.employee_name} · {when(m.created_at)}</p>
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      {data.attachments.filter(a => a.message_id === m.id).map(a => <div key={a.id} className="mt-2 w-72 max-w-full"><AttachmentCard att={a} resolve={resolve} auto /></div>)}
                    </div>
                  </div>))}
              </div>
              {r.closed ? <p className="mt-3 rounded-lg bg-surface2 p-3 text-sm">Conversación cerrada: ya no se pueden enviar mensajes.</p> : (
                <form onSubmit={send} className="mt-3 space-y-2">
                  {sendError && <p role="alert" className="text-sm text-red-500">{sendError}</p>}
                  <div className="flex items-end gap-1 rounded-3xl border border-line bg-surface2 p-1 transition focus-within:border-brand">
                    <textarea rows={1} placeholder="Escribe a Aires y Destinos…" aria-label="Mensaje" value={text} maxLength={4900} onChange={e => setText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
                      className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-5 text-fg outline-none placeholder:text-muted" />
                    <button type="submit" disabled={sending || !text.trim()} aria-label="Enviar mensaje" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-white shadow-sm transition hover:opacity-90 disabled:opacity-40 dark:text-slate-900">{sending ? <Spinner /> : <Send size={18} />}</button>
                  </div>
                </form>
              )}
            </section>

            <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Historial de aprobación</h3>
              {data.approvals.length === 0 ? <p className="text-sm text-muted">Sin movimientos todavía.</p> : (
                <ol className="space-y-2 border-l-2 border-line pl-4">{[...data.approvals].reverse().map(h => (
                  <li key={h.id} className="relative text-sm">
                    <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                    <p className="font-medium">{APPROVAL_ACTION_LABEL[h.action]}{h.to_status && h.action !== 'created' ? ` → ${APPROVAL_LABEL[h.to_status]}` : ''}</p>
                    <p className="text-xs text-muted">{when(h.created_at)} · {h.actor_type === 'company_admin' ? `Administrador (${h.actor_label})` : h.actor_type === 'agency' ? 'Aires y Destinos' : 'Sistema'}</p>
                    {h.note && <p className="mt-1 whitespace-pre-wrap text-sm">{h.note}</p>}
                  </li>))}</ol>
              )}
            </section>
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={!!decision} title={decision === 'approve' ? 'Aprobar conversación' : 'Rechazar conversación'} confirmLabel={decision === 'approve' ? 'Aprobar' : 'Rechazar'} danger={decision === 'reject'}
        busy={busy} error={actionError} onCancel={() => setDecision(null)} onConfirm={confirm}>
        <p>{decision === 'approve' ? 'Se aprobará la conversación completa con todos sus requerimientos.' : 'Se rechazará la conversación completa con todos sus requerimientos.'} Si luego se agrega un nuevo requerimiento a una conversación aprobada, volverá a quedar pendiente de aprobación.</p>
        {note.trim() && <p className="text-muted">Observación: «{note.trim()}»</p>}
      </ConfirmDialog>
    </>
  )
}

function Dashboard({ me }: { me: CompanyPortalMe }) {
  const [rows, setRows] = useState<CompanyConversationRow[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t) }, [search])

  const load = useCallback(async (quiet = false) => {
    try { setRows(await companyPortal.list(q, status)); setError('') }
    catch (e) { if (!quiet) setError(e instanceof Error ? e.message : 'No se pudieron cargar las conversaciones.') }
  }, [q, status])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(true) }
    const t = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  const pending = rows?.filter(r => r.approval_status === 'pending_approval').length ?? 0
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-semibold">Conversaciones de {me.company_name}</h1><p className="text-sm text-muted">{rows ? `${rows.length} conversaciones` : 'Cargando…'}{pending > 0 ? ` · ${pending} pendientes de aprobación` : ''}</p></div>
      </div>
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <input className="input md:max-w-xs" placeholder="Buscar por empleado o descripción…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar" />
        <select className="input md:!w-56" value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado de aprobación"><option value="">Todos los estados</option>{STATUSES.map(s => <option key={s} value={s}>{APPROVAL_LABEL[s]}</option>)}</select>
      </div>
      <div className="card overflow-hidden">
        {!rows && !error ? <Loading /> : error ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : rows!.length === 0 ? <Empty>No hay conversaciones con estos filtros.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="border-b border-line bg-surface2/50">{['Empleado', 'Estado', 'Requerimientos', 'Mensajes', 'Creada', 'Última actividad'].map(h => <th key={h} className="th !px-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows!.map(r => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-surface2/60">
                <td className="td !px-3 font-medium">{r.employee_name}</td>
                <td className="td !px-3"><Badge status={r.approval_status} /></td>
                <td className="td !px-3">{r.items + (r.request_type ? 1 : 0)}</td>
                <td className="td !px-3"><span className="inline-flex items-center gap-1"><MessageSquare size={12} className="text-muted" />{r.messages}</span></td>
                <td className="td !px-3">{when(r.created_at)}</td>
                <td className="td !px-3">{when(r.last_activity_at)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      <ConversationDetail id={openId} onClose={() => setOpenId(null)} onChanged={() => load(true)} />
    </>
  )
}

/** Private portal for the single administrator of a company. Separate from the agency app: own session handling, no agency layout or data. */
export default function CompanyPortal() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [setting, setSetting] = useState(OPENED_FROM_RECOVERY_LINK)
  const [me, setMe] = useState<CompanyPortalMe | null | undefined>(undefined)
  const [activating, setActivating] = useState(!!ACTIVATION_TOKEN)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    document.title = 'Portal empresarial · Aires y Destinos'
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((event, s) => { setSession(s); if (event === 'PASSWORD_RECOVERY') setSetting(true) })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!ACTIVATION_TOKEN) return
    activate().then(ok => { history.replaceState(null, '', location.pathname); if (ok) setSetting(true); else setExpired(true); setActivating(false) })
  }, [])
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) { setMe(undefined); return }
    let alive = true
    companyPortal.me().then(r => { if (alive) setMe(r) }, () => { if (alive) setMe(null) })
    return () => { alive = false }
  }, [userId])

  const signOut = () => supabase.auth.signOut()
  if (!ready || activating) return <Frame><Loading /></Frame>
  if (!session) return <Frame><Login expired={expired} /></Frame>
  if (setting) return <Frame onSignOut={signOut}><SetPassword onDone={() => setSetting(false)} /></Frame>
  if (me === undefined) return <Frame onSignOut={signOut}><Loading /></Frame>
  if (!me) return (
    <Frame onSignOut={signOut}>
      <div className="card mx-auto mt-10 max-w-md p-8 text-center"><h1 className="text-lg font-semibold">Sin acceso al portal empresarial</h1>
        <p className="mt-2 text-sm text-muted">Esta cuenta no es el administrador activo de una empresa. Cierra sesión e ingresa con la cuenta correcta o contacta a Aires y Destinos.</p>
        <button className="btn-primary mt-4" onClick={signOut}>Cerrar sesión</button></div>
    </Frame>
  )
  return <Frame company={me.company_name} onSignOut={signOut}><Dashboard me={me} /></Frame>
}
