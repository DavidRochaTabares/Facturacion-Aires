import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, Spinner } from './ui'

/** Generic confirmation modal (title, what will happen, consequences, cancel / confirm). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={() => { if (!busy) onCancel() }} title={title}>
      <div className="space-y-3">
        <div className="space-y-2 text-sm">{children}</div>
        {danger && <p className="flex gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>Esta acción no se puede deshacer fácilmente.</span></p>}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="button" className={danger ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'} disabled={busy} onClick={onConfirm}>{busy && <Spinner />}{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  )
}
