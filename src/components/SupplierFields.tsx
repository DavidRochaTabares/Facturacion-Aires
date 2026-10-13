import { useState } from 'react'
import { cardLabel } from '../lib/format'
import type { PaymentCard, Supplier } from '../types'
import { Select, TextInput } from './ui'

const OTHER = '__other__'
const hint = <p className="text-xs text-muted mt-1">No hay registrados. Agrégalos en «Proveedores y tarjetas».</p>

/** Dropdown fed from the suppliers catalog. Stores the plain name (same text field as before), so historical values keep working: any value not in the list is shown as "Otro". */
export function SupplierSelect({ label, value, onChange, suppliers, error }: { label: string; value: string; onChange: (v: string) => void; suppliers?: Supplier[] | null; error?: string }) {
  const [other, setOther] = useState(false)
  const loaded = !!suppliers
  const names = (suppliers ?? []).filter(s => s.is_active || s.name === value).map(s => s.name)
  const isOther = other || (loaded && value !== '' && !names.includes(value))
  return (
    <div className="space-y-3">
      <Select label={label} error={error} value={isOther ? OTHER : value} onChange={e => {
        const v = e.target.value
        if (v === OTHER) { setOther(true); onChange('') } else { setOther(false); onChange(v) }
      }}>
        <option value="">Seleccionar…</option>
        {!loaded && value && <option value={value}>{value}</option>}
        {names.map(n => <option key={n} value={n}>{n}</option>)}
        <option value={OTHER}>Otro…</option>
      </Select>
      {isOther && <TextInput label="Otro proveedor" value={value} onChange={e => onChange(e.target.value)} />}
      {loaded && !names.length && hint}
    </div>
  )
}

/** Same idea for the cards catalog (independent from suppliers). Stores "alias ****1234". */
export function CardSelect({ label, value, onChange, cards }: { label: string; value: string; onChange: (v: string) => void; cards?: PaymentCard[] | null }) {
  const [other, setOther] = useState(false)
  const loaded = !!cards
  const labels = (cards ?? []).filter(c => c.is_active || cardLabel(c) === value).map(cardLabel)
  const isOther = other || (loaded && value !== '' && !labels.includes(value))
  return (
    <div className="space-y-3">
      <Select label={label} value={isOther ? OTHER : value} onChange={e => {
        const v = e.target.value
        if (v === OTHER) { setOther(true); onChange('') } else { setOther(false); onChange(v) }
      }}>
        <option value="">Seleccionar…</option>
        {!loaded && value && <option value={value}>{value}</option>}
        {labels.map(l => <option key={l} value={l}>{l}</option>)}
        <option value={OTHER}>Otra tarjeta…</option>
      </Select>
      {isOther && <TextInput label="Otra tarjeta" value={value} onChange={e => onChange(e.target.value)} />}
      {loaded && !labels.length && hint}
    </div>
  )
}
