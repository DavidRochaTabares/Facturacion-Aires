import { Banknote, BedDouble, Landmark, FileText, HandCoins, Layers, Plane, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BarList, DonutChart } from '../components/charts'
import { Empty, Loading, PageHeader, TypeBadge } from '../components/ui'
import { useAsync } from '../hooks'
import { fdate, money } from '../lib/format'
import { dataService } from '../services'

export default function Dashboard() {
  const { data, loading, error } = useAsync(() => dataService.getDashboardStats(), [])
  const { data: bank } = useAsync(() => dataService.getBankReports(), [])
  if (error) return <Empty><span role="alert" className="text-red-500">{error}</span></Empty>
  if (loading || !data) return <Loading />
  const cards = [
    { label: 'Total registros', value: data.total_operations, icon: FileText },
    { label: 'Costo total', value: money(data.total_cost), icon: Banknote },
    { label: 'Valor a cobrar', value: money(data.total_charge), icon: Wallet },
    { label: 'Vuelos', value: data.total_flights, icon: Plane },
    { label: 'Hoteles', value: data.total_hotels, icon: BedDouble },
    { label: 'Préstamos', value: data.total_loans, icon: HandCoins },
    { label: 'Otros servicios', value: data.total_others, icon: Layers },
  ]
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumen general de la operación" />
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Registros de servicios</h2>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cards.map(c => (
          <div key={c.label} className="card p-4">
            <div className="flex items-center justify-between text-muted text-xs font-medium">{c.label}<c.icon size={16} /></div>
            <p className="mt-2 text-xl font-semibold tabular-nums truncate">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 mt-4 lg:grid-cols-2">
        <section className="card p-5"><h2 className="font-semibold text-sm mb-4">Distribución por tipo de servicio</h2><DonutChart data={data.by_type} /></section>
        <section className="card p-5"><h2 className="font-semibold text-sm mb-4">Costo por empresa</h2><BarList data={data.by_company} /></section>
      </div>
      <section className="card mt-4">
        <div className="flex items-center justify-between p-5 pb-3"><h2 className="font-semibold text-sm">Registros recientes</h2><Link to="/registros" className="text-sm text-brand">Ver todos</Link></div>
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="border-y border-line"><th className="th">Fecha</th><th className="th">Empresa</th><th className="th">Tipo</th><th className="th">Proveedor</th><th className="th text-right">Costo</th><th className="th text-right">A cobrar</th></tr></thead>
          <tbody className="divide-y divide-line">{data.recent.map(r => (
            <tr key={r.id}><td className="td">{fdate(r.date)}</td><td className="td">{r.company_name}</td><td className="td"><TypeBadge type={r.type} /></td><td className="td">{r.provider || '—'}</td><td className="td text-right tabular-nums">{money(r.amount)}</td><td className="td text-right tabular-nums">{money(r.charge_amount)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mt-8 mb-3">Movimientos bancarios (independiente de los servicios)</h2>
      <section className="card p-5">
        <div className="flex items-center justify-between mb-4"><span className="flex items-center gap-2 text-sm font-semibold"><Landmark size={16} />Cuenta bancaria</span><Link to="/movimientos-bancarios" className="text-sm text-brand">Ver movimientos</Link></div>
        {bank ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="text-xs text-muted">Movimientos</p><p className="text-xl font-semibold">{bank.count}</p></div>
            <div><p className="text-xs text-muted">Último movimiento</p><p className="text-xl font-semibold">{fdate(bank.last_date)}</p></div>
            <div><p className="text-xs text-muted mb-1">Por tipo</p><ul className="text-sm space-y-0.5">{bank.by_type.map(t => <li key={t.key} className="flex justify-between"><span>{t.label} ({t.count})</span><span className="tabular-nums">{money(t.amount)}</span></li>)}</ul></div>
          </div>
        ) : <Loading />}
      </section>
    </>
  )
}
