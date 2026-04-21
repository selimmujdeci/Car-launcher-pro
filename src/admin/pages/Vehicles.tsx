import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/shared/PageHeader'
import { DataTable, type ColDef } from '../components/shared/DataTable'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { useTable } from '../hooks/useTable'
import { useModal } from '../hooks/useModal'
import { useRole } from '../hooks/useRole'
import { listVehicles, updateVehicle, deleteVehicle } from '../services/vehicles.service'
import type { Vehicle, VehicleStatus } from '../types'

const STATUS_BADGE: Record<VehicleStatus, 'success' | 'default' | 'warning' | 'danger'> = {
  active:      'success',
  idle:        'default',
  maintenance: 'warning',
  offline:     'danger',
}

const STATUS_LABEL: Record<VehicleStatus, string> = {
  active:      'Aktif',
  idle:        'Boşta',
  maintenance: 'Bakımda',
  offline:     'Çevrimdışı',
}

export function Vehicles() {
  const { can } = useRole()
  const [all,     setAll]     = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [toDelete, setToDelete] = useState<Vehicle | null>(null)
  const editModal   = useModal()
  const deleteModal = useModal()

  useEffect(() => {
    listVehicles()
      .then(setAll)
      .finally(() => setLoading(false))
  }, [])

  const table = useTable<Vehicle>({
    data:       all,
    searchKeys: ['plate', 'brand', 'model', 'driver_name', 'institution'] as (keyof Vehicle)[],
    perPage:    8,
  })

  const cols: ColDef<Vehicle>[] = [
    {
      key: 'plate', header: 'Plaka', sortable: true,
      cell: (v) => <span className="font-mono font-semibold text-[--adm-text]">{v.plate}</span>,
    },
    {
      key: 'brand', header: 'Araç', sortable: true,
      cell: (v) => (
        <div>
          <p className="text-sm font-medium text-[--adm-text]">{v.brand} {v.model}</p>
          <p className="text-xs text-[--adm-muted]">{v.year} · {v.fuel_type}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Durum', sortable: true,
      cell: (v) => <Badge variant={STATUS_BADGE[v.status]}>{STATUS_LABEL[v.status]}</Badge>,
    },
    {
      key: 'driver_name', header: 'Sürücü',
      cell: (v) => <span className="text-sm text-[--adm-muted]">{v.driver_name ?? '—'}</span>,
    },
    {
      key: 'current_km', header: 'KM', sortable: true,
      cell: (v) => (
        <span className="text-sm tabular-nums text-[--adm-text]">
          {v.current_km.toLocaleString('tr-TR')} km
        </span>
      ),
    },
    {
      key: 'speed', header: 'Hız',
      cell: (v) => (
        <span className={['text-sm tabular-nums', v.status === 'active' ? 'text-green-400' : 'text-[--adm-muted]'].join(' ')}>
          {v.speed != null ? `${v.speed} km/s` : '—'}
        </span>
      ),
    },
    {
      key: 'institution', header: 'Kurum',
      cell: (v) => <span className="text-xs text-[--adm-muted]">{v.institution ?? '—'}</span>,
    },
    ...(can('admin') ? [{
      key: '_actions', header: '',
      cell: (v: Vehicle) => (
        <div className="flex items-center gap-1 justify-end">
          <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...v }); editModal.show() }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {can('super_admin') && (
            <Button variant="ghost" size="icon" onClick={() => { setToDelete(v); deleteModal.show() }}>
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </Button>
          )}
        </div>
      ),
    } as ColDef<Vehicle>] : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Araçlar" description={`${all.length} araç`} />

      <DataTable<Vehicle>
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
        onSort={(k) => table.onSort(k as keyof Vehicle)}
        onPage={table.setPage}
        placeholder="Plaka, marka veya sürücü ara…"
      />

      <Modal
        open={editModal.open}
        onClose={editModal.hide}
        title="Araç Durumu Güncelle"
        footer={
          <>
            <Button variant="outline" onClick={editModal.hide}>İptal</Button>
            <Button onClick={async () => {
              if (!editing) return
              const updated = await updateVehicle(editing.id, { status: editing.status })
              setAll((prev) => prev.map((v) => v.id === updated.id ? updated : v))
              editModal.hide()
            }}>
              Kaydet
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <p className="text-sm text-[--adm-muted]">
              <span className="font-medium text-[--adm-text]">{editing.plate}</span> — {editing.brand} {editing.model}
            </p>
            <div>
              <label className="block text-sm mb-1.5 text-[--adm-muted]">Durum</label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setEditing({ ...editing, status: s })}
                    className="px-3 py-1.5 rounded-lg text-sm transition-colors"
                    style={{
                      background: editing.status === s ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)',
                      color: editing.status === s ? 'var(--adm-accent2)' : 'var(--adm-muted)',
                      border: `1px solid ${editing.status === s ? 'rgba(59,130,246,0.4)' : 'var(--adm-border)'}`,
                    }}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteModal.open}
        onClose={deleteModal.hide}
        title="Aracı Sil"
        footer={
          <>
            <Button variant="outline" onClick={deleteModal.hide}>İptal</Button>
            <Button variant="danger" onClick={async () => {
              if (!toDelete) return
              await deleteVehicle(toDelete.id)
              setAll((prev) => prev.filter((v) => v.id !== toDelete.id))
              deleteModal.hide()
            }}>
              Sil
            </Button>
          </>
        }
      >
        <p className="text-sm text-[--adm-muted]">
          <span className="font-medium text-[--adm-text]">{toDelete?.plate}</span> plakalı aracı silmek istediğinize emin misiniz?
        </p>
      </Modal>
    </div>
  )
}
