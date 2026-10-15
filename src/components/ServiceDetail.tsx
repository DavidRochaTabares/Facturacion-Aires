import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Eye, FileText, Paperclip, Pencil } from 'lucide-react'
import { dataService } from '../services'
import { fdate, fsize, money, SERVICE_LABEL } from '../lib/format'
import { summary } from '../lib/service'
import type { DocumentFile, OperationRow } from '../types'
import { BillingSummary } from './BillingSummary'
import ServiceForm from './ServiceForm'
import { Drawer, FilePreview, Loading, Modal, TypeBadge } from './ui'

const KV = ({ k, v }: { k: string; v?: ReactNode }) => v || v === 0 ? <div><dt className="text-xs text-muted">{k}</dt><dd className="text-sm mt-0.5 break-words">{v}</dd></div> : null
const Grid = ({ children }: { children: ReactNode }) => <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
const H = ({ children }: { children: ReactNode }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mt-6 mb-3">{children}</h3>
const m = (n: number | null) => (n === null ? '' : money(n))

function Specific({ r }: { r: OperationRow }) {
  switch (r.type) {
    case 'flight': {
      const f = r.details
      return (<>
        <Grid><KV k="NO" v={f.no} /><KV k="Primer apellido" v={f.first_surname} /><KV k="Nombres" v={f.names} /><KV k="Ruta" v={f.route} />
          <KV k="Fecha de ida" v={f.departure_date && fdate(f.departure_date)} /><KV k="Fecha de vuelta" v={f.return_date && fdate(f.return_date)} />
          <KV k="Aerolínea" v={f.airline} /><KV k="Código de reserva" v={f.booking_code} /><KV k="Código de reserva INT" v={f.internal_booking_code} /><KV k="Número de tiquete" v={f.ticket_number} /></Grid>
        <H>Valores y facturación</H>
        <Grid><KV k="Valor TKT con impuestos TA y FEE" v={m(f.value_with_taxes_tae)} /><KV k="Total factura" v={m(f.total_invoice)} /><KV k="Factura de compra" v={f.purchase_invoice} /></Grid>
        <H>Comisiones y ganancias</H>
        <Grid><KV k="Comisión terceros" v={m(f.third_party_commission)} /><KV k="Ganancia proveedor" v={m(f.provider_profit)} /></Grid>
        <H>Impuestos / TA</H>
        <Grid><KV k="TA" v={m(f.ta)} /><KV k="TA sin IVA" v={m(f.ta_without_iva)} /><KV k="IVA incluido en TA" v={m(f.iva_ta)} /><KV k="Valor neto cotización TA con IVA" v={m(f.net_quote_minus_iva_ta)} /></Grid>
        <H>Proveedor</H>
        <Grid><KV k="Número tarjeta" v={f.card_number} /></Grid>
        <H>Tramos</H>
        <div className="space-y-2">{f.segments.map(s => (
          <div key={s.id} className="rounded-lg border border-line p-3 text-sm">
            <div className="flex justify-between font-medium"><span>{s.origin} → {s.destination}</span><span className="text-muted font-normal">{s.flight_number} · {s.cabin}</span></div>
            <p className="text-muted mt-1">{fdate(s.departure_date)} {s.departure_time} → {s.arrival_time}{s.arrival_date ? ` · Regreso ${fdate(s.arrival_date)}` : ''}</p>
          </div>))}</div>
        <H>Pasajeros ({f.passengers.length})</H>
        <div className="space-y-2">{f.passengers.map(p => (
          <div key={p.id} className="rounded-lg border border-line p-3 text-sm">
            <p className="font-medium">{[p.names, p.surnames].filter(Boolean).join(' ')}</p>
            <p className="text-muted">{p.document_type} {p.document_number}{p.ticket_number && ` · Ticket ${p.ticket_number}`}</p>
            <p className="text-muted">{[p.birth_date && `Nac. ${fdate(p.birth_date)}`, p.email, p.phone, p.frequent_flyer && `FF ${p.frequent_flyer}`].filter(Boolean).join(' · ')}</p>
          </div>))}</div>
      </>)
    }
    case 'hotel': { const d = r.details; return (<>
      <Grid><KV k="Número de reserva" v={d.reservation_number} /><KV k="Código de alojamiento" v={d.accommodation_code} /></Grid>
      <H>Hotel</H>
      <Grid><KV k="Nombre del hotel" v={d.hotel} /><KV k="Ciudad / destino" v={d.city} /><KV k="Dirección" v={d.address} /><KV k="Teléfono" v={d.phone} /><KV k="Email" v={d.email} /></Grid>
      <H>Estadía</H>
      <Grid><KV k="Check-in" v={d.check_in && fdate(d.check_in)} /><KV k="Hora check-in" v={d.check_in_time} /><KV k="Check-out" v={d.check_out && fdate(d.check_out)} /><KV k="Hora check-out" v={d.check_out_time} /><KV k="Noches" v={d.nights} /></Grid>
      <H>Huésped</H>
      <Grid><KV k="Titular de la reserva" v={d.holder} /><KV k="Huéspedes" v={d.guests} /></Grid>
      <H>Habitación</H>
      <Grid><KV k="Tipo de habitación" v={d.room_type} /><KV k="Régimen" v={d.board} /><KV k="Solicitudes especiales" v={d.special_requests} /></Grid>
      <H>Facturación</H>
      <Grid><KV k="Factura de compra" v={d.purchase_invoice} /><KV k="Total factura" v={m(d.total_invoice)} /></Grid>
      <H>Comisiones y ganancias</H>
      <Grid><KV k="Comisión terceros" v={m(d.third_party_commission)} /><KV k="Ganancia proveedor" v={m(d.provider_profit)} /></Grid>
      <H>Impuestos / TA</H>
      <Grid><KV k="TA" v={m(d.ta)} /><KV k="TA sin IVA" v={m(d.ta_without_iva)} /><KV k="IVA incluido en TA" v={m(d.iva_ta)} /><KV k="Valor neto cotización TA con IVA" v={m(d.net_quote_minus_iva_ta)} /></Grid>
    </>) }
    case 'transport': { const d = r.details; return <Grid><KV k="Pasajero / cliente" v={d.passenger} /><KV k="Origen" v={d.origin} /><KV k="Destino" v={d.destination} /><KV k="Hora" v={d.time} /><KV k="N.º de servicio" v={d.service_number} /></Grid> }
    case 'food': { const d = r.details; return <Grid><KV k="Quién solicitó" v={d.requested_by} /><KV k="Qué solicitó" v={d.requested_item} /><KV k="Valor insumo" v={m(d.supplies_value)} /><KV k="Valor transporte" v={m(d.transport_value)} /><KV k="Costo total" v={money(d.total_cost)} /></Grid> }
    case 'loan': { const d = r.details; return <Grid><KV k="Solicitud" v={d.request} /><KV k="Solicitó" v={d.requested_by} /><KV k="Fecha de factura" v={d.invoice_date && fdate(d.invoice_date)} /><KV k="COT" v={d.cot} /><KV k="Enviada" v={d.sent && fdate(d.sent)} />
      <KV k="Valor cobrado / cotizado" v={m(d.charged_quoted_value)} /><KV k="¿Incluye IVA 19%?" v={d.has_iva ? 'Sí' : 'No'} /><KV k="IVA" v={m(d.iva)} />{d.has_iva && <KV k="Total con IVA" v={m(r.amount + (d.iva ?? 0))} />}<KV k="OC" v={d.oc} /><KV k="Recibida" v={d.received && fdate(d.received)} /><KV k="Se pagó" v={d.paid && fdate(d.paid)} /></Grid> }
    default: return <Grid><KV k="Descripción" v={r.details.description} /></Grid>
  }
}

interface Props { id: string | null; startEdit?: boolean; onClose: () => void; onChanged: () => void; onNavigate?: (id: string) => void }

export default function ServiceDetail({ id, startEdit, onClose, onChanged, onNavigate }: Props) {
  const [row, setRow] = useState<OperationRow | null>(null)
  const [siblings, setSiblings] = useState<OperationRow[]>([])
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ doc: DocumentFile; url: string } | null>(null)

  const load = async (i: string) => {
    const r = await dataService.getOperationById(i)
    setRow(r)
    setSiblings(r?.group_id ? (await dataService.getOperations()).filter(x => x.group_id === r.group_id) : [])
  }
  useEffect(() => { setEdit(!!startEdit); setRow(null); if (id) load(id) }, [id, startEdit])
  const open = async (doc: DocumentFile) => {
    try { setPreview({ doc, url: await dataService.getDocumentUrl(doc) }) } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo abrir el documento') }
  }
  const s = row && summary(row)

  return (
    <>
      <Drawer open={!!id} onClose={onClose} title="Detalle del registro" wide={edit}>
        {!row ? <Loading /> : edit ? (
          <ServiceForm key={row.id} type={row.type} initial={row as any} busy={busy} submitLabel="Guardar cambios" onCancel={() => setEdit(false)}
            onSubmit={async v => { setBusy(true); await dataService.updateOperation(row.id, v); setBusy(false); onChanged(); setEdit(false); load(row.id) }} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div><TypeBadge type={row.type} /><h2 className="text-lg font-semibold mt-2">{s?.route || SERVICE_LABEL[row.type]}</h2><p className="text-sm text-muted">{row.company_name} · {fdate(row.date)}</p></div>
              <div className="text-right"><p className="text-xs text-muted">A cobrar</p><p className="text-xl font-semibold tabular-nums">{money(row.charge_amount)}</p><button className="btn-ghost mt-2" onClick={() => setEdit(true)}><Pencil size={14} />Editar</button></div>
            </div>
            {row.missing.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300"><AlertTriangle size={16} />Información incompleta</p>
                <p className="text-sm text-muted mt-1">Faltan:</p>
                <ul className="text-sm list-disc pl-5">{row.missing.map(x => <li key={x}>{x}</li>)}</ul>
                <button className="btn-primary mt-3" onClick={() => setEdit(true)}>Completar información</button>
              </div>
            )}
            {row.group && (
              <div className="mt-4 rounded-lg border border-line p-3">
                <p className="text-sm font-medium">GRUPO {row.group.code} · {row.group.label} · {siblings.length} registros</p>
                <ul className="mt-2 text-sm space-y-1">{siblings.map((x, i) => (
                  <li key={x.id}>
                    <button disabled={x.id === row.id} onClick={() => onNavigate?.(x.id)} className={`text-left ${x.id === row.id ? 'font-medium' : 'text-brand hover:underline'}`}>
                      <span className="text-muted">{i === siblings.length - 1 ? '└──' : '├──'}</span> {SERVICE_LABEL[x.type]} · {summary(x).client || summary(x).route || x.provider}
                    </button>
                  </li>))}</ul>
              </div>
            )}
            <H>General</H>
            <Grid><KV k="Empresa" v={row.company_name} /><KV k="Fecha" v={fdate(row.date)} /><KV k="Proveedor" v={row.provider} /><KV k="Factura" v={row.invoice_number} />
              <KV k="Valor (costo)" v={money(row.amount)} /><KV k="Valor a cobrar" v={money(row.charge_amount)} /><KV k="Registrado" v={fdate(row.created_at)} /></Grid>
            <H>{SERVICE_LABEL[row.type]}</H>
            <Specific r={row} />
            {row.observations && <><H>Observaciones</H><p className="text-sm">{row.observations}</p></>}
            <H>Resumen para facturación</H>
            <BillingSummary row={row} />
            <H>Documentos</H>
            {row.documents.length === 0 && <p className="text-sm text-muted mb-2">Sin documentos asociados.</p>}
            {row.documents.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-line p-3 mb-2">
                <FileText size={18} className="text-brand" /><div className="flex-1 min-w-0"><p className="text-sm truncate">{doc.name}</p><p className="text-xs text-muted">{fsize(doc.size)} · {fdate(doc.created_at)}</p></div>
                <button className="btn-ghost" onClick={() => open(doc)}><Eye size={14} />Ver</button>
              </div>
            ))}
            <label className="btn-ghost cursor-pointer"><Paperclip size={14} />Adjuntar documento
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { try { await dataService.addDocument(row.id, f); onChanged(); load(row.id) } catch (err) { alert(err instanceof Error ? err.message : 'No se pudo subir el documento') } } e.target.value = '' }} /></label>
          </>
        )}
      </Drawer>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.doc.name ?? ''}>
        <div className="h-[60vh]"><FilePreview url={preview?.url ?? null} mime={preview?.doc.mime_type} className="h-full" /></div>
      </Modal>
    </>
  )
}
