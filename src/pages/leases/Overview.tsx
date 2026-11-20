import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, monthLabel } from '../../lib/format'
import { monthly, summarize } from '../../lib/leaseCalc'
import type { LeaseSnapshot } from '../../types/lease'
import { defaultPeriod, PeriodPicker, periodLabel, periodRange, Stat } from './shared'

const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12 } }

export function Overview({ snap }: { snap: LeaseSnapshot }) {
  const [period, setPeriod] = useState(defaultPeriod())
  const range = periodRange(period)
  const s = useMemo(() => summarize(snap, range), [snap, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const months = useMemo(() => monthly(snap, range), [snap, range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps
  const tone = (n: number) => (n > 0 ? 'good' as const : n < 0 ? 'bad' as const : undefined)

  return (
    <div className="space-y-5">
      <div className="card p-4"><PeriodPicker value={period} onChange={setPeriod} /><p className="mt-2 text-xs text-muted">Facturación y gastos se reconocen por su <b>periodo</b>; los recaudos y pagos, por su <b>fecha real</b>.</p></div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Ingresos · {periodLabel(period)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total facturado a clientes" value={money(s.invoiced)} hint="Facturas del periodo (sin anuladas)" />
          <Stat label="Total recibido de clientes" value={money(s.receivedClients)} tone="good" hint="Pagos de clientes en las fechas" />
          <Stat label="Saldo pendiente de clientes" value={money(s.customerPending)} tone={s.customerPending > 0 ? 'warn' : undefined} hint="De las facturas del periodo" />
          <Stat label="Total recibido de SLB" value={money(s.slb)} tone="good" hint="Ingreso independiente" />
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Gastos del periodo</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total de gastos" value={money(s.expensesTotal)} />
          <Stat label="Gastos pagados" value={money(s.expensesPaid)} hint="Pagos de esos gastos" />
          <Stat label="Gastos pendientes" value={money(s.expensesPending)} tone={s.expensesPending > 0 ? 'warn' : undefined} />
          <Stat label="Pagado en el periodo" value={money(s.paidCash)} hint="Salidas de dinero por fecha" />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Resultado operativo</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card p-4"><p className="text-sm font-semibold">Resultado por facturación</p><p className="text-xs text-muted">Facturación reconocida − gastos del periodo</p>
            <dl className="mt-3 space-y-1 text-sm"><div className="flex justify-between"><dt>Facturado</dt><dd className="tabular-nums">{money(s.invoiced)}</dd></div><div className="flex justify-between"><dt>Gastos</dt><dd className="tabular-nums">− {money(s.expensesTotal)}</dd></div></dl>
            <p className={`mt-2 border-t border-line pt-2 text-2xl font-semibold tabular-nums ${tone(s.resultInvoicing) === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(s.resultInvoicing)}</p>
            <p className="mt-1 text-[11px] text-muted">Los pagos de SLB ({money(s.slb)}) se muestran aparte y no entran en este cálculo.</p></div>
          <div className="card p-4"><p className="text-sm font-semibold">Flujo de caja</p><p className="text-xs text-muted">Dinero efectivamente recibido − dinero efectivamente pagado</p>
            <dl className="mt-3 space-y-1 text-sm"><div className="flex justify-between"><dt>Recibido de clientes</dt><dd className="tabular-nums">{money(s.receivedClients)}</dd></div><div className="flex justify-between"><dt>Recibido de SLB</dt><dd className="tabular-nums">{money(s.slb)}</dd></div><div className="flex justify-between"><dt>Pagado en gastos</dt><dd className="tabular-nums">− {money(s.paidCash)}</dd></div></dl>
            <p className={`mt-2 border-t border-line pt-2 text-2xl font-semibold tabular-nums ${tone(s.cashFlow) === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(s.cashFlow)}</p></div>
        </div>
      </div>

      <section className="card p-4"><h2 className="mb-3 text-sm font-semibold">Evolución mensual</h2>
        {months.length === 0 ? <p className="text-sm text-muted">Sin datos para el periodo.</p> : (
          <div className="h-72"><ResponsiveContainer><BarChart data={months.map(m => ({ ...m, label: monthLabel(m.ym) }))} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" /><XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} /><YAxis tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} tickFormatter={v => `${Math.round(Number(v) / 1_000_000)}M`} width={40} />
            <Tooltip {...tip} formatter={v => money(Number(v))} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="invoiced" name="Facturado" fill="#3b82f6" radius={[3, 3, 0, 0]} /><Bar dataKey="receivedClients" name="Recibido clientes" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="slb" name="Recibido SLB" fill="#8b5cf6" radius={[3, 3, 0, 0]} /><Bar dataKey="expenses" name="Gastos" fill="#f43f5e" radius={[3, 3, 0, 0]} />
          </BarChart></ResponsiveContainer></div>
        )}
      </section>
    </div>
  )
}
