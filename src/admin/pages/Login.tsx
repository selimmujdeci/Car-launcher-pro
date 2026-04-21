import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function Login() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [email,    setEmail]    = useState('admin@carlauncher.pro')
  const [password, setPassword] = useState('demo')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  if (user) {
    navigate('/', { replace: true })
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--adm-bg)' }}>
      <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--adm-card)', border: '1px solid var(--adm-border)' }}>
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="p-3 rounded-full" style={{ background: 'rgba(59,130,246,0.15)' }}>
            <Car size={24} style={{ color: 'var(--adm-accent)' }} />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--adm-text)' }}>Car Launcher Admin</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--adm-muted)' }}>Hesabınıza giriş yapın</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>E-posta</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@carlauncher.pro"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--adm-muted)' }}>Şifre</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            Giriş Yap
          </Button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: 'var(--adm-muted)' }}>
          Demo: herhangi bir e-posta / şifre
        </p>
      </div>
    </div>
  )
}
