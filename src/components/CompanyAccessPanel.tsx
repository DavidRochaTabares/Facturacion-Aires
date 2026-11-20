import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound, MessageCircle, Unlink, UserCheck, UserPlus, UserX } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { companyAccessAdmin } from '../services/companyPortal'
import type { CompanyAccessStatus } from '../types/company'
import type { Company } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { Loading, Modal, Spinner } from './ui'

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

/** Shows a one-time secret (public company link or password-setup link) with copy / WhatsApp actions. */
function Secret({ label, url, whatsapp, hint }: { label: string; url: string; whatsapp: string; hint: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle')
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface2/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <input className="input font-mono text-xs" readOnly value={url} onFocus={e => e.target.select()} aria-label={label} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={async () => { try { await copyText(url); setState('ok') } catch { setState('error') } }}><Copy size={14} />Copiar</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(whatsapp)}`} target="_blank" rel="noreferrer" className="btn-ghost"><MessageCircle size={14} />Compartir por WhatsApp</a>
        <span role="status" className={state === 'error' ? 'text-xs text-red-500' : 'text-xs text-emerald-600 dark:text-emerald-400'}>{state === 'ok' && 'Copiado.'}{state === 'error' && 'No se pudo copiar; cópialo manualmente.'}</span>
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-300">{hint}</p>
    </div>
  )
}

type Confirm = 'revoke' | 'disable' | 'enable' | 'reset' | null

/** Agency panel to manage a company's public employee link and its single enterprise administrator. */
export function CompanyAccessPanel({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const id = company?.id
  const [status, setStatus] = useState<CompanyAccessStatus | null>(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState('')
  const [setupUrl, setSetupUrl] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try { setStatus(await companyAccessAdmin.status(id)); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el acceso de la empresa.') }
  }, [id])
  useEffect(() => { setStatus(null); setError(''); setEmail(''); setSetupUrl(''); setConfirm(null); if (id) load() }, [id, load])

  const name = company?.name ?? ''
  const run = async (fn: () => Promise<void>, fromConfirm = false) => {
    setBusy(true); setError(''); setConfirmError('')
    try { await fn(); setConfirm(null); await load() }
    catch (e) { const m = e instanceof Error ? e.message : 'No se pudo completar la acción.'; if (fromConfirm) setConfirmError(m); else setError(m) }
    finally { setBusy(false) }
  }
  const createAdmin = (e: FormEvent) => { e.preventDefault(); if (!id || !email.trim()) return; run(async () => { const r = await companyAccessAdmin.createAdmin(id, email.trim()); setSetupUrl(r.link ?? ''); if (!r.link) setError('El administrador se creó, pero no se pudo generar el enlace de acceso. Usa «Restablecer acceso».'); setEmail('') }) }

  const confirmCfg: Record<Exclude<Confirm, null>, { title: string; label: string; danger: boolean; body: string; act: () => Promise<void> }> = {
    revoke: { title: 'Revocar enlaces de empleados', label: 'Revocar enlaces', danger: true, body: 'Todos los enlaces activos de la empresa dejarán de funcionar de inmediato: nadie podrá iniciar nuevas conversaciones con ellos. Las conversaciones existentes y su historial se conservan.', act: async () => { await companyAccessAdmin.revokeLink(id!) } },
    disable: { title: 'Desactivar administrador', label: 'Desactivar acceso', danger: true, body: 'El administrador no podrá iniciar sesión ni consultar el portal hasta que lo habilites de nuevo. Su historial de aprobaciones se conserva.', act: async () => { await companyAccessAdmin.setActive(id!, false) } },
    enable: { title: 'Habilitar administrador', label: 'Habilitar acceso', danger: false, body: 'El administrador podrá volver a iniciar sesión en el portal empresarial.', act: async () => { await companyAccessAdmin.setActive(id!, true) } },
    reset: { title: 'Restablecer acceso', label: 'Generar enlace de acceso', danger: false, body: 'Se generará un enlace seguro de un solo uso para que el administrador defina una nueva contraseña.', act: async () => { setSetupUrl((await companyAccessAdmin.resetAdmin(id!)).link) } },
  }
  const cfg = confirm ? confirmCfg[confirm] : null
  const admin = status?.admin
  const setupText = (u: string) => `Acceso al portal empresarial de ${name} (Aires y Destinos). Define tu contraseña con este enlace: ${u}\nDespués ingresa en ${companyAccessAdmin.portalUrl()}`

  return (
    <>
      <Modal open={!!company} onClose={onClose} title={`Portal empresarial · ${name}`}>
        {!status ? (error ? <p role="alert" className="text-sm text-red-500">{error}</p> : <Loading />) : (
          <div className="space-y-5 text-sm">
            {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-red-600 dark:text-red-400">{error}</p>}

            <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Enlaces de empleados</h3>
              <p className="text-muted">Se generan desde <b>Solicitudes de clientes → Generar enlace</b> eligiendo esta empresa.</p>
              <p>Enlaces activos: <b>{status.links_active}</b></p>
              {status.link_active && <button className="btn-ghost text-red-600 dark:text-red-400" disabled={busy} onClick={() => { setConfirmError(''); setConfirm('revoke') }}><Unlink size={14} />Revocar todos los enlaces</button>}
            </section>

            <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Administrador de la empresa</h3>
              {!admin ? (
                <form onSubmit={createAdmin} className="space-y-2">
                  <p className="text-muted">Cada empresa tiene un único administrador, que aprueba o rechaza las conversaciones desde <b>{companyAccessAdmin.portalUrl()}</b>.</p>
                  <label className="label" htmlFor="adm-email">Correo del administrador</label>
                  <input id="adm-email" className="input" type="email" required value={email} maxLength={200} onChange={e => setEmail(e.target.value)} placeholder="administrador@empresa.com" autoComplete="off" />
                  <button className="btn-primary" disabled={busy || !email.trim()}>{busy ? <Spinner /> : <UserPlus size={14} />}Crear administrador</button>
                </form>
              ) : (
                <>
                  <p><b>{admin.email}</b> · <span className={admin.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{admin.active ? 'Acceso habilitado' : 'Acceso desactivado'}</span><span className="text-muted"> · creado {when(admin.created_at)}</span></p>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-ghost" disabled={busy} onClick={() => { setConfirmError(''); setConfirm('reset') }}><KeyRound size={14} />Restablecer acceso</button>
                    {admin.active
                      ? <button className="btn-ghost text-red-600 dark:text-red-400" disabled={busy} onClick={() => { setConfirmError(''); setConfirm('disable') }}><UserX size={14} />Desactivar</button>
                      : <button className="btn-ghost" disabled={busy} onClick={() => { setConfirmError(''); setConfirm('enable') }}><UserCheck size={14} />Habilitar</button>}
                  </div>
                </>
              )}
              {setupUrl && <Secret label="Enlace para definir la contraseña" url={setupUrl} whatsapp={setupText(setupUrl)} hint="Enlace de un solo uso con vigencia limitada: compártelo solo con el administrador. Si vence, usa «Restablecer acceso»." />}
            </section>
            <div className="flex justify-end"><button className="btn-ghost" onClick={onClose}>Cerrar</button></div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!cfg} title={cfg?.title ?? ''} confirmLabel={cfg?.label ?? ''} danger={cfg?.danger} busy={busy} error={confirmError} onCancel={() => setConfirm(null)} onConfirm={() => cfg && run(cfg.act, true)}>
        <p>{cfg?.body}</p>
      </ConfirmDialog>
    </>
  )
}
