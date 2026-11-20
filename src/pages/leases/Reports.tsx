import { useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet } from 'lucide-react'
import airesDay from '../../assets/aires-day.png'
import { Empty, Select, Spinner } from '../../components/ui'
import { fdate, money, MONTHS } from '../../lib/format'
import { bySpace, inRange, invoicePeriod, monthly, periodIn, summarize } from '../../lib/leaseCalc'
import type { ReportColumn, ReportTable } from '../../lib/reportColumns'
import { downloadReportExcel } from '../../lib/reportExcel'
import { downloadReportPdf, imageToDataUrl } from '../../lib/reportPdf'
import { INVOICE_STATUS_LABEL, LEASE_CATEGORIES, LEASE_CATEGORY_LABEL, PAY_STATUS_LABEL, type LeaseSnapshot } from '../../types/lease'
import { defaultPeriod, PeriodPicker, periodLabel, periodRange } from './shared'

interface Tbl { id: string; title: string; head: string[]; rows: string[][]; foot?: string[]; right: number[] }
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)
const ymText = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

export function Reports({ opName, snap }: { opName: string; snap: LeaseSnapshot }) {
  const [period, setPeriod] = useState(defaultPeriod())
  const [space, setSpace] = useState('')
  const [category, setCategory] = useState('')
  const [customer, setCustomer] = useState('')
  const [status, setStatus] = useState('')
  const [income, setIncome] = useState<'all' | 'clients' | 'slb'>('all')
  const [tab, setTab] = useState('result')
  const [busy, setBusy] = useState(false)
  const [fmt, setFmt] = useState<'pdf' | 'xlsx'>('pdf')
  const range = periodRange(period)
  const customers = useMemo(() => [...new Set(snap.invoices.map(i => i.customer_name))].sort((a, b) => a.localeCompare(b)), [snap.invoices])
  const spaceName = (id: string | null) => (id ? snap.spaces.find(s => s.id === id)?.name ?? '—' : 'General SLB')

  const built = useMemo(() => {
    const okSpace = (id: string | null) => !space || (space === 'none' ? !id : id === space)
    const showClients = income !== 'slb', showSlb = income !== 'clients' && !space && !customer
    const expenses = (income === 'slb' ? [] : snap.expenses).filter(e => periodIn(e.period, range) && okSpace(e.space_id) && (!category || e.category === category) && (!status || e.payment_status === status))
    const invoices = (showClients ? snap.invoices : []).filter(i => periodIn(invoicePeriod(i), range) && okSpace(i.space_id) && (!customer || i.customer_name === customer) && (!status || i.payment_status === status))
    const invById = new Map(snap.invoices.map(i => [i.id, i]))
    const custPays = (showClients ? snap.customerPayments : []).filter(p => { const i = invById.get(p.invoice_id); return !!i && inRange(p.paid_at, range) && okSpace(i.space_id) && (!customer || i.customer_name === customer) })
    const slb = (showSlb ? snap.slbPayments : []).filter(p => inRange(p.received_at, range))
    const expPays = (income === 'slb' ? [] : snap.expensePayments).filter(p => { const e = snap.expenses.find(x => x.id === p.expense_id); return !!e && inRange(p.paid_at, range) && okSpace(e.space_id) && (!category || e.category === category) })
    const fs: LeaseSnapshot = { spaces: snap.spaces, expenses, invoices, expensePayments: expPays, customerPayments: custPays, slbPayments: slb }
    const sum = summarize(fs, range)
    const live = invoices.filter(i => i.status !== 'void')
    const tables: Tbl[] = []
    tables.push({ id: 'result', title: 'Resultado general de la operación', head: ['Concepto', 'Valor'], right: [1], rows: [
      ['Total facturado a clientes', money(sum.invoiced)], ['Total recibido de clientes', money(sum.receivedClients)], ['Saldo pendiente de clientes', money(sum.customerPending)], ['Total recibido de SLB', money(sum.slb)],
      ['Total de gastos', money(sum.expensesTotal)], ['Gastos pagados', money(sum.expensesPaid)], ['Gastos pendientes', money(sum.expensesPending)],
      ['Resultado por facturación (facturado - gastos)', money(sum.resultInvoicing)], ['Flujo de caja (recibido - pagado)', money(sum.cashFlow)]] })
    tables.push({ id: 'expenses', title: `Detalle de gastos (${expenses.length})`, head: ['Fecha', 'Periodo', 'Categoría', 'Concepto', 'Beneficiario', 'Espacio', 'Valor', 'Pagado', 'Saldo', 'Estado'], right: [6, 7, 8],
      rows: expenses.map(e => [fdate(e.expense_date), e.period.slice(0, 7), LEASE_CATEGORY_LABEL[e.category], e.concept, e.beneficiary || '-', spaceName(e.space_id), money(e.amount), money(e.paid), money(e.balance), PAY_STATUS_LABEL[e.payment_status]]),
      foot: expenses.length ? ['Total', '', '', '', '', '', money(sum.expensesTotal), money(sum.expensesPaid), money(sum.expensesPending), ''] : undefined })
    tables.push({ id: 'invoices', title: `Facturas emitidas (${invoices.length})`, head: ['Número', 'Cliente', 'Espacio', 'Periodo', 'Emisión', 'Vence', 'Total', 'Recibido', 'Saldo', 'Estado'], right: [6, 7, 8],
      rows: invoices.map(i => [i.invoice_number, i.customer_name, spaceName(i.space_id) === 'General SLB' ? '-' : spaceName(i.space_id), `${MONTHS[i.period_month - 1]} ${i.period_year}`, fdate(i.issue_date), fdate(i.due_date ?? undefined), money(i.total), money(i.received), i.status === 'void' ? '-' : money(i.balance), INVOICE_STATUS_LABEL[i.payment_status]]),
      foot: invoices.length ? ['Total (sin anuladas)', '', '', '', '', '', money(live.reduce((a, i) => a + i.total, 0)), money(live.reduce((a, i) => a + i.received, 0)), money(live.reduce((a, i) => a + i.balance, 0)), ''] : undefined })
    tables.push({ id: 'custpays', title: `Pagos recibidos de clientes (${custPays.length})`, head: ['Fecha', 'Factura', 'Cliente', 'Medio', 'Referencia', 'Valor'], right: [5],
      rows: custPays.map(p => { const i = invById.get(p.invoice_id); return [fdate(p.paid_at), i?.invoice_number ?? '-', i?.customer_name ?? '-', p.method || '-', p.reference || '-', money(p.amount)] }),
      foot: custPays.length ? ['Total', '', '', '', '', money(sum.receivedClients)] : undefined })
    tables.push({ id: 'slb', title: `Pagos recibidos de SLB (${slb.length})`, head: ['Recibido', 'Periodo', 'Concepto', 'Medio', 'Cuenta destino', 'Referencia', 'Valor'], right: [6],
      rows: slb.map(p => [fdate(p.received_at), p.period.slice(0, 7), p.concept, p.method || '-', p.bank_account || '-', p.reference || '-', money(p.amount)]),
      foot: slb.length ? ['Total', '', '', '', '', '', money(sum.slb)] : undefined })
    const pend = [
      ...live.filter(i => i.balance > 0).map(i => ['Por cobrar a cliente', i.invoice_number, i.customer_name, fdate(i.due_date ?? undefined), money(i.balance), i.balance] as const),
      ...expenses.filter(e => e.balance > 0).map(e => ['Gasto por pagar', e.concept, e.beneficiary || '-', fdate(e.due_date ?? undefined), money(e.balance), e.balance] as const),
    ]
    tables.push({ id: 'pending', title: `Saldos pendientes (${pend.length})`, head: ['Tipo', 'Documento', 'Tercero', 'Vence', 'Saldo'], right: [4], rows: pend.map(p => [p[0], p[1], p[2], p[3], p[4]]),
      foot: pend.length ? ['Total', '', '', '', `Por cobrar ${money(sum.customerPending)} · Por pagar ${money(sum.expensesPending)}`] : undefined })
    const months = monthly(fs, range)
    tables.push({ id: 'monthly', title: 'Comparativo mensual', head: ['Mes', 'Facturado', 'Recibido clientes', 'Recibido SLB', 'Gastos', 'Pagado', 'Result. facturación', 'Flujo de caja'], right: [1, 2, 3, 4, 5, 6, 7],
      rows: months.map(m => [ymText(m.ym), money(m.invoiced), money(m.receivedClients), money(m.slb), money(m.expenses), money(m.paidExpenses), money(m.resultInvoicing), money(m.cashFlow)]) })
    const sp = bySpace(fs, range)
    tables.push({ id: 'spaces', title: 'Rentabilidad por espacio (base facturación)', head: ['Espacio', 'Facturado', 'Recibido', 'Gastos', 'Resultado', 'Margen'], right: [1, 2, 3, 4, 5],
      rows: sp.map(s => [s.name, money(s.invoiced), money(s.received), money(s.expenses), money(s.result), pct(s.margin)]) })
    return tables
  }, [snap, range.from, range.to, space, category, customer, status, income]) // eslint-disable-line react-hooks/exhaustive-deps

  const labels: Record<string, string> = { result: 'Resultado', expenses: 'Gastos', invoices: 'Facturas', custpays: 'Pagos de clientes', slb: 'Pagos de SLB', pending: 'Saldos pendientes', monthly: 'Comparativo mensual', spaces: 'Por espacio' }
  const current = built.find(t => t.id === tab) ?? built[0]
  const filtersText = [space && `Espacio: ${space === 'none' ? 'General SLB' : spaceName(space)}`, category && `Categoría: ${LEASE_CATEGORY_LABEL[category as keyof typeof LEASE_CATEGORY_LABEL]}`, customer && `Cliente: ${customer}`, status && `Estado: ${PAY_STATUS_LABEL[status as keyof typeof PAY_STATUS_LABEL]}`, income !== 'all' && `Ingresos: ${income === 'clients' ? 'solo clientes' : 'solo SLB'}`].filter(Boolean).join(' · ')

  const exportReport = async (format: 'pdf' | 'xlsx') => {
    setBusy(true); setFmt(format)
    try {
      const col = (i: number, label: string, money: boolean): ReportColumn => ({ key: String(i), label, group: 'common', money, get: () => null })
      const tables: ReportTable[] = built.filter(t => t.id === 'result' || t.id === 'monthly' || t.id === 'spaces' || t.rows.length).map(t => ({ group: 'additional', title: t.title, cols: t.head.map((h, i) => col(i, h, t.right.includes(i))), body: t.rows, foot: t.foot ?? null }))
      const meta = { title: `Informe de Arrendamientos - ${opName}`, client: opName, period: periodLabel(period), extra: filtersText, generatedAt: new Date().toLocaleString('es-CO') }
      const base = `Informe_Arrendamientos_${opName.replace(/\s+/g, '_')}_${period.mode === 'month' ? `${period.year}-${String(period.month).padStart(2, '0')}` : period.mode === 'year' ? period.year : `${range.from}_a_${range.to}`}`
      if (format === 'xlsx') await downloadReportExcel(meta, tables, `${base}.xlsx`)
      else await downloadReportPdf(meta, tables, await imageToDataUrl(airesDay).catch(() => undefined), `${base}.pdf`)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Select label="Espacio" value={space} onChange={e => setSpace(e.target.value)}><option value="">Todos</option><option value="none">General SLB</option>{snap.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select label="Categoría de gasto" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas</option>{LEASE_CATEGORIES.map(c => <option key={c} value={c}>{LEASE_CATEGORY_LABEL[c]}</option>)}</Select>
          <Select label="Cliente" value={customer} onChange={e => setCustomer(e.target.value)}><option value="">Todos</option>{customers.map(c => <option key={c}>{c}</option>)}</Select>
          <Select label="Estado de pago" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option><option value="void">Anulada</option></Select>
          <Select label="Tipo de ingreso" value={income} onChange={e => setIncome(e.target.value as typeof income)}><option value="all">Clientes y SLB</option><option value="clients">Solo clientes</option><option value="slb">Solo SLB</option></Select>
        </div>
        {(space || customer) && income !== 'clients' && <p className="text-xs text-muted">Los pagos de SLB no pertenecen a un espacio ni a un cliente: se ocultan mientras uno de esos filtros esté activo.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost border border-line" onClick={() => exportReport('xlsx')} disabled={busy}>{busy && fmt === 'xlsx' ? <Spinner /> : <FileSpreadsheet size={16} />}Descargar Excel</button>
          <button className="btn-primary" onClick={() => exportReport('pdf')} disabled={busy}>{busy && fmt === 'pdf' ? <Spinner /> : <FileDown size={16} />}Descargar PDF</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist">{built.map(t => <button key={t.id} role="tab" aria-selected={current.id === t.id} onClick={() => setTab(t.id)}
        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${current.id === t.id ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:text-fg'}`}>{labels[t.id]}</button>)}</div>

      <div className="card overflow-hidden">
        <p className="border-b border-line px-4 py-2.5 text-sm font-semibold">{current.title}</p>
        {current.rows.length === 0 ? <Empty>Sin registros para estos filtros.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr className="border-b border-line bg-surface2/50">{current.head.map((h, i) => <th key={i} className={`th !px-3 ${current.right.includes(i) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{current.rows.map((r, ri) => <tr key={ri} className="hover:bg-surface2/60">{r.map((c, i) => <td key={i} className={`td !px-3 ${current.right.includes(i) ? 'text-right tabular-nums' : '!whitespace-normal'}`}>{c}</td>)}</tr>)}</tbody>
            {current.foot && <tfoot><tr className="border-t border-line bg-surface2/50 font-semibold">{current.foot.map((c, i) => <td key={i} className={`td !px-3 ${current.right.includes(i) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr></tfoot>}
          </table></div>
        )}
      </div>
    </div>
  )
}
