import { useState } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { Building2, BedDouble, Bus, HandCoins, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Plane, Sparkles, Sun, BarChart3, Landmark, Utensils, Calculator as CalcIcon, CreditCard, RefreshCw } from 'lucide-react'
import { refreshAll, useAppUpdate, useAuth, useTheme } from '../hooks'
import { CalculatorPanel } from './CalculatorPanel'
import { AgencyLogo, Loading, MobileLogo, PoweredBy, ThemeSwitch } from './ui'

const groups = [
  { title: 'General', items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }, { to: '/registros', label: 'Registros', icon: ListChecks }] },
  { title: 'Operaciones', items: [{ to: '/vuelos', label: 'Vuelos', icon: Plane }, { to: '/hoteles', label: 'Hoteles', icon: BedDouble }, { to: '/prestamos', label: 'Préstamos', icon: HandCoins }, { to: '/alimentacion', label: 'Alimentación', icon: Utensils }, { to: '/transporte', label: 'Transporte', icon: Bus }, { to: '/otros', label: 'Servicios adicionales', icon: Sparkles }] },
  { title: 'Administrar', items: [{ to: '/empresas', label: 'Empresas', icon: Building2 }, { to: '/proveedores-tarjetas', label: 'Proveedores y tarjetas', icon: CreditCard }, { to: '/reportes', label: 'Reportes', icon: BarChart3 }, { to: '/movimientos-bancarios', label: 'Banco', icon: Landmark }] },
]

export function ProtectedLayout() {
  const { session, loading, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const [open, setOpen] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const update = useAppUpdate()
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true); setRefreshMsg('')
    try {
      const [ok] = await Promise.all([refreshAll(), update.check(), new Promise(r => setTimeout(r, 600))])
      setRefreshMsg(ok ? 'Datos actualizados' : 'No se pudieron actualizar todos los datos. Revisa tu conexión.')
    } finally { setRefreshing(false); setTimeout(() => setRefreshMsg(''), 3500) }
  }
  const nav = useNavigate()
  if (loading) return <div className="min-h-screen grid place-items-center"><Loading /></div>
  if (!session) return <Navigate to="/login" replace />

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-brand/10 text-brand font-medium' : 'text-muted hover:bg-surface2 hover:text-fg'}`

  return (
    <div className="min-h-screen lg:flex">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-surface border-r border-line flex flex-col transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 h-16 border-b border-line"><AgencyLogo /><span className="font-semibold">Aires y Destinos</span></div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-5" onClick={() => setOpen(false)}>
          {groups.map(g => (
            <div key={g.title}>
              <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.title}</p>
              {g.items.map(i => <NavLink key={i.to} to={i.to} className={link}><i.icon size={18} />{i.label}</NavLink>)}
            </div>
          ))}
          <div>
            <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Herramientas</p>
            <button type="button" aria-pressed={calcOpen} onClick={() => setCalcOpen(o => !o)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${calcOpen ? 'bg-brand/10 text-brand font-medium' : 'text-muted hover:bg-surface2 hover:text-fg'}`}><CalcIcon size={18} />Calculadora</button>
          </div>
        </nav>
        <div className="shrink-0 space-y-1 border-t border-line bg-surface2/60 p-3">
          <p className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Sistema</p>
          <div className="flex items-center justify-between rounded-lg px-3 py-1 text-sm text-muted">
            <span className="flex items-center gap-3">{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}{theme === 'dark' ? 'Modo oscuro' : 'Modo claro'}</span>
            <ThemeSwitch dark={theme === 'dark'} onToggle={toggle} />
          </div>
          <button type="button" onClick={refresh} disabled={refreshing} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface2 hover:text-fg disabled:opacity-70"><RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />Actualizar datos</button>
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-400" onClick={async () => { await signOut(); nav('/login') }}><LogOut size={18} />Cerrar sesión</button>
          <div className="mt-3 border-t border-line px-3 pt-3"><PoweredBy /></div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="lg:hidden sticky top-0 z-20 grid grid-cols-[2.25rem_1fr_2.25rem] items-center gap-3 h-14 px-4 bg-surface border-b border-line">
          <button onClick={() => setOpen(true)} aria-label="Menú" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-surface2"><Menu size={20} /></button>
          <span className="flex justify-center"><MobileLogo className="h-9" /></span>
          <button onClick={refresh} disabled={refreshing} aria-label="Actualizar datos" title="Actualizar datos" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-fg disabled:opacity-70"><RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} /></button>
        </header>
        <div aria-live="polite" className="sr-only">{refreshMsg}</div>
        {refreshMsg && <p role="status" className="mx-4 mt-3 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm lg:mx-8 lg:mt-6">{refreshMsg}</p>}
        {update.ready && (
          <div role="status" className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm lg:mx-8 lg:mt-6">
            <span>Hay una nueva versión de la aplicación.</span>
            <button className="btn-primary !py-1" onClick={update.apply}>Actualizar ahora</button>
          </div>
        )}
        <main className="p-4 sm:p-6 lg:p-8 w-full"><Outlet /></main>
      </div>
      <CalculatorPanel open={calcOpen} onClose={() => setCalcOpen(false)} />
    </div>
  )
}
