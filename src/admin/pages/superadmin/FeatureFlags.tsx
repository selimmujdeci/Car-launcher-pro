/**
 * FeatureFlags — Feature Flag Yönetim Paneli
 *
 * Tüm sistem flaglerini listeler ve toggle ile anlık değiştirmeye olanak tanır.
 * Destructive Action Protection: Her değişiklik önce Preview → ardından Confirm
 * adımından geçer. Onaylanmadan hiçbir şey Supabase'e yazılmaz.
 *
 * Flagler: CRM · Hazard Intelligence · Safety Co-Pilot ·
 *          Predictive Intelligence · Voice Extras
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Flag, RefreshCw, Shield, Brain, Radio, Mic, Users,
  AlertTriangle, CheckCircle, ChevronRight,
} from 'lucide-react'
import { Card }   from '../../components/ui/Card'
import { Badge }  from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal }  from '../../components/ui/Modal'
import type { FeatureFlag } from '../../types/superadmin'
import { getFeatureFlags, updateFeatureFlag } from '../../services/superadmin.service'
import { useAuth } from '../../hooks/useAuth'

// ── Flag görsel haritası ──────────────────────────────────────────────────────

const FLAG_ICON: Record<string, React.ReactNode> = {
  crm:                     <Users     size={16} />,
  hazard_intelligence:     <Radio     size={16} />,
  safety_copilot:          <Shield    size={16} />,
  predictive_intelligence: <Brain     size={16} />,
  voice_extras:            <Mic       size={16} />,
}

const FLAG_COLOR: Record<string, string> = {
  crm:                     '#60a5fa',
  hazard_intelligence:     '#f97316',
  safety_copilot:          '#4ade80',
  predictive_intelligence: '#a78bfa',
  voice_extras:            '#f472b6',
}

function _flagColor(key: string): string {
  return FLAG_COLOR[key] ?? '#94a3b8'
}

function _flagIcon(key: string): React.ReactNode {
  return FLAG_ICON[key] ?? <Flag size={16} />
}

// ── Onay modalı durumu ────────────────────────────────────────────────────────

interface PendingChange {
  flag:       FeatureFlag
  newEnabled: boolean
}

// ── FeatureFlags ──────────────────────────────────────────────────────────────

export function FeatureFlags() {
  const { user }                        = useAuth()
  const [flags,   setFlags]             = useState<FeatureFlag[]>([])
  const [loading, setLoading]           = useState(true)
  const [saving,  setSaving]            = useState<string | null>(null)  // key of flag being saved
  const [pending, setPending]           = useState<PendingChange | null>(null)
  const [step,    setStep]              = useState<'preview' | 'confirm'>('preview')
  const [error,   setError]             = useState<string | null>(null)
  const [success, setSuccess]           = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setFlags(await getFeatureFlags())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Toast otomatik temizle
  useEffect(() => {
    if (!success && !error) return
    const id = setTimeout(() => { setSuccess(null); setError(null) }, 4_000)
    return () => clearTimeout(id)
  }, [success, error])

  function handleToggleClick(flag: FeatureFlag): void {
    setPending({ flag, newEnabled: !flag.enabled })
    setStep('preview')
    setError(null)
  }

  async function handleConfirm(): Promise<void> {
    if (!pending || !user) return
    setSaving(pending.flag.key)
    try {
      await updateFeatureFlag(
        pending.flag.key,
        { enabled: pending.newEnabled, rollout_percent: pending.flag.rollout_percent },
        user.id,
      )
      setFlags((prev) =>
        prev.map((f) => f.key === pending.flag.key
          ? { ...f, enabled: pending.newEnabled, updated_at: new Date().toISOString() }
          : f,
        ),
      )
      setSuccess(`"${pending.flag.name}" ${pending.newEnabled ? 'etkinleştirildi' : 'devre dışı bırakıldı'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bilinmeyen hata')
    } finally {
      setSaving(null)
      setPending(null)
    }
  }

  const activeCount   = flags.filter((f) => f.enabled).length
  const totalCount    = flags.length

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Başlık */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e2e8f0' }}>
            Feature Flag Yönetimi
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            {activeCount} / {totalCount} flag aktif · Her değişiklik audit log'a kaydedilir.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => { void load() }}
          className="shrink-0"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Yenile
        </Button>
      </div>

      {/* Toast bildirimleri */}
      {(success || error) && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={success
            ? { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }
            : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }
          }
        >
          {success ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
          {success ?? error}
        </div>
      )}

      {/* Flag listesi */}
      <Card>
        {loading ? (
          <ul className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
            ))}
          </ul>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {flags.map((flag) => {
              const color   = _flagColor(flag.key)
              const isSaving = saving === flag.key
              return (
                <li key={flag.key} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                  {/* İkon */}
                  <div
                    className="flex items-center justify-center rounded-lg shrink-0"
                    style={{
                      width:      36,
                      height:     36,
                      background: `${color}12`,
                      border:     `1px solid ${color}25`,
                      color,
                    }}
                  >
                    {_flagIcon(flag.key)}
                  </div>

                  {/* Bilgi */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium" style={{ color: '#e2e8f0' }}>
                        {flag.name}
                      </p>
                      <Badge variant={flag.enabled ? 'success' : 'muted'}>
                        {flag.enabled ? 'Aktif' : 'Kapalı'}
                      </Badge>
                      {flag.target_scope !== 'all' && (
                        <Badge variant="warning">{flag.target_scope}</Badge>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: '#64748b' }}>
                      {flag.description}
                    </p>
                    {flag.rollout_percent < 100 && flag.enabled && (
                      <p className="text-[11px] mt-0.5" style={{ color: '#475569' }}>
                        Kapsam: %{flag.rollout_percent}
                      </p>
                    )}
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleClick(flag)}
                    disabled={isSaving}
                    className="relative shrink-0 transition-opacity"
                    style={{ opacity: isSaving ? 0.5 : 1 }}
                    aria-label={flag.enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
                  >
                    <div
                      style={{
                        width:        44,
                        height:       24,
                        borderRadius: 12,
                        background:   flag.enabled ? color : 'rgba(255,255,255,0.12)',
                        transition:   'background 0.2s',
                        position:     'relative',
                      }}
                    >
                      <div
                        style={{
                          position:     'absolute',
                          top:          3,
                          left:         flag.enabled ? 23 : 3,
                          width:        18,
                          height:       18,
                          borderRadius: '50%',
                          background:   '#fff',
                          transition:   'left 0.2s',
                        }}
                      />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Destructive Action Protection — 2 adım onay modalı */}
      <ConfirmModal
        pending={pending}
        step={step}
        onNext={() => setStep('confirm')}
        onConfirm={() => { void handleConfirm() }}
        onClose={() => { setPending(null) }}
      />
    </div>
  )
}

// ── Onay Modalı ───────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  pending:   PendingChange | null
  step:      'preview' | 'confirm'
  onNext:    () => void
  onConfirm: () => void
  onClose:   () => void
}

function ConfirmModal({ pending, step, onNext, onConfirm, onClose }: ConfirmModalProps) {
  if (!pending) return null

  const { flag, newEnabled } = pending
  const color  = _flagColor(flag.key)
  const isDisabling = !newEnabled

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'preview' ? 'Değişiklik Önizleme' : 'Değişikliği Onayla'}
      size="sm"
      footer={
        step === 'preview' ? (
          <>
            <Button variant="outline" size="sm" onClick={onClose}>İptal</Button>
            <Button size="sm" onClick={onNext}>
              Devam Et
              <ChevronRight size={14} />
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onClose}>İptal</Button>
            <Button
              variant={isDisabling ? 'danger' : 'primary'}
              size="sm"
              onClick={onConfirm}
            >
              {isDisabling ? 'Devre Dışı Bırak' : 'Etkinleştir'}
            </Button>
          </>
        )
      }
    >
      {step === 'preview' ? (
        <div className="space-y-4">
          {/* Flag bilgisi */}
          <div
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{ background: `${color}08`, border: `1px solid ${color}15` }}
          >
            <div style={{ color }}>{_flagIcon(flag.key)}</div>
            <div>
              <p className="text-sm font-medium" style={{ color: '#e2e8f0' }}>{flag.name}</p>
              <p className="text-[11px]" style={{ color: '#64748b' }}>{flag.description}</p>
            </div>
          </div>

          {/* Before / After */}
          <div className="grid grid-cols-2 gap-3">
            <_StateBox label="Mevcut Durum" enabled={flag.enabled} />
            <_StateBox label="Yeni Durum"   enabled={newEnabled} highlight />
          </div>

          <p className="text-xs" style={{ color: '#475569' }}>
            Bu değişiklik tüm araç filonuza uygulanacak.
            Devam etmek için "Devam Et" tuşuna basın.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {isDisabling && (
            <div
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
            >
              <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
              <p className="text-xs" style={{ color: '#fca5a5' }}>
                <strong>Dikkat:</strong> Bu özelliği devre dışı bırakmak anlık olarak
                tüm araçlarda etkili olacak. Audit log'a kaydedilecek.
              </p>
            </div>
          )}

          <p className="text-sm" style={{ color: '#94a3b8' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{flag.name}</span> özelliğini{' '}
            <span style={{ color: newEnabled ? '#4ade80' : '#f87171', fontWeight: 600 }}>
              {newEnabled ? 'etkinleştirmek' : 'devre dışı bırakmak'}
            </span>{' '}
            istediğinize emin misiniz?
          </p>
        </div>
      )}
    </Modal>
  )
}

function _StateBox({ label, enabled, highlight }: { label: string; enabled: boolean; highlight?: boolean }) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 p-3 rounded-xl"
      style={{
        background: highlight
          ? enabled ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'
          : 'rgba(255,255,255,0.04)',
        border: highlight
          ? enabled ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(239,68,68,0.2)'
          : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>
        {label}
      </p>
      <p
        className="text-sm font-bold"
        style={{ color: enabled ? '#4ade80' : '#f87171' }}
      >
        {enabled ? 'Aktif' : 'Kapalı'}
      </p>
    </div>
  )
}
