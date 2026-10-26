import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, KeyRound, Lock, LockOpen, MessageCircle, Paperclip, Send, Trash2, Unlink } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { requestsService, type CleanupResult } from '../services/requests'
import { displayStatus, typeLabel, type ClientRequestFull, type RequestAttachment } from '../types/requests'
import { AttachmentCard, PendingFiles, type UrlResolver } from './AttachmentPreview'
import { ConfirmDialog } from './ConfirmDialog'
import { Drawer, Loading, Modal, Spinner } from './ui'

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const dmy = (d?: string | number) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const POLL_MS = 15_000

/** Field→label mapping shared by the main request and each additional item (only the service's own fields show up). */
const detailFacts = (d: Record<string, string | number>): [string, string][] => ([
  ['Origen', String(d.origin ?? '')], ['Destino', String(d.destination ?? '')], ['Salida', dmy(d.departure_date)], ['Regreso', dmy(d.return_date)],
  ['Viaje', d.scope ? `${d.scope === 'international' ? 'Internacional' : 'Nacional'} · ${d.trip_type === 'roundtrip' ? 'ida y vuelta' : 'solo ida'}` : ''],
  ['Entrada', dmy(d.check_in)], ['Salida del hotel', dmy(d.check_out)], ['Huéspedes', String(d.guests ?? '')], ['Habitaciones', String(d.rooms ?? '')],
  ['Fecha del servicio', dmy(d.service_date)], ['Hora', String(d.time ?? '')], ['Ubicación', String(d.location ?? '')], ['Personas', String(d.people ?? '')],
  ['Inicio', dmy(d.date_from)], ['Fin', dmy(d.date_to)], ['Fechas', String(d.dates ?? '')], ['Datos adicionales', String(d.extra ?? '')],
  ['Preferencias', String(d.preferences ?? d.itinerary_notes ?? '')],
] as [string, string][]).filter(([, v]) => v)

type Action =
  | { kind: 'close' } | { kind: 'reopen' } | { kind: 'regenerate' } | { kind: 'revoke' } | { kind: 'delete' }
  | { kind: 'del-message'; id: string } | { kind: 'del-attachment'; id: string; name: string } | { kind: 'del-passenger'; id: string; name: string }

/** Modal that shows a freshly generated link. The token is not stored anywhere readable: this is the only time it can be copied. */
export function LinkModal({ link, onClose }: { link: { token: string; name: string } | null; onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle')
  const url = link ? requestsService.link(link.token) : ''
  const name = link?.name.trim() ?? ''
  // Official WhatsApp share mechanism: opens the app/tab with the message ready to send (nothing is sent automatically).
  const waText = name
    ? `Hola, ${name}. Te compartimos este enlace para que puedas registrar tus requerimientos con Aires y Destinos: ${url}\nDesde allí podrás ingresar la información y adjuntar los documentos necesarios.`
    : `Te compartimos este enlace para que puedas registrar tus requerimientos con Aires y Destinos: ${url}\nDesde allí podrás ingresar la información y adjuntar los documentos necesarios.`
  const wa = `https://wa.me/?text=${encodeURIComponent(waText)}`
  useEffect(() => setState('idle'), [link])
  return (
    <Modal open={!!link} onClose={onClose} title="Enlace privado generado">
      <div className="space-y-3 text-sm">
        <p>Envía este enlace {name ? <>a <b>{name}</b></> : 'al cliente'} por WhatsApp, correo u otro medio. El cliente completará sus datos y elegirá qué necesita. Solo quien tenga el enlace puede abrir esta conversación.</p>
        <input className="input font-mono text-xs" readOnly value={url} onFocus={e => e.target.select()} aria-label="Enlace privado" />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={async () => { try { await copyText(url); setState('ok') } catch { setState('error') } }}><Copy size={14} />Copiar enlace</button>
          <a href={wa} target="_blank" rel="noreferrer" className="btn-ghost"><MessageCircle size={14} />Compartir por WhatsApp</a>
          <span role="status" className={state === 'error' ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}>{state === 'ok' && 'Enlace copiado.'}{state === 'error' && 'No se pudo copiar. Selecciónalo y cópialo manualmente.'}</span>
        </div>
        <p className="rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">Por seguridad el enlace se muestra solo ahora (en la base de datos se guarda únicamente su huella). Si lo pierdes, usa «Regenerar enlace»: el anterior dejará de funcionar.</p>
        <div className="flex justify-end"><button className="btn-ghost" onClick={onClose}>Cerrar</button></div>
      </div>
    </Modal>
  )
}

export default function RequestConversation({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [full, setFull] = useState<ClientRequestFull | null>(null)
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [link, setLink] = useState<{ token: string; name: string } | null>(null)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)
  const changed = useRef(onChanged)
  changed.current = onChanged

  const load = useCallback(async (quiet = false) => {
    if (!id) return
    try {
      const r = await requestsService.get(id)
      if (!r) { setFull(null); setLoadError('La solicitud ya no existe.'); return }
      setFull(r); setLoadError('')
      if (r.agency_unread > 0) { await requestsService.markRead(id); changed.current() }
    } catch (e) { if (!quiet) setLoadError(e instanceof Error ? e.message : 'No se pudo cargar la conversación.') }
  }, [id])

  useEffect(() => { setFull(null); setLoadError(''); setNotice(''); setText(''); setFiles([]); setSendError(''); lastCount.current = 0; if (id) load() }, [id, load])
  useEffect(() => {
    if (!id) return
    const tick = () => { if (document.visibilityState === 'visible') load(true) }
    const t = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [id, load])
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px` } }, [text])
  useEffect(() => { const n = full?.messages.length ?? 0; if (n !== lastCount.current) { lastCount.current = n; bottom.current?.scrollIntoView({ block: 'end' }) } }, [full?.messages.length])

  const cleanupNote = (r: CleanupResult) => { if (r.pending > 0) setNotice(`Se eliminó de la base de datos, pero ${r.pending} archivo(s) siguen pendientes de borrarse del almacenamiento. Se reintentará automáticamente; también puedes reintentar desde la bandeja.`) }

  const resolve: UrlResolver = a => requestsService.signedUrl((full?.attachments.find(x => x.id === a.id)?.storage_path) ?? '', a.file_name)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || sending || (!text.trim() && !files.length)) return
    setSending(true); setSendError('')
    try { await requestsService.postMessage(id, text.trim(), files); setText(''); setFiles([]); await load(true); onChanged() }
    catch (err) { setSendError(err instanceof Error ? err.message : 'No se pudo enviar.') } finally { setSending(false) }
  }

  const run = async () => {
    if (!id || !action) return
    setBusy(true); setActionError('')
    try {
      switch (action.kind) {
        case 'close': await requestsService.setClosed(id, true); break
        case 'reopen': await requestsService.setClosed(id, false); break
        case 'revoke': await requestsService.revoke(id); setNotice('El enlace fue revocado: el cliente ya no puede abrirlo. Puedes generar uno nuevo con «Regenerar enlace».'); break
        case 'regenerate': setLink({ token: await requestsService.regenerate(id), name: full?.client_name ?? '' }); break
        case 'del-message': cleanupNote(await requestsService.deleteMessage(action.id)); break
        case 'del-attachment': cleanupNote(await requestsService.deleteAttachment(action.id)); break
        case 'del-passenger': cleanupNote(await requestsService.deletePassenger(action.id)); break
        case 'delete': { const r = await requestsService.deleteRequest(id); onChanged(); setAction(null); onClose(); if (r.pending > 0) alert(`La conversación se eliminó, pero ${r.pending} archivo(s) siguen pendientes de borrarse del almacenamiento. Se reintentará automáticamente al abrir esta sección.`); return }
      }
      setAction(null); await load(true); onChanged()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'No se pudo completar la acción.') } finally { setBusy(false) }
  }

  const closed = full?.status === 'closed'
  const st = full ? displayStatus(full) : null
  const d = full?.details ?? {}
  const facts: [string, string][] = full ? ([
    ['Cliente', full.client_name], ['Correo', full.client_email], ['Teléfono', full.client_phone], ['Tipo', typeLabel(full.request_type)], ['Creada', when(full.created_at)],
    ['Enviada por el cliente', full.submitted_at ? when(full.submitted_at) : 'Aún no completa el formulario'], ['Última actividad', when(full.last_activity_at)],
    ...detailFacts(d),
    ['Cerrada', full.closed_at ? when(full.closed_at) : ''], ['Enlace', full.link_active ? 'Activo' : 'Revocado'],
  ] as [string, string][]).filter(([, v]) => v) : []
  const mainPax = full?.passengers.filter(p => !p.item_id) ?? []
  const mainSupporting = full?.attachments.filter(a => a.kind === 'supporting' && !a.item_id) ?? []

  const attBtn = (a: RequestAttachment, auto = false) => (
    <li key={a.id} className="w-72 max-w-full">
      <AttachmentCard att={a} resolve={resolve} auto={auto} onRemove={() => { setActionError(''); setAction({ kind: 'del-attachment', id: a.id, name: a.file_name }) }} />
    </li>
  )

  const dialog = (() => {
    if (!action) return null
    const name = full?.client_name ?? ''
    const map: Record<Action['kind'], { title: string; label: string; danger: boolean; body: ReactNode }> = {
      close: { title: 'Cerrar conversación', label: 'Cerrar conversación', danger: false, body: <p>Se cerrará la conversación con <b>{name}</b>. El cliente <b>no podrá enviar más mensajes ni archivos</b>, aunque conserve su enlace. Podrá seguir viendo el historial. Quedará registrado quién la cerró y cuándo.</p> },
      reopen: { title: 'Reabrir conversación', label: 'Reabrir conversación', danger: false, body: <p>Se reabrirá la conversación con <b>{name}</b> y, si su enlace sigue activo, podrá volver a enviar mensajes y archivos. Quedará registrado.</p> },
      regenerate: { title: 'Regenerar enlace', label: 'Regenerar enlace', danger: true, body: <p>Se creará un enlace nuevo para <b>{name}</b> y <b>el anterior dejará de funcionar de inmediato</b>. Tendrás que enviarle el nuevo enlace.</p> },
      revoke: { title: 'Revocar enlace', label: 'Revocar enlace', danger: true, body: <p>El enlace de <b>{name}</b> dejará de funcionar de inmediato: no podrá leer, escribir ni descargar archivos. La conversación y su historial se conservan en la plataforma.</p> },
      delete: { title: 'Eliminar conversación completa', label: 'Eliminar conversación', danger: true, body: <><p>Se eliminará la solicitud de <b>{name}</b> con <b>todos sus mensajes ({full?.messages.length ?? 0}), pasajeros ({full?.passengers.length ?? 0}) y archivos ({full?.attachments.length ?? 0})</b>, incluidos los documentos de identidad, y también los archivos del almacenamiento privado.</p><p>El enlace se revoca de inmediato. Los datos de operaciones de facturación que ya hayas creado a partir de esta solicitud no se eliminan.</p></> },
      'del-message': { title: 'Eliminar mensaje', label: 'Eliminar mensaje', danger: true, body: <p>Se eliminará este mensaje y los archivos que tenga adjuntos. El cliente dejará de verlo.</p> },
      'del-attachment': { title: 'Eliminar archivo', label: 'Eliminar archivo', danger: true, body: <p>Se eliminará el archivo <b>{(action as { name?: string }).name}</b> de la solicitud y del almacenamiento privado.</p> },
      'del-passenger': { title: 'Eliminar datos del pasajero', label: 'Eliminar pasajero', danger: true, body: <p>Se eliminarán los datos de <b>{(action as { name?: string }).name}</b> y su documento de identidad (también del almacenamiento privado).</p> },
    }
    return map[action.kind]
  })()

  return (
    <>
      <Drawer open={!!id} onClose={onClose} title="Solicitud de cliente" wide>
        {!full ? (loadError ? <p role="alert" className="text-sm text-red-500">{loadError}</p> : <Loading />) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{full.client_name || 'Cliente sin identificar'}</h2>{st && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>}</div>
              <div className="flex flex-wrap gap-2">
                {closed ? <button className="btn-ghost" onClick={() => { setActionError(''); setAction({ kind: 'reopen' }) }}><LockOpen size={14} />Reabrir</button>
                  : <button className="btn-ghost" onClick={() => { setActionError(''); setAction({ kind: 'close' }) }}><Lock size={14} />Cerrar</button>}
                <button className="btn-ghost" onClick={() => { setActionError(''); setAction({ kind: 'regenerate' }) }}><KeyRound size={14} />Regenerar enlace</button>
                {full.link_active && <button className="btn-ghost" onClick={() => { setActionError(''); setAction({ kind: 'revoke' }) }}><Unlink size={14} />Revocar enlace</button>}
                <button className="btn-ghost text-red-600 dark:text-red-400" onClick={() => { setActionError(''); setAction({ kind: 'delete' }) }}><Trash2 size={14} />Eliminar</button>
              </div>
            </div>
            {notice && <p role="status" className="rounded-lg border border-line bg-surface2 p-3 text-sm">{notice}</p>}

            <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Datos de la solicitud</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{facts.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="break-words text-sm">{v}</dd></div>)}</dl>
              {full.description && <p className="mt-3 whitespace-pre-wrap text-sm">{full.description}</p>}
              {full.observations && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{full.observations}</p>}
            </section>

            {full.details_history.length > 0 && (
              <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Cambios de tipo de requerimiento</h3>
                <ul className="space-y-1 text-sm text-muted">{full.details_history.map((h, i) => <li key={i}>{when(h.changed_at)} · antes: <b className="text-fg">{typeLabel(h.request_type)}</b>{h.description ? ` — «${h.description.slice(0, 120)}${h.description.length > 120 ? '…' : ''}»` : ''}</li>)}</ul>
              </section>
            )}

            {mainPax.length > 0 && (
              <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Pasajeros ({mainPax.length})</h3>
                <div className="grid gap-2 sm:grid-cols-2">{mainPax.map(p => (
                  <div key={p.id} className="rounded-lg border border-line p-3 text-sm">
                    <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{p.first_names} {p.last_names}</p><p className="text-xs text-muted">{p.document_type} {p.document_number} · Nac. {dmy(p.birth_date)}</p></div>
                      <button type="button" title="Eliminar pasajero" aria-label={`Eliminar pasajero ${p.first_names} ${p.last_names}`} onClick={() => { setActionError(''); setAction({ kind: 'del-passenger', id: p.id, name: `${p.first_names} ${p.last_names}` }) }} className="rounded p-1.5 text-muted hover:bg-red-500/10 hover:text-red-600"><Trash2 size={14} /></button></div>
                    {full.attachments.filter(a => a.passenger_id === p.id).length === 0 ? <p className="mt-2 text-xs text-muted">Sin documento de identidad.</p> : <ul className="mt-2 space-y-1">{full.attachments.filter(a => a.passenger_id === p.id).map(a => attBtn(a))}</ul>}
                  </div>))}</div>
              </section>
            )}
            {mainSupporting.length > 0 && (
              <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Archivos complementarios</h3><ul className="space-y-1">{mainSupporting.map(a => attBtn(a))}</ul></section>
            )}

            {full.items.length > 0 && (
              <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Requerimientos adicionales ({full.items.length})</h3>
                <div className="space-y-3">{full.items.map(it => {
                  const pax = full.passengers.filter(p => p.item_id === it.id)
                  const files = full.attachments.filter(a => a.item_id === it.id && a.kind === 'supporting')
                  return (
                    <div key={it.id} className="rounded-lg border border-line p-3">
                      <p className="text-sm font-medium">{typeLabel(it.request_type)} <span className="font-normal text-muted">· {when(it.created_at)}</span></p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">{detailFacts(it.details).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="break-words text-sm">{v}</dd></div>)}</dl>
                      {it.description && <p className="mt-2 whitespace-pre-wrap text-sm">{it.description}</p>}
                      {it.observations && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{it.observations}</p>}
                      {pax.length > 0 && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">{pax.map(p => (
                          <div key={p.id} className="rounded-lg border border-line p-3 text-sm">
                            <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{p.first_names} {p.last_names}</p><p className="text-xs text-muted">{p.document_type} {p.document_number} · Nac. {dmy(p.birth_date)}</p></div>
                              <button type="button" title="Eliminar pasajero" aria-label={`Eliminar pasajero ${p.first_names} ${p.last_names}`} onClick={() => { setActionError(''); setAction({ kind: 'del-passenger', id: p.id, name: `${p.first_names} ${p.last_names}` }) }} className="rounded p-1.5 text-muted hover:bg-red-500/10 hover:text-red-600"><Trash2 size={14} /></button></div>
                            {full.attachments.filter(a => a.passenger_id === p.id).length === 0 ? <p className="mt-2 text-xs text-muted">Sin documento de identidad.</p> : <ul className="mt-2 space-y-1">{full.attachments.filter(a => a.passenger_id === p.id).map(a => attBtn(a))}</ul>}
                          </div>))}</div>
                      )}
                      {files.length > 0 && <ul className="mt-2 space-y-1">{files.map(a => attBtn(a))}</ul>}
                    </div>)
                })}</div>
              </section>
            )}

            <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Conversación</h3>
              <div className="space-y-3 rounded-lg border border-line p-3">
                {full.messages.length === 0 && <p className="py-4 text-center text-sm text-muted">Aún no hay mensajes.</p>}
                {full.messages.map(m => (
                  <div key={m.id} className={`flex ${m.author === 'agency' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`group max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.author === 'agency' ? 'bg-brand text-white dark:text-slate-900 rounded-br-sm' : 'bg-surface2 rounded-bl-sm'}`}>
                      <div className="mb-0.5 flex items-center justify-between gap-3"><p className={`text-[11px] font-medium ${m.author === 'agency' ? 'opacity-80' : 'text-muted'}`}>{m.author === 'agency' ? 'Agencia' : full.client_name} · {when(m.created_at)}</p>
                        <button type="button" title="Eliminar mensaje" aria-label="Eliminar mensaje" onClick={() => { setActionError(''); setAction({ kind: 'del-message', id: m.id }) }} className="opacity-60 hover:opacity-100"><Trash2 size={12} /></button></div>
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      {full.attachments.some(a => a.message_id === m.id) && <ul className="mt-2 space-y-1 text-fg">{full.attachments.filter(a => a.message_id === m.id).map(a => attBtn(a, true))}</ul>}
                    </div>
                  </div>))}
                <div ref={bottom} />
              </div>
              {closed ? <p className="mt-3 flex items-center gap-2 rounded-lg bg-surface2 p-3 text-sm"><Lock size={14} />Conversación cerrada. Reábrela para volver a responder.</p> : (
                <form onSubmit={send} className="mt-3 space-y-2">
                  <PendingFiles files={files} disabled={sending} onRemove={i => setFiles(x => x.filter((_, j) => j !== i))} />
                  {sendError && <p role="alert" className="text-sm text-red-500">{sendError}</p>}
                  <div className="flex items-end gap-1 rounded-3xl border border-line bg-surface2 p-1 transition focus-within:border-brand">
                    <button type="button" disabled={sending || files.length >= 10} onClick={() => input.current?.click()} aria-label="Adjuntar archivo"
                      title="Adjuntar cotizaciones, itinerarios, confirmaciones u otros documentos: PDF, PNG, JPG o WEBP · máx. 8 MB por archivo"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-brand disabled:opacity-40"><Paperclip size={20} /></button>
                    <input ref={input} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={e => { const picked = [...(e.target.files ?? [])]; setFiles(x => [...x, ...picked].slice(0, 10)); e.target.value = '' }} />
                    <textarea ref={area} rows={1} placeholder="Escribe tu respuesta…" aria-label="Respuesta" value={text} maxLength={5000} onChange={e => setText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
                      className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-5 text-fg outline-none placeholder:text-muted" />
                    <button type="submit" disabled={sending || (!text.trim() && !files.length)} aria-label={sending ? 'Enviando…' : 'Enviar respuesta'} title="Enviar"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-white shadow-sm transition hover:opacity-90 disabled:opacity-40 dark:text-slate-900">{sending ? <Spinner /> : <Send size={18} />}</button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </Drawer>
      {dialog && <ConfirmDialog open title={dialog.title} confirmLabel={dialog.label} danger={dialog.danger} busy={busy} error={actionError} onCancel={() => setAction(null)} onConfirm={run}>{dialog.body}</ConfirmDialog>}
      <LinkModal link={link} onClose={() => setLink(null)} />
    </>
  )
}
