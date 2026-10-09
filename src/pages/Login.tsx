import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks'
import { AgencyLogo, PoweredBy, Spinner } from '../components/ui'

export default function Login() {
  const { session, signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (session) return <Navigate to="/dashboard" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try { await signIn(email, password); nav('/dashboard') }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión') }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6"><AgencyLogo size={56} /><h1 className="text-xl font-semibold">Aires y Destinos</h1><p className="text-sm text-muted">Inicia sesión para continuar</p></div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div><label className="label">Correo electrónico</label>
            <input className="input" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@agencia.com" /></div>
          <div><label className="label">Contraseña</label>
            <div className="relative">
              <input className="input pr-10" type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted" aria-label="Mostrar contraseña">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div></div>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Iniciar sesión</button>
        </form>
        <div className="flex justify-center mt-6"><PoweredBy /></div>
      </div>
    </div>
  )
}
