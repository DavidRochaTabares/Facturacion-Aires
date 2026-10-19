import { useRef, useState } from 'react'
import { FileUp, Plus, Trash2 } from 'lucide-react'
import { Field, Select, Spinner, TextInput } from '../../components/ui'
import { normalizeDocFile } from '../../lib/files'
import { PortalError, portalApi } from '../../services/portalApi'
import { DOC_TYPES, PASSENGERS_REQUIRED, REQUEST_TYPE_LABEL, type DocType, type PortalData, type RequestPassenger, type RequestType } from '../../types/requests'

const MAX_FILE = 8 * 1024 * 1024
const MAX_PAX = 10
const MAX_EXTRA = 5
const uid = () => Math.random().toString(36).slice(2, 9)
const today = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'

interface Pax { id: string; first_names: string; last_names: string; document_type: DocType; document_number: string; birth_date: string; file: File | null }
const emptyPax = (): Pax => ({ id: uid(), first_names: '', last_names: '', document_type: 'CC', document_number: '', birth_date: '', file: null })

async function checkFile(f: File): Promise<File> {
  const ok = await normalizeDocFile(f, 'pdf-or-image')
  if (ok.size > MAX_FILE) throw new Error('El archivo supera los 8 MB.')
  return ok
}

const PRIVACY = (
  <div className="space-y-2 text-sm text-muted">
    <p><b className="text-fg">Tratamiento de datos personales.</b> Aires y Destinos recopilará y usará tus datos (nombre, datos de contacto, documento de identidad, fecha de nacimiento y datos del viaje) únicamente para cotizar, gestionar y confirmar los servicios que solicitas y para comunicarse contigo sobre esta solicitud.</p>
    <p>Los documentos se guardan de forma privada y solo pueden consultarlos las personas autorizadas de la agencia. No se usarán para otros fines ni se compartirán con terceros, salvo lo estrictamente necesario para prestar el servicio (por ejemplo, aerolíneas, hoteles u otros proveedores).</p>
    <p>Se conservan mientras sean necesarios para atender tu solicitud y cumplir obligaciones legales; después se eliminan. Si incluyes datos de menores de edad, declaras ser su representante legal. Puedes pedir en cualquier momento la consulta, corrección o eliminación de tus datos escribiendo a la agencia por el mismo medio por el que recibiste este enlace (Ley 1581 de 2012, Colombia).</p>
  </div>
)

const H = ({ children }: { children: string }) => <h3 className="!mt-6 flex items-center gap-2 rounded-lg bg-brand/5 px-3 py-2 text-sm font-semibold"><span className="h-4 w-1 rounded-full bg-brand" />{children}</h3>

/** mode "create": first submission (contact data + privacy). mode "update": the client clarifies/changes the request while the conversation is open. */
export function PortalForm({ token, initial, existing = [], mode = 'create', onDone, onCancel }: {
  token: string; initial: PortalData['request']; existing?: RequestPassenger[]; mode?: 'create' | 'update'; onDone: () => void; onCancel?: () => void
}) {
  const update = mode === 'update'
  const [type, setType] = useState<RequestType | ''>(initial.request_type ?? '')
  const [name, setName] = useState(initial.client_name)
  const [email, setEmail] = useState(initial.client_email)
  const [phone, setPhone] = useState(initial.client_phone)
  const [description, setDescription] = useState(initial.description)
  const [observations, setObservations] = useState(update ? initial.observations : '')
  const [d, setD] = useState<Record<string, string>>(() => ({ scope: 'national', trip_type: 'oneway', ...Object.fromEntries(Object.entries(update ? initial.details : {}).map(([k, v]) => [k, String(v)])) }))
  const [pax, setPax] = useState<Pax[]>([])
  const [extras, setExtras] = useState<File[]>([])
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const extraInput = useRef<HTMLInputElement>(null)

  const need = !!type && PASSENGERS_REQUIRED.includes(type)
  const optionalPax = type === 'transport' || type === 'other'
  const usePax = need || optionalPax // food (and no type yet) never collects passengers
  const livePax = usePax ? pax : []
  const dv = (k: string) => ({ value: d[k] ?? '', onChange: (e: { target: { value: string } }) => setD(p => ({ ...p, [k]: e.target.value })) })
  const setPaxField = (i: number, k: keyof Pax, v: string | File | null) => setPax(p => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const changeType = (t: RequestType | '') => {
    setType(t); setErrors([])
    if (t && PASSENGERS_REQUIRED.includes(t) && !pax.length && !existing.length) setPax([emptyPax()])
  }
  const pickPax = async (i: number, f?: File) => {
    if (!f) return
    try { setPaxField(i, 'file', await checkFile(f)); setErrors([]) } catch (e) { setErrors([`Pasajero ${existing.length + i + 1}: ${e instanceof Error ? e.message : 'no se pudo leer el archivo.'}`]) }
  }
  const pickExtras = async (list: FileList | null) => {
    const picked = [...(list ?? [])]
    const next = [...extras]
    const bad: string[] = []
    for (const f of picked) {
      if (next.length >= MAX_EXTRA) { bad.push(`Máximo ${MAX_EXTRA} archivos complementarios.`); break }
      try { next.push(await checkFile(f)) } catch (e) { bad.push(`${f.name}: ${e instanceof Error ? e.message : 'no se pudo leer.'}`) }
    }
    setExtras(next); setErrors(bad)
  }

  const validate = (): string[] => {
    const e: string[] = []
    if (!type) return ['Selecciona qué necesitas (tipo de requerimiento).']
    if (!update) {
      if (name.trim().length < 3) e.push('Escribe tu nombre completo.')
      if (!email.trim() && !phone.trim()) e.push('Escribe un correo electrónico o un teléfono de contacto.')
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.push('El correo electrónico no es válido.')
      if (phone.trim() && !/^\+?[0-9 ()-]{7,20}$/.test(phone.trim())) e.push('El teléfono no es válido.')
    }
    if (!['flight', 'hotel'].includes(type) && description.trim().length < 10) e.push('Describe con más detalle lo que necesitas (mínimo 10 caracteres).')
    const req = (k: string, label: string, min = 2) => { if ((d[k] ?? '').trim().length < min) e.push(label) }
    const date = (k: string, label: string) => { if (!d[k]) e.push(`Selecciona ${label}.`); else if (d[k] < today()) e.push(`${label[0].toUpperCase()}${label.slice(1)} no puede estar en el pasado.`) }
    if (type === 'flight') {
      req('origin', 'Indica el origen del vuelo.'); req('destination', 'Indica el destino del vuelo.'); date('departure_date', 'la fecha de salida')
      if (d.scope === 'international' && d.trip_type === 'roundtrip' && !d.return_date) e.push('Selecciona la fecha de regreso (obligatoria en viajes internacionales de ida y vuelta).')
      if (d.trip_type === 'roundtrip' && d.return_date && d.departure_date && d.return_date < d.departure_date) e.push('La fecha de regreso no puede ser anterior a la de salida.')
    } else if (type === 'hotel') {
      req('destination', 'Indica el destino o la ubicación del hotel.'); date('check_in', 'la fecha de entrada')
      if (!d.check_out) e.push('Selecciona la fecha de salida.'); else if (d.check_in && d.check_out <= d.check_in) e.push('La fecha de salida debe ser posterior a la de entrada.')
      if (!(Number(d.guests) >= 1)) e.push('Indica el número de huéspedes.')
    } else if (type === 'transport') {
      req('origin', 'Indica el origen del servicio de transporte.'); req('destination', 'Indica el destino del servicio de transporte.'); date('service_date', 'la fecha del servicio')
      if (d.return_date && d.service_date && d.return_date < d.service_date) e.push('La fecha de regreso no puede ser anterior a la del servicio.')
    } else if (type === 'food') {
      req('location', 'Indica la ubicación donde se necesita el servicio de alimentación.', 3); date('service_date', 'la fecha del servicio')
      if (!(Number(d.people) >= 1)) e.push('Indica la cantidad de personas.')
    } else if (type === 'package') {
      req('destination', 'Indica el destino del paquete turístico.'); date('date_from', 'la fecha de inicio')
      if (!d.date_to) e.push('Selecciona la fecha de finalización.'); else if (d.date_from && d.date_to < d.date_from) e.push('La fecha de finalización no puede ser anterior a la de inicio.')
    }
    if (need && !existing.length && !livePax.length) e.push('Agrega al menos un pasajero.')
    livePax.forEach((p, i) => {
      const w = `Pasajero ${existing.length + i + 1}`
      if (p.first_names.trim().length < 2 || p.last_names.trim().length < 2) e.push(`${w}: escribe nombres y apellidos.`)
      if (!/^[A-Za-z0-9.-]{4,30}$/.test(p.document_number.trim())) e.push(`${w}: el número de documento no es válido.`)
      if (!p.birth_date) e.push(`${w}: selecciona la fecha de nacimiento.`)
      if (need && !p.file) e.push(`Falta el documento de identidad de ${p.first_names.trim() ? `${p.first_names.trim()} ${p.last_names.trim()}`.trim() : w} (${w.toLowerCase()}).`)
    })
    if (!update && !accepted) e.push('Debes aceptar el aviso de privacidad para enviar la solicitud.')
    return e
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (e.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    setBusy(true)
    const files: Record<string, File> = {}
    livePax.forEach((p, i) => { if (p.file) files[`file_p${i}`] = p.file })
    extras.forEach((f, j) => { files[`file_x${j}`] = f })
    const details = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''))
    const passengers = livePax.map(({ first_names, last_names, document_type, document_number, birth_date }) => ({ first_names, last_names, document_type, document_number, birth_date }))
    try {
      if (update) await portalApi.update(token, { request_type: type, description, observations, details, passengers }, files)
      else await portalApi.submit(token, { client_name: name, client_email: email, client_phone: phone, request_type: type, description, observations, privacy_accepted: true, details, passengers }, files)
      onDone()
    } catch (err) {
      const pe = err as PortalError
      setErrors(pe.details?.length ? pe.details : [pe.message || 'No se pudo enviar la solicitud.'])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setBusy(false) }
  }

  const grid = 'grid gap-3 sm:grid-cols-2'
  const changed = update && type && initial.request_type && type !== initial.request_type
  const descLabel = !type ? '' : ['flight', 'hotel'].includes(type) ? 'Descripción de lo que necesitas (opcional)' : type === 'other' ? 'Cuéntanos qué necesitas *' : type === 'transport' ? 'Detalles del servicio *' : type === 'food' ? 'Descripción del requerimiento *' : 'Descripción detallada *'

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="card portal-fade space-y-4 p-5 sm:p-7">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{update ? 'Actualizar mi solicitud' : 'Solicitud de servicio'}</h1>
          <p className="mt-1 text-sm text-muted">{update ? 'Cambia lo que necesites. Se conservan tus mensajes, documentos y datos anteriores.' : 'Cuéntanos qué necesitas. Cuando envíes la solicitud podrás conversar con la agencia desde esta misma página.'}</p>
        </div>
        {errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
            <p className="font-medium">Revisa lo siguiente:</p>
            <ul className="mt-1 list-disc pl-5">{errors.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}

        {!update && (<>
          <H>Tus datos</H>
          <div className={grid}>
            <TextInput className="sm:col-span-2" label="Nombre completo *" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            <TextInput label="Correo electrónico" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            <TextInput label="Teléfono / WhatsApp" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
          </div>
          <p className="text-xs text-muted">Indica al menos un correo o un teléfono.</p>
        </>)}

        <H>¿Qué necesitas?</H>
        <Select label="Tipo de requerimiento *" value={type} onChange={e => changeType(e.target.value as RequestType | '')}>
          <option value="">Selecciona una opción…</option>
          {(Object.keys(REQUEST_TYPE_LABEL) as RequestType[]).map(t => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}
        </Select>
        {changed && <p role="status" className="rounded-lg bg-brand/10 p-3 text-sm">Cambiarás el tipo de requerimiento de <b>{REQUEST_TYPE_LABEL[initial.request_type!]}</b> a <b>{REQUEST_TYPE_LABEL[type as RequestType]}</b>. Tus mensajes, documentos y datos anteriores se conservan y la agencia será avisada.</p>}

        {type === 'flight' && (
          <div className={grid}>
            <TextInput label="Origen *" {...dv('origin')} />
            <TextInput label="Destino *" {...dv('destination')} />
            <Select label="Tipo de viaje *" {...dv('scope')}><option value="national">Nacional</option><option value="international">Internacional</option></Select>
            <Select label="Trayecto *" {...dv('trip_type')}><option value="oneway">Solo ida</option><option value="roundtrip">Ida y vuelta</option></Select>
            <TextInput label="Fecha de salida *" type="date" min={today()} {...dv('departure_date')} />
            {d.trip_type === 'roundtrip' && <TextInput label={d.scope === 'international' ? 'Fecha de regreso *' : 'Fecha de regreso (opcional)'} type="date" min={d.departure_date || today()} {...dv('return_date')} />}
            <TextInput className="sm:col-span-2" label="Preferencias u observaciones del itinerario" {...dv('itinerary_notes')} />
            <p className="text-sm text-muted sm:col-span-2">Número de pasajeros: <b className="text-fg">{existing.length + livePax.length || '—'}</b> (según los pasajeros que agregues abajo)</p>
          </div>
        )}
        {type === 'hotel' && (
          <div className={grid}>
            <TextInput className="sm:col-span-2" label="Destino o ubicación *" {...dv('destination')} />
            <TextInput label="Fecha de entrada *" type="date" min={today()} {...dv('check_in')} />
            <TextInput label="Fecha de salida *" type="date" min={d.check_in || today()} {...dv('check_out')} />
            <TextInput label="Número de huéspedes *" type="number" min={1} max={50} {...dv('guests')} />
            <TextInput label="Número de habitaciones" type="number" min={1} max={30} {...dv('rooms')} />
            <TextInput className="sm:col-span-2" label="Observaciones y preferencias" {...dv('preferences')} />
          </div>
        )}
        {type === 'transport' && (
          <div className={grid}>
            <TextInput label="Origen *" {...dv('origin')} />
            <TextInput label="Destino *" {...dv('destination')} />
            <TextInput label="Fecha del servicio *" type="date" min={today()} {...dv('service_date')} />
            <TextInput label="Hora" type="time" {...dv('time')} />
            <TextInput label="Fecha de regreso (opcional)" type="date" min={d.service_date || today()} {...dv('return_date')} />
            <TextInput label="Cantidad de personas" type="number" min={1} max={500} {...dv('people')} />
          </div>
        )}
        {type === 'food' && (
          <div className={grid}>
            <TextInput label="Fecha del servicio *" type="date" min={today()} {...dv('service_date')} />
            <TextInput label="Cantidad de personas *" type="number" min={1} max={5000} {...dv('people')} />
            <TextInput className="sm:col-span-2" label="Ubicación *" placeholder="Ciudad y lugar donde se necesita" {...dv('location')} />
          </div>
        )}
        {type === 'package' && (
          <div className={grid}>
            <TextInput className="sm:col-span-2" label="Destino *" {...dv('destination')} />
            <TextInput label="Fecha de inicio *" type="date" min={today()} {...dv('date_from')} />
            <TextInput label="Fecha de finalización *" type="date" min={d.date_from || today()} {...dv('date_to')} />
            <TextInput className="sm:col-span-2" label="Preferencias" {...dv('preferences')} />
          </div>
        )}
        {type === 'other' && (
          <div className={grid}>
            <TextInput label="Fecha o fechas relevantes" placeholder="Ej.: 15 al 20 de diciembre" {...dv('dates')} />
            <TextInput label="Datos adicionales" {...dv('extra')} />
          </div>
        )}

        {type && <>
          <Field label={descLabel}><textarea className="input min-h-24" value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} /></Field>
          <Field label="Observaciones adicionales"><textarea className="input min-h-16" value={observations} maxLength={4000} onChange={e => setObservations(e.target.value)} /></Field>
        </>}

        {type && usePax && <H>{need ? 'Pasajeros *' : 'Pasajeros (opcional)'}</H>}
        {type && usePax && existing.length > 0 && (
          <p className="text-sm text-muted">Ya registrados: <b className="text-fg">{existing.map(p => `${p.first_names} ${p.last_names}`).join(', ')}</b>. Aquí solo agregas pasajeros nuevos.</p>
        )}
        {type && usePax && pax.map((p, i) => (
          <div key={p.id} className="relative space-y-3 rounded-xl border border-line p-3">
            <p className="text-sm font-medium">Pasajero {existing.length + i + 1}</p>
            {(!need || existing.length + pax.length > 1) && <button type="button" onClick={() => setPax(x => x.filter((_, j) => j !== i))} className="absolute right-2 top-2 text-muted hover:text-red-500" aria-label={`Quitar pasajero ${existing.length + i + 1}`}><Trash2 size={14} /></button>}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Nombres *" value={p.first_names} onChange={e => setPaxField(i, 'first_names', e.target.value)} autoComplete="off" />
              <TextInput label="Apellidos *" value={p.last_names} onChange={e => setPaxField(i, 'last_names', e.target.value)} autoComplete="off" />
              <Select label="Tipo de documento *" value={p.document_type} onChange={e => setPaxField(i, 'document_type', e.target.value)}>{DOC_TYPES.map(t => <option key={t}>{t}</option>)}</Select>
              <TextInput label="Número de documento *" value={p.document_number} onChange={e => setPaxField(i, 'document_number', e.target.value)} autoComplete="off" />
              <TextInput label="Fecha de nacimiento *" type="date" max={today()} value={p.birth_date} onChange={e => setPaxField(i, 'birth_date', e.target.value)} />
              <Field label={need ? 'Documento de identidad (PDF o imagen) *' : 'Documento de identidad (PDF o imagen)'}>
                <label className="btn-ghost w-full cursor-pointer justify-start"><FileUp size={14} /><span className="truncate">{p.file ? p.file.name : 'Seleccionar archivo'}</span>
                  <input type="file" className="hidden" accept={ACCEPT} onChange={ev => { pickPax(i, ev.target.files?.[0]); ev.target.value = '' }} /></label>
              </Field>
            </div>
          </div>
        ))}
        {type && usePax && existing.length + pax.length < MAX_PAX && (
          <button type="button" className="btn-ghost" onClick={() => setPax(p => [...p, emptyPax()])}><Plus size={14} />Agregar {existing.length + pax.length ? 'otro ' : ''}pasajero</button>
        )}

        {type && <>
          <H>Archivos complementarios (opcional)</H>
          <div className="space-y-2">
            {extras.map((f, j) => <div key={j} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span className="truncate">{f.name}</span><button type="button" onClick={() => setExtras(x => x.filter((_, k) => k !== j))} className="text-muted hover:text-red-500" aria-label="Quitar archivo"><Trash2 size={14} /></button></div>)}
            {extras.length < MAX_EXTRA && <button type="button" className="btn-ghost" onClick={() => extraInput.current?.click()}><FileUp size={14} />Adjuntar archivos</button>}
            <input ref={extraInput} type="file" multiple className="hidden" accept={ACCEPT} onChange={ev => { pickExtras(ev.target.files); ev.target.value = '' }} />
            <p className="text-xs text-muted">PDF, PNG, JPG o WEBP. Máximo 8 MB por archivo.</p>
          </div>
        </>}

        {type && !update && <>
          <H>Aviso de privacidad</H>
          <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Leer el aviso de privacidad</summary><div className="mt-3">{PRIVACY}</div></details>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
            <span>He leído el aviso de privacidad y autorizo el tratamiento de mis datos personales para gestionar esta solicitud.</span></label>
        </>}

        <div className="flex justify-end gap-2 pt-2">
          {onCancel && <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Cancelar</button>}
          <button className="btn-primary" disabled={busy || !type}>{busy && <Spinner />}{busy ? 'Enviando…' : update ? 'Guardar cambios' : 'Enviar solicitud'}</button>
        </div>
      </div>
    </form>
  )
}
