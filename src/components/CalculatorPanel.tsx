import { useEffect, useRef, useState } from 'react'
import { Calculator, Check, Copy, Delete, X } from 'lucide-react'

// Standalone helper: purely local state. It does not read or write forms, records, services or Supabase.
type Op = '+' | '-' | '×' | '÷'
const ERR = 'Error'
const MAX_DIGITS = 15

const toStr = (n: number): string => {
  if (!Number.isFinite(n) || Math.abs(n) >= 1e15) return ERR
  const s = n.toFixed(10).replace(/\.?0+$/, '')
  return Number(s) === 0 ? '0' : s
}

const calc = (a: number, op: Op, b: number): number =>
  op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : b === 0 ? NaN : a / b

const show = (s: string): string => {
  if (s === ERR) return 'No definido'
  const neg = s.startsWith('-')
  const [i, d] = (neg ? s.slice(1) : s).split('.')
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (neg ? '-' : '') + g + (d !== undefined ? ',' + d : '')
}

const key = 'rounded-lg py-2.5 text-sm font-medium transition active:scale-95 bg-surface2 hover:bg-line text-fg'
const B = ({ children, onClick, cls = key, label }: { children: React.ReactNode; onClick: () => void; cls?: string; label?: string }) =>
  <button type="button" className={cls} onClick={onClick} aria-label={label}>{children}</button>

const POS_KEY = 'aires-calc-pos'
type Pos = { x: number; y: number }
const clamp = (p: Pos, w: number, h: number): Pos => ({
  x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
  y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h)),
})
const loadPos = (): Pos | null => {
  try { const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null'); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null } catch { return null }
}

export function CalculatorPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('0')
  const [prev, setPrev] = useState<number | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  const [fresh, setFresh] = useState(true)
  const [expr, setExpr] = useState('')
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(loadPos)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => { if (open) ref.current?.focus() }, [open])
  useEffect(() => {
    const fit = () => { const r = ref.current?.getBoundingClientRect(); if (r && r.width) setPos(p => (p ? clamp(p, r.width, r.height) : p)) }
    if (open) fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, r.width, r.height))
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    try { if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* storage unavailable */ }
  }
  const home = () => { setPos(null); try { localStorage.removeItem(POS_KEY) } catch { /* storage unavailable */ } }

  const reset = () => { setCur('0'); setPrev(null); setOp(null); setFresh(true); setExpr('') }
  const bad = cur === ERR

  const digit = (d: string) => {
    if (bad) { reset(); setCur(d); setFresh(false); return }
    if (fresh) { setCur(d); setFresh(false); return }
    if (cur.replace(/[-.]/g, '').length >= MAX_DIGITS) return
    setCur(cur === '0' ? d : cur + d)
  }
  const dot = () => {
    if (bad || fresh) { if (bad) reset(); setCur('0.'); setFresh(false); return }
    if (!cur.includes('.')) setCur(cur + '.')
  }
  const operate = (o: Op) => {
    if (bad) return
    const n = Number(cur)
    if (prev !== null && op && !fresh) {
      const r = calc(prev, op, n)
      const s = toStr(r)
      if (s === ERR) { setCur(ERR); setPrev(null); setOp(null); setExpr(''); setFresh(true); return }
      setPrev(Number(s)); setCur(s); setExpr(`${show(s)} ${o}`)
    } else {
      setPrev(n); setExpr(`${show(cur)} ${o}`)
    }
    setOp(o); setFresh(true)
  }
  const equals = () => {
    if (bad || prev === null || !op) return
    const n = Number(cur)
    const s = toStr(calc(prev, op, n))
    setExpr(`${show(toStr(prev))} ${op} ${show(cur)} =`)
    setCur(s); setPrev(null); setOp(null); setFresh(true)
  }
  const percent = () => {
    if (bad) return
    const n = Number(cur)
    const v = prev !== null && (op === '+' || op === '-') ? (prev * n) / 100 : n / 100
    setCur(toStr(v)); setFresh(true)
  }
  const sign = () => { if (!bad && cur !== '0') setCur(cur.startsWith('-') ? cur.slice(1) : '-' + cur) }
  const back = () => {
    if (bad) { reset(); return }
    if (fresh) return
    const s = cur.slice(0, -1)
    setCur(s === '' || s === '-' ? '0' : s)
  }
  const copy = async () => {
    if (bad) return
    try { await navigator.clipboard.writeText(cur); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* clipboard unavailable */ }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (/^\d$/.test(k)) digit(k)
    else if (k === '.' || k === ',') dot()
    else if (k === '+' || k === '-') operate(k)
    else if (k === '*' || k === 'x' || k === 'X') operate('×')
    else if (k === '/') operate('÷')
    else if (k === '%') percent()
    else if (k === 'Enter' || k === '=') equals()
    else if (k === 'Backspace') back()
    else if (k === 'Delete') reset()
    else if (k === 'Escape') onClose()
    else return
    e.preventDefault()
  }

  const opKey = 'rounded-lg py-2.5 text-sm font-semibold transition active:scale-95 bg-brand/10 text-brand hover:bg-brand/20'

  return (
    <div
      ref={ref} tabIndex={-1} role="dialog" aria-label="Calculadora" hidden={!open} onKeyDown={onKey}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`fixed z-50 rounded-2xl border border-line bg-surface p-3 shadow-2xl outline-none ${pos ? 'w-72 max-w-[calc(100vw-1rem)]' : 'bottom-3 right-3 left-3 ml-auto max-w-xs sm:bottom-4 sm:right-4 sm:left-auto sm:w-72'}`}
    >
      <div
        className="mb-2 flex cursor-grab touch-none select-none items-center justify-between active:cursor-grabbing"
        title="Arrastra para mover · doble clic para volver a la esquina"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={home}
      >
        <span className="flex items-center gap-2 text-sm font-semibold"><Calculator size={16} className="text-brand" />Calculadora</span>
        <button type="button" onClick={onClose} aria-label="Cerrar calculadora" className="rounded-md p-1 text-muted hover:bg-surface2 hover:text-fg"><X size={16} /></button>
      </div>
      <div className="mb-2 rounded-lg bg-surface2 px-3 py-2 text-right">
        <div className="h-4 truncate text-xs text-muted">{expr}</div>
        <div className={`truncate font-semibold tabular-nums ${show(cur).length > 14 ? 'text-xl' : 'text-3xl'}`} aria-live="polite">{show(cur)}</div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <B onClick={reset} cls={`${key} !text-red-600 dark:!text-red-400`} label="Borrar todo">C</B>
        <B onClick={back} label="Retroceso"><Delete size={16} className="mx-auto" /></B>
        <B onClick={percent} cls={opKey} label="Porcentaje">%</B>
        <B onClick={() => operate('÷')} cls={opKey} label="Dividir">÷</B>
        {['7', '8', '9'].map(d => <B key={d} onClick={() => digit(d)}>{d}</B>)}
        <B onClick={() => operate('×')} cls={opKey} label="Multiplicar">×</B>
        {['4', '5', '6'].map(d => <B key={d} onClick={() => digit(d)}>{d}</B>)}
        <B onClick={() => operate('-')} cls={opKey} label="Restar">−</B>
        {['1', '2', '3'].map(d => <B key={d} onClick={() => digit(d)}>{d}</B>)}
        <B onClick={() => operate('+')} cls={opKey} label="Sumar">+</B>
        <B onClick={sign} label="Cambiar signo">±</B>
        <B onClick={() => digit('0')}>0</B>
        <B onClick={dot} label="Decimal">,</B>
        <B onClick={equals} cls="rounded-lg py-2.5 text-sm font-semibold transition active:scale-95 bg-brand text-white hover:opacity-90 dark:text-slate-900" label="Igual">=</B>
      </div>
      <button type="button" onClick={copy} disabled={bad} className="btn-ghost mt-2 w-full justify-center disabled:opacity-50">
        {copied ? <><Check size={14} />Copiado</> : <><Copy size={14} />Copiar resultado</>}
      </button>
    </div>
  )
}
