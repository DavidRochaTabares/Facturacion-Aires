import type { OperationType } from '../types'

export type SectionKey = 'flight' | 'hotel' | 'loan' | 'food' | 'transport' | 'other'
export const SECTIONS: Record<SectionKey, { path: string; title: string; navLabel: string; newLabel: string; types: OperationType[] }> = {
  flight: { path: '/vuelos', title: 'Vuelos', navLabel: 'Vuelos', newLabel: 'Registrar vuelo', types: ['flight'] },
  hotel: { path: '/hoteles', title: 'Hoteles', navLabel: 'Hoteles', newLabel: 'Registrar hotel', types: ['hotel'] },
  loan: { path: '/prestamos', title: 'Préstamos', navLabel: 'Préstamos', newLabel: 'Registrar préstamo', types: ['loan'] },
  food: { path: '/alimentacion', title: 'Alimentación', navLabel: 'Alimentación', newLabel: 'Registrar alimentación', types: ['food'] },
  transport: { path: '/transporte', title: 'Transporte', navLabel: 'Transporte', newLabel: 'Registrar transporte', types: ['transport'] },
  other: { path: '/otros', title: 'Servicios adicionales', navLabel: 'Servicios adicionales', newLabel: 'Registrar servicio adicional', types: ['additional', 'other'] },
}
