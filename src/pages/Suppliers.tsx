import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Empty, Loading, Modal, PageHeader, Spinner, TextInput } from '../components/ui'
import { useAsync } from '../hooks'
import { cardLabel } from '../lib/format'
import { dataService } from '../services'
import type { DeleteResult, PaymentCard, PaymentCardInput, Supplier, SupplierInput } from '../types'

const blankSupplier: SupplierInput = { name: '', nit: '', contact: '', email: '', phone: '', is_active: true }
const blankCard: PaymentCardInput = { alias: '', last_four: '', bank: '', holder: '', is_active: true }
const Inactive = () => <span className="ml-2 rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-muted">Inactivo</span>
const Active = ({ v, onChange }: { v: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v} onChange={e => onChange(e.target.checked)} />Activo (aparece en los desplegables)</label>
)
const delMsg = (r: DeleteResult, name: string) => (r === 'deleted' ? `«${name}» se eliminó.` : `«${name}» tiene registros asociados, así que se desactivó (ya no sale en los desplegables). Puedes reactivarlo editándolo.`)
const confirmDel = (name: string) => confirm(`¿Eliminar «${name}»?\n\nSi ya aparece en registros existentes se desactivará en lugar de eliminarse, para no afectar el historial.`)

function useCrud() {
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const run = async (fn: () => Promise<unknown>, done: () => void, reload: () => void) => {
    setBusy(true); setSaveError('')
    try { await fn(); done(); reload() } catch (err) { setSaveError(err instanceof Error ? err.message : 'No se pudo guardar') } finally { setBusy(false) }
  }
  return { busy, saveError, setSaveError, notice, setNotice, run }
}

const Toolbar = ({ search, onSearch, placeholder, children }: { search: string; onSearch: (v: string) => void; placeholder: string; children: React.ReactNode }) => (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div className="relative w-full max-w-md"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder={placeholder} value={search} onChange={e => onSearch(e.target.value)} /></div>
    {children}
  </div>
)
const Actions = ({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) => (
  <div className="flex justify-end gap-1">
    <button className="btn-ghost !px-2" title={`Editar ${label}`} aria-label={`Editar ${label}`} onClick={onEdit}><Pencil size={14} /></button>
    <button className="btn-ghost !px-2 text-red-600 dark:text-red-400" title={`Eliminar ${label}`} aria-label={`Eliminar ${label}`} onClick={onDelete}><Trash2 size={14} /></button>
  </div>
)
const Buttons = ({ busy, onCancel }: { busy: boolean; onCancel: () => void }) => (
  <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button></div>
)

function SuppliersTab() {
  const { data, loading, error, reload } = useAsync(() => dataService.getSuppliers(), [])
  const { busy, saveError, setSaveError, notice, setNotice, run } = useCrud()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const [form, setForm] = useState<SupplierInput>(blankSupplier)
  const open = (s: Supplier | 'new') => { setForm(s === 'new' ? blankSupplier : { name: s.name, nit: s.nit, contact: s.contact, email: s.email, phone: s.phone, is_active: s.is_active }); setSaveError(''); setEditing(s) }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return setSaveError('El nombre es obligatorio.')
    run(() => (editing === 'new' ? dataService.createSupplier(form) : dataService.updateSupplier((editing as Supplier).id, form)), () => setEditing(null), reload)
  }
  const remove = async (s: Supplier) => {
    if (!confirmDel(s.name)) return
    setNotice('')
    try { setNotice(delMsg(await dataService.deleteSupplier(s.id), s.name)); reload() } catch (err) { setNotice(err instanceof Error ? err.message : 'No se pudo eliminar') }
  }
  const q = search.trim().toLowerCase()
  const list = (data ?? []).filter(s => !q || `${s.name} ${s.nit} ${s.contact} ${s.email}`.toLowerCase().includes(q))
  const f = (k: 'name' | 'nit' | 'contact' | 'email' | 'phone') => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm(p => ({ ...p, [k]: e.target.value })) })
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar proveedor…"><button className="btn-primary" onClick={() => open('new')}><Plus size={16} />Nuevo proveedor</button></Toolbar>
      {notice && <p role="status" className="mb-4 rounded-lg border border-line bg-surface2 p-3 text-sm">{notice}</p>}
      <div className="card overflow-hidden">
        {loading ? <Loading /> : error ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : !list.length ? <Empty>No hay proveedores.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr className="border-b border-line bg-surface2/50">{['Proveedor', 'NIT', 'Contacto', 'Email', 'Teléfono'].map(h => <th key={h} className="th">{h}</th>)}<th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{list.map(s => (
              <tr key={s.id}>
                <td className="td font-medium">{s.name}{!s.is_active && <Inactive />}</td><td className="td">{s.nit}</td><td className="td">{s.contact}</td><td className="td">{s.email}</td><td className="td">{s.phone}</td>
                <td className="td"><Actions label="proveedor" onEdit={() => open(s)} onDelete={() => remove(s)} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo proveedor' : 'Editar proveedor'}>
        <form onSubmit={save} className="space-y-3">
          <TextInput label="Nombre *" {...f('name')} />
          <div className="grid grid-cols-2 gap-3"><TextInput label="NIT" {...f('nit')} /><TextInput label="Contacto" {...f('contact')} /></div>
          <div className="grid grid-cols-2 gap-3"><TextInput label="Email" type="email" {...f('email')} /><TextInput label="Teléfono" {...f('phone')} /></div>
          <Active v={form.is_active} onChange={v => setForm(p => ({ ...p, is_active: v }))} />
          {saveError && <p role="alert" className="text-sm text-red-500">{saveError}</p>}
          <Buttons busy={busy} onCancel={() => setEditing(null)} />
        </form>
      </Modal>
    </>
  )
}

function CardsTab() {
  const { data, loading, error, reload } = useAsync(() => dataService.getCards(), [])
  const { busy, saveError, setSaveError, notice, setNotice, run } = useCrud()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PaymentCard | 'new' | null>(null)
  const [form, setForm] = useState<PaymentCardInput>(blankCard)
  const open = (c: PaymentCard | 'new') => { setForm(c === 'new' ? blankCard : { alias: c.alias, last_four: c.last_four, bank: c.bank, holder: c.holder, is_active: c.is_active }); setSaveError(''); setEditing(c) }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!form.alias.trim()) return setSaveError('El alias es obligatorio.')
    if (!/^\d{4}$/.test(form.last_four.trim())) return setSaveError('Escribe exactamente los últimos 4 dígitos.')
    run(() => (editing === 'new' ? dataService.createCard(form) : dataService.updateCard((editing as PaymentCard).id, form)), () => setEditing(null), reload)
  }
  const remove = async (c: PaymentCard) => {
    if (!confirmDel(cardLabel(c))) return
    setNotice('')
    try { setNotice(delMsg(await dataService.deleteCard(c.id), cardLabel(c))); reload() } catch (err) { setNotice(err instanceof Error ? err.message : 'No se pudo eliminar') }
  }
  const q = search.trim().toLowerCase()
  const list = (data ?? []).filter(c => !q || `${c.alias} ${c.last_four} ${c.bank} ${c.holder}`.toLowerCase().includes(q))
  const f = (k: 'alias' | 'bank' | 'holder') => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm(p => ({ ...p, [k]: e.target.value })) })
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar tarjeta…"><button className="btn-primary" onClick={() => open('new')}><Plus size={16} />Nueva tarjeta</button></Toolbar>
      {notice && <p role="status" className="mb-4 rounded-lg border border-line bg-surface2 p-3 text-sm">{notice}</p>}
      <div className="card overflow-hidden">
        {loading ? <Loading /> : error ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : !list.length ? <Empty>No hay tarjetas.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr className="border-b border-line bg-surface2/50">{['Tarjeta', 'Últimos 4', 'Banco', 'Titular'].map(h => <th key={h} className="th">{h}</th>)}<th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{list.map(c => (
              <tr key={c.id}>
                <td className="td font-medium">{c.alias}{!c.is_active && <Inactive />}</td><td className="td font-mono">{c.last_four}</td><td className="td">{c.bank}</td><td className="td">{c.holder}</td>
                <td className="td"><Actions label="tarjeta" onEdit={() => open(c)} onDelete={() => remove(c)} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nueva tarjeta' : 'Editar tarjeta'}>
        <form onSubmit={save} className="space-y-3">
          <TextInput label="Alias *" placeholder="Visa empresarial" {...f('alias')} />
          <TextInput label="Últimos 4 dígitos *" inputMode="numeric" maxLength={4} placeholder="1234" value={form.last_four} onChange={e => setForm(p => ({ ...p, last_four: e.target.value.replace(/\D/g, '') }))} />
          <div className="grid grid-cols-2 gap-3"><TextInput label="Banco" {...f('bank')} /><TextInput label="Titular" {...f('holder')} /></div>
          <Active v={form.is_active} onChange={v => setForm(p => ({ ...p, is_active: v }))} />
          <p className="text-xs text-muted">Solo se guardan el alias y los últimos 4 dígitos. Nunca registres el número completo, CVV, PIN ni claves.</p>
          {saveError && <p role="alert" className="text-sm text-red-500">{saveError}</p>}
          <Buttons busy={busy} onCancel={() => setEditing(null)} />
        </form>
      </Modal>
    </>
  )
}

export default function Suppliers() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'tarjetas' ? 'tarjetas' : 'proveedores'
  const tabCls = (on: boolean) => `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${on ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg'}`
  return (
    <>
      <PageHeader title="Proveedores y tarjetas" subtitle="Catálogos independientes que alimentan los desplegables de los formularios" />
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        <button role="tab" aria-selected={tab === 'proveedores'} className={tabCls(tab === 'proveedores')} onClick={() => setParams({})}>Proveedores</button>
        <button role="tab" aria-selected={tab === 'tarjetas'} className={tabCls(tab === 'tarjetas')} onClick={() => setParams({ tab: 'tarjetas' })}>Tarjetas</button>
      </div>
      {tab === 'proveedores' ? <SuppliersTab /> : <CardsTab />}
    </>
  )
}
