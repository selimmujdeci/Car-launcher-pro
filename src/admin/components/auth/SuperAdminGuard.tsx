/**
 * SuperAdminGuard — JWT Claim Tabanlı Super Admin Koruyucu
 *
 * Güvenlik Mimarisi:
 *   • user_metadata'ya GÜVENİLMEZ — kullanıcı tarafından değiştirilebilir
 *   • Supabase access_token JWT payload → app_metadata.role okunur
 *   • super_admin claim yoksa → /login yönlendirmesi
 *
 * Supabase Kurulum (service_role key gerektirir):
 *   await supabase.auth.admin.updateUserById(userId, {
 *     app_metadata: { role: 'super_admin' }
 *   })
 *
 * Token Yenileme:
 *   supabase.auth.refreshSession() sonrası yeni token okunur.
 *   Sayfa yenilemesi gerekmez — useEffect yeniden tetiklenir.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate }                          from 'react-router-dom'
import { ShieldAlert, ShieldCheck }             from 'lucide-react'
import { supabase }                             from '../../lib/supabaseClient'
import {
  SUPER_ADMIN_CLAIM_KEY,
  SUPER_ADMIN_CLAIM_VALUE,
}                                               from '../../config/roles'

// ── Tipler ────────────────────────────────────────────────────────────────────

type GuardState = 'checking' | 'authorized' | 'denied'

interface Props {
  children: ReactNode
}

// ── JWT Yardımcısı ─────────────────────────────────────────────────────────────

/**
 * JWT access_token'ın payload bölümünü decode eder.
 * Ağ çağrısı yapmaz — in-memory token'ı parse eder.
 * İmza doğrulaması yapmaz (Supabase edge'de yapılır).
 */
function _decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const segment = token.split('.')[1]
    if (!segment) return {}
    // Base64url → Base64 dönüşümü
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const json    = typeof window !== 'undefined'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString()
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * JWT payload'ından app_metadata.role okunur.
 * app_metadata Supabase tarafında service_role ile yazılır — kullanıcı değiştiremez.
 * Fallback olarak user_metadata.role da kontrol edilir (geçiş dönemi uyumluluğu).
 */
function _extractRole(payload: Record<string, unknown>): string | undefined {
  const appMeta  = payload.app_metadata  as Record<string, unknown> | undefined
  const userMeta = payload.user_metadata as Record<string, unknown> | undefined

  const fromApp  = appMeta?.[SUPER_ADMIN_CLAIM_KEY]  as string | undefined
  const fromUser = userMeta?.[SUPER_ADMIN_CLAIM_KEY] as string | undefined

  // app_metadata öncelikli — user_metadata yalnızca fallback
  return fromApp ?? fromUser
}

// ── Bileşen ───────────────────────────────────────────────────────────────────

export function SuperAdminGuard({ children }: Props) {
  const [state, setState] = useState<GuardState>('checking')
  const navigate          = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function verifyClaim() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error || !session?.access_token) {
          if (!cancelled) setState('denied')
          return
        }

        const payload = _decodeJwtPayload(session.access_token)
        const role    = _extractRole(payload)

        if (!cancelled) {
          setState(role === SUPER_ADMIN_CLAIM_VALUE ? 'authorized' : 'denied')
        }
      } catch {
        if (!cancelled) setState('denied')
      }
    }

    void verifyClaim()

    // Supabase token yenilendiğinde yeniden doğrula
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (!session?.access_token) {
        setState('denied')
        return
      }
      const payload = _decodeJwtPayload(session.access_token)
      const role    = _extractRole(payload)
      setState(role === SUPER_ADMIN_CLAIM_VALUE ? 'authorized' : 'denied')
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  // Reddedilince login'e yönlendir
  useEffect(() => {
    if (state === 'denied') {
      navigate('/login', { replace: true })
    }
  }, [state, navigate])

  // ── Kontrol ediliyor ────────────────────────────────────────────────────────

  if (state === 'checking') {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: 'var(--sa-bg, var(--adm-bg))' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--adm-accent)' }}
          />
          <p className="text-sm" style={{ color: 'var(--adm-muted)' }}>
            Yetki doğrulanıyor…
          </p>
        </div>
      </div>
    )
  }

  // ── Reddedildi ──────────────────────────────────────────────────────────────

  if (state === 'denied') {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: 'var(--sa-bg, var(--adm-bg))' }}
      >
        <div
          className="flex flex-col items-center gap-3 p-8 rounded-xl"
          style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}
        >
          <ShieldAlert size={36} style={{ color: '#ef4444' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--adm-text)' }}>
            Erişim Reddedildi
          </p>
          <p className="text-xs text-center max-w-48" style={{ color: 'var(--adm-muted)' }}>
            Bu bölüm Super Admin JWT claim'i gerektiriyor.
            Yönlendiriliyor…
          </p>
        </div>
      </div>
    )
  }

  // ── Yetki verildi ───────────────────────────────────────────────────────────

  return (
    <>
      {import.meta.env.DEV && (
        <div
          className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium pointer-events-none"
          style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}
        >
          <ShieldCheck size={11} />
          super_admin claim ✓
        </div>
      )}
      {children}
    </>
  )
}
