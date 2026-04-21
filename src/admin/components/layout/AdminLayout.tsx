import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Sidebar } from './Sidebar'

export function AdminLayout() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login', { replace: true })
    }
  }, [user, loading, navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--adm-bg)' }}>
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--adm-accent)' }} />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--adm-bg)' }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
