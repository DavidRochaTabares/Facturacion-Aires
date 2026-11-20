import type { ClientRequestItem, RequestAttachment, RequestMessage, RequestPassenger, RequestType } from './requests'

export type ApprovalStatus = 'pending_approval' | 'approved' | 'rejected' | 'in_management' | 'completed'
export type ApprovalAction = 'created' | 'approve' | 'reject' | 'reopen' | 'agency_status'

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending_approval: 'Pendiente de aprobación', approved: 'Aprobada', rejected: 'Rechazada', in_management: 'En gestión', completed: 'Finalizada',
}
export const APPROVAL_CLS: Record<ApprovalStatus, string> = {
  pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  in_management: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  completed: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
}
export const APPROVAL_ACTION_LABEL: Record<ApprovalAction, string> = {
  created: 'Conversación iniciada', approve: 'Aprobada', reject: 'Rechazada', reopen: 'Vuelta a pendiente de aprobación', agency_status: 'Cambio de estado por la agencia',
}

export interface ApprovalEvent {
  id: string; action: ApprovalAction; from_status: ApprovalStatus | null; to_status: ApprovalStatus | null
  actor_type: 'company_admin' | 'agency' | 'system'; actor_label: string; note: string; created_at: string
}

export interface CompanyPortalMe { company_id: string; company_name: string; email: string }

export interface CompanyConversationRow {
  id: string; employee_name: string; created_at: string; last_activity_at: string; approval_status: ApprovalStatus | null
  request_type: RequestType | null; closed: boolean; items: number; messages: number; last_decision_at: string | null
}

export interface CompanyConversation {
  request: {
    id: string; employee_name: string; created_at: string; last_activity_at: string; submitted_at: string | null; approval_status: ApprovalStatus | null
    approval_updated_at: string | null; closed: boolean; request_type: RequestType | null; description: string; observations: string; details: Record<string, string | number>
  }
  items: ClientRequestItem[]
  passengers: RequestPassenger[]
  attachments: RequestAttachment[]
  messages: RequestMessage[]
  approvals: ApprovalEvent[]
}

export interface CompanyAccessStatus {
  link_active: boolean; links_active: number; link_issued_at: string | null
  admin: { email: string; active: boolean; created_at: string } | null
}
