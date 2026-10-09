import { PageHeader, ThemeSwitch } from '../components/ui'
import { useAuth, useTheme } from '../hooks'

export default function SettingsPage() {
  const { theme, toggle } = useTheme()
  const { session } = useAuth()
  return (
    <div className="max-w-2xl">
      <PageHeader title="Configuración" />
      <div className="card divide-y divide-line">
        <div className="p-5 flex items-center justify-between">
          <div><p className="font-medium text-sm">Apariencia</p><p className="text-xs text-muted">Tema {theme === 'dark' ? 'oscuro' : 'claro'} (se guarda en este equipo)</p></div>
          <ThemeSwitch dark={theme === 'dark'} onToggle={toggle} />
        </div>
        <div className="p-5"><p className="font-medium text-sm">Sesión</p><p className="text-xs text-muted">{session?.email}</p></div>
        <div className="p-5"><p className="font-medium text-sm">Moneda</p><p className="text-xs text-muted">Peso colombiano (COP)</p></div>
      </div>
    </div>
  )
}
