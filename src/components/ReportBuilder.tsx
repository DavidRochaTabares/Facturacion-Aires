import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FileDown, Plus, X } from 'lucide-react'
import airesDay from '../assets/aires-day.png'
import { fdate, SERVICE_LABEL } from '../lib/format'
import { buildTables, defaultColumns, GROUP_TITLE, presentGroups, REPORT_COLUMNS } from '../lib/reportColumns'
import { downloadReportPdf, imageToDataUrl } from '../lib/reportPdf'
import { dataService } from '../services'
import type { OperationFilters, OperationRow } from '../types'
import { Drawer, Empty, Loading, Spinner } from './ui'

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function ReportBuilder({ open, onClose, filters, companyName }: { open: boolean; onClose: () => void; filters: OperationFilters; companyName?: string }) {
  const [rows, setRows] = useState<OperationRow[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const fkey = JSON.stringify(filters)

  const client = filters.company_id ? companyName ?? 'Cliente seleccionado' : 'Todos los clientes'
  const defaultTitle = filters.company_id ? `Informe de servicios - ${client}` : 'Informe de servicios'
  const period = filters.date_from && filters.date_to ? `${fdate(filters.date_from)} a ${fdate(filters.date_to)}`
    : filters.date_from ? `Desde ${fdate(filters.date_from)}` : filters.date_to ? `Hasta ${fdate(filters.date_to)}` : 'Todos los periodos'
  const extra = [filters.type && `Tipo: ${SERVICE_LABEL[filters.type]}`, filters.provider && `Proveedor: ${filters.provider}`].filter(Boolean).join(' | ')

  useEffect(() => {
    if (!open) return
    setRows(null); setError(''); setTitle('')
    dataService.getOperations(filters).then(r => {
      setRows(r)
      setSelected(defaultColumns(presentGroups(r), !!filters.company_id))
    }).catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar los registros'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fkey])

  const groups = useMemo(() => (rows ? presentGroups(rows) : []), [rows])
  const available = REPORT_COLUMNS.filter(c => c.group === 'common' || groups.includes(c.group))
  const tables = useMemo(() => (rows ? buildTables(rows, selected) : []), [rows, selected])
  const label = (k: string) => REPORT_COLUMNS.find(c => c.key === k)
  const move = (i: number, d: number) => setSelected(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n })

  const generate = async () => {
    setBusy(true); setError('')
    try {
      const logo = await imageToDataUrl(airesDay).catch(() => undefined)
      const day = new Date().toISOString().slice(0, 10)
      await downloadReportPdf(
        { title: title.trim() || defaultTitle, client, period, extra, generatedAt: new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }) },
        tables, logo, `informe-${slug(filters.company_id ? client : 'general')}-${day}.pdf`,
      )
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe') }
    finally { setBusy(false) }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Crear informe" wide>
      {!rows && !error ? <Loading /> : !rows ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : rows.length === 0 ? <Empty>No hay registros con los filtros aplicados.</Empty> : (
        <div className="space-y-6">
          <section>
            <label className="label">Título del informe</label>
            <input className="input" value={title} placeholder={defaultTitle} onChange={e => setTitle(e.target.value)} />
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-xs text-muted">Cliente</dt><dd>{client}</dd></div>
              <div><dt className="text-xs text-muted">Período</dt><dd>{period}</dd></div>
              <div><dt className="text-xs text-muted">Registros incluidos</dt><dd>{rows.length}</dd></div>
              {extra && <div><dt className="text-xs text-muted">Filtros</dt><dd>{extra}</dd></div>}
            </dl>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Columnas del informe (en orden)</h3>
            {selected.length === 0 && <p className="text-sm text-muted">Agrega al menos una columna.</p>}
            <ol className="space-y-1.5">
              {selected.map((k, i) => { const c = label(k); return c && (
                <li key={k} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                  <span className="w-5 text-xs text-muted">{i + 1}</span>
                  <span className="flex-1">{c.label}</span>
                  {c.group !== 'common' && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">{GROUP_TITLE[c.group]}</span>}
                  <button type="button" className="p-1 rounded hover:bg-surface2 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp size={14} /></button>
                  <button type="button" className="p-1 rounded hover:bg-surface2 disabled:opacity-30" disabled={i === selected.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown size={14} /></button>
                  <button type="button" className="p-1 rounded hover:bg-surface2 hover:text-red-500" onClick={() => setSelected(s => s.filter(x => x !== k))} aria-label="Quitar"><X size={14} /></button>
                </li>) })}
            </ol>
            <h3 className="text-sm font-semibold mt-5 mb-2">Agregar columnas</h3>
            <div className="space-y-3">
              {(['common', ...groups] as const).map(g => {
                const cols = available.filter(c => c.group === g && !selected.includes(c.key))
                return cols.length > 0 && (
                  <div key={g}>
                    <p className="text-xs text-muted mb-1">{g === 'common' ? 'Generales' : GROUP_TITLE[g]}</p>
                    <div className="flex flex-wrap gap-1.5">{cols.map(c => (
                      <button key={c.key} type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setSelected(s => [...s, c.key])}><Plus size={12} />{c.label}</button>
                    ))}</div>
                  </div>)
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">Vista previa</h3>
            {tables.length === 0 ? <p className="text-sm text-muted">Selecciona columnas para ver la vista previa.</p> : (
              <div className="space-y-4">{tables.map(t => (
                <div key={t.group}>
                  <p className="text-xs font-semibold mb-1">{t.title}</p>
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-brand text-white dark:text-slate-900">{t.cols.map(c => <th key={c.key} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c.label}</th>)}</tr></thead>
                      <tbody className="divide-y divide-line">{t.body.slice(0, 5).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={`px-2 py-1.5 whitespace-nowrap ${t.cols[j].money ? 'text-right tabular-nums' : ''}`}>{v}</td>)}</tr>)}</tbody>
                      {t.foot && <tfoot><tr className="bg-surface2 font-semibold">{t.foot.map((v, j) => <td key={j} className={`px-2 py-1.5 whitespace-nowrap ${t.cols[j].money ? 'text-right tabular-nums' : ''}`}>{v}</td>)}</tr></tfoot>}
                    </table>
                  </div>
                  {t.body.length > 5 && <p className="text-xs text-muted mt-1">Mostrando 5 de {t.body.length} registros. El PDF incluye todos.</p>}
                </div>))}
              </div>
            )}
          </section>

          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <button type="button" className="btn-primary w-full" disabled={busy || selected.length === 0} onClick={generate}>{busy ? <Spinner /> : <FileDown size={16} />}Generar y descargar PDF</button>
        </div>
      )}
    </Drawer>
  )
}
