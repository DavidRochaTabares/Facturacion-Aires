import { useMemo, useState } from 'react'
import { FileDown, RotateCcw, Search } from 'lucide-react'
import airesDay from '../assets/aires-day.png'
import { fdate, money, MONTHS } from '../lib/format'
import { PERSONAL_CATEGORIES, PERSONAL_KIND_LABEL, PERSONAL_METHODS } from '../lib/service'
import type { ReportColumn, ReportTable } from '../lib/reportColumns'
import { downloadReportPdf, imageToDataUrl } from '../lib/reportPdf'
import { dataService } from '../services'
import type { BankMovementRow, PersonalMovementRow } from '../types'
import { Loading, Select, Spinner, TextInput } from './ui'

type Origin = 'agency' | 'personal' | 'both'
type PeriodMode = 'all' | 'month' | 'year' | 'range'

interface AgencyFilters { movement_type: string; bank: string; invoice: string; text: string; min: string; max: string }
interface PersonalF { kind: '' | 'income' | 'expense'; category: string; method: string; text: string; min: string; max: string }

const SECTIONS: { key: string; label: string; agency: boolean; personal: boolean }[] = [
  { key: 'summary', label: 'Resumen general (ingresos, gastos y balance)', agency: true, personal: true },
  { key: 'detail', label: 'Detalle de los movimientos', agency: true, personal: true },
  { key: 'by_type', label: 'Agrupado por tipo / categoría', agency: true, personal: true },
  { key: 'by_account', label: 'Agrupado por cuenta o medio de pago', agency: true, personal: true },
  { key: 'invoices', label: 'Listado de facturas y referencias', agency: true, personal: true },
  { key: 'notes', label: 'Observaciones y descripciones', agency: true, personal: true },
]

const num = (s: string) => { const n = Number(s); return s.trim() !== '' && !Number.isNaN(n) ? n : null }
const inRange = (v: number, min: string, max: string) => (num(min) == null || Math.abs(v) >= Math.abs(num(min)!)) && (num(max) == null || Math.abs(v) <= Math.abs(num(max)!))
const match = (s: string, q: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase())

/** Ingreso/Egreso según el campo `kind` del movimiento (la clasificación explícita guardada en Supabase). */
const isIncome = (r: BankMovementRow) => r.kind === 'income'
const monthEnd = (y: number, m: number) => new Date(y, m, 0).toISOString().slice(0, 10)

export default function BankReportBuilder() {
  const [origin, setOrigin] = useState<Origin>('agency')
  const [pm, setPm] = useState<PeriodMode>('all')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [af, setAf] = useState<AgencyFilters>({ movement_type: '', bank: '', invoice: '', text: '', min: '', max: '' })
  const [pf, setPf] = useState<PersonalF>({ kind: '', category: '', method: '', text: '', min: '', max: '' })
  const [secs, setSecs] = useState<string[]>(['summary', 'detail'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ agency: BankMovementRow[]; personal: PersonalMovementRow[] } | null>(null)

  const period = useMemo(() => {
    const y = Number(year) || new Date().getFullYear()
    if (pm === 'month') { const m = Number(month); return { from: `${y}-${month}-01`, to: monthEnd(y, m), label: `${MONTHS[m - 1]} ${y}` } }
    if (pm === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Año ${y}` }
    if (pm === 'range') return { from, to, label: from && to ? `${fdate(from)} a ${fdate(to)}` : from ? `Desde ${fdate(from)}` : to ? `Hasta ${fdate(to)}` : 'Todos los períodos' }
    return { from: '', to: '', label: 'Todos los períodos' }
  }, [pm, year, month, from, to])

  const toggleSec = (k: string) => setSecs(s => (s.includes(k) ? s.filter(x => x !== k) : [...s, k]))
  const filterDesc = useMemo(() => {
    const p: string[] = [`Origen: ${origin === 'agency' ? 'Agencia' : origin === 'personal' ? 'Personales' : 'Agencia y personales'}`]
    if (af.movement_type && origin !== 'personal') p.push(`Tipo: ${af.movement_type}`)
    if (af.bank && origin !== 'personal') p.push(`Banco: ${af.bank}`)
    if (af.invoice && origin !== 'personal') p.push(`Factura: ${af.invoice}`)
    if (pf.kind && origin !== 'agency') p.push(`Clase: ${PERSONAL_KIND_LABEL[pf.kind]}`)
    if (pf.category && origin !== 'agency') p.push(`Categoría: ${pf.category}`)
    if (pf.method && origin !== 'agency') p.push(`Medio: ${pf.method}`)
    const mn = num(origin === 'personal' ? pf.min : af.min), mx = num(origin === 'personal' ? pf.max : af.max)
    if (mn != null) p.push(`Valor ≥ ${money(mn)}`)
    if (mx != null) p.push(`Valor ≤ ${money(mx)}`)
    return p.join(' | ')
  }, [origin, af, pf])

  const load = async () => {
    setBusy(true); setError('')
    try {
      const out = { agency: [] as BankMovementRow[], personal: [] as PersonalMovementRow[] }
      if (origin !== 'personal') {
        const rows = await dataService.getBankMovements({ movement_type: af.movement_type || undefined, date_from: period.from || undefined, date_to: period.to || undefined })
        out.agency = rows.filter(r => match(r.bank_name, af.bank) && match(r.invoice_number, af.invoice)
          && match(`${r.description} ${r.beneficiary} ${r.reference_1} ${r.reference_2} ${r.reference_3} ${r.observation}`, af.text)
          && inRange(r.amount, af.min, af.max))
      }
      if (origin !== 'agency') {
        const rows = await dataService.getPersonalMovements({ kind: pf.kind || undefined, category: pf.category || undefined, date_from: period.from || undefined, date_to: period.to || undefined })
        out.personal = rows.filter(r => match(r.payment_method, pf.method)
          && match(`${r.description} ${r.beneficiary} ${r.account} ${r.reference} ${r.notes}`, pf.text)
          && inRange(r.amount, pf.min, pf.max))
      }
      setPreview(out)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los movimientos.') }
    finally { setBusy(false) }
  }

  const totals = (rows: { amount: number; kind?: string; movement_type?: string }[]) => {
    let inc = 0, exp = 0
    rows.forEach(r => { const i = 'kind' in r && r.kind ? r.kind === 'income' : isIncome(r as BankMovementRow); if (i) inc += Math.abs(r.amount); else exp += Math.abs(r.amount) })
    return { inc, exp, net: inc - exp }
  }

  const col = (key: string, label: string, moneyCol = false): ReportColumn => ({ key, label, money: moneyCol, group: 'common', get: () => null })
  const tbl = (title: string, cols: ReportColumn[], body: string[][], foot: string[] | null = null): ReportTable => ({ group: 'additional', title, cols, body, foot })
  const group = (rows: { amount: number }[], key: (r: any) => string) => {
    const m = new Map<string, { n: number; t: number }>()
    rows.forEach(r => { const k = key(r) || 'Sin dato'; const g = m.get(k) ?? { n: 0, t: 0 }; g.n++; g.t += r.amount; m.set(k, g) })
    return [...m.entries()].sort((a, b) => Math.abs(b[1].t) - Math.abs(a[1].t))
  }

  const tables = (): ReportTable[] => {
    if (!preview) return []
    const t: ReportTable[] = []
    const use = (k: string, o: 'agency' | 'personal') => secs.includes(k) && (origin === 'both' || origin === o)
    if (origin !== 'personal') {
      const rows = preview.agency, T = totals(rows)
      const head = origin === 'both' ? ' (agencia)' : ''
      if (use('summary', 'agency')) t.push(tbl(`Resumen${head}`, [col('k', 'Concepto'), col('v', 'Valor', true)], [
        ['Movimientos incluidos', String(rows.length)], ['Total ingresos', money(T.inc)], ['Total gastos', money(T.exp)], ['Balance neto', money(T.net)]]))
      if (use('detail', 'agency')) t.push(tbl(`Detalle de movimientos${head}`,
        [col('d', 'Fecha'), col('b', 'Banco'), col('ty', 'Tipo'), col('de', 'Descripción'), col('i', 'Factura'), col('c', 'Cliente'), col('v', 'Valor', true)],
        rows.map(r => [fdate(r.date), r.bank_name || '-', r.movement_type || '-', r.description || '-', r.invoice_number || '-', r.client_name || '-', money(r.amount)]),
        rows.length ? ['', '', '', '', '', 'Total', money(rows.reduce((a, r) => a + r.amount, 0))] : null))
      if (use('by_type', 'agency')) t.push(tbl(`Por tipo${head}`, [col('k', 'Tipo'), col('n', 'Movimientos'), col('v', 'Total', true)],
        group(rows, (r: BankMovementRow) => r.movement_type).map(([k, g]) => [k, String(g.n), money(g.t)])))
      if (use('by_account', 'agency')) t.push(tbl(`Por cuenta bancaria${head}`, [col('k', 'Banco'), col('n', 'Movimientos'), col('v', 'Total', true)],
        group(rows, (r: BankMovementRow) => r.bank_name).map(([k, g]) => [k, String(g.n), money(g.t)])))
      if (use('invoices', 'agency')) {
        const inv = rows.filter(r => r.invoice_number.trim())
        if (inv.length) t.push(tbl(`Facturas${head}`, [col('i', 'Factura'), col('d', 'Fecha'), col('c', 'Cliente'), col('v', 'Valor', true)],
          inv.map(r => [r.invoice_number, fdate(r.date), r.client_name || '-', money(r.amount)]), ['', '', 'Total', money(inv.reduce((a, r) => a + r.amount, 0))]))
      }
      if (use('notes', 'agency')) {
        const obs = rows.filter(r => r.observation.trim() || r.description.trim())
        if (obs.length) t.push(tbl(`Descripciones y observaciones${head}`, [col('d', 'Fecha'), col('de', 'Descripción'), col('o', 'Observación'), col('v', 'Valor', true)],
          obs.map(r => [fdate(r.date), r.description || '-', r.observation || '-', money(r.amount)])))
      }
    }
    if (origin !== 'agency') {
      const rows = preview.personal, T = totals(rows)
      const head = origin === 'both' ? ' (personales)' : ''
      if (use('summary', 'personal')) t.push(tbl(`Resumen${head}`, [col('k', 'Concepto'), col('v', 'Valor', true)], [
        ['Movimientos incluidos', String(rows.length)], ['Total ingresos', money(T.inc)], ['Total gastos', money(T.exp)], ['Balance neto', money(T.net)]]))
      if (use('detail', 'personal')) t.push(tbl(`Detalle de movimientos${head}`,
        [col('d', 'Fecha'), col('k', 'Clase'), col('cat', 'Categoría'), col('de', 'Descripción'), col('m', 'Medio'), col('b', 'Beneficiario'), col('v', 'Valor', true)],
        rows.map(r => [fdate(r.date), PERSONAL_KIND_LABEL[r.kind], r.category || '-', r.description || '-', r.payment_method || '-', r.beneficiary || '-', money(r.amount)]),
        rows.length ? ['', '', '', '', '', 'Total', money(rows.reduce((a, r) => a + r.amount, 0))] : null))
      if (use('by_type', 'personal')) t.push(tbl(`Por categoría${head}`, [col('k', 'Categoría'), col('n', 'Movimientos'), col('v', 'Total', true)],
        group(rows, (r: PersonalMovementRow) => r.category || PERSONAL_KIND_LABEL[r.kind]).map(([k, g]) => [k, String(g.n), money(g.t)])))
      if (use('by_account', 'personal')) t.push(tbl(`Por medio de pago / cuenta${head}`, [col('k', 'Medio o cuenta'), col('n', 'Movimientos'), col('v', 'Total', true)],
        group(rows, (r: PersonalMovementRow) => r.payment_method || r.account).map(([k, g]) => [k, String(g.n), money(g.t)])))
      if (use('invoices', 'personal')) {
        const ref = rows.filter(r => r.reference.trim())
        if (ref.length) t.push(tbl(`Referencias${head}`, [col('i', 'Referencia'), col('d', 'Fecha'), col('de', 'Descripción'), col('v', 'Valor', true)],
          ref.map(r => [r.reference, fdate(r.date), r.description || '-', money(r.amount)]), ['', '', 'Total', money(ref.reduce((a, r) => a + r.amount, 0))]))
      }
      if (use('notes', 'personal')) {
        const obs = rows.filter(r => r.notes.trim() || r.description.trim())
        if (obs.length) t.push(tbl(`Descripciones y notas${head}`, [col('d', 'Fecha'), col('de', 'Descripción'), col('o', 'Notas'), col('v', 'Valor', true)],
          obs.map(r => [fdate(r.date), r.description || '-', r.notes || '-', money(r.amount)])))
      }
    }
    return t
  }

  const generate = async () => {
    const list = tables()
    if (!list.length) { setError('Selecciona al menos una sección con contenido.'); return }
    setBusy(true); setError('')
    try {
      const logo = await imageToDataUrl(airesDay).catch(() => undefined)
      const day = new Date().toISOString().slice(0, 10)
      const name = origin === 'agency' ? 'Agencia' : origin === 'personal' ? 'Movimientos_Personales' : 'Agencia_y_Personales'
      await downloadReportPdf(
        { title: `Informe de movimientos - ${origin === 'agency' ? 'agencia' : origin === 'personal' ? 'personales' : 'agencia y personales'}`, client: 'Bancos', period: period.label, extra: filterDesc, generatedAt: new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }) },
        list, logo, `Informe_Bancos_${name}_${day}.pdf`,
      )
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe.') }
    finally { setBusy(false) }
  }

  const pAg = preview?.agency ?? [], pPe = preview?.personal ?? []
  const tAg = totals(pAg), tPe = totals(pPe)
  const visibleSecs = SECTIONS.filter(s => (origin === 'both' ? s.agency || s.personal : origin === 'agency' ? s.agency : s.personal))

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Informes de movimientos</h2>
          <p className="mt-0.5 text-sm text-muted">Genera un PDF con los movimientos de la agencia, los personales o ambos en secciones separadas. Los datos personales nunca se suman a los totales de la agencia.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Origen" value={origin} onChange={e => { setOrigin(e.target.value as Origin); setPreview(null) }}>
            <option value="agency">Movimientos de la agencia</option><option value="personal">Movimientos personales</option><option value="both">Ambos (secciones separadas)</option>
          </Select>
          <Select label="Período" value={pm} onChange={e => setPm(e.target.value as PeriodMode)}>
            <option value="all">Todo el histórico</option><option value="month">Un mes</option><option value="year">Un año</option><option value="range">Rango de fechas</option>
          </Select>
          {pm === 'month' && <div className="grid grid-cols-2 gap-3">
            <Select label="Mes" value={month} onChange={e => setMonth(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</Select>
            <TextInput label="Año" type="number" value={year} onChange={e => setYear(e.target.value)} />
          </div>}
          {pm === 'year' && <TextInput label="Año" type="number" value={year} onChange={e => setYear(e.target.value)} />}
          {pm === 'range' && <div className="grid grid-cols-2 gap-3">
            <TextInput label="Desde" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <TextInput label="Hasta" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>}
        </div>

        {origin !== 'personal' && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Filtros de la agencia</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Tipo de movimiento" value={af.movement_type} onChange={e => setAf(p => ({ ...p, movement_type: e.target.value }))}>
                <option value="">Todos</option>{['Ingreso', 'Egreso', 'Transferencia', 'Comisión bancaria', 'Otro'].map(t => <option key={t}>{t}</option>)}
              </Select>
              <TextInput label="Cuenta bancaria" placeholder="Nombre del banco" value={af.bank} onChange={e => setAf(p => ({ ...p, bank: e.target.value }))} />
              <TextInput label="N.º de factura" value={af.invoice} onChange={e => setAf(p => ({ ...p, invoice: e.target.value }))} />
              <TextInput label="Concepto / beneficiario / referencia" value={af.text} onChange={e => setAf(p => ({ ...p, text: e.target.value }))} />
              <TextInput label="Valor mínimo" type="number" min={0} value={af.min} onChange={e => setAf(p => ({ ...p, min: e.target.value }))} />
              <TextInput label="Valor máximo" type="number" min={0} value={af.max} onChange={e => setAf(p => ({ ...p, max: e.target.value }))} />
            </div>
          </div>
        )}
        {origin !== 'agency' && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Filtros personales</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Clase" value={pf.kind} onChange={e => setPf(p => ({ ...p, kind: e.target.value as PersonalF['kind'] }))}>
                <option value="">Ingresos y gastos</option><option value="income">Ingresos</option><option value="expense">Gastos</option>
              </Select>
              <Select label="Categoría" value={pf.category} onChange={e => setPf(p => ({ ...p, category: e.target.value }))}>
                <option value="">Todas</option>{PERSONAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </Select>
              <Select label="Medio de pago" value={pf.method} onChange={e => setPf(p => ({ ...p, method: e.target.value }))}>
                <option value="">Todos</option>{PERSONAL_METHODS.map(m => <option key={m}>{m}</option>)}
              </Select>
              <TextInput label="Concepto / beneficiario / referencia" value={pf.text} onChange={e => setPf(p => ({ ...p, text: e.target.value }))} />
              <TextInput label="Valor mínimo" type="number" min={0} value={pf.min} onChange={e => setPf(p => ({ ...p, min: e.target.value }))} />
              <TextInput label="Valor máximo" type="number" min={0} value={pf.max} onChange={e => setPf(p => ({ ...p, max: e.target.value }))} />
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Secciones del informe</p>
          <div className="flex flex-wrap gap-2">
            {visibleSecs.map(s => (
              <button key={s.key} type="button" onClick={() => toggleSec(s.key)}
                className={`btn border !px-3 !py-1.5 text-xs ${secs.includes(s.key) ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-muted hover:text-fg'}`}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={load}>{busy ? <Spinner /> : <Search size={15} />}Vista previa</button>
          {preview && <button type="button" className="btn-ghost" onClick={() => setPreview(null)}><RotateCcw size={14} />Modificar filtros</button>}
        </div>
      </div>

      {preview && (
        <div className="card space-y-3 p-5">
          <h3 className="font-semibold">Vista previa</h3>
          {pAg.length + pPe.length === 0 ? (
            <p role="status" className="text-sm text-amber-600 dark:text-amber-300">No hay movimientos que cumplan los filtros. Ajusta los criterios antes de generar el informe.</p>
          ) : (
            <>
              {origin !== 'personal' && <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">Movimientos agencia</dt><dd className="font-medium">{pAg.length}</dd></div>
                <div><dt className="text-xs text-muted">Ingresos</dt><dd className="tabular-nums text-emerald-600 dark:text-emerald-400">{money(tAg.inc)}</dd></div>
                <div><dt className="text-xs text-muted">Gastos</dt><dd className="tabular-nums text-red-600 dark:text-red-400">{money(tAg.exp)}</dd></div>
                <div><dt className="text-xs text-muted">Balance</dt><dd className="tabular-nums">{money(tAg.net)}</dd></div>
              </dl>}
              {origin !== 'agency' && <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">Movimientos personales</dt><dd className="font-medium">{pPe.length}</dd></div>
                <div><dt className="text-xs text-muted">Ingresos</dt><dd className="tabular-nums text-emerald-600 dark:text-emerald-400">{money(tPe.inc)}</dd></div>
                <div><dt className="text-xs text-muted">Gastos</dt><dd className="tabular-nums text-red-600 dark:text-red-400">{money(tPe.exp)}</dd></div>
                <div><dt className="text-xs text-muted">Balance</dt><dd className="tabular-nums">{money(tPe.net)}</dd></div>
              </dl>}
              {origin === 'both' && <p className="text-xs text-muted">Los dos orígenes se muestran en secciones separadas del PDF; sus totales no se combinan.</p>}
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead><tr className="bg-surface2/60">{origin !== 'personal'
                    ? ['Fecha', 'Banco', 'Tipo', 'Descripción', 'Factura', 'Valor'].map(h => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)
                    : ['Fecha', 'Clase', 'Categoría', 'Descripción', 'Medio', 'Valor'].map(h => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {(origin !== 'personal' ? pAg : pPe).slice(0, 8).map(r => origin !== 'personal' ? (
                      <tr key={r.id}>{[fdate(r.date), (r as BankMovementRow).bank_name || '-', (r as BankMovementRow).movement_type || '-', r.description || '-', (r as BankMovementRow).invoice_number || '-', money(r.amount)].map((v, i) => <td key={i} className={`px-2 py-1.5 ${i === 5 ? 'text-right tabular-nums' : ''}`}>{v}</td>)}</tr>
                    ) : (
                      <tr key={r.id}>{[fdate(r.date), PERSONAL_KIND_LABEL[(r as PersonalMovementRow).kind], (r as PersonalMovementRow).category || '-', r.description || '-', (r as PersonalMovementRow).payment_method || '-', money(r.amount)].map((v, i) => <td key={i} className={`px-2 py-1.5 ${i === 5 ? 'text-right tabular-nums' : ''}`}>{v}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(origin !== 'personal' ? pAg : pPe).length > 8 && <p className="text-xs text-muted">Mostrando 8 de {(origin !== 'personal' ? pAg : pPe).length}. El PDF incluye todos.</p>}
              <button type="button" className="btn-primary w-full" disabled={busy} onClick={generate}>{busy ? <Spinner /> : <FileDown size={16} />}Generar y descargar PDF</button>
            </>
          )}
        </div>
      )}

      {busy && !preview && <Loading />}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
