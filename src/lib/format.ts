import type { OperationType } from '../types'

export const SERVICE_LABEL: Record<OperationType, string> = {
  flight: 'Vuelo', hotel: 'Hotel', transport: 'Transporte', food: 'Alimentación', loan: 'Préstamo', additional: 'Servicio adicional', other: 'Otro',
}
export const SERVICE_TYPES = (Object.keys(SERVICE_LABEL) as OperationType[]).filter(t => t !== 'other')
export const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export const money = (n: number | null | undefined) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)
export const fdate = (d?: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const fsize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]?.slice(0, 3)} ${ym.slice(0, 4)}`

/** Text stored in flights.card_number when a registered card is picked (same format as supplier_card_label() in SQL). */
export const cardLabel = (c: { alias: string; last_four: string }) => `${c.alias.trim()} ****${c.last_four}`
