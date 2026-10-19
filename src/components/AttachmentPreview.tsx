import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Eye, EyeOff, FileText, Maximize2, RefreshCw, X } from 'lucide-react'
import { fsize } from '../lib/format'
import { Spinner } from './ui'

export interface PreviewAtt { id: string; file_name: string; mime_type: string; size_bytes: number }
/** Returns a short-lived signed URL for the attachment. Each side (portal / agency) supplies its own authorised resolver. */
export type UrlResolver = (a: PreviewAtt) => Promise<string>

// Files are fetched ONCE with a freshly signed URL and shown from an in-memory blob: the signed URL never sits in the DOM, expiry cannot break an
// already-open preview, polling does not refetch, and the page needs no remote img/frame permissions in its CSP.
const cache = new Map<string, string>()
const MAX_CACHED = 40
export function forgetPreview(id: string) { const u = cache.get(id); if (u) { URL.revokeObjectURL(u); cache.delete(id) } }

async function loadBlobUrl(a: PreviewAtt, resolve: UrlResolver): Promise<string> {
  const hit = cache.get(a.id)
  if (hit) return hit
  let signed: string
  try { signed = await resolve(a) } catch (e) { throw (e as { status?: number }).status === 404 || (e as Error).message === 'gone' ? new Error('gone') : e }
  const res = await fetch(signed, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!res.ok) throw new Error(res.status === 400 || res.status === 404 ? 'gone' : 'failed')
  // the type comes from our own record (validated on upload), not from the response headers
  const url = URL.createObjectURL(new Blob([await res.blob()], { type: a.mime_type }))
  cache.set(a.id, url)
  if (cache.size > MAX_CACHED) { const oldest = cache.keys().next().value as string; forgetPreview(oldest) }
  return url
}

function useAttachmentUrl(a: PreviewAtt, resolve: UrlResolver, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(cache.get(a.id) ?? null)
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'gone' | 'failed'>(cache.has(a.id) ? 'ok' : 'idle')
  const load = useCallback(async () => {
    setState('loading')
    try { setUrl(await loadBlobUrl(a, resolve)); setState('ok') }
    catch (e) { setState(e instanceof Error && e.message === 'gone' ? 'gone' : 'failed') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id])
  useEffect(() => { if (enabled && state === 'idle') load() }, [enabled, state, load])
  return { url, state, load }
}

function Lightbox({ a, url, onClose }: { a: PreviewAtt; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  const isImg = a.mime_type.startsWith('image/')
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/85" role="dialog" aria-modal="true" aria-label={`Vista ampliada de ${a.file_name}`} onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={e => e.stopPropagation()}>
        <p className="min-w-0 truncate text-sm">{a.file_name}</p>
        <div className="flex items-center gap-2">
          <a href={url} download={a.file_name} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Descargar" title="Descargar"><Download size={16} /></a>
          <button type="button" onClick={onClose} autoFocus className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Cerrar vista ampliada" title="Cerrar"><X size={18} /></button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4" onClick={onClose}>
        {isImg
          ? <img src={url} alt={a.file_name} className="max-h-full max-w-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          : <iframe src={url} title={a.file_name} className="h-full w-full max-w-5xl rounded-lg bg-white" onClick={e => e.stopPropagation()} />}
      </div>
    </div>, document.body)
}

/** One attachment: inline image / PDF viewer, enlarge, download. `onRemove` (only when the caller is authorised) shows the X at the top-right corner. */
export function AttachmentCard({ att, resolve, auto = false, onRemove }: { att: PreviewAtt; resolve: UrlResolver; auto?: boolean; onRemove?: () => void }) {
  const isImg = att.mime_type.startsWith('image/')
  const [shown, setShown] = useState(false)
  const [zoom, setZoom] = useState(false)
  const { url, state, load } = useAttachmentUrl(att, resolve, (isImg && auto) || shown || zoom)
  const download = async () => {
    try {
      const u = url ?? (await loadBlobUrl(att, resolve))
      const link = document.createElement('a'); link.href = u; link.download = att.file_name; document.body.appendChild(link); link.click(); link.remove()
    } catch { setShown(true) }
  }
  const problem = state === 'gone' ? 'Este archivo ya no está disponible.' : state === 'failed' ? 'No se pudo cargar la vista previa.' : ''
  const openZoom = () => { setZoom(true) }
  const xBtn = onRemove && (
    <button type="button" onClick={e => { e.stopPropagation(); onRemove() }} aria-label={`Eliminar archivo ${att.file_name}`} title="Eliminar archivo"
      className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-90 transition hover:bg-red-600 hover:opacity-100"><X size={13} /></button>
  )

  return (
    <div className="relative max-w-full overflow-hidden rounded-xl border border-line bg-surface text-fg">
      {xBtn}
      {isImg && (state === 'ok' && url ? (
        <button type="button" onClick={openZoom} className="block w-full cursor-zoom-in bg-surface2" aria-label={`Ampliar imagen ${att.file_name}`}>
          <img src={url} alt={att.file_name} loading="lazy" className="mx-auto max-h-64 w-auto max-w-full object-contain" />
        </button>
      ) : state === 'loading' ? <div className="grid h-28 place-items-center bg-surface2 text-muted"><Spinner /></div> : null)}
      {!isImg && shown && state === 'ok' && url && <iframe src={url} title={att.file_name} className="block h-[min(20rem,50dvh)] w-full max-w-full border-b border-line bg-white" />}
      <div className="flex items-center gap-2 px-2.5 py-1.5 pr-9 text-xs">
        <FileText size={14} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{att.file_name}</span><span className="text-muted">{isImg ? 'Imagen' : 'PDF'} · {fsize(att.size_bytes)}</span></span>
        {!isImg && <button type="button" onClick={() => setShown(s => !s)} className="rounded p-1.5 text-muted hover:text-brand" aria-label={shown ? 'Ocultar documento' : 'Ver documento'} title={shown ? 'Ocultar' : 'Ver aquí'}>{state === 'loading' && shown ? <Spinner /> : shown ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
        {isImg && state === 'idle' && <button type="button" onClick={() => setShown(true)} className="rounded p-1.5 text-muted hover:text-brand" aria-label="Ver imagen" title="Ver imagen"><Eye size={15} /></button>}
        <button type="button" onClick={openZoom} className="rounded p-1.5 text-muted hover:text-brand" aria-label="Ampliar" title="Ampliar"><Maximize2 size={15} /></button>
        <button type="button" onClick={download} className="rounded p-1.5 text-muted hover:text-brand" aria-label="Descargar" title="Descargar"><Download size={15} /></button>
      </div>
      {problem && (
        <div role="alert" className="flex items-center justify-between gap-2 border-t border-line bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-300">
          <span>{problem}</span>
          {state === 'failed' && <button type="button" onClick={load} className="flex items-center gap-1 underline"><RefreshCw size={11} />Reintentar</button>}
        </div>
      )}
      {zoom && state === 'ok' && url && <Lightbox a={att} url={url} onClose={() => setZoom(false)} />}
    </div>
  )
}

/** Files selected but not sent yet: thumbnail + X at the top-right corner of each. Removing one never touches the others or the typed text. */
export function PendingFiles({ files, onRemove, disabled }: { files: File[]; onRemove: (index: number) => void; disabled?: boolean }) {
  const urls = useMemo(() => files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files])
  useEffect(() => () => urls.forEach(u => u && URL.revokeObjectURL(u)), [urls])
  if (!files.length) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Archivos por enviar">
      {files.map((f, i) => (
        <li key={`${f.name}-${f.size}-${i}`} className="relative h-20 w-20 overflow-hidden rounded-xl border border-line bg-surface2" title={f.name}>
          {urls[i] ? <img src={urls[i]} alt={f.name} className="h-full w-full object-cover" /> : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] text-muted"><FileText size={22} className="text-brand" /><span className="line-clamp-2 break-all">{f.name}</span></div>
          )}
          <button type="button" disabled={disabled} onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(i) }} aria-label={`Quitar ${f.name}`} title="Quitar"
            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white transition hover:bg-red-600 disabled:opacity-40"><X size={12} /></button>
        </li>
      ))}
    </ul>
  )
}
