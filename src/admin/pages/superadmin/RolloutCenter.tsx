/**
 * RolloutCenter — Canary Dağıtım Yönetim Merkezi
 *
 * Stage Timeline görünümü:
 *   INTERNAL (1%) → PILOT (5%) → PRODUCTION (100%)
 *
 * Circuit Breaker: versiyon stability < 60 ise ilerleme engellenir.
 *
 * Tablo ön koşulu:
 *   Supabase SQL Editor'da rollout_plans tablosunu oluştur
 *   (bkz. superadmin.service.ts getRolloutPlans JSDoc).
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Plus, RefreshCw, AlertTriangle, CheckCircle,
  ChevronRight, PlayCircle, PauseCircle, XCircle,
  Zap,
} from 'lucide-react'
import {
  getRolloutPlans,
  createRolloutPlan,
  updateRolloutStage,
  getRolloutHealth,
  type RolloutHealthStats,
  type CreateRolloutDTO,
} from '../../services/superadmin.service'
import type { RolloutPlan, RolloutStage, RolloutStageStatus } from '../../types/superadmin'
import { Button }   from '../../components/ui/Button'
import { useAuth }  from '../../hooks/useAuth'
import '../../styles/admin-enterprise.css'

// ── Durum renk haritası ───────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:          '#4b5563',
  pending_review: '#d97706',
  approved:       '#60a5fa',
  rolling:        '#3b82f6',
  paused:         '#d97706',
  complete:       '#4ade80',
  reverted:       '#dc2626',
}

const STAGE_COLOR: Record<string, string> = {
  pending:  '#2d3748',
  active:   '#3b82f6',
  complete: '#4ade80',
  failed:   '#dc2626',
}

const TARGET_LABEL: Record<string, string> = {
  internal:   'DAHİLİ',
  pilot:      'PİLOT',
  beta:       'BETA',
  production: 'ÜRETİM',
}

const PLAN_STATUS_LABEL: Record<string, string> = {
  draft:          'TASLAK',
  pending_review: 'ONAY BEKLİYOR',
  approved:       'ONAYLANDI',
  rolling:        'DAĞITILIYOR',
  paused:         'DURAKLATILDI',
  complete:       'TAMAMLANDI',
  reverted:       'GERİ ALINDI',
}

const STAGE_STATUS_LABEL: Record<string, string> = {
  pending:  'BEKLİYOR',
  active:   'AKTİF',
  complete: 'TAMAMLANDI',
  failed:   'BAŞARISIZ',
}

// ── RolloutCenter ─────────────────────────────────────────────────────────────

export function RolloutCenter() {
  const { user }                         = useAuth()
  const [plans,    setPlans]             = useState<RolloutPlan[]>([])
  const [health,   setHealth]            = useState<Record<string, RolloutHealthStats>>({})
  const [loading,  setLoading]           = useState(true)
  const [showForm, setShowForm]          = useState(false)
  const [toast,    setToast]             = useState<{ type: 'ok'|'err'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRolloutPlans()
      setPlans(data)
      // Aktif planların sağlık raporunu çek
      const active = data.filter((p) => p.status === 'rolling' || p.status === 'approved')
      const healthMap: Record<string, RolloutHealthStats> = {}
      await Promise.all(
        active.map(async (p) => {
          healthMap[p.version] = await getRolloutHealth(p.version)
        }),
      )
      setHealth(healthMap)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(id)
  }, [load])

  // Toast otomatik temizle
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5_000)
    return () => clearTimeout(id)
  }, [toast])

  async function handleStageAction(
    plan: RolloutPlan,
    stageIdx: number,
    status: RolloutStageStatus,
  ) {
    if (!user) return
    try {
      await updateRolloutStage(plan.id, stageIdx, status, user.id)
      setToast({ type: 'ok', msg: `Aşama ${stageIdx + 1} → ${STAGE_STATUS_LABEL[status] ?? status.toUpperCase()}` })
      await load()
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : 'İşlem başarısız' })
    }
  }

  async function handleCreate(dto: CreateRolloutDTO) {
    if (!user) return
    try {
      await createRolloutPlan(dto, user.id)
      setShowForm(false)
      setToast({ type: 'ok', msg: `v${dto.version} rollout planı oluşturuldu.` })
      await load()
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : 'Oluşturma başarısız' })
    }
  }

  const activeCount = plans.filter((p) => p.status === 'rolling').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 1100 }}>

      {/* New Rollout Modal */}
      {showForm && (
        <NewRolloutModal
          onSubmit={(dto) => { void handleCreate(dto) }}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <div>
          <p className="sa-label">DAĞITIM MERKEZİ</p>
          <p style={{ fontSize: 10, color: '#2d3748', fontFamily: 'var(--sa-font-ui)', marginTop: 2 }}>
            {activeCount > 0
              ? `${activeCount} aktif dağıtım · canary hattı`
              : 'Aktif dağıtım yok'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => { void load() }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Yenile
          </Button>
          <button
            onClick={() => setShowForm(true)}
            style={{
              display:       'flex',
              alignItems:    'center',
              gap:            6,
              padding:       '5px 12px',
              background:    'rgba(59,130,246,0.08)',
              border:        '1px solid rgba(59,130,246,0.3)',
              borderRadius:   2,
              cursor:        'pointer',
              fontFamily:    'var(--sa-font-mono)',
              fontSize:       9,
              fontWeight:     700,
              color:         '#60a5fa',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <Plus size={11} />
            Yeni Dağıtım
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            padding:      '8px 14px',
            borderRadius:  2,
            display:      'flex',
            alignItems:   'center',
            gap:           8,
            fontFamily:   'var(--sa-font-ui)',
            fontSize:      11,
            marginBottom:  8,
            background:   toast.type === 'ok' ? 'rgba(74,222,128,0.06)' : 'rgba(220,38,38,0.06)',
            border:       `1px solid ${toast.type === 'ok' ? 'rgba(74,222,128,0.2)' : 'rgba(220,38,38,0.2)'}`,
            color:        toast.type === 'ok' ? '#4ade80' : '#f87171',
          }}
        >
          {toast.type === 'ok' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {toast.msg}
        </div>
      )}

      {/* Circuit Breaker warnings */}
      {Object.values(health).filter((h) => h.circuitBreaker).map((h) => (
        <div
          key={h.version}
          style={{
            padding:      '10px 14px',
            borderRadius:  2,
            background:   'rgba(220,38,38,0.06)',
            border:       '1px solid #dc2626',
            display:      'flex',
            alignItems:   'center',
            gap:           10,
            marginBottom:  4,
          }}
        >
          <AlertTriangle size={13} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div>
            <p
              style={{
                fontFamily:    'var(--sa-font-mono)',
                fontSize:       10,
                fontWeight:     700,
                color:         '#dc2626',
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
              }}
            >
              DEVRE KESİCİ — v{h.version}
            </p>
            <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 10, color: '#4b5563', marginTop: 2 }}>
              Kararlılık puanı {h.stabilityScore.toFixed(0)}/100 ({h.criticalEvents} kritik olay) —
              otomatik ilerleme engellendi.
            </p>
          </div>
        </div>
      ))}

      {/* Plan list */}
      {loading && plans.length === 0 ? (
        <RolloutSkeleton />
      ) : plans.length === 0 ? (
        <div className="sa-empty" style={{ border: '1px solid #1a1a1a', borderRadius: 2 }}>
          <Zap size={18} style={{ opacity: 0.3, color: '#4b5563' }} />
          PLAN_YOK: Dağıtım planı bulunamadı.
          <span style={{ fontSize: 9, color: '#1a1a1a' }}>
            Önce Supabase'de rollout_plans tablosunu oluştur.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              health={health[plan.version]}
              onStageAction={(idx, status) => { void handleStageAction(plan, idx, status) }}
            />
          ))}
        </div>
      )}

      {/* SQL note */}
      <p
        style={{
          marginTop:  8,
          fontSize:    9,
          color:      '#1a1a1a',
          fontFamily: 'var(--sa-font-mono)',
          letterSpacing: '0.04em',
        }}
      >
        ⚠ rollout_plans tablosu yoksa: Supabase SQL Editor → superadmin.service.ts getRolloutPlans JSDoc SQL
      </p>
    </div>
  )
}

// ── Plan Card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan, health, onStageAction,
}: {
  plan:          RolloutPlan
  health?:       RolloutHealthStats
  onStageAction: (stageIdx: number, status: RolloutStageStatus) => void
}) {
  const [expanded, setExpanded] = useState(plan.status === 'rolling')
  const statusColor = STATUS_COLOR[plan.status] ?? '#4b5563'
  const isRolling   = plan.status === 'rolling'
  const cb          = health?.circuitBreaker ?? false

  const progress = (() => {
    const done = plan.stages.filter((s) => s.status === 'complete').length
    return Math.round((done / plan.stages.length) * 100)
  })()

  return (
    <div
      style={{
        background:    '#0d0d0d',
        border:        `1px solid ${isRolling ? (cb ? '#dc2626' : 'rgba(59,130,246,0.3)') : '#1a1a1a'}`,
        borderRadius:   2,
        overflow:      'hidden',
      }}
      className={isRolling && !cb ? 'sa-status-rolling' : undefined}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-3"
        style={{
          padding:  '10px 14px',
          cursor:   'pointer',
          borderBottom: expanded ? '1px solid #1a1a1a' : 'none',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Version */}
        <span
          className="sa-mono"
          style={{ fontSize: 13, fontWeight: 700, color: '#e5e7eb', flexShrink: 0 }}
        >
          v{plan.version}
        </span>

        {/* Status chip */}
        <StatusChip status={plan.status} />

        {/* Progress */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              flex:        1,
              height:       2,
              background:  '#1a1a1a',
              borderRadius: 1,
              overflow:    'hidden',
            }}
          >
            <div
              style={{
                height:     '100%',
                width:      `${progress}%`,
                background: statusColor,
                transition: 'width 400ms ease',
              }}
            />
          </div>
          <span
            className="sa-mono"
            style={{ fontSize: 9, color: '#2d3748', flexShrink: 0 }}
          >
            {progress}%
          </span>
        </div>

        {/* Health score */}
        {health && (
          <span
            className="sa-mono"
            style={{
              fontSize:   10,
              fontWeight:  700,
              color:      cb ? '#dc2626' : '#4ade80',
              flexShrink:  0,
            }}
          >
            {cb && <AlertTriangle size={9} style={{ display: 'inline', marginRight: 3 }} />}
            S:{health.stabilityScore.toFixed(0)}
          </span>
        )}

        {/* Rollback info */}
        {plan.rollback_to && (
          <span style={{ fontSize: 9, color: '#2d3748', fontFamily: 'var(--sa-font-mono)', flexShrink: 0 }}>
            ↩ v{plan.rollback_to}
          </span>
        )}

        <ChevronRight
          size={12}
          style={{
            color:      '#2d3748',
            transform:  expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 150ms ease',
            flexShrink:  0,
          }}
        />
      </div>

      {/* Stage Pipeline */}
      {expanded && (
        <div style={{ padding: '12px 14px' }}>
          {plan.description && (
            <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 10, color: '#4b5563', marginBottom: 12 }}>
              {plan.description}
            </p>
          )}
          <StagePipeline
            stages={plan.stages}
            circuitBreaker={cb}
            onAction={onStageAction}
          />
        </div>
      )}
    </div>
  )
}

// ── Status Chip ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? '#4b5563'
  return (
    <div
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:            4,
        padding:       '2px 6px',
        background:    `${color}12`,
        border:        `1px solid ${color}30`,
        borderRadius:   2,
        flexShrink:     0,
      }}
    >
      <span
        className="sa-dot"
        style={{ background: color, width: 4, height: 4, animationPlayState: status === 'rolling' ? 'running' : 'paused' }}
      />
      <span
        style={{
          fontFamily:    'var(--sa-font-mono)',
          fontSize:       8,
          fontWeight:     700,
          color,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}
      >
        {PLAN_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
      </span>
    </div>
  )
}

// ── Stage Pipeline ────────────────────────────────────────────────────────────

function StagePipeline({
  stages, circuitBreaker, onAction,
}: {
  stages:         RolloutStage[]
  circuitBreaker: boolean
  onAction:       (stageIdx: number, status: RolloutStageStatus) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
      {stages.map((stage, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <StageCard
            stage={stage}
            idx={i}
            circuitBreaker={circuitBreaker && stage.status === 'pending'}
            onAction={onAction}
          />
          {i < stages.length - 1 && (
            <div className="sa-stage-connector" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Stage Card ────────────────────────────────────────────────────────────────

function StageCard({
  stage, idx, circuitBreaker, onAction,
}: {
  stage:          RolloutStage
  idx:            number
  circuitBreaker: boolean
  onAction:       (stageIdx: number, status: RolloutStageStatus) => void
}) {
  const color = STAGE_COLOR[stage.status] ?? '#4b5563'

  return (
    <div
      style={{
        flex:         1,
        background:   '#0a0a0a',
        border:       `1px solid ${stage.status === 'active' ? 'rgba(59,130,246,0.3)' : '#1a1a1a'}`,
        borderRadius:  2,
        padding:      '10px 10px',
        minWidth:      0,
      }}
    >
      {/* Stage header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span
          style={{
            fontFamily:    'var(--sa-font-ui)',
            fontSize:       8,
            fontWeight:     700,
            color:         '#4b5563',
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
          }}
        >
          AŞAMA {idx + 1}
        </span>
        <StageIcon status={stage.status} />
      </div>

      {/* Target + percent */}
      <p
        className="sa-mono"
        style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 2 }}
      >
        {TARGET_LABEL[stage.target] ?? stage.target}
      </p>
      <p
        className="sa-mono"
        style={{ fontSize: 10, color: '#4b5563' }}
      >
        {stage.percent}% · maks hata {stage.error_threshold_pct}%
      </p>

      {/* Timestamp */}
      {stage.started_at && (
        <p style={{ fontFamily: 'var(--sa-font-mono)', fontSize: 8, color: '#2d3748', marginTop: 4 }}>
          başladı {new Date(stage.started_at).toLocaleTimeString('tr-TR', { hour12: false })}
        </p>
      )}

      {/* Actions */}
      {circuitBreaker && (
        <p style={{ fontFamily: 'var(--sa-font-ui)', fontSize: 8, color: '#dc2626', marginTop: 6, fontWeight: 700 }}>
          ENGELLENDİ
        </p>
      )}
      {!circuitBreaker && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {stage.status === 'pending' && (
            <ActionBtn
              color="#60a5fa"
              icon={<PlayCircle size={10} />}
              label="BAŞLAT"
              onClick={() => onAction(idx, 'active')}
            />
          )}
          {stage.status === 'active' && (
            <>
              <ActionBtn
                color="#4ade80"
                icon={<CheckCircle size={10} />}
                label="TAMAM"
                onClick={() => onAction(idx, 'complete')}
              />
              <ActionBtn
                color="#d97706"
                icon={<PauseCircle size={10} />}
                label="DURAKLAT"
                onClick={() => onAction(idx, 'failed')}
              />
            </>
          )}
          {stage.status === 'complete' && (
            <span style={{ fontFamily: 'var(--sa-font-mono)', fontSize: 8, color: '#4ade80' }}>
              TAMAMLANDI ✓
            </span>
          )}
          {stage.status === 'failed' && (
            <ActionBtn
              color="#f87171"
              icon={<XCircle size={10} />}
              label="YENİDEN DENE"
              onClick={() => onAction(idx, 'active')}
            />
          )}
        </div>
      )}
    </div>
  )
}

function StageIcon({ status }: { status: string }) {
  const color = STAGE_COLOR[status] ?? '#4b5563'
  if (status === 'complete') return <CheckCircle size={12} style={{ color }} />
  if (status === 'active')   return <PlayCircle  size={12} style={{ color }} />
  if (status === 'failed')   return <XCircle     size={12} style={{ color }} />
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2d3748' }} />
}

function ActionBtn({
  color, icon, label, onClick,
}: {
  color: string; icon: React.ReactNode; label: string; onClick: () => void
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{
        display:       'flex',
        alignItems:    'center',
        gap:            3,
        padding:       '3px 6px',
        background:    `${color}10`,
        border:        `1px solid ${color}30`,
        borderRadius:   2,
        cursor:        'pointer',
        color,
        fontFamily:    'var(--sa-font-mono)',
        fontSize:       8,
        fontWeight:     700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        transition:    'border-color 150ms ease',
      }}
    >
      {icon}{label}
    </button>
  )
}

// ── New Rollout Modal ─────────────────────────────────────────────────────────

function NewRolloutModal({
  onSubmit, onClose,
}: {
  onSubmit: (dto: CreateRolloutDTO) => void
  onClose:  () => void
}) {
  const [version,     setVersion]     = useState('')
  const [description, setDescription] = useState('')
  const [rollbackTo,  setRollbackTo]  = useState('')

  function handleSubmit() {
    if (!version.trim()) return
    onSubmit({
      version:     version.trim(),
      description: description.trim(),
      rollback_to: rollbackTo.trim() || null,
    })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: '100%', maxWidth: 420,
          background: '#0a0a0a',
          border: '1px solid #1a1a1a',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '10px 16px', borderBottom: '1px solid #1a1a1a',
            background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--sa-font-mono)', fontSize: 10, fontWeight: 700,
              color: '#60a5fa', letterSpacing: '0.12em', textTransform: 'uppercase',
            }}
          >
            YENİ DAĞITIM PLANI
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#374151', fontFamily: 'var(--sa-font-mono)', fontSize: 9,
              letterSpacing: '0.08em',
            }}
          >
            İPTAL
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="SÜRÜM *" placeholder="2.5.0" value={version} onChange={setVersion} />
          <FormField label="AÇIKLAMA" placeholder="Sürüm notları..." value={description} onChange={setDescription} />
          <FormField label="GERİ DÖNÜŞ SÜRÜMÜ" placeholder="2.4.1 (önceki kararlı)" value={rollbackTo} onChange={setRollbackTo} />

          {/* Default stages preview */}
          <div>
            <p className="sa-label" style={{ marginBottom: 8 }}>VARSAYILAN AŞAMALAR</p>
            <div style={{ display: 'flex', gap: 1 }}>
              {[
                { label: 'DAHİLİ', pct: '1%' },
                { label: 'PİLOT',  pct: '5%' },
                { label: 'ÜRETİM', pct: '100%' },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1, padding: '6px 8px',
                    background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 2,
                  }}
                >
                  <p className="sa-label">{s.label}</p>
                  <p className="sa-mono" style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginTop: 3 }}>
                    {s.pct}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '10px 16px', borderTop: '1px solid #1a1a1a',
          }}
        >
          <button
            onClick={handleSubmit}
            disabled={!version.trim()}
            style={{
              padding: '5px 14px',
              background: version.trim() ? 'rgba(59,130,246,0.1)' : 'transparent',
              border: `1px solid ${version.trim() ? 'rgba(59,130,246,0.4)' : '#1a1a1a'}`,
              borderRadius: 2, cursor: version.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--sa-font-mono)', fontSize: 9, fontWeight: 700,
              color: version.trim() ? '#60a5fa' : '#2d3748',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: version.trim() ? 1 : 0.4,
            }}
          >
            PLAN OLUŞTUR →
          </button>
        </div>
      </div>
    </div>
  )
}

function FormField({
  label, placeholder, value, onChange,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <p className="sa-label" style={{ marginBottom: 5 }}>{label}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '7px 10px',
          background: '#080808', border: '1px solid #1a1a1a',
          borderRadius: 2, color: '#e5e7eb',
          fontFamily: 'var(--sa-font-mono)', fontSize: 12,
          outline: 'none', boxSizing: 'border-box',
          transition: 'border-color 150ms ease',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#374151' }}
        onBlur={(e)  => { e.currentTarget.style.borderColor = '#1a1a1a' }}
      />
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function RolloutSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 56, borderRadius: 2, background: '#0d0d0d',
            border: '1px solid #1a1a1a', opacity: 1 - i * 0.25,
          }}
        />
      ))}
    </div>
  )
}
