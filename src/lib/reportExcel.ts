import type { ReportTable } from './reportColumns'
import type { ReportMeta } from './reportPdf'

// Excel (.xlsx) export that mirrors downloadReportPdf: same tables, same totals. Money columns become real numbers (sortable / summable in Excel).
// The library is loaded on demand so it does not weigh on the rest of the app.
const parseMoney = (s: string): number | null => {
  const t = s.trim()
  if (!/^-?\s*\$?\s*-?[\d.]+(,\d+)?$/.test(t) || !/\d/.test(t)) return null
  const neg = t.includes('-')
  const n = Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}
const sheetName = (title: string, used: Set<string>) => {
  const base = (title.replace(/\(\d+\)/g, '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Hoja').slice(0, 28)
  let name = base, n = 2
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${n++}`
  used.add(name.toLowerCase())
  return name
}

export async function downloadReportExcel(meta: ReportMeta, tables: ReportTable[], filename: string) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const head = { fontWeight: 'bold' as const, backgroundColor: '#2563eb', textColor: '#ffffff', alignVertical: 'center' as const, wrap: true }
  const used = new Set<string>(['informe'])

  const info: { label: string; value: string }[] = [
    { label: 'Informe', value: meta.title }, { label: 'Cliente / operación', value: meta.client }, { label: 'Periodo', value: meta.period },
    ...(meta.extra ? [{ label: 'Filtros aplicados', value: meta.extra }] : []), { label: 'Generado', value: meta.generatedAt },
  ]
  const sheets = [
    { data: info.map(r => [{ value: r.label, fontWeight: 'bold' as const }, { value: r.value, wrap: true }]), sheet: 'Informe', columns: [{ width: 24 }, { width: 70 }] },
    ...tables.map(t => {
      const moneyCols = new Set(t.cols.map((c, i) => (c.money ? i : -1)).filter(i => i >= 0))
      const cell = (v: string, i: number, bold = false) => {
        const n = moneyCols.has(i) ? parseMoney(v) : null
        return n == null
          ? { value: v || null, type: String, wrap: true, ...(bold ? { fontWeight: 'bold' as const } : {}) }
          : { value: n, type: Number, format: '#,##0', align: 'right' as const, ...(bold ? { fontWeight: 'bold' as const } : {}) }
      }
      const data = [
        t.cols.map(c => ({ value: c.label, ...head })),
        ...t.body.map(r => r.map((v, i) => cell(v, i))),
        ...(t.foot ? [t.foot.map((v, i) => ({ ...cell(v, i, true), backgroundColor: '#f1f5f9' }))] : []),
      ]
      const columns = t.cols.map((c, i) => ({ width: Math.min(46, Math.max(c.label.length + 2, moneyCols.has(i) ? 16 : 12, ...t.body.slice(0, 200).map(r => (r[i] ?? '').length + 2))) }))
      return { data, sheet: sheetName(t.title, used), columns, stickyRowsCount: 1 }
    }),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await (writeExcelFile as any)(sheets).toBlob()
  const url = URL.createObjectURL(blob as Blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
