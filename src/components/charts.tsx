import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, SERVICE_LABEL } from '../lib/format'
import type { Slice } from '../types'
import { Empty, TYPE_HEX } from './ui'

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#94a3b8']
const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--fg))' }, itemStyle: { color: 'rgb(var(--fg))' } }
const colorOf = (s: Slice, i: number) => (s.key in SERVICE_LABEL ? TYPE_HEX[s.key as keyof typeof TYPE_HEX] : PALETTE[i % PALETTE.length])

export function DonutChart({ data }: { data: Slice[] }) {
  if (!data.length) return <Empty>Sin datos</Empty>
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="h-44 w-44 shrink-0">
        <ResponsiveContainer><PieChart>
          <Pie data={data} dataKey="count" nameKey="label" innerRadius={48} outerRadius={80} stroke="none">{data.map((s, i) => <Cell key={s.key} fill={colorOf(s, i)} />)}</Pie>
          <Tooltip {...tip} />
        </PieChart></ResponsiveContainer>
      </div>
      <ul className="flex-1 w-full space-y-1.5 text-sm">
        {data.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(s, i) }} /><span className="flex-1 truncate">{s.label}</span><span className="text-muted">{s.count}</span><span className="w-28 text-right tabular-nums">{money(s.amount)}</span></li>
        ))}
      </ul>
    </div>
  )
}

export function BarList({ data, height }: { data: Slice[]; height?: number }) {
  if (!data.length) return <Empty>Sin datos</Empty>
  return (
    <div style={{ height: height ?? Math.max(160, data.length * 44) }}>
      <ResponsiveContainer><BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} />
        <Tooltip {...tip} formatter={(v) => money(Number(v))} cursor={{ fill: 'rgb(var(--surface2))' }} />
        <Bar dataKey="amount" name="Valor" fill="#3b82f6" radius={4} barSize={16} />
      </BarChart></ResponsiveContainer>
    </div>
  )
}
