import { useState } from 'react'
import { FileText, FilterX } from 'lucide-react'
import { BarList, DonutChart } from '../components/charts'
import ReportBuilder from '../components/ReportBuilder'
import { Empty, Loading, PageHeader, Select, TextInput } from '../components/ui'
import { useAsync } from '../hooks'
import { money, monthLabel, SERVICE_LABEL, SERVICE_TYPES } from '../lib/format'
import { dataService } from '../services'
import type { OperationFilters, OperationType } from '../types'

export default function Reports() {
  const [f, setF] = useState<OperationFilters>({})
  const [build, setBuild] = useState(false)
  const set = (k: keyof OperationFilters) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))
  const { data, loading, error } = useAsync(() => dataService.getServiceReports(f), [JSON.stringify(f)])
  const { data: companies } = useAsync(() => dataService.getCompanies(), [])
  const { data: providers } = useAsync(() => dataService.getProviders(), [])

  const cards = data && [
    ['Total registros', data.total_operations], ['Costo total', money(data.total_cost)], ['Valor a cobrar', money(data.total_charge)], ['Costo promedio', money(data.average)],
  ]
  return (
    <>
      <PageHeader title="Reportes" subtitle="Análisis por periodo, empresa y proveedor" actions={<button className="btn-primary" onClick={() => setBuild(true)}><FileText size={16} />Crear informe</button>} />
      <div className="card p-3 mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <div className="sm:col-span-2 lg:col-span-5 flex justify-end -mb-1"><button type="button" className="btn-ghost" onClick={() => setF({})}><FilterX size={14} />Limpiar filtros</button></div>
        <TextInput label="Desde" type="date" value={f.date_from ?? ''} onChange={set('date_from')} />
        <TextInput label="Hasta" type="date" value={f.date_to ?? ''} onChange={set('date_to')} />
        <Select label="Empresa" value={f.company_id ?? ''} onChange={set('company_id')}><option value="">Todas</option>{companies?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select label="Tipo de servicio" value={f.type ?? ''} onChange={e => setF(p => ({ ...p, type: e.target.value as OperationType | '' }))}><option value="">Todos</option>{SERVICE_TYPES.map(t => <option key={t} value={t}>{SERVICE_LABEL[t]}</option>)}</Select>
        <Select label="Aerolínea / proveedor" value={f.provider ?? ''} onChange={set('provider')}><option value="">Todos</option>{providers?.map(p => <option key={p}>{p}</option>)}</Select>
      </div>
      {loading ? <Loading /> : error || !data ? <Empty><span role="alert" className="text-red-500">{error ?? 'Sin datos'}</span></Empty> : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">{cards!.map(([k, v]) => <div key={k} className="card p-4"><p className="text-xs text-muted font-medium">{k}</p><p className="mt-2 text-xl font-semibold tabular-nums">{v}</p></div>)}</div>
          <div className="grid gap-4 mt-4 lg:grid-cols-2">
            <section className="card p-5"><h2 className="font-semibold text-sm mb-4">Distribución por servicio</h2><DonutChart data={data.by_type} /></section>
            <section className="card p-5"><h2 className="font-semibold text-sm mb-4">Valor por empresa</h2><BarList data={data.by_company} /></section>
            <section className="card p-5"><h2 className="font-semibold text-sm mb-4">Valor por aerolínea / proveedor</h2><BarList data={data.by_provider.slice(0, 8)} /></section>
            <section className="card p-5"><h2 className="font-semibold text-sm mb-4">Evolución mensual</h2><BarList data={data.by_month.map(m => ({ ...m, label: monthLabel(m.key) }))} /></section>
          </div>
        </>
      )}
      <ReportBuilder open={build} onClose={() => setBuild(false)} filters={f} companyName={companies?.find(c => c.id === f.company_id)?.name} />
    </>
  )
}
