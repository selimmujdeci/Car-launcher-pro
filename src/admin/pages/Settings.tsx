import { useState } from 'react'
import { PageHeader } from '../components/shared/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { RoleGuard } from '../components/common/RoleGuard'
import { useAuth } from '../hooks/useAuth'
import { useRole } from '../hooks/useRole'
import { ROLE_LABEL } from '../types'

export function Settings() {
  const { user }    = useAuth()
  const { can, company } = useRole()
  const [saved, setSaved] = useState(false)
  const [appName, setAppName]       = useState('Caros Pro')
  const [maxSpeed, setMaxSpeed]     = useState('300')
  const [sessionTtl, setSessionTtl] = useState('480')

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <RoleGuard minRole="admin">
      <div className="space-y-6 max-w-2xl">
        <PageHeader title="Ayarlar" description="Sistem yapılandırması" />

        <Card>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--adm-text)' }}>Oturum Bilgileri</h2>
          <dl className="space-y-2 text-sm">
            {[
              { label: 'Ad Soyad', value: user?.full_name },
              { label: 'E-posta',  value: user?.email },
              { label: 'Rol',      value: user ? ROLE_LABEL[user.role] : '—' },
              { label: 'Kurum',    value: company?.name ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <dt style={{ color: 'var(--adm-muted)' }}>{label}</dt>
                <dd style={{ color: 'var(--adm-text)' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {can('super_admin') && (
          <Card>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--adm-text)' }}>Uygulama Ayarları</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>Uygulama Adı</label>
                <Input value={appName} onChange={(e) => setAppName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>Maksimum Hız Eşiği (km/s)</label>
                <Input type="number" value={maxSpeed} onChange={(e) => setMaxSpeed(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>Oturum Süresi (dk)</label>
                <Input type="number" value={sessionTtl} onChange={(e) => setSessionTtl(e.target.value)} />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave}>{saved ? 'Kaydedildi!' : 'Kaydet'}</Button>
                <p className="text-xs" style={{ color: 'var(--adm-muted)' }}>
                  Supabase entegrasyonuna kadar ayarlar mock modunda çalışır.
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </RoleGuard>
  )
}
