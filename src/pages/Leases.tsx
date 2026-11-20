import { useEffect, useState } from 'react'
import { Empty, Loading, PageHeader, Select } from '../components/ui'
import { useAsync } from '../hooks'
import { leases } from '../services/leases'
import { Expenses } from './leases/Expenses'
import { Invoices } from './leases/Invoices'
import { Overview } from './leases/Overview'
import { Reports } from './leases/Reports'
import { SlbPayments } from './leases/SlbPayments'
import { Spaces } from './leases/Spaces'

const TABS = [
  { id: 'overview', label: 'Resumen' }, { id: 'spaces', label: 'Espacios' }, { id: 'expenses', label: 'Gastos' },
  { id: 'invoices', label: 'Facturación' }, { id: 'slb', label: 'Pagos de SLB' }, { id: 'reports', label: 'Reportes' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Leases() {
  const ops = useAsync(() => leases.operations(), [])
  const [opId, setOpId] = useState('')
  const [tab, setTab] = useState<TabId>('overview')
  const op = ops.data?.find(o => o.id === opId) ?? ops.data?.[0]
  const snap = useAsync(() => (op ? leases.snapshot(op.id) : Promise.resolve(null)), [op?.id])
  // retries any file removals that did not finish earlier (queued by the database)
  useEffect(() => { leases.processCleanup().catch(() => undefined) }, [])

  return (
    <>
      <PageHeader title="Arrendamientos" subtitle={op ? `Operación ${op.name}` : 'Espacios arrendados y alquilados a clientes'}
        actions={(ops.data?.length ?? 0) > 1 ? <div className="w-48"><Select value={op?.id ?? ''} onChange={e => setOpId(e.target.value)} aria-label="Operación">{ops.data!.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div> : undefined} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
          className={`-mb-px shrink-0 border-b-2 px-3.5 py-2 text-sm font-medium transition ${tab === t.id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg'}`}>{t.label}</button>)}
      </div>
      {ops.error ? <Empty><span role="alert" className="text-red-500">{ops.error}</span></Empty>
        : ops.loading || (op && snap.loading && !snap.data) ? <Loading />
        : !op ? <Empty>No hay operaciones de arrendamiento. Ejecuta supabase/leases.sql para crear la operación SLB.</Empty>
        : snap.error || !snap.data ? <Empty><span role="alert" className="text-red-500">{snap.error ?? 'No se pudieron cargar los datos.'}</span></Empty>
        : tab === 'overview' ? <Overview snap={snap.data} />
        : tab === 'spaces' ? <Spaces operationId={op.id} snap={snap.data} />
        : tab === 'expenses' ? <Expenses operationId={op.id} snap={snap.data} />
        : tab === 'invoices' ? <Invoices operationId={op.id} snap={snap.data} />
        : tab === 'slb' ? <SlbPayments operationId={op.id} snap={snap.data} />
        : <Reports opName={op.name} snap={snap.data} />}
    </>
  )
}
