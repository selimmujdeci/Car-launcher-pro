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
import { getFeatureFlags, updateFeatureFlag, activateFleetLimpMode } from '../../services/superadmin.service'
import { useAuth } from '../../hooks/useAuth'
import '../../styles/admin-enterprise.css'

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
  const [flags,      setFlags]          = useState<FeatureFlag[]>([])
  const [loading,    setLoading]        = useState(true)
  const [saving,     setSaving]         = useState<string | null>(null)
  const [pending,    setPending]        = useState<PendingChange | null>(null)
  const [step,       setStep]           = useState<'preview' | 'confirm'>('preview')
  const [error,      setError]          = useState<string | null>(null)
  const [success,    setSuccess]        = useState<string | null>(null)
  const [limpState,  setLimpState]      = useState<'idle'|'step1'|'step2'|'step3'|'executing'>('idle')
  const [limpError,  setLimpError]      = useState<string | null>(null)
  const [limpInput,  setLimpInput]      = useState('')

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

  async function handleLimpModeConfirm() {
    if (!user) return
    setLimpState('executing')
    setLimpError(null)
    try {
      await activateFleetLimpMode(user.id)
      await load()
      setSuccess('FLEET LIMP MODE ACTIVATED — All flags disabled. Vehicles will update within 10 min.')
    } catch (e) {
      setLimpError(e instanceof Error ? e.message : 'Limp Mode failed')
    } finally {
      setLimpState('idle')
      setLimpInput('')
    }
  }

  const activeCount = flags.filter((f) => f.enabled).length
  const totalCount  = flags.length

  return (
    <div className="space-y-6 max-w-3xl">

      {/* ── Emergency Operations Banner ────────────────────────────── */}
      <EmergencyBanner
        limpState={limpState}
        limpInput={limpInput}
        limpError={limpError}
        onLimpInputChange={setLimpInput}
        onOpen={() => { setLimpState('step1'); setLimpError(null); setLimpInput('') }}
        onStep1Confirm={() => setLimpState('step2')}
        onStep2Confirm={() => setLimpState('step3')}
        onStep3Confirm={() => { void handleLimpModeConfirm() }}
        onCancel={() => { setLimpState('idle'); setLimpInput(''); setLimpError(null) }}
      />

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

// ── Emergency Banner ──────────────────────────────────────────────────────────

interface EmergencyBannerProps {
  limpState:        'idle'|'step1'|'step2'|'step3'|'executing'
  limpInput:        string
  limpError:        string | null
  onLimpInputChange:(v: string) => void
  onOpen:           () => void
  onStep1Confirm:   () => void
  onStep2Confirm:   () => void
  onStep3Confirm:   () => void
  onCancel:         () => void
}

function EmergencyBanner({
  limpState, limpInput, limpError,
  onLimpInputChange, onOpen,
  onStep1Confirm, onStep2Confirm, onStep3Confirm, onCancel,
}: EmergencyBannerProps) {
  return (
    <>
      <div className="sa-emergency-banner flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={15} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div>
            <p
              style={{
                fontFamily:    'var(--sa-font-ui)',
                fontSize:       10,
                fontWeight:     700,
                color:         '#dc2626',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              EMERGENCY OPERATIONS
            </p>
            <p style={{ fontSize: 10, color: '#4b5563', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
              Fleet Limp Mode tüm feature flag'leri devre dışı bırakır.
              Araçlar 10 dakika içinde güvenli moda geçer.
            </p>
          </div>
        </div>
        <button
          onClick={onOpen}
          disabled={limpState === 'executing'}
          className="sa-emergency-btn"
          style={{
            padding:       '6px 14px',
            background:    'rgba(220,38,38,0.10)',
            border:        '1px solid #dc2626',
            borderRadius:   2,
            cursor:        limpState === 'executing' ? 'not-allowed' : 'pointer',
            fontFamily:    'var(--sa-font-mono)',
            fontSize:       9,
            fontWeight:     700,
            color:         '#dc2626',
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            opacity:       limpState === 'executing' ? 0.5 : 1,
            whiteSpace:    'nowrap',
            flexShrink:     0,
          }}
        >
          {limpState === 'executing' ? 'EXECUTING…' : 'ACTIVATE FLEET LIMP MODE'}
        </button>
      </div>

      {/* Triple Confirmation Modal */}
      <LimpModeModal
        step={limpState}
        input={limpInput}
        error={limpError}
        onInputChange={onLimpInputChange}
        onStep1Confirm={onStep1Confirm}
        onStep2Confirm={onStep2Confirm}
        onStep3Confirm={onStep3Confirm}
        onCancel={onCancel}
      />
    </>
  )
}

// ── Limp Mode Triple Confirmation Modal ───────────────────────────────────────

interface LimpModalProps {
  step:            'idle'|'step1'|'step2'|'step3'|'executing'
  input:           string
  error:           string | null
  onInputChange:   (v: string) => void
  onStep1Confirm:  () => void
  onStep2Confirm:  () => void
  onStep3Confirm:  () => void
  onCancel:        () => void
}

function LimpModeModal({
  step, input, error, onInputChange,
  onStep1Confirm, onStep2Confirm, onStep3Confirm, onCancel,
}: LimpModalProps) {
  if (step === 'idle' || step === 'executing') return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 440,
          background: '#0a0a0a',
          border: '1px solid #dc2626',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid rgba(220,38,38,0.3)',
            background: 'rgba(220,38,38,0.06)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <AlertTriangle size={13} style={{ color: '#dc2626' }} />
          <span
            style={{
              fontFamily: 'var(--sa-font-mono)', fontSize: 10, fontWeight: 700,
              color: '#dc2626', letterSpacing: '0.12em', textTransform: 'uppercase',
            }}
          >
            {step === 'step1' && 'STEP 1 OF 3 — FIRST CONFIRMATION'}
            {step === 'step2' && 'STEP 2 OF 3 — SECOND CONFIRMATION'}
            {step === 'step3' && 'STEP 3 OF 3 — FINAL AUTHORIZATION'}
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 16px' }}>
          {step === 'step1' && (
            <>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                Bu işlem <strong style={{ color: '#dc2626' }}>tüm feature flag'leri</strong> devre dışı bırakır.
                Filo genelindeki araçlar en fazla 10 dakika içinde etkilenecektir.
              </p>
              <div
                style={{
                  padding: '10px 12px', background: 'rgba(220,38,38,0.04)',
                  border: '1px solid rgba(220,38,38,0.2)', borderRadius: 2, marginBottom: 14,
                }}
              >
                <p style={{ fontFamily: 'var(--sa-font-mono)', fontSize: 10, color: '#dc2626' }}>
                  CRM · Hazard Intelligence · Safety Co-Pilot · Predictive Intelligence · Voice Extras
                </p>
              </div>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 11, color: '#4b5563' }}>
                Devam etmek istediğinizden emin misiniz?
              </p>
            </>
          )}

          {step === 'step2' && (
            <>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                <strong style={{ color: '#dc2626' }}>Geri alınamaz</strong> — Limp Mode aktif olduğunda araçlar
                yeniden bağlanana kadar bu özellikler kapalı kalır.
              </p>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 11, color: '#4b5563' }}>
                Audit Log'a <strong style={{ color: '#dc2626' }}>CRITICAL</strong> seviyeli kayıt düşülecek.
                Devam etmek istiyor musunuz?
              </p>
            </>
          )}

          {step === 'step3' && (
            <>
              <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                Son onay. Devam etmek için aşağıya <code style={{ color: '#dc2626' }}>LIMP</code> yazın.
              </p>
              <input
                type="text"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder="LIMP"
                autoFocus
                style={{
                  width: '100%', padding: '8px 10px',
                  background: '#080808', border: '1px solid #1a1a1a',
                  borderRadius: 2, color: '#e5e7eb',
                  fontFamily: 'var(--sa-font-mono)', fontSize: 13,
                  letterSpacing: '0.08em', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {error && (
                <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 10, color: '#dc2626', marginTop: 6 }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '10px 16px', borderTop: '1px solid #1a1a1a',
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '5px 12px', background: 'transparent',
              border: '1px solid #1a1a1a', borderRadius: 2,
              color: '#4b5563', cursor: 'pointer',
              fontFamily: 'var(--sa-font-mono)', fontSize: 9,
              fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}
          >
            ABORT
          </button>
          <button
            onClick={() => {
              if (step === 'step1') onStep1Confirm()
              else if (step === 'step2') onStep2Confirm()
              else if (step === 'step3') {
                if (input.trim().toUpperCase() !== 'LIMP') return
                onStep3Confirm()
              }
            }}
            disabled={step === 'step3' && input.trim().toUpperCase() !== 'LIMP'}
            style={{
              padding: '5px 14px',
              background: 'rgba(220,38,38,0.12)',
              border: '1px solid #dc2626',
              borderRadius: 2,
              color: '#dc2626', cursor: 'pointer',
              fontFamily: 'var(--sa-font-mono)', fontSize: 9,
              fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: (step === 'step3' && input.trim().toUpperCase() !== 'LIMP') ? 0.4 : 1,
            }}
          >
            {step === 'step3' ? 'EXECUTE LIMP MODE' : 'CONFIRM →'}
          </button>
        </div>
      </div>
    </div>
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
