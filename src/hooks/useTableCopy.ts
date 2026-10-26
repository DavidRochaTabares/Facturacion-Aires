import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'

interface Pt { r: number; c: number }
interface Sel { a: Pt; b: Pt }

/** Plain-text value of a cell: strips badges/buttons marked data-copyignore and collapses whitespace so the TSV stays one line per row. */
const cellText = (td: Element): string => {
  const c = td.cloneNode(true) as HTMLElement
  c.querySelectorAll('[data-copyignore],button').forEach(x => x.remove())
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Parses the formatted money shown in a cell ("$1.234.567" / "-$1.234.567"). Returns null for empty/dash text. */
const moneyVal = (t: string): number | null => {
  const digits = t.replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return t.includes('-') ? -n : n
}

/**
 * Excel-like cell selection + Ctrl+C TSV copy + automatic sum for an existing <table>.
 * Data rows must carry data-rr (0-based index) and data-id; header/spanned rows simply don't.
 * - click: select one cell · drag: range · Shift+click: extend range · Ctrl+click: add/remove individual cells · Esc: clear
 * - Ctrl+C copies the selected cells as TSV (tabs + newlines) ready to paste into Excel.
 *   When the selection spans all columns, the visible <thead> headers are prepended.
 * - `sum` totals only cells in `numericCols` (monetary columns); dates, ids and text never add up.
 * - Clicks on data rows are captured so selecting never opens/edits the record; open via double click (calls onOpen).
 */
export function useTableCopy(colCount: number, numericCols: boolean[] = [], onOpen?: (id: string) => void, resetKey: unknown = null) {
  const [sel, setSel] = useState<Sel | null>(null)
  const [extra, setExtra] = useState<Set<string>>(new Set()) // ctrl-picked cells outside the range ("r:c")
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const norm = (s: Sel | null) => (s ? { r1: Math.min(s.a.r, s.b.r), r2: Math.max(s.a.r, s.b.r), c1: Math.min(s.a.c, s.b.c), c2: Math.max(s.a.c, s.b.c) } : null)
  const inSel = (r: number, c: number) => { const n = norm(sel); return (!!n && r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2) || extra.has(`${r}:${c}`) }
  const clear = useCallback(() => { setSel(null); setExtra(new Set()) }, [])

  /** Selected cells grouped by row (sorted), each row = sorted column indexes. */
  const pickRows = useCallback((): [number, number[]][] => {
    const n = norm(sel)
    const map = new Map<number, Set<number>>()
    const put = (r: number, c: number) => { if (c < colCount) (map.get(r) ?? map.set(r, new Set()).get(r)!).add(c) }
    if (n) for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) put(r, c)
    extra.forEach(k => { const [r, c] = k.split(':').map(Number); put(r, c) })
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => [r, [...cs].sort((a, b) => a - b)])
  }, [sel, extra, colCount])

  const doCopy = useCallback(() => {
    const el = box.current, picked = pickRows()
    if (!el || !picked.length) return
    const byRr = new Map([...el.querySelectorAll<HTMLTableRowElement>('tbody tr[data-rr]')].map(tr => [Number(tr.dataset.rr), tr]))
    const matrix = picked.map(([r, cs]) => { const tr = byRr.get(r); return tr ? cs.map(c => cellText(tr.children[c] ?? tr)) : [] })
    const single = norm(sel)
    const fullWidth = !extra.size && !!single && single.c1 === 0 && single.c2 >= colCount - 1
    const head = fullWidth ? [[...el.querySelectorAll('thead th')].slice(0, colCount).map(th => (th.textContent ?? '').trim())] : []
    const tsv = [...head, ...matrix].map(cols => cols.join('\t')).join('\n')
    copyText(tsv).then(() => { setCopied(true); clearTimeout(copiedTimer.current); copiedTimer.current = setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }, [pickRows, sel, extra, colCount])

  // Ctrl+C / Esc while a selection exists. Skips inputs/areas so normal copy keeps working elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel && !extra.size) return
      const t = e.target as HTMLElement
      if (t && /^(input|textarea|select)$/i.test(t.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString()) return // let a manual text selection win
        e.preventDefault(); doCopy()
      } else if (e.key === 'Escape') clear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sel, extra, doCopy, clear])

  useEffect(() => { const up = () => { drag.current = false }; document.addEventListener('mouseup', up); return () => document.removeEventListener('mouseup', up) }, [])
  useEffect(() => { setSel(null); setExtra(new Set()) }, [resetKey])

  // Auto-scroll while dragging: when the pointer reaches (or passes) an edge of the scrollable container, it scrolls
  // and the selection keeps extending to the cells being revealed — vertical and horizontal, like Excel.
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const step = () => {
      const el = box.current, p = lastPos.current
      if (!drag.current || !el || !p) return
      const rect = el.getBoundingClientRect()
      const M = 28, SP = 22 // edge zone (px inside) / scroll step per tick
      const dx = p.x < rect.left + M && p.x > rect.left - 80 ? -SP : p.x > rect.right - M && p.x < rect.right + 80 ? SP : 0
      const dy = p.y < rect.top + M && p.y > rect.top - 80 ? -SP : p.y > rect.bottom - M && p.y < rect.bottom + 80 ? SP : 0
      if (dx || dy) el.scrollBy(dx, dy)
      const cx = Math.min(Math.max(p.x, rect.left + 2), rect.right - 2)
      const cy = Math.min(Math.max(p.y, rect.top + 2), rect.bottom - 2)
      const td = document.elementFromPoint(cx, cy)?.closest('td'), tr = td?.closest<HTMLTableRowElement>('tr[data-rr]')
      if (td && tr && td.cellIndex < colCount) setSel(s => (s ? { a: s.a, b: { r: Number(tr.dataset.rr), c: td.cellIndex } } : s))
    }
    const move = (e: MouseEvent) => { lastPos.current = { x: e.clientX, y: e.clientY }; step() }
    const tick = setInterval(step, 60)
    document.addEventListener('mousemove', move)
    return () => { document.removeEventListener('mousemove', move); clearInterval(tick) }
  }, [colCount])

  const onMouseDown = (e: React.MouseEvent) => {
    const td = (e.target as HTMLElement).closest('td'), tr = td?.closest<HTMLTableRowElement>('tr[data-rr]')
    if (!td || !tr || td.colSpan > 1 || td.cellIndex >= colCount) return
    e.preventDefault() // blocks text selection & row activation; we manage selection ourselves
    const r = Number(tr.dataset.rr), c = td.cellIndex, k = `${r}:${c}`
    if (e.ctrlKey || e.metaKey) { // disjoint cells, like Excel
      setExtra(x => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n })
      return
    }
    drag.current = true
    setSel(s => (e.shiftKey && s ? { a: s.a, b: { r, c } } : { a: { r, c }, b: { r, c } }))
  }
  const onMouseOver = (e: React.MouseEvent) => {
    if (!drag.current) return
    const td = (e.target as HTMLElement).closest('td'), tr = td?.closest<HTMLTableRowElement>('tr[data-rr]')
    if (!td || !tr || td.cellIndex >= colCount) return
    const r = Number(tr.dataset.rr), c = td.cellIndex
    setSel(s => (s ? { a: s.a, b: { r, c } } : s))
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('tr[data-rr]')) e.stopPropagation() // selecting never opens the record
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-rr]')
    if (tr?.dataset.id) openRef.current?.(tr.dataset.id)
  }

  /** Sum of the selected cells that live in numeric (money) columns; recomputed whenever the selection changes. */
  const sum = useMemo(() => {
    const el = box.current
    if (!el) return { count: 0, total: 0 }
    const byRr = new Map([...el.querySelectorAll<HTMLTableRowElement>('tbody tr[data-rr]')].map(tr => [Number(tr.dataset.rr), tr]))
    let count = 0, total = 0
    for (const [r, cs] of pickRows()) {
      const tr = byRr.get(r)
      if (!tr) continue
      for (const c of cs) {
        if (!numericCols[c]) continue
        const v = moneyVal(cellText(tr.children[c] ?? tr))
        if (v != null) { count++; total += v }
      }
    }
    return { count, total }
  }, [pickRows, numericCols])

  const hasSel = !!sel || extra.size > 0
  return { inSel, clear, copied, hasSel, sum, props: { ref: box, onMouseDown, onMouseOver, onClickCapture, onDoubleClick } }
}
