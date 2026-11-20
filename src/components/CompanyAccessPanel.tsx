import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy, KeyRound, Link2, MessageCircle, Unlink, UserCheck, UserPlus, UserX } from 'lucide-react'
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

type Confirm = 'generate' | 'revoke' | 'disable' | 'enable' | 'reset' | null

/** Agency panel to manage a company's public employee link and its single enterprise administrator. */
export function CompanyAccessPanel({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const id = company?.id
  const [status, setStatus] = useState<CompanyAccessStatus | null>(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [setupUrl, setSetupUrl] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try { setStatus(await companyAccessAdmin.status(id)); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el acceso de la empresa.') }
  }, [id])
  useEffect(() => { setStatus(null); setError(''); setEmail(''); setLinkUrl(''); setSetupUrl(''); setConfirm(null); if (id) load() }, [id, load])

  const name = company?.name ?? ''
  const run = async (fn: () => Promise<void>, fromConfirm = false) => {
    setBusy(true); setError(''); setConfirmError('')
    try { await fn(); setConfirm(null); await load() }
    catch (e) { const m = e instanceof Error ? e.message : 'No se pudo completar la acción.'; if (fromConfirm) setConfirmError(m); else setError(m) }
    finally { setBusy(false) }
  }
  const createAdmin = (e: FormEvent) => { e.preventDefault(); if (!id || !email.trim()) return; run(async () => { const r = await companyAccessAdmin.createAdmin(id, email.trim()); setSetupUrl(r.link ?? ''); if (!r.link) setError('El administrador se creó, pero no se pudo generar el enlace de acceso. Usa «Restablecer acceso».'); setEmail('') }) }

  const confirmCfg: Record<Exclude<Confirm, null>, { title: string; label: string; danger: boolean; body: string; act: () => Promise<void> }> = {
    generate: { title: status?.link_active ? 'Regenerar enlace de la empresa' : 'Generar enlace de la empresa', label: status?.link_active ? 'Regenerar enlace' : 'Generar enlace', danger: !!status?.link_active,
      body: status?.link_active ? 'El enlace actual dejará de funcionar de inmediato y tendrás que compartir el nuevo con los empleados. Las conversaciones ya iniciadas no se afectan.' : 'Se creará un enlace público para que los empleados de la empresa inicien conversaciones con su nombre.',
      act: async () => { setLinkUrl(companyAccessAdmin.link(await companyAccessAdmin.generateLink(id!))) } },
    revoke: { title: 'Revocar enlace de la empresa', label: 'Revocar enlace', danger: true, body: 'Nadie podrá iniciar nuevas conversaciones con este enlace. Las conversaciones existentes y su historial se conservan.', act: async () => { await companyAccessAdmin.revokeLink(id!); setLinkUrl('') } },
    disable: { title: 'Desactivar administrador', label: 'Desactivar acceso', danger: true, body: 'El administrador no podrá iniciar sesión ni consultar el portal hasta que lo habilites de nuevo. Su historial de aprobaciones se conserva.', act: async () => { await companyAccessAdmin.setActive(id!, false) } },
    enable: { title: 'Habilitar administrador', label: 'Habilitar acceso', danger: false, body: 'El administrador podrá volver a iniciar sesión en el portal empresarial.', act: async () => { await companyAccessAdmin.setActive(id!, true) } },
    reset: { title: 'Restablecer acceso', label: 'Generar enlace de acceso', danger: false, body: 'Se generará un enlace seguro de un solo uso para que el administrador defina una nueva contraseña.', act: async () => { setSetupUrl((await companyAccessAdmin.resetAdmin(id!)).link) } },
  }
  const cfg = confirm ? confirmCfg[confirm] : null
  const admin = status?.admin
  const linkText = (u: string) => `Te compartimos el enlace de ${name} para solicitar servicios de viaje con Aires y Destinos: ${u}\nEscribe tu nombre para iniciar la conversación.`
  const setupText = (u: string) => `Acceso al portal empresarial de ${name} (Aires y Destinos). Define tu contraseña con este enlace: ${u}\nDespués ingresa en ${companyAccessAdmin.portalUrl()}`

  return (
    <>
      <Modal open={!!company} onClose={onClose} title={`Portal empresarial · ${name}`}>
        {!status ? (error ? <p role="alert" className="text-sm text-red-500">{error}</p> : <Loading />) : (
          <div className="space-y-5 text-sm">
            {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-red-600 dark:text-red-400">{error}</p>}

            <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Enlace para empleados</h3>
              <p className="text-muted">Cada empleado abre el enlace, escribe su nombre e inicia su propia conversación (sin cuenta ni contraseña).</p>
              <p>Estado: <b className={status.link_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'}>{status.link_active ? 'Activo' : status.link_issued_at ? 'Revocado' : 'Sin generar'}</b>{status.link_issued_at ? ` · creado ${when(status.link_issued_at)}` : ''}</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => { setConfirmError(''); setConfirm('generate') }}><Link2 size={14} />{status.link_active ? 'Regenerar enlace' : 'Generar enlace'}</button>
                {status.link_active && <button className="btn-ghost" disabled={busy} onClick={() => { setConfirmError(''); setConfirm('revoke') }}><Unlink size={14} />Revocar</button>}
              </div>
              {linkUrl && <Secret label="Enlace de la empresa" url={linkUrl} whatsapp={linkText(linkUrl)} hint="Por seguridad el enlace se muestra solo ahora (en la base de datos se guarda únicamente su huella). Si lo pierdes, regenera uno nuevo." />}
              {status.link_active && !linkUrl && <p className="text-xs text-muted">El enlace actual ya no se puede mostrar. Si necesitas compartirlo de nuevo, regenéralo.</p>}
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
