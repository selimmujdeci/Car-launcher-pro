import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Truck, Activity, AlertTriangle, ShieldCheck, ChevronRight } from 'lucide-react'
import { StatCard } from '../components/shared/StatCard'
import { PageHeader } from '../components/shared/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { listUsers } from '../services/users.service'
import { listVehicles } from '../services/vehicles.service'
import { useRole } from '../hooks/useRole'
import type { User, Vehicle } from '../types'

export function Dashboard() {
  const { can } = useRole()
  const [users,    setUsers]    = useState<User[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.all([listUsers(), listVehicles()])
      .then(([u, v]) => { setUsers(u); setVehicles(v) })
      .finally(() => setLoading(false))
  }, [])

  const activeVehicles      = vehicles.filter((v) => v.status === 'active').length
  const maintenanceVehicles = vehicles.filter((v) => v.status === 'maintenance').length
  const activeUsers         = users.filter((u) => u.status === 'active').length

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Sisteme genel bakış" />

      {/* Süper Admin Paneli girişi (YevmiyePlus modeli): yalnız super_admin
          görür, Command Center'a (/sa → health) götürür. SuperAdminShell
          sidebar'ındaki Incidents/VoiceDiag erişimi aynen durur. */}
      {can('super_admin') && (
        <Link to="/sa/health" className="block" data-testid="super-admin-panel-card">
          <Card className="flex items-center gap-4 transition-opacity hover:opacity-85">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
              style={{ background: 'rgba(239,68,68,0.15)' }}
            >
              <ShieldCheck size={20} style={{ color: '#ef4444' }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--adm-text)' }}>
                Süper Admin Paneli
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--adm-muted)' }}>
                Command Center — Health, Fleet, Rollout, Incidents
              </p>
            </div>
            <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--adm-muted)' }} />
          </Card>
        </Link>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-lg animate-pulse" style={{ background: 'var(--adm-card)' }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title="Toplam Kullanıcı"  value={users.length}        icon={Users}         iconClass="text-blue-400"   subtitle={`${activeUsers} aktif`} />
          <StatCard title="Toplam Araç"        value={vehicles.length}     icon={Truck}         iconClass="text-green-400"  subtitle={`${activeVehicles} seferde`} />
          <StatCard title="Aktif Sefer"        value={activeVehicles}      icon={Activity}      iconClass="text-violet-400" />
          <StatCard title="Bakımda"            value={maintenanceVehicles} icon={AlertTriangle} iconClass="text-yellow-400" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--adm-text)' }}>Son Araçlar</h2>
          <div className="space-y-2">
            {vehicles.slice(0, 5).map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--adm-border)' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--adm-text)' }}>{v.plate}</p>
                  <p className="text-xs" style={{ color: 'var(--adm-muted)' }}>{v.brand} {v.model}</p>
                </div>
                <VehicleStatusBadge status={v.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--adm-text)' }}>Son Kullanıcılar</h2>
          <div className="space-y-2">
            {users.slice(0, 5).map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--adm-border)' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--adm-text)' }}>{u.full_name}</p>
                  <p className="text-xs" style={{ color: 'var(--adm-muted)' }}>{u.email}</p>
                </div>
                <Badge variant={u.status === 'active' ? 'success' : u.status === 'suspended' ? 'danger' : 'default'}>
                  {u.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function VehicleStatusBadge({ status }: { status: string }) {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
    active:      'success',
    idle:        'default',
    maintenance: 'warning',
    offline:     'danger',
  }
  return <Badge variant={map[status] ?? 'default'}>{status}</Badge>
}
