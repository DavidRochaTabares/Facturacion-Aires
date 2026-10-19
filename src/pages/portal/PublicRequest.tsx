import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Moon, Paperclip, Pencil, Send, Sun } from 'lucide-react'
import spineDay from '../../assets/spinedev-day.png'
import spineNight from '../../assets/spinedev-night.png'
import { AttachmentCard, forgetPreview, PendingFiles, type UrlResolver } from '../../components/AttachmentPreview'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AgencyLogo, Spinner } from '../../components/ui'
import { useTheme } from '../../hooks'
import { normalizeDocFile } from '../../lib/files'
import { PortalError, portalApi, TOKEN_RE } from '../../services/portalApi'
import { typeLabel, type PortalData, type RequestAttachment } from '../../types/requests'
import { PortalForm } from './PortalForm'

const MAX_FILE = 8 * 1024 * 1024
const MAX_FILES = 5
const POLL_MS = 12_000
const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const dmy = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

function Shell({ children, fill = false }: { children: React.ReactNode; fill?: boolean }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <div className={`relative flex flex-col overflow-x-hidden bg-bg text-fg ${fill ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`}>
      <div className="portal-bg" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <header className="relative z-10 shrink-0">
        <div className="mx-auto grid max-w-3xl grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 px-3 py-2 sm:px-4 sm:py-3">
          <AgencyLogo size={36} />
          <div className="min-w-0 text-center">
            <p className="truncate text-base font-semibold leading-tight tracking-tight sm:text-lg">Aires y Destinos</p>
            <p className="truncate text-[10px] uppercase tracking-[0.18em] text-muted">Portal de solicitudes</p>
          </div>
          <button type="button" onClick={toggle} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title={dark ? 'Modo claro' : 'Modo oscuro'}
            className="grid h-9 w-9 place-items-center justify-self-end rounded-full border border-line bg-surface text-muted shadow-sm transition hover:text-brand">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      <main className={`relative z-10 mx-auto w-full max-w-3xl flex-1 px-3 pt-2 sm:px-4 ${fill ? 'flex min-h-0 flex-col overflow-hidden pb-3' : 'pb-6'}`}>{children}</main>
      <footer className="relative z-10 flex shrink-0 items-center justify-center gap-2 px-4 pb-4 pt-2 text-[11px] text-muted opacity-80">
        Desarrollado por
        <img src={spineDay} alt="SpineDev" className="h-6 w-auto dark:hidden" />
        <img src={spineNight} alt="SpineDev" className="hidden h-6 w-auto dark:block" />
      </footer>
    </div>
  )
}

const Notice = ({ title, text }: { title: string; text: string }) => (
  <Shell><div className="card portal-fade p-8 text-center"><Lock className="mx-auto mb-3 text-muted" size={28} /><h1 className="text-lg font-semibold">{title}</h1><p className="mt-2 text-sm text-muted">{text}</p></div></Shell>
)

function AttachmentList({ items, resolve, auto = false, canRemove, onRemove }: { items: RequestAttachment[]; resolve: UrlResolver; auto?: boolean; canRemove?: (a: RequestAttachment) => boolean; onRemove?: (a: RequestAttachment) => void }) {
  if (!items.length) return null
  return (
    <ul className="mt-2 w-72 max-w-full space-y-2">
      {items.map(a => <li key={a.id}><AttachmentCard att={a} resolve={resolve} auto={auto} onRemove={canRemove?.(a) && onRemove ? () => onRemove(a) : undefined} /></li>)}
    </ul>
  )
}

export default function PublicRequest() {
  // The token lives in the URL fragment: it is never sent to a server, written to hosting logs or leaked through the Referer header.
  const token = useMemo(() => location.hash.replace(/^#/, ''), [])
  const [data, setData] = useState<PortalData | null>(null)
  const [state, setState] = useState<'loading' | 'invalid' | 'error' | 'ready'>(TOKEN_RE.test(token) ? 'loading' : 'invalid')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async (quiet = false) => {
    if (!TOKEN_RE.test(token)) return
    try { setData(await portalApi.get(token)); setState('ready') }
    catch (e) {
      if (e instanceof PortalError && e.status === 404) { setData(null); setState('invalid') }
      else if (!quiet) { setLoadError(e instanceof Error ? e.message : 'No se pudo cargar.'); setState('error') }
    }
  }, [token])

  useEffect(() => {
    document.title = 'Solicitud · Aires y Destinos'
    load()
  }, [load])

  // Moderate polling, only while the page is visible and the form was already submitted.
  const submitted = !!data?.request.submitted_at
  useEffect(() => {
    if (!submitted) return
    const tick = () => { if (document.visibilityState === 'visible') load(true) }
    const t = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [submitted, load])

  if (state === 'loading') return <Shell><div className="flex justify-center py-24 text-muted"><Spinner /></div></Shell>
  if (state === 'invalid') return <Notice title="Enlace no válido" text="Este enlace no es válido o ha sido desactivado. Contacta a la agencia para recibir uno nuevo." />
  if (state === 'error' || !data) return <Shell><div className="card p-8 text-center"><p className="text-sm text-red-500" role="alert">{loadError}</p><button className="btn-primary mt-4" onClick={() => { setState('loading'); load() }}>Reintentar</button></div></Shell>
  if (!data.request.submitted_at) return <Shell><PortalForm token={token} initial={data.request} onDone={() => load()} /></Shell>
  return <Shell fill><Conversation token={token} data={data} reload={load} /></Shell>
}

function Conversation({ token, data, reload }: { token: string; data: PortalData; reload: (quiet?: boolean) => Promise<void> }) {
  const { request: r, passengers, attachments, messages } = data
  const closed = r.status === 'closed'
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<RequestAttachment | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [sent, setSent] = useState(false)
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)

  // The composer grows with the text (like WhatsApp) up to its max height, then scrolls inside.
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px` } }, [text])
  const trackScroll = () => {
    const el = list.current
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = list.current
    if (el && nearBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])
  // Attachments/images change the content height without changing the message list: keep the tail pinned if the user is at the bottom.
  useEffect(() => {
    const el = list.current, inner = content.current
    if (!el || !inner || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (nearBottom.current) el.scrollTop = el.scrollHeight })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  const resolve: UrlResolver = a => portalApi.download(token, a.id)
  // Only files the client sent themselves in a message, and only while the conversation is open (the server enforces the same rule).
  const mine = (a: RequestAttachment) => !closed && a.kind === 'message' && a.uploaded_by === 'client'
  const confirmDelete = async () => {
    if (!deleting) return
    setDelBusy(true); setDelError('')
    try { await portalApi.deleteAttachment(token, deleting.id); forgetPreview(deleting.id); setDeleting(null); await reload(true) }
    catch (e) { setDelError(e instanceof Error ? e.message : 'No se pudo eliminar el archivo. Inténtalo de nuevo.'); if (e instanceof PortalError && e.status !== 0 && e.status < 500) reload(true) } finally { setDelBusy(false) }
  }
  const pick = async (list: FileList | null) => {
    const next = [...files]; const bad: string[] = []
    for (const f of [...(list ?? [])]) {
      if (next.length >= MAX_FILES) { bad.push(`Máximo ${MAX_FILES} archivos por mensaje.`); break }
      try { const ok = await normalizeDocFile(f, 'pdf-or-image'); if (ok.size > MAX_FILE) throw new Error('supera los 8 MB.'); next.push(ok) } catch (e) { bad.push(`${f.name}: ${e instanceof Error ? e.message : 'no se pudo leer.'}`) }
    }
    setFiles(next); setError(bad.join(' '))
  }
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || (!text.trim() && !files.length)) return
    setBusy(true); setError(''); setSent(false)
    try { await portalApi.message(token, text.trim(), files); setText(''); setFiles([]); setSent(true); nearBottom.current = true; await reload(true); setTimeout(() => setSent(false), 2500) }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.'); if (err instanceof PortalError && err.status === 409) reload(true) } finally { setBusy(false) }
  }

  const attOf = (id: string) => attachments.filter(a => a.message_id === id)
  const d = r.details
  const summary: [string, string][] = ([
    ['Tipo', typeLabel(r.request_type)], ['Enviada', when(r.submitted_at ?? r.created_at)],
    ['Origen', String(d.origin ?? '')], ['Destino', String(d.destination ?? '')], ['Salida', dmy(d.departure_date as string)], ['Regreso', dmy(d.return_date as string)],
    ['Viaje', d.scope ? `${d.scope === 'international' ? 'Internacional' : 'Nacional'} · ${d.trip_type === 'roundtrip' ? 'ida y vuelta' : 'solo ida'}` : ''],
    ['Entrada', dmy(d.check_in as string)], ['Salida del hotel', dmy(d.check_out as string)], ['Huéspedes', String(d.guests ?? '')], ['Habitaciones', String(d.rooms ?? '')],
    ['Fecha del servicio', dmy(d.service_date as string)], ['Hora', String(d.time ?? '')], ['Ubicación', String(d.location ?? '')], ['Personas', String(d.people ?? '')],
    ['Inicio', dmy(d.date_from as string)], ['Fin', dmy(d.date_to as string)], ['Fechas', String(d.dates ?? '')],
  ] as [string, string][]).filter(([, v]) => v)
  const general = attachments.filter(a => a.kind === 'supporting')

  if (editing) return <div className="min-h-0 flex-1 overflow-y-auto"><PortalForm token={token} initial={r} existing={passengers} mode="update" onCancel={() => setEditing(false)} onDone={async () => { setEditing(false); await reload(true) }} /></div>

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="card portal-fade max-h-[38dvh] shrink-0 overflow-y-auto p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Tu solicitud</h1>
          <div className="flex items-center gap-2">
            {!closed && <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setEditing(true)}><Pencil size={12} />Actualizar solicitud</button>}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${closed ? 'bg-slate-500/10 text-muted' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'}`}>{closed ? 'Cerrada' : 'Abierta'}</span>
          </div>
        </div>
        <details className="mt-2" open={messages.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-brand">Ver datos de la solicitud</summary>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">{summary.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
          {r.description && <p className="mt-3 whitespace-pre-wrap text-sm">{r.description}</p>}
          {r.observations && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{r.observations}</p>}
          {passengers.length > 0 && (
            <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Pasajeros</p>
              <ul className="mt-1 space-y-2">{passengers.map(p => (
                <li key={p.id} className="rounded-lg border border-line p-2 text-sm">
                  <p className="font-medium">{p.first_names} {p.last_names}</p><p className="text-xs text-muted">{p.document_type} {p.document_number} · Nac. {dmy(p.birth_date)}</p>
                  <AttachmentList items={attachments.filter(a => a.passenger_id === p.id)} resolve={resolve} />
                </li>))}</ul></div>
          )}
          {general.length > 0 && <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Archivos complementarios</p><AttachmentList items={general} resolve={resolve} /></div>}
        </details>
      </section>

      <section className="card portal-fade flex min-h-0 flex-1 flex-col p-3 sm:p-4" aria-label="Conversación">
        <h2 className="mb-2 shrink-0 text-sm font-semibold">Conversación con la agencia</h2>
        <div ref={list} onScroll={trackScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" aria-live="polite">
          <div ref={content} className="space-y-3">
            {messages.length === 0 && <p className="py-6 text-center text-sm text-muted">Tu solicitud fue enviada. La agencia te responderá aquí.</p>}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.author === 'client' ? 'justify-end' : 'justify-start'}`}>
                <div className={`min-w-0 max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.author === 'client' ? 'bg-brand text-white dark:text-slate-900 rounded-br-sm' : 'bg-surface2 rounded-bl-sm'}`}>
                  <p className={`mb-0.5 text-[11px] font-medium ${m.author === 'client' ? 'opacity-80' : 'text-muted'}`}>{m.author === 'client' ? 'Tú' : 'Aires y Destinos'} · {when(m.created_at)}</p>
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <AttachmentList items={attOf(m.id)} resolve={resolve} auto canRemove={mine} onRemove={a => { setDelError(''); setDeleting(a) }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {closed ? (
          <div role="status" className="mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-line bg-surface2 p-3 text-sm"><Lock size={16} className="mt-0.5 shrink-0 text-muted" />
            <p>Esta conversación está cerrada y ya no se pueden enviar mensajes ni archivos. Si necesitas continuar, contacta a la agencia.</p></div>
        ) : (
          <form onSubmit={send} className="mt-3 shrink-0 space-y-2 border-t border-line pt-3">
            <PendingFiles files={files} disabled={busy} onRemove={i => setFiles(x => x.filter((_, j) => j !== i))} />
            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
            {sent && <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">Mensaje enviado.</p>}
            <div className="flex items-end gap-1 rounded-3xl border border-line bg-surface2 p-1 transition focus-within:border-brand">
              <button type="button" onClick={() => input.current?.click()} disabled={busy || files.length >= MAX_FILES} aria-label="Adjuntar archivo"
                title={`Adjuntar PDF, PNG, JPG o WEBP · máx. 8 MB por archivo y ${MAX_FILES} por mensaje`}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-brand disabled:opacity-40"><Paperclip size={20} /></button>
              <input ref={input} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={e => { pick(e.target.files); e.target.value = '' }} />
              <textarea ref={area} rows={1} placeholder="Escribe tu mensaje…" value={text} maxLength={5000} onChange={e => setText(e.target.value)} aria-label="Mensaje"
                className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-5 text-fg outline-none placeholder:text-muted" />
              <button type="submit" disabled={busy || (!text.trim() && !files.length)} aria-label={busy ? 'Enviando…' : 'Enviar mensaje'} title="Enviar"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-white shadow-sm transition hover:opacity-90 disabled:opacity-40 dark:text-slate-900">{busy ? <Spinner /> : <Send size={18} />}</button>
            </div>
          </form>
        )}
      </section>
      <ConfirmDialog open={!!deleting} title="Eliminar archivo" confirmLabel="Eliminar archivo" danger busy={delBusy} error={delError} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>Se eliminará definitivamente <b>{deleting?.file_name}</b> de la conversación. La agencia dejará de verlo y no se podrá recuperar.</p>
      </ConfirmDialog>
    </div>
  )
}
