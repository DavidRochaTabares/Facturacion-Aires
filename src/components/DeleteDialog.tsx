import type { ReactNode } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Modal, Spinner } from './ui'

/** Confirmation modal shared by every delete action. The caller says what is being deleted and runs the real (transactional) delete. */
export function DeleteDialog({ open, title, children, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; children: ReactNode; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={() => { if (!busy) onCancel() }} title={title}>
      <div className="space-y-3">
        <div className="rounded-lg border border-line bg-surface2 p-3 text-sm">{children}</div>
        <p className="flex gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Esta acción no se puede deshacer fácilmente. Se eliminarán el registro y sus datos dependientes (pasajeros, tramos, documentos adjuntos). Los archivos que otro registro siga usando se conservan.</span></p>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={onConfirm}>{busy ? <Spinner /> : <Trash2 size={14} />}Eliminar</button>
        </div>
      </div>
    </Modal>
  )
}
