import { useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ArrowLeft, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import airesDay from '../assets/aires-day.png'
import airesNight from '../assets/aires-night.png'
import spineDay from '../assets/spinedev-day.png'
import spineNight from '../assets/spinedev-night.png'
import { SERVICE_LABEL } from '../lib/format'
import type { OperationType } from '../types'

export const BackButton = ({ onClick, label = 'Volver' }: { onClick: () => void; label?: string }) => (
  <button type="button" onClick={onClick} className="group inline-flex items-center gap-2 rounded-full bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20 focus:outline-none focus:ring-2 focus:ring-brand/40">
    <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />{label}
  </button>
)
export const ThemeSwitch = ({ dark, onToggle }: { dark: boolean; onToggle: () => void }) => (
  <label className="theme-switch" title="Cambiar modo claro / oscuro">
    <input className="checkbox" type="checkbox" role="switch" aria-label="Cambiar modo claro / oscuro" checked={dark} onChange={onToggle} />
    <span className="slider">
      <svg className="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      <svg className="icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </span>
  </label>
)
export const Spinner = ({ className = '' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} size={18} />
export const Loading = () => <div className="flex justify-center py-16 text-muted"><Spinner /></div>

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}</div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function Field({ label, children, className = '', error }: { label: string; children: ReactNode; className?: string; error?: string }) {
  return <div className={className}><label className="label">{label}</label>{children}{error && <p role="alert" className="text-xs text-red-500 mt-1">{error}</p>}</div>
}
const errCls = (e?: string, w?: boolean) => `input ${e ? '!border-red-500' : w ? '!border-amber-500' : ''}`
export const TextInput = ({ label, className, error, warn, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; warn?: boolean }) => (
  <Field label={label} className={className} error={error}><input className={errCls(error, warn)} {...p} /></Field>
)
export const Select = ({ label, className, children, error, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }) => {
  const el = <select className={errCls(error)} {...p}>{children}</select>
  return label ? <Field label={label} className={className} error={error}>{el}</Field> : el
}

const TYPE_COLOR: Record<OperationType, string> = {
  flight: 'bg-blue-500/10 text-blue-600 dark:text-blue-300', hotel: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  transport: 'bg-amber-500/10 text-amber-600 dark:text-amber-300', food: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  loan: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300', additional: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300',
  other: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
}
export const TYPE_HEX: Record<OperationType, string> = { flight: '#3b82f6', hotel: '#8b5cf6', transport: '#f59e0b', food: '#f43f5e', loan: '#10b981', additional: '#06b6d4', other: '#94a3b8' }
export const TypeBadge = ({ type }: { type: OperationType }) => <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[type]}`}>{SERVICE_LABEL[type]}</span>

export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} bg-surface border-l border-line shadow-xl flex flex-col`}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface2" aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  )
}

export const Modal = ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4"><h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface2" aria-label="Cerrar"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-12 text-center text-sm text-muted">{children}</div>

export const AgencyLogo = ({ size = 36 }: { size?: number }) => (
  <span style={{ width: size, height: size }} className="shrink-0 grid place-items-center">
    <img src={airesDay} alt="Aires y Destinos" className="max-h-full max-w-full object-contain dark:hidden" />
    <img src={airesNight} alt="Aires y Destinos" className="max-h-full max-w-full object-contain hidden dark:block" />
  </span>
)
export const PoweredBy = () => (
  <div className="flex items-center gap-2 text-[11px] text-muted">
    Powered by
    <img src={spineDay} alt="SpineDev" className="h-5 w-auto dark:hidden" />
    <img src={spineNight} alt="SpineDev" className="h-5 w-auto hidden dark:block" />
  </div>
)

export function FilterBar({ search, onSearch, active, children }: { search: string; onSearch: (v: string) => void; active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card p-3 mb-4 space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-2">
      <div className="flex gap-2 md:contents">
        <div className="relative flex-1 md:min-w-[14rem]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar…" value={search} onChange={e => onSearch(e.target.value)} /></div>
        <button type="button" className="btn-ghost md:hidden" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <SlidersHorizontal size={16} />Filtros{active > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] text-white dark:text-slate-900">{active}</span>}
        </button>
      </div>
      <div className={`${open ? 'grid' : 'hidden'} grid-cols-2 gap-2 md:contents`}>{children}</div>
    </div>
  )
}

export const FilePreview = ({ url, mime = 'application/pdf', className = '' }: { url: string | null; mime?: string; className?: string }) =>
  !url ? <div className={`grid place-items-center rounded-lg border border-dashed border-line text-sm text-muted ${className}`}>Sin vista previa</div>
    : mime.startsWith('image/') ? <img src={url} alt="Vista previa" className={`w-full h-full object-contain rounded-lg border border-line bg-surface2 ${className}`} />
    : <iframe src={url} title="Vista previa" className={`w-full h-full rounded-lg border border-line bg-surface2 ${className}`} />
