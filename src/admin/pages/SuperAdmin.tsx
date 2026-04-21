import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Users, Plus, Trash2, PowerOff, Power, UserPlus, X } from 'lucide-react'
import { PageHeader }  from '../components/shared/PageHeader'
import { StatCard }    from '../components/shared/StatCard'
import { RoleGuard }   from '../components/common/RoleGuard'
import { Badge }       from '../components/ui/Badge'
import { Button }      from '../components/ui/Button'
import { Modal }       from '../components/ui/Modal'
import { Input }       from '../components/ui/Input'
import { Select }      from '../components/ui/Select'
import { Card }        from '../components/ui/Card'
import { useModal }    from '../hooks/useModal'
import {
  listAllCompanies, createCompany, setCompanyActive, deleteCompany,
  listCompanyMembers, assignUserByEmail, updateMemberRole, removeMember,
  slugify,
  type Company, type CompanyMember,
} from '../services/companies.service'
import type { Role } from '../types'
import { ROLE_LABEL } from '../types'

const ASSIGNABLE_ROLES: Role[] = ['admin', 'operator', 'viewer']

const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))

// ── Main page ─────────────────────────────────────────────────────────────────

export function SuperAdmin() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<Company | null>(null)
  const [toDelete,  setToDelete]  = useState<Company | null>(null)

  const createModal  = useModal()
  const membersModal = useModal()
  const deleteModal  = useModal()

  async function reload() {
    setLoading(true)
    try { setCompanies(await listAllCompanies()) } finally { setLoading(false) }
  }

  useEffect(() => { void reload() }, [])

  async function handleToggleActive(company: Company) {
    await setCompanyActive(company.id, !company.is_active)
    setCompanies((prev) =>
      prev.map((c) => c.id === company.id ? { ...c, is_active: !c.is_active } : c),
    )
  }

  async function handleDelete() {
    if (!toDelete) return
    await deleteCompany(toDelete.id)
    setCompanies((prev) => prev.filter((c) => c.id !== toDelete.id))
    deleteModal.hide()
    setToDelete(null)
  }

  const active   = companies.filter((c) => c.is_active).length
  const disabled = companies.filter((c) => !c.is_active).length
  const totalMembers = companies.reduce((s, c) => s + c.member_count, 0)

  return (
    <RoleGuard minRole="super_admin">
      <div className="space-y-6">
        <PageHeader title="Süper Admin" description="Tüm şirketler ve üyeler">
          <Button onClick={() => createModal.show()}>
            <Plus className="h-4 w-4" />
            Yeni Şirket
          </Button>
        </PageHeader>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title="Toplam Şirket"   value={companies.length} icon={Building2} iconClass="text-blue-400" />
          <StatCard title="Aktif"            value={active}           icon={Power}     iconClass="text-green-400" />
          <StatCard title="Devre Dışı"       value={disabled}         icon={PowerOff}  iconClass="text-red-400" />
          <StatCard title="Toplam Üye"       value={totalMembers}     icon={Users}     iconClass="text-violet-400" />
        </div>

        {/* Companies list */}
        <Card>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
              ))}
            </div>
          ) : companies.length === 0 ? (
            <p className="text-sm text-center py-12" style={{ color: 'var(--adm-muted)' }}>
              Henüz şirket yok.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--adm-border)' }}>
                  {['Şirket', 'Slug', 'Üye', 'Durum', 'Oluşturulma', ''].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--adm-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="group" style={{ borderBottom: '1px solid var(--adm-border)' }}>
                    <td className="px-3 py-3 font-medium" style={{ color: 'var(--adm-text)' }}>{c.name}</td>
                    <td className="px-3 py-3">
                      <code className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--adm-muted)' }}>
                        {c.slug}
                      </code>
                    </td>
                    <td className="px-3 py-3 tabular-nums" style={{ color: 'var(--adm-text)' }}>{c.member_count}</td>
                    <td className="px-3 py-3">
                      <Badge variant={c.is_active ? 'success' : 'danger'}>
                        {c.is_active ? 'Aktif' : 'Devre Dışı'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs" style={{ color: 'var(--adm-muted)' }}>
                      {new Date(c.created_at).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost" size="icon"
                          title="Üyeleri Yönet"
                          onClick={() => { setSelected(c); membersModal.show() }}
                        >
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          title={c.is_active ? 'Devre Dışı Bırak' : 'Etkinleştir'}
                          onClick={() => handleToggleActive(c)}
                        >
                          {c.is_active
                            ? <PowerOff className="h-3.5 w-3.5 text-yellow-400" />
                            : <Power    className="h-3.5 w-3.5 text-green-400" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          title="Şirketi Sil"
                          onClick={() => { setToDelete(c); deleteModal.show() }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* ── Create company modal ────────────────────────────────────────────── */}
      <CreateCompanyModal
        open={createModal.open}
        onClose={createModal.hide}
        onCreated={(c) => { setCompanies((prev) => [c, ...prev]); createModal.hide() }}
      />

      {/* ── Members modal ───────────────────────────────────────────────────── */}
      {selected && (
        <MembersModal
          company={selected}
          open={membersModal.open}
          onClose={() => { membersModal.hide(); setSelected(null) }}
          onMemberCountChange={(delta) =>
            setCompanies((prev) =>
              prev.map((c) => c.id === selected.id
                ? { ...c, member_count: c.member_count + delta }
                : c,
              )
            )
          }
        />
      )}

      {/* ── Delete confirm modal ────────────────────────────────────────────── */}
      <Modal
        open={deleteModal.open}
        onClose={() => { deleteModal.hide(); setToDelete(null) }}
        title="Şirketi Sil"
        footer={
          <>
            <Button variant="outline" onClick={() => { deleteModal.hide(); setToDelete(null) }}>İptal</Button>
            <Button variant="danger" onClick={handleDelete}>Sil</Button>
          </>
        }
      >
        <p className="text-sm" style={{ color: 'var(--adm-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--adm-text)' }}>{toDelete?.name}</span> şirketini ve tüm üyeliklerini silmek istediğinize emin misiniz?
          Bu işlem geri alınamaz.
        </p>
      </Modal>
    </RoleGuard>
  )
}

// ── Create company modal ───────────────────────────────────────────────────────

interface CreateModalProps {
  open:      boolean
  onClose:   () => void
  onCreated: (c: Company) => void
}

function CreateCompanyModal({ open, onClose, onCreated }: CreateModalProps) {
  const [name,    setName]    = useState('')
  const [slug,    setSlug]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (open) { setName(''); setSlug(''); setError(''); setSaving(false) }
  }, [open])

  function handleNameChange(v: string) {
    setName(v)
    setSlug(slugify(v))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return
    setSaving(true)
    setError('')
    try {
      const company = await createCompany({ name: name.trim(), slug: slug.trim() })
      onCreated(company)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni Şirket"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button loading={saving} onClick={(e) => { void handleSubmit(e) }}>Oluştur</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>Şirket Adı</label>
          <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="İstanbul Belediyesi" autoFocus />
        </div>
        <div>
          <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>Slug</label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="istanbul-belediyesi" />
          <p className="text-xs mt-1" style={{ color: 'var(--adm-muted)' }}>Benzersiz URL tanımlayıcı</p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}

// ── Members modal ─────────────────────────────────────────────────────────────

interface MembersModalProps {
  company:             Company
  open:                boolean
  onClose:             () => void
  onMemberCountChange: (delta: number) => void
}

function MembersModal({ company, open, onClose, onMemberCountChange }: MembersModalProps) {
  const [members,  setMembers]  = useState<CompanyMember[]>([])
  const [loading,  setLoading]  = useState(true)
  const [addEmail, setAddEmail] = useState('')
  const [addRole,  setAddRole]  = useState<Role>('viewer')
  const [adding,   setAdding]   = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setAddEmail('')
    setError('')
    listCompanyMembers(company.id)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }, [open, company.id])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)
    setError('')
    try {
      await assignUserByEmail(company.id, addEmail.trim(), addRole)
      const updated = await listCompanyMembers(company.id)
      const prev = members.length
      setMembers(updated)
      onMemberCountChange(updated.length - prev)
      setAddEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hata oluştu')
    } finally {
      setAdding(false)
    }
  }

  async function handleRoleChange(member: CompanyMember, role: Role) {
    await updateMemberRole(member.user_id, company.id, role)
    setMembers((prev) => prev.map((m) => m.user_id === member.user_id ? { ...m, role } : m))
  }

  async function handleRemove(member: CompanyMember) {
    await removeMember(member.user_id, company.id)
    setMembers((prev) => {
      const next = prev.filter((m) => m.user_id !== member.user_id)
      onMemberCountChange(next.length - prev.length)
      return next
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${company.name} — Üyeler`}
      footer={<Button variant="outline" onClick={onClose}>Kapat</Button>}
    >
      <div className="space-y-5">
        {/* Add user form */}
        <form onSubmit={handleAdd} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: 'var(--adm-muted)' }}>E-posta</label>
            <Input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="kullanici@example.com"
            />
          </div>
          <div className="w-32">
            <label className="block text-xs mb-1" style={{ color: 'var(--adm-muted)' }}>Rol</label>
            <Select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as Role)}
              options={ROLE_OPTIONS}
            />
          </div>
          <Button type="submit" loading={adding} size="sm">
            <UserPlus className="h-3.5 w-3.5" />
            Ekle
          </Button>
        </form>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Member list */}
        <div style={{ borderTop: '1px solid var(--adm-border)' }}>
          {loading ? (
            <div className="space-y-2 pt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--adm-muted)' }}>
              Henüz üye yok.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--adm-border)' }}>
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--adm-text)' }}>{m.full_name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--adm-muted)' }}>{m.email}</p>
                  </div>
                  <Select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                    options={ROLE_OPTIONS}
                    className="w-28 h-7 text-xs"
                  />
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => handleRemove(m)}
                    title="Üyeyi Kaldır"
                  >
                    <X className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
