import { ShieldCheck } from 'lucide-react'

/** Messages from the company administrator are stored on the client side with this visible prefix (see company_post_message). */
export const ADMIN_PREFIX = 'Administrador de la empresa: '
export const parseAdmin = (author: string, body: string) =>
  author === 'client' && body.startsWith(ADMIN_PREFIX) ? { admin: true, text: body.slice(ADMIN_PREFIX.length) } : { admin: false, text: body }

export const ADMIN_BUBBLE = 'bg-gradient-to-br from-violet-700 to-indigo-600 text-white shadow-md ring-2 ring-violet-400/60'

export function AdminBadge() {
  return (
    <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
      <ShieldCheck size={11} />Administrador de la empresa
    </span>
  )
}
