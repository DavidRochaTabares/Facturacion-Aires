import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { billingSummary } from '../lib/summary'
import type { OperationRow } from '../types'

/** Auto-generated billing text for a record, with a copy button. Derived from the row on every render, so it follows any edit. */
export function BillingSummary({ row }: { row: OperationRow }) {
  const text = useMemo(() => billingSummary(row), [row])
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => setState('idle'), [text])

  const copy = async () => {
    clearTimeout(timer.current)
    try { await copyText(text); setState('ok') } catch { setState('error') }
    timer.current = setTimeout(() => setState('idle'), 3000)
  }

  if (!text) return <p className="text-sm text-muted">No hay datos suficientes para generar el resumen.</p>
  return (
    <div className="rounded-lg border border-line bg-surface2 p-3">
      <p className="select-all break-words text-sm leading-relaxed">{text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={copy}>{state === 'ok' ? <Check size={14} /> : <Copy size={14} />}{state === 'ok' ? 'Copiado' : 'Copiar resumen'}</button>
        <span role="status" aria-live="polite" className={`text-sm ${state === 'error' ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {state === 'ok' && 'Resumen copiado al portapapeles.'}
          {state === 'error' && 'No se pudo copiar automáticamente. Selecciona el texto y cópialo con Ctrl+C (⌘+C en Mac).'}
        </span>
      </div>
    </div>
  )
}
