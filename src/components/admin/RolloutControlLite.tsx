/**
 * RolloutControlLite — Mobil Dağıtım Yönetim Paneli
 *
 * Aktif Canary dağıtımlarını listeler, mobilden DURDUR/DEVAM ET işlemi yapar.
 * Double-layer confirmation: STOP → ONAYLA → execute.
 * Mali-400 uyumlu, GPS verisi yok.
 */

import { useEffect, useState } from 'react';
import { X, GitBranch, Loader2, AlertTriangle, Play, Square } from 'lucide-react';
import {
  getActiveRollouts,
  updateRolloutStatus,
  type RolloutPlan,
} from '../../platform/superadmin/superAdminService';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const BG    = '#050505';
const SURF  = '#0d0d0d';
const BORD  = '#1c1c1c';
const TEXT  = '#e5e7eb';
const MUTED = '#4b5563';
const DIM   = '#2d3748';
const RED   = '#dc2626';
const GREEN = '#4ade80';
const AMB   = '#d97706';
const BLUE  = '#60a5fa';

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('tr-TR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '--'; }
}

function scoreColor(score: number): string {
  return score >= 80 ? GREEN : score >= 60 ? AMB : RED;
}

function statusLabel(s: RolloutPlan['status']): string {
  const map: Record<RolloutPlan['status'], string> = {
    active:    'AKTİF',
    paused:    'DURDURULDU',
    completed: 'TAMAMLANDI',
    cancelled: 'İPTAL',
  };
  return map[s] ?? s.toUpperCase();
}

function statusAccent(s: RolloutPlan['status']): string {
  return s === 'active' ? GREEN : s === 'paused' ? AMB : s === 'cancelled' ? RED : MUTED;
}

// ── RolloutControlLite ────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function RolloutControlLite({ onClose }: Props) {
  const [plans,      setPlans]      = useState<RolloutPlan[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadErr,    setLoadErr]    = useState<string | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [actionErr,  setActionErr]  = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void getActiveRollouts()
      .then((data: RolloutPlan[]) => { setPlans(data); setLoading(false); })
      .catch((e: unknown) => {
        setLoadErr(e instanceof Error ? e.message : String(e) || 'Yükleme hatası');
        setLoading(false);
      });
  }, []);

  async function handleStop(planId: string) {
    setExecutingId(planId);
    setActionErr(null);
    try {
      await updateRolloutStatus(planId, 'paused');
      setPlans((prev) => prev.map((p) => p.id === planId ? { ...p, status: 'paused' } : p));
      setConfirmId(null);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'İşlem başarısız');
    } finally {
      setExecutingId(null);
    }
  }

  async function handleResume(planId: string) {
    setExecutingId(planId);
    setActionErr(null);
    try {
      await updateRolloutStatus(planId, 'active');
      setPlans((prev) => prev.map((p) => p.id === planId ? { ...p, status: 'active' } : p));
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'İşlem başarısız');
    } finally {
      setExecutingId(null);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: BG, display: 'flex', flexDirection: 'column',
      fontFamily: '"JetBrains Mono", monospace, system-ui',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderBottom: `0.5px solid ${BORD}`,
        background: '#060606', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: MUTED, padding: 4, flexShrink: 0,
        }}>
          <X size={16} />
        </button>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'rgba(96,165,250,0.08)', border: `0.5px solid ${BLUE}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <GitBranch size={14} style={{ color: BLUE }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
            color: BLUE, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            DAĞITIM MERKEZİ
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 8, color: DIM, letterSpacing: '0.06em', marginTop: 1 }}>
            {loading ? 'YÜKLENİYOR...' : `${plans.length} plan · ${plans.filter(p => p.status === 'active').length} aktif`}
          </p>
        </div>
        {loading && <Loader2 size={12} style={{ color: DIM, animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {actionErr && (
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: RED, letterSpacing: '0.06em' }}>
            ✗ {actionErr}
          </p>
        )}

        {loadErr ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 32 }}>
            <AlertTriangle size={18} style={{ color: DIM }} />
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: DIM, letterSpacing: '0.06em' }}>
              YÜKLEME_HATASI: {loadErr}
            </p>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <Loader2 size={18} style={{ color: MUTED, animation: 'spin 1s linear infinite' }} />
          </div>
        ) : plans.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 32 }}>
            <GitBranch size={18} style={{ color: DIM }} />
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: DIM, letterSpacing: '0.06em' }}>
              DAĞITIM_YOK: Aktif dağıtım planı yok
            </p>
          </div>
        ) : (
          plans.map((plan) => (
            <RolloutCard
              key={plan.id}
              plan={plan}
              confirming={confirmId === plan.id}
              executing={executingId === plan.id}
              onRequestStop={() => setConfirmId(plan.id)}
              onCancelStop={() => setConfirmId(null)}
              onConfirmStop={() => { void handleStop(plan.id); }}
              onResume={() => { void handleResume(plan.id); }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── RolloutCard ────────────────────────────────────────────────────────────────

function RolloutCard({
  plan, confirming, executing,
  onRequestStop, onCancelStop, onConfirmStop, onResume,
}: {
  plan:          RolloutPlan
  confirming:    boolean
  executing:     boolean
  onRequestStop: () => void
  onCancelStop:  () => void
  onConfirmStop: () => void
  onResume:      () => void
}) {
  const sc          = plan.stabilityScore;
  const sc_color    = scoreColor(sc);
  const st_color    = statusAccent(plan.status);
  const isCritical  = sc < 60;
  const isWarn      = sc < 80 && sc >= 60;
  const borderColor = isCritical ? RED : isWarn ? AMB : BORD;
  const isPaused    = plan.status === 'paused';

  return (
    <div style={{
      background: SURF,
      border: `0.5px solid ${borderColor}`,
      borderLeft: `3px solid ${sc_color}`,
      borderRadius: 4,
      overflow: 'hidden',
      animation: isCritical ? 'rollout-critical-pulse 1.8s ease-in-out infinite' : 'none',
    }}>
      {/* Kart başlığı */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {/* Version badge */}
          <span style={{
            fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: TEXT,
            letterSpacing: '0.06em',
          }}>
            v{plan.version}
          </span>

          {/* Status badge */}
          <span style={{
            fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
            color: st_color, border: `0.5px solid ${st_color}40`,
            borderRadius: 3, padding: '1px 5px', letterSpacing: '0.10em',
          }}>
            {statusLabel(plan.status)}
          </span>

          <span style={{
            fontFamily: 'monospace', fontSize: 8, color: DIM, marginLeft: 'auto',
          }}>
            {fmtDate(plan.startedAt)}
          </span>
        </div>

        {/* Progress + Stability grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {/* İlerleme */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 7, color: DIM, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                İLERLEME
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: MUTED }}>
                %{plan.progress}
              </span>
            </div>
            <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${plan.progress}%`,
                background: BLUE, borderRadius: 2,
                transition: 'width 300ms ease',
              }} />
            </div>
          </div>

          {/* Stability Score */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 7, color: DIM, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                SAĞLIK
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: sc_color }}>
                %{sc}
              </span>
            </div>
            <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${sc}%`,
                background: sc_color, borderRadius: 2,
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Aksiyon satırı */}
      {!confirming ? (
        <div style={{
          display: 'flex', gap: 1,
          padding: '6px 12px 8px',
          borderTop: `0.5px solid ${BORD}`,
        }}>
          {isPaused ? (
            <button
              onClick={onResume}
              disabled={executing}
              style={{
                flex: 1, padding: '6px 0',
                background: 'rgba(74,222,128,0.06)', border: `0.5px solid ${GREEN}40`,
                borderRadius: 3, cursor: executing ? 'not-allowed' : 'pointer',
                color: GREEN, fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.10em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                opacity: executing ? 0.5 : 1,
              }}
            >
              {executing
                ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                : <Play size={10} />}
              {executing ? 'İŞLENİYOR...' : 'DEVAM ET'}
            </button>
          ) : (
            <button
              onClick={onRequestStop}
              disabled={executing || plan.status !== 'active'}
              style={{
                flex: 1, padding: '6px 0',
                background: 'rgba(220,38,38,0.06)', border: `0.5px solid ${RED}40`,
                borderRadius: 3,
                cursor: (executing || plan.status !== 'active') ? 'not-allowed' : 'pointer',
                color: RED, fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.10em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                opacity: (executing || plan.status !== 'active') ? 0.4 : 1,
              }}
            >
              <Square size={10} />
              DAĞITIMI DURDUR
            </button>
          )}
        </div>
      ) : (
        /* Double-layer confirmation */
        <div style={{
          padding: '8px 12px',
          borderTop: `0.5px solid ${RED}40`,
          background: 'rgba(220,38,38,0.04)',
        }}>
          <p style={{
            fontFamily: 'monospace', fontSize: 9, color: RED,
            letterSpacing: '0.08em', marginBottom: 8,
          }}>
            DURDURULSUN MU? v{plan.version} — TÜM CİHAZLARI ETKİLER
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onCancelStop}
              disabled={executing}
              style={{
                flex: 1, padding: '6px 0',
                background: 'transparent', border: `0.5px solid ${BORD}`,
                borderRadius: 3, cursor: 'pointer',
                color: MUTED, fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: executing ? 0.5 : 1,
              }}
            >
              VAZGEÇ
            </button>
            <button
              onClick={onConfirmStop}
              disabled={executing}
              style={{
                flex: 1, padding: '6px 0',
                background: 'rgba(220,38,38,0.12)', border: `0.5px solid ${RED}`,
                borderRadius: 3, cursor: executing ? 'not-allowed' : 'pointer',
                color: RED, fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                opacity: executing ? 0.5 : 1,
              }}
            >
              {executing
                ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                : null}
              {executing ? 'İŞLENİYOR...' : 'ONAYLA — DURDUR'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Keyframes ─────────────────────────────────────────────────────────────────

// Bu style global CSS'te olmadığından inline <style> ile eklenir.
// SuperAdminShell'deki sa-emergency-pulse gibi, RolloutControlLite kendi
// animasyonunu kendi scope'unda tanımlar.
export function RolloutKeyframes() {
  return (
    <style>{`
      @keyframes rollout-critical-pulse {
        0%, 100% { border-color: #dc2626; }
        50%       { border-color: #7f1d1d; }
      }
    `}</style>
  );
}
