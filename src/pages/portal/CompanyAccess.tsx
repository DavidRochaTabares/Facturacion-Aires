import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, Lock, MessageCircle } from 'lucide-react'
import { Spinner } from '../../components/ui'
import { TOKEN_RE } from '../../services/portalApi'
import { companyAccessPublic } from '../../services/companyPortal'
import { Shell } from './PublicRequest'

const storeKey = (token: string) => `aires.company.${token.slice(0, 16)}`
interface Previous { name: string; conversation_token: string }
const readPrevious = (token: string): Previous | null => {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(token)) ?? 'null')
    return v && typeof v.name === 'string' && TOKEN_RE.test(v.conversation_token) ? v : null
  } catch { return null }
}

/** Public entry for a company's employees: the private company link (token in the fragment) + the employee's name opens a NEW conversation of that company. */
export default function CompanyAccess() {
  const token = useMemo(() => location.hash.replace(/^#/, ''), [])
  const [state, setState] = useState<'loading' | 'invalid' | 'error' | 'ready'>(TOKEN_RE.test(token) ? 'loading' : 'invalid')
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previous = useMemo(() => (TOKEN_RE.test(token) ? readPrevious(token) : null), [token])

  useEffect(() => {
    document.title = 'Solicitudes de empresa · Aires y Destinos'
    if (!TOKEN_RE.test(token)) return
    companyAccessPublic.check(token).then(r => { setCompany(r.company_name); setState('ready') })
      .catch((e: Error & { status?: number }) => { if (e.status === 404) setState('invalid'); else { setError(e.message); setState('error') } })
  }, [token])

  const open = (conversationToken: string) => location.assign(`/solicitud#${conversationToken}`)
  const start = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    setBusy(true); setError('')
    try {
      const r = await companyAccessPublic.start(token, n)
      try { localStorage.setItem(storeKey(token), JSON.stringify({ name: n, conversation_token: r.conversation_token })) } catch { /* private mode: the link is still opened */ }
      open(r.conversation_token)
    } catch (err) {
      const x = err as Error & { status?: number }
      if (x.status === 404) setState('invalid'); else setError(x.message)
      setBusy(false)
    }
  }

  if (state === 'loading') return <Shell><div className="flex justify-center py-24 text-muted"><Spinner /></div></Shell>
  if (state === 'invalid') return <Shell><div className="card portal-fade p-8 text-center"><Lock className="mx-auto mb-3 text-muted" size={28} /><h1 className="text-lg font-semibold">Enlace no válido</h1><p className="mt-2 text-sm text-muted">Este enlace no es válido o ha sido desactivado. Pide a tu empresa o a Aires y Destinos un enlace nuevo.</p></div></Shell>
  if (state === 'error') return <Shell><div className="card p-8 text-center"><p role="alert" className="text-sm text-red-500">{error}</p><button className="btn-primary mt-4" onClick={() => location.reload()}>Reintentar</button></div></Shell>

  return (
    <Shell>
      <section className="card portal-fade overflow-hidden" aria-label="Iniciar conversación">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-800 via-brand to-sky-500 px-6 py-8 text-center text-white sm:px-10">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col items-center gap-2">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/30 bg-white/15 backdrop-blur-sm"><Building2 size={22} /></span>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{company}</h1>
            <p className="mx-auto max-w-md text-sm text-blue-50/90">Solicita tus servicios de viaje con Aires y Destinos. Tu empresa podrá revisar y aprobar la conversación.</p>
          </div>
        </div>
        <form onSubmit={start} className="mx-auto max-w-md space-y-3 p-5 sm:p-7">
          {previous && (
            <button type="button" onClick={() => open(previous.conversation_token)} className="flex w-full items-center gap-3 rounded-xl border-2 border-line bg-surface p-3 text-left transition hover:border-brand">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"><MessageCircle size={18} /></span>
              <span className="min-w-0 text-sm"><span className="block font-semibold">Continuar mi conversación anterior</span><span className="block truncate text-xs text-muted">{previous.name}</span></span>
            </button>
          )}
          <label className="label" htmlFor="emp-name">{previous ? 'O inicia una nueva conversación con tu nombre' : 'Tu nombre'}</label>
          <input id="emp-name" className="input" value={name} maxLength={160} autoComplete="name" placeholder="Ej.: Carlos Pérez" onChange={e => setName(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || !name.trim()}>{busy ? <Spinner /> : <MessageCircle size={16} />}Iniciar conversación</button>
          <p className="text-center text-xs text-muted">Escribirás por chat o con el formulario y podrás agregar varios requerimientos. No necesitas contraseña.</p>
        </form>
      </section>
    </Shell>
  )
}
