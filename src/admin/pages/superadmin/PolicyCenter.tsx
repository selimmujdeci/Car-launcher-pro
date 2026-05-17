/**
 * PolicyCenter — Runtime Politika Yönetimi
 *
 * Termal eşikler, senkronizasyon aralıkları ve watchdog politikalarını
 * düzenleyen form arayüzü.
 *
 * Destructive Action Protection:
 *   Kaydet → Preview (Before/After tablo) → Confirm modal → Supabase upsert
 *
 * Bölümler:
 *   🌡 Termal Eşikler   — L1/L2/L3 sıcaklıklar, recovery hysteresis
 *   🔄 Sync Aralıkları  — OBD heartbeat, GPS güncelleme, telemetri
 *   👁 Watchdog         — Servis deadline'ları, max restart limiti
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Thermometer, RefreshCw, Clock, Eye, AlertTriangle,
  CheckCircle, ChevronRight, Save,
} from 'lucide-react'
import { Card }   from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal }  from '../../components/ui/Modal'
import type { RuntimePolicy, RuntimePolicyCategory } from '../../types/superadmin'
import { getRuntimePolicies, updateRuntimePolicy } from '../../services/superadmin.service'
import { useAuth } from '../../hooks/useAuth'

// ── Kategori meta ─────────────────────────────────────────────────────────────

const CATEGORY_META: Record<RuntimePolicyCategory, { label: string; icon: React.ReactNode; color: string }> = {
  thermal:  { label: 'Termal Eşikler',    icon: <Thermometer size={15} />, color: '#f97316' },
  sync:     { label: 'Sync Aralıkları',   icon: <RefreshCw   size={15} />, color: '#60a5fa' },
  watchdog: { label: 'Watchdog Politikası', icon: <Eye         size={15} />, color: '#a78bfa' },
}

// ── Bekleyen değişiklik tipi ──────────────────────────────────────────────────

interface DraftChange {
  policy:   RuntimePolicy
  newValue: number
}

// ── PolicyCenter ──────────────────────────────────────────────────────────────

export function PolicyCenter() {
  const { user }                              = useAuth()
  const [policies,  setPolicies]              = useState<RuntimePolicy[]>([])
  const [loading,   setLoading]               = useState(true)
  const [drafts,    setDrafts]                = useState<Record<string, number>>({})
  const [pendingChanges, setPendingChanges]   = useState<DraftChange[]>([])
  const [previewOpen,    setPreviewOpen]      = useState(false)
  const [confirmOpen,    setConfirmOpen]      = useState(false)
  const [saving,         setSaving]           = useState(false)
  const [toast,          setToast]            = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRuntimePolicies()
      setPolicies(data)
      // Draft'ı mevcut değerlerle başlat
      const initial: Record<string, number> = {}
      data.forEach((p) => { initial[p.key] = p.value })
      setDrafts(initial)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4_000)
    return () => clearTimeout(id)
  }, [toast])

  function handleValueChange(key: string, raw: string): void {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setDrafts((prev) => ({ ...prev, [key]: n }))
  }

  function handleSaveClick(): void {
    // Hangi politikaların değeri değişti?
    const changes: DraftChange[] = policies
      .filter((p) => drafts[p.key] !== undefined && drafts[p.key] !== p.value)
      .map((p) => ({ policy: p, newValue: drafts[p.key] }))

    if (changes.length === 0) {
      setToast({ type: 'ok', msg: 'Değişiklik yok — her şey zaten güncel.' })
      return
    }

    // Değer aralığı kontrolü
    const invalid = changes.find(
      (c) => c.newValue < c.policy.min || c.newValue > c.policy.max,
    )
    if (invalid) {
      setToast({
        type: 'err',
        msg: `"${invalid.policy.name}" değeri [${invalid.policy.min}–${invalid.policy.max}] aralığının dışında.`,
      })
      return
    }

    setPendingChanges(changes)
    setPreviewOpen(true)
  }

  async function handleConfirm(): Promise<void> {
    if (!user) return
    setSaving(true)
    try {
      await Promise.all(
        pendingChanges.map((c) => updateRuntimePolicy(c.policy.key, c.newValue, user.id)),
      )
      // Local state'i güncelle
      setPolicies((prev) =>
        prev.map((p) => {
          const change = pendingChanges.find((c) => c.policy.key === p.key)
          return change
            ? { ...p, value: change.newValue, updated_at: new Date().toISOString(), updated_by: user.id }
            : p
        }),
      )
      setToast({ type: 'ok', msg: `${pendingChanges.length} politika güncellendi.` })
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : 'Kayıt hatası' })
    } finally {
      setSaving(false)
      setConfirmOpen(false)
      setPreviewOpen(false)
      setPendingChanges([])
    }
  }

  const categories: RuntimePolicyCategory[] = ['thermal', 'sync', 'watchdog']
  const hasChanges = policies.some((p) => drafts[p.key] !== undefined && drafts[p.key] !== p.value)

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Başlık */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e2e8f0' }}>
            Runtime Politika Merkezi
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            Termal eşikler, senkronizasyon aralıkları ve watchdog limitleri.
            Her değişiklik audit log'a kaydedilir.
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

      {/* Toast */}
      {toast && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={toast.type === 'ok'
            ? { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }
            : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }
          }
        >
          {toast.type === 'ok'
            ? <CheckCircle size={15} />
            : <AlertTriangle size={15} />
          }
          {toast.msg}
        </div>
      )}

      {/* Kategori bölümleri */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </div>
      ) : (
        categories.map((cat) => {
          const meta    = CATEGORY_META[cat]
          const catPolices = policies.filter((p) => p.category === cat)
          if (catPolices.length === 0) return null
          return (
            <Card key={cat}>
              {/* Bölüm başlığı */}
              <div className="flex items-center gap-2 mb-4">
                <span style={{ color: meta.color }}>{meta.icon}</span>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
                  {meta.label}
                </p>
              </div>

              {/* Policy satırları */}
              <div className="space-y-3">
                {catPolices.map((policy) => {
                  const draft     = drafts[policy.key] ?? policy.value
                  const isDirty   = draft !== policy.value
                  const isInvalid = draft < policy.min || draft > policy.max
                  return (
                    <div key={policy.key} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium" style={{ color: '#e2e8f0' }}>
                          {policy.name}
                        </p>
                        <p className="text-[11px]" style={{ color: '#475569' }}>
                          {policy.description}
                        </p>
                      </div>
                      {/* Input */}
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number"
                          value={draft}
                          min={policy.min}
                          max={policy.max}
                          step={policy.unit === 'ms' ? 500 : policy.unit === '°C' ? 1 : 1}
                          onChange={(e) => handleValueChange(policy.key, e.target.value)}
                          className="text-right tabular-nums"
                          style={{
                            width:        80,
                            padding:      '4px 8px',
                            borderRadius: 8,
                            border:       `1px solid ${isInvalid ? 'rgba(239,68,68,0.4)' : isDirty ? `${meta.color}40` : 'rgba(255,255,255,0.1)'}`,
                            background:   isDirty ? `${meta.color}08` : 'rgba(255,255,255,0.04)',
                            color:        isInvalid ? '#f87171' : isDirty ? meta.color : '#e2e8f0',
                            fontSize:     13,
                            outline:      'none',
                          }}
                        />
                        <span className="text-[11px] w-8" style={{ color: '#475569' }}>
                          {policy.unit}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Range göstergesi */}
              <div className="mt-3 pt-3 flex items-center gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[10px]" style={{ color: '#334155' }}>
                  Her satır için izin verilen aralık: değerin üzerine gelin veya input'a tıklayın.
                </p>
              </div>
            </Card>
          )
        })
      )}

      {/* Global kaydet butonu */}
      {!loading && (
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasChanges}
            onClick={() => {
              // Draft'ı sıfırla
              const reset: Record<string, number> = {}
              policies.forEach((p) => { reset[p.key] = p.value })
              setDrafts(reset)
            }}
          >
            Geri Al
          </Button>
          <Button
            size="sm"
            disabled={!hasChanges}
            onClick={handleSaveClick}
          >
            <Save size={14} />
            Değişiklikleri Kaydet
          </Button>
        </div>
      )}

      {/* Preview Modal */}
      <PreviewModal
        open={previewOpen}
        changes={pendingChanges}
        onNext={() => { setPreviewOpen(false); setConfirmOpen(true) }}
        onClose={() => { setPreviewOpen(false); setPendingChanges([]) }}
      />

      {/* Confirm Modal */}
      <ConfirmModal
        open={confirmOpen}
        changes={pendingChanges}
        saving={saving}
        onConfirm={() => { void handleConfirm() }}
        onClose={() => { setConfirmOpen(false); setPendingChanges([]) }}
      />
    </div>
  )
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

function PreviewModal({
  open, changes, onNext, onClose,
}: {
  open:    boolean
  changes: DraftChange[]
  onNext:  () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Değişiklik Önizleme"
      size="md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={onNext}>
            Onayla
            <ChevronRight size={14} />
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs" style={{ color: '#64748b' }}>
          Aşağıdaki {changes.length} politika değiştirilecek:
        </p>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Politika', 'Mevcut', 'Yeni'].map((h) => (
                <th key={h} className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: '#475569' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map(({ policy, newValue }) => {
              const increased = newValue > policy.value
              return (
                <tr key={policy.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td className="py-2 pr-3">
                    <p style={{ color: '#e2e8f0' }}>{policy.name}</p>
                    <p className="text-[10px]" style={{ color: '#475569' }}>{policy.key}</p>
                  </td>
                  <td className="py-2 tabular-nums" style={{ color: '#64748b' }}>
                    {policy.value} {policy.unit}
                  </td>
                  <td className="py-2 tabular-nums font-semibold" style={{ color: increased ? '#4ade80' : '#f97316' }}>
                    {newValue} {policy.unit}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <p className="text-[11px]" style={{ color: '#475569' }}>
          Bu değişiklikler buluta kaydedilecek ve remoteConfigService tarafından araçlara iletilecek.
        </p>
      </div>
    </Modal>
  )
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  open, changes, saving, onConfirm, onClose,
}: {
  open:      boolean
  changes:   DraftChange[]
  saving:    boolean
  onConfirm: () => void
  onClose:   () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Politika Güncellemeyi Onayla"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>İptal</Button>
          <Button
            variant="danger"
            size="sm"
            disabled={saving}
            onClick={onConfirm}
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Clock size={13} />}
            {saving ? 'Kaydediliyor…' : `${changes.length} Değişikliği Uygula`}
          </Button>
        </>
      }
    >
      <div
        className="flex items-start gap-3 p-3 rounded-xl"
        style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}
      >
        <AlertTriangle size={16} style={{ color: '#facc15', flexShrink: 0, marginTop: 1 }} />
        <p className="text-xs" style={{ color: '#fde68a' }}>
          Bu değişiklikler anlık olarak tüm sisteme uygulanır.
          {changes.length} politika güncellenecek ve audit log'a kaydedilecek.
        </p>
      </div>
    </Modal>
  )
}
