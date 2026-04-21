import type { ReactNode } from 'react'
import { ShieldOff } from 'lucide-react'
import type { Role } from '../../types'
import { useRole } from '../../hooks/useRole'

interface Props {
  minRole:  Role
  children: ReactNode
}

export function RoleGuard({ minRole, children }: Props) {
  const { can, loading } = useRole()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--adm-accent)' }}
        />
      </div>
    )
  }

  if (!can(minRole)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <ShieldOff size={32} style={{ color: 'var(--adm-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--adm-muted)' }}>
          Bu sayfayı görüntülemek için yeterli yetkiniz yok.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
