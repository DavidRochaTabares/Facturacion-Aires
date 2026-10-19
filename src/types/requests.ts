export type RequestType = 'flight' | 'hotel' | 'transport' | 'food' | 'package' | 'other'
export type RequestStatus = 'new' | 'in_progress' | 'closed' | 'reopened'
export type DocType = 'CC' | 'CE' | 'TI' | 'RC' | 'PA' | 'NIT'

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  flight: 'Vuelo', hotel: 'Hotel', transport: 'Transporte', food: 'Alimentación', package: 'Paquete turístico', other: 'Otro requerimiento',
}
export const typeLabel = (t: RequestType | null | undefined) => (t ? REQUEST_TYPE_LABEL[t] : 'Sin definir')
export const DOC_TYPES: DocType[] = ['CC', 'CE', 'TI', 'RC', 'PA', 'NIT']
/** Travel requests need each passenger's data and identity document (same rule enforced by the Edge Function). */
export const PASSENGERS_REQUIRED: RequestType[] = ['flight', 'hotel', 'package']

export interface RequestPassenger { id: string; first_names: string; last_names: string; document_type: DocType; document_number: string; birth_date: string }
export interface RequestAttachment {
  id: string; kind: 'identity' | 'supporting' | 'message'; passenger_id: string | null; message_id: string | null
  file_name: string; mime_type: string; size_bytes: number; uploaded_by: 'client' | 'agency'; created_at: string; storage_path?: string
}
export interface RequestMessage { id: string; author: 'client' | 'agency'; body: string; created_at: string }

/** What the agency sees in the inbox. */
export interface ClientRequestRow {
  id: string; created_at: string; client_name: string; client_email: string; client_phone: string; request_type: RequestType | null; description: string
  status: RequestStatus; submitted_at: string | null; last_activity_at: string; last_message_author: 'client' | 'agency' | null; agency_unread: number; link_active: boolean
}
export interface ClientRequestFull extends ClientRequestRow {
  observations: string; details: Record<string, string | number>; closed_at: string | null; closed_by: string | null; reopened_at: string | null
  details_history: { request_type: RequestType | null; details: Record<string, string | number>; description: string; changed_at: string }[]
  passengers: RequestPassenger[]; messages: RequestMessage[]; attachments: RequestAttachment[]
}

/** What the public portal receives (no internal fields). */
export interface PortalData {
  server_time: string
  request: { status: RequestStatus; created_at: string; submitted_at: string | null; closed_at: string | null; client_name: string; client_email: string; client_phone: string
    request_type: RequestType | null; description: string; observations: string; details: Record<string, string | number>; last_message_author: 'client' | 'agency' | null }
  passengers: RequestPassenger[]
  attachments: RequestAttachment[]
  messages: RequestMessage[]
}

export const STATUS_FILTERS = [
  { key: '', label: 'Todos los estados' }, { key: 'new', label: 'Nuevas' }, { key: 'pending', label: 'Pendientes de respuesta' },
  { key: 'in_progress', label: 'En gestión' }, { key: 'closed', label: 'Cerradas' }, { key: 'reopened', label: 'Reabiertas' },
] as const

/** Display state: "pending" is derived (the client wrote last and the conversation is open). */
export function displayStatus(r: Pick<ClientRequestRow, 'status' | 'submitted_at' | 'last_message_author'>): { key: string; label: string; cls: string } {
  if (r.status === 'closed') return { key: 'closed', label: 'Cerrada', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' }
  if (!r.submitted_at) return { key: 'waiting', label: 'Esperando al cliente', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' }
  if (r.last_message_author === 'client') return { key: 'pending', label: 'Pendiente de respuesta', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
  if (r.status === 'reopened') return { key: 'reopened', label: 'Reabierta', cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-300' }
  if (r.status === 'new') return { key: 'new', label: 'Nueva', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-300' }
  return { key: 'in_progress', label: 'En gestión', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' }
}
