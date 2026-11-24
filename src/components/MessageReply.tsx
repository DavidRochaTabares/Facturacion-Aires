import { useRef } from 'react'
import { CornerUpLeft, X } from 'lucide-react'
import { parseAdmin } from './AdminMessage'

/** Reply-to-a-message ("responder"), shared by the three chats (client, agency, company administrator). */
export const previewOf = (m: { author: string; body: string }, fileNames: string[] = []) => {
  const text = parseAdmin(m.author, m.body).text.replace(/\s+/g, ' ').trim()
  if (text) return text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text
  return fileNames.length ? `📎 ${fileNames[0]}${fileNames.length > 1 ? ` (+${fileNames.length - 1})` : ''}` : 'Mensaje'
}

/** Scrolls to the quoted message and highlights it for a moment. */
export function jumpToMessage(id: string) {
  const el = document.getElementById(`msg-${id}`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('msg-flash')
  setTimeout(() => el.classList.remove('msg-flash'), 1600)
}

/** Swipe right on a message to reply (touch). Mostly horizontal and long enough, so normal scrolling never triggers it. */
export function useSwipeReply(onReply: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY } },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current; start.current = null
      if (!s) return
      const t = e.changedTouches[0], dx = t.clientX - s.x, dy = Math.abs(t.clientY - s.y)
      if (dx > 60 && dy < 40 && dx > dy * 2) onReply()
    },
  }
}

/** One chat row: anchor for "jump to message", reply button (hover / always on touch) and swipe-to-reply. The bubble is the child. */
export function MessageRow({ id, right, onReply, children }: { id: string; right: boolean; onReply: () => void; children: React.ReactNode }) {
  const swipe = useSwipeReply(onReply)
  return (
    <div id={`msg-${id}`} className={`group/msg flex items-center gap-1 ${right ? 'justify-end' : 'justify-start'}`} {...swipe}>
      {right && <ReplyButton onClick={onReply} />}
      {children}
      {!right && <ReplyButton onClick={onReply} />}
    </div>
  )
}

export function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Responder a este mensaje" title="Responder"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted opacity-50 transition hover:bg-surface2 hover:text-brand focus:opacity-100 md:opacity-0 md:group-hover/msg:opacity-100">
      <CornerUpLeft size={14} />
    </button>
  )
}

/** The quoted message shown at the top of a reply bubble. `dark` = the bubble has a coloured background (white text). */
export function QuoteBlock({ label, text, deleted, onJump, dark }: { label: string; text: string; deleted: boolean; onJump: () => void; dark: boolean }) {
  return (
    <button type="button" onClick={deleted ? undefined : onJump} disabled={deleted}
      className={`mb-1.5 block w-full min-w-0 rounded-lg border-l-4 px-2.5 py-1.5 text-left text-xs ${dark ? 'border-white/70 bg-black/15' : 'border-brand bg-black/5 dark:bg-white/5'} ${deleted ? 'cursor-default italic opacity-80' : 'hover:opacity-90'}`}>
      {deleted ? 'Mensaje eliminado' : <><span className={`block truncate font-semibold ${dark ? '' : 'text-brand'}`}>{label}</span><span className="line-clamp-2 break-words opacity-90">{text}</span></>}
    </button>
  )
}

/** Preview of the message being answered, shown above the composer. */
export function ReplyBar({ label, text, onCancel }: { label: string; text: string; onCancel: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-line bg-surface2 px-3 py-2 text-xs" role="status">
      <CornerUpLeft size={14} className="mt-0.5 shrink-0 text-brand" />
      <div className="min-w-0 flex-1 border-l-2 border-brand pl-2"><p className="truncate font-semibold text-brand">Respondiendo a {label}</p><p className="line-clamp-2 break-words text-muted">{text}</p></div>
      <button type="button" onClick={onCancel} aria-label="Cancelar respuesta" className="rounded p-1 text-muted hover:text-red-600"><X size={14} /></button>
    </div>
  )
}
