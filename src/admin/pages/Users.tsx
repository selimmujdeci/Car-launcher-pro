import { useEffect, useState } from 'react'
import { UserPlus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/shared/PageHeader'
import { DataTable, type ColDef } from '../components/shared/DataTable'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useTable } from '../hooks/useTable'
import { useModal } from '../hooks/useModal'
import { useRole } from '../hooks/useRole'
import { RoleGuard } from '../components/common/RoleGuard'
import { listUsers, createUser, updateUser, deleteUser } from '../services/users.service'
import type { User, CreateUserDTO, Role, UserStatus } from '../types'
import { ROLE_LABEL } from '../types'

const STATUS_BADGE: Record<UserStatus, 'success' | 'danger' | 'warning' | 'muted'> = {
  active:    'success',
  inactive:  'muted',
  suspended: 'danger',
  pending:   'warning',
}

const STATUS_LABEL: Record<UserStatus, string> = {
  active:    'Aktif',
  inactive:  'Pasif',
  suspended: 'Askıya Alındı',
  pending:   'Bekliyor',
}

export function Users() {
  const { can } = useRole()
  const [all,     setAll]     = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<User | null>(null)
  const [toDelete, setToDelete] = useState<User | null>(null)
  const addModal    = useModal()
  const deleteModal = useModal()

  async function reload() {
    setLoading(true)
    try { setAll(await listUsers()) } finally { setLoading(false) }
  }

  useEffect(() => { void reload() }, [])

  const table = useTable<User>({
    data:       all,
    searchKeys: ['full_name', 'email', 'institution'] as (keyof User)[],
    perPage:    8,
  })

  const cols: ColDef<User>[] = [
    {
      key: 'full_name', header: 'Ad Soyad', sortable: true,
      cell: (u) => (
        <div>
          <p className="font-medium text-[--adm-text]">{u.full_name}</p>
          <p className="text-xs text-[--adm-muted]">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'role', header: 'Rol', sortable: true,
      cell: (u) => <Badge variant="info">{ROLE_LABEL[u.role]}</Badge>,
    },
    {
      key: 'status', header: 'Durum', sortable: true,
      cell: (u) => <Badge variant={STATUS_BADGE[u.status]}>{STATUS_LABEL[u.status]}</Badge>,
    },
    {
      key: 'institution', header: 'Kurum', sortable: true,
      cell: (u) => <span className="text-sm text-[--adm-muted]">{u.institution ?? '—'}</span>,
    },
    {
      key: 'last_login', header: 'Son Giriş',
      cell: (u) => (
        <span className="text-xs text-[--adm-muted]">
          {u.last_login ? new Date(u.last_login).toLocaleDateString('tr-TR') : '—'}
        </span>
      ),
    },
    ...(can('admin') ? [{
      key: '_actions', header: '',
      cell: (u: User) => (
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="icon" onClick={() => { setEditing(u); addModal.show() }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { setToDelete(u); deleteModal.show() }}>
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      ),
    } as ColDef<User>] : []),
  ]

  return (
    <RoleGuard minRole="operator">
    <div className="space-y-6">
      <PageHeader title="Kullanıcılar" description={`${all.length} kullanıcı`}>
        {can('admin') && (
          <Button onClick={() => { setEditing(null); addModal.show() }}>
            <UserPlus className="h-4 w-4" />
            Yeni Kullanıcı
          </Button>
        )}
      </PageHeader>

      <DataTable<User>
        data={table.rows}
        cols={cols}
        total={table.total}
        page={table.page}
        pages={table.pages}
        q={table.q}
        sortKey={table.sortKey as string | null}
        sortDir={table.sortDir}
        loading={loading}
        onSearch={table.onSearch}
        onSort={(k) => table.onSort(k as keyof User)}
        onPage={table.setPage}
        placeholder="Ad, e-posta veya kurum ara…"
      />

      <UserFormModal
        open={addModal.open}
        onClose={() => { addModal.hide(); setEditing(null) }}
        initial={editing}
        onSave={async (dto) => {
          if (editing) {
            const updated = await updateUser(editing.id, dto)
            setAll((prev) => prev.map((u) => u.id === updated.id ? updated : u))
          } else {
            const created = await createUser(dto)
            setAll((prev) => [created, ...prev])
          }
          addModal.hide()
          setEditing(null)
        }}
      />

      <Modal
        open={deleteModal.open}
        onClose={deleteModal.hide}
        title="Kullanıcıyı Sil"
        footer={
          <>
            <Button variant="outline" onClick={deleteModal.hide}>İptal</Button>
            <Button variant="danger" onClick={async () => {
              if (!toDelete) return
              await deleteUser(toDelete.id)
              setAll((prev) => prev.filter((u) => u.id !== toDelete.id))
              deleteModal.hide()
            }}>
              Sil
            </Button>
          </>
        }
      >
        <p className="text-sm text-[--adm-muted]">
          <span className="font-medium text-[--adm-text]">{toDelete?.full_name}</span> adlı kullanıcıyı silmek istediğinize emin misiniz?
        </p>
      </Modal>
    </div>
    </RoleGuard>
  )
}

interface FormModalProps {
  open:     boolean
  onClose:  () => void
  initial:  User | null
  onSave:   (dto: CreateUserDTO) => Promise<void>
}

function UserFormModal({ open, onClose, initial, onSave }: FormModalProps) {
  const [full_name,   setName]        = useState('')
  const [email,       setEmail]       = useState('')
  const [role,        setRole]        = useState<Role>('viewer')
  const [institution, setInstitution] = useState('')
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial?.full_name ?? '')
      setEmail(initial?.email ?? '')
      setRole(initial?.role ?? 'viewer')
      setInstitution(initial?.institution ?? '')
      setSaving(false)
    }
  }, [open, initial])

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ full_name, email, role, institution: institution || undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Kullanıcıyı Düzenle' : 'Yeni Kullanıcı'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button loading={saving} onClick={handleSave}>Kaydet</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm mb-1.5 text-[--adm-muted]">Ad Soyad</label>
          <Input value={full_name} onChange={(e) => setName(e.target.value)} placeholder="Ali Veli" />
        </div>
        <div>
          <label className="block text-sm mb-1.5 text-[--adm-muted]">E-posta</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ali@example.com" />
        </div>
        <div>
          <label className="block text-sm mb-1.5 text-[--adm-muted]">Rol</label>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={(Object.entries(ROLE_LABEL) as [Role, string][]).map(([k, v]) => ({ value: k, label: v }))}
          />
        </div>
        <div>
          <label className="block text-sm mb-1.5 text-[--adm-muted]">Kurum (opsiyonel)</label>
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Kurumunuz" />
        </div>
      </div>
    </Modal>
  )
}
