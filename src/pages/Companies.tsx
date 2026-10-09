import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilterX, ListChecks, Pencil, Plus, Search } from 'lucide-react'
import { Empty, Loading, Modal, PageHeader, Spinner, TextInput } from '../components/ui'
import { useAsync, useDebounced } from '../hooks'
import { money } from '../lib/format'
import { dataService } from '../services'
import type { Company, CompanyInput } from '../types'

const blank: CompanyInput = { name: '', nit: '', contact: '', email: '', phone: '', observations: '', ta: null }

export default function Companies() {
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const { data, loading, error, reload } = useAsync(() => dataService.getCompanies(q), [q])
  const { data: stats } = useAsync(() => dataService.getServiceReports({}), [])
  const [editing, setEditing] = useState<Company | 'new' | null>(null)
  const [form, setForm] = useState<CompanyInput>(blank)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')

  const openForm = (c: Company | 'new') => { setForm(c === 'new' ? blank : c); setSaveError(''); setEditing(c) }
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setSaveError('')
    try {
      if (editing === 'new') await dataService.createCompany(form)
      else if (editing) await dataService.updateCompany(editing.id, form)
      setEditing(null); reload()
    } catch (err) { setSaveError(err instanceof Error ? err.message : 'No se pudo guardar') }
    finally { setBusy(false) }
  }
  const f = (k: Exclude<keyof CompanyInput, 'ta'>) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm(p => ({ ...p, [k]: e.target.value })) })

  return (
    <>
      <PageHeader title="Empresas" subtitle="Clientes de la agencia" actions={<button className="btn-primary" onClick={() => openForm('new')}><Plus size={16} />Nueva empresa</button>} />
      <div className="flex gap-2 mb-4 max-w-md"><div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input pl-9" placeholder="Buscar empresa…" value={search} onChange={e => setSearch(e.target.value)} /></div><button type="button" className="btn-ghost" onClick={() => setSearch('')}><FilterX size={14} />Limpiar filtros</button></div>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : error ? <Empty><span role="alert" className="text-red-500">{error}</span></Empty> : !data?.length ? <Empty>No hay empresas.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr className="border-b border-line bg-surface2/50">{['Empresa', 'NIT', 'Contacto', 'Email', 'Teléfono', 'Registros'].map(h => <th key={h} className="th">{h}</th>)}<th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{data.map(c => { const s = stats?.by_company.find(x => x.key === c.id); return (
              <tr key={c.id}>
                <td className="td font-medium">{c.name}</td><td className="td">{c.nit}</td><td className="td">{c.contact}</td><td className="td">{c.email}</td><td className="td">{c.phone}</td>
                <td className="td">{s ? `${s.count} · ${money(s.amount)}` : '0'}</td>
                <td className="td"><div className="flex gap-1 justify-end">
                  <button className="btn-ghost !px-2" title="Ver registros" onClick={() => nav(`/registros?empresa=${c.id}`)}><ListChecks size={14} /></button>
                  <button className="btn-ghost !px-2" title="Editar" onClick={() => openForm(c)}><Pencil size={14} /></button></div></td>
              </tr>) })}</tbody>
          </table></div>
        )}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nueva empresa' : 'Editar empresa'}>
        <form onSubmit={save} className="space-y-3">
          <TextInput label="Nombre / razón social *" required {...f('name')} />
          <TextInput label="NIT" {...f('nit')} />
          <TextInput label="Contacto" {...f('contact')} />
          <TextInput label="TA (con IVA incluido)" type="number" min={0} value={form.ta ?? ''} onChange={e => setForm(p => ({ ...p, ta: e.target.value === '' ? null : Number(e.target.value) }))} />
          <div className="grid grid-cols-2 gap-3"><TextInput label="Email" type="email" {...f('email')} /><TextInput label="Teléfono" {...f('phone')} /></div>
          <div><label className="label">Observaciones</label><textarea className="input min-h-20" {...f('observations')} /></div>
          {saveError && <p role="alert" className="text-sm text-red-500">{saveError}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Guardar</button></div>
        </form>
      </Modal>
    </>
  )
}
