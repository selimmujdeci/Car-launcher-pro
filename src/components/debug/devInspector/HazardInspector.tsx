/**
 * HazardInspector — Hazard Intelligence katmanı derin denetim paneli.
 * DEV modunda görünür; production build'de tree-shake edilir.
 *
 * Bölümler:
 *   Global Stats     — hazardStatus, globalRiskScore, DAB
 *   Active Hazards   — her tehlike için canlı güven, yoğunluk, ilgi
 *   Decision Matrix  — mevcut durumu açıklayan mantık özeti
 *   Control Center   — tehlike enjeksiyonu + temizleme (dev only)
 */

import { memo, useEffect, useState } from 'react';
import {
  useHazardStore,
  type HazardType,
} from '../../../store/useHazardStore';
import {
  calculateCurrentConfidence,
  calculateFinalIntensity,
  injectTestHazard,
  DEFAULT_DECAY,
  DEFAULT_RADIUS,
} from '../../../platform/hazardService';
import { useUnifiedVehicleStore } from '../../../platform/vehicleDataLayer/UnifiedVehicleStore';

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const IS_DEV = import.meta.env.DEV;

const STATUS_COLOR: Record<string, string> = {
  IDLE:      '#64748b',
  AWARENESS: '#3b82f6',
  PREPARE:   '#f59e0b',
  ATTENTION: '#ef4444',
  STABILIZE: '#10b981',
  RECOVER:   '#a78bfa',
};

const TYPE_LABELS: Record<HazardType, string> = {
  CONSTRUCTION: 'İNŞAAT',
  ACCIDENT:     'KAZA',
  WEATHER:      'HAVA',
  SPEED_CAM:    'KAMERA',
  ROAD_DAMAGE:  'HASARLI YOL',
  TUNNEL:       'TÜNEL',
};

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function pct(v: number): string { return `${(v * 100).toFixed(0)}%`; }
function bar(v: number, color: string): React.ReactNode {
  return (
    <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.min(100, v * 100).toFixed(1)}%`, background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function decisionExplain(status: string, risk: number, hasActive: boolean): string {
  if (!hasActive)           return 'Rota üzerinde tehlike yok (ilgi < 0.1)';
  if (status === 'IDLE')    return `Risk ${risk.toFixed(3)} — tehlike pasif veya sıfır`;
  if (status === 'AWARENESS') return `Risk ${risk.toFixed(3)} < 0.20 — uzak farkındalık`;
  if (status === 'PREPARE')   return `Risk ${risk.toFixed(3)} < 0.45 — hazırlık modu`;
  if (status === 'ATTENTION') return `Risk ${risk.toFixed(3)} ≥ 0.45 — tam dikkat`;
  return `Durum: ${status}`;
}

/* ── Tehlike enjeksiyonu (dev only) ──────────────────────────────────────── */

function injectSpecific(type: HazardType): void {
  if (!IS_DEV) return;
  const loc = useUnifiedVehicleStore.getState().location;
  const baseLat = (loc && isFinite(loc.latitude))  ? loc.latitude  : 39.9208;
  const baseLng = (loc && isFinite(loc.longitude)) ? loc.longitude : 32.8541;
  const jitter  = () => (Math.random() - 0.5) * 0.008;

  useHazardStore.getState().upsertHazard({
    id:                `dbg_${type}_${Date.now()}`,
    type,
    lat:               baseLat + jitter(),
    lng:               baseLng + jitter(),
    severity:          0.75,
    source:            'SYSTEM',
    timestamp:         Date.now(),
    initialConfidence: 0.95,
    decayRate:         DEFAULT_DECAY[type],
    influenceRadius:   DEFAULT_RADIUS[type],
  });
}

/* ── Ana bileşen ─────────────────────────────────────────────────────────── */

export const HazardInspector = memo(function HazardInspector() {
  // Canlı güven değeri için 500ms yenile
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  const {
    hazardStatus,
    globalRiskScore,
    driverAttentionBudget,
    activeHazards,
    routeRelevance,
    hazardIntensity,
  } = useHazardStore();

  const statusColor  = STATUS_COLOR[hazardStatus] ?? '#64748b';
  const hasActive    = Object.values(routeRelevance).some((r) => r >= 0.1);

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-3 font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.75)' }}>

      {/* ── Global Stats ─────────────────────────────────────────────── */}
      <section>
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Global İstatistikler
        </div>
        <div className="space-y-1.5 px-1">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>Status</span>
            <span className="font-bold" style={{ color: statusColor }}>{hazardStatus}</span>
          </div>
          {/* Risk score */}
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.4)', width: 72 }}>Global Risk</span>
            {bar(globalRiskScore, globalRiskScore > 0.6 ? '#ef4444' : globalRiskScore > 0.35 ? '#f59e0b' : '#3b82f6')}
            <span className="w-8 text-right">{pct(globalRiskScore)}</span>
          </div>
          {/* DAB */}
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.4)', width: 72 }}>Dikkat (DAB)</span>
            {bar(driverAttentionBudget, driverAttentionBudget < 0.4 ? '#ef4444' : '#22c55e')}
            <span className="w-8 text-right">{pct(driverAttentionBudget)}</span>
          </div>
          {/* Hazard count */}
          <div className="flex items-center justify-between">
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>Aktif Tehlike</span>
            <span>{activeHazards.length}</span>
          </div>
        </div>
      </section>

      <hr style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

      {/* ── Active Hazards ────────────────────────────────────────────── */}
      <section>
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Aktif Tehlikeler ({activeHazards.length})
        </div>

        {activeHazards.length === 0 ? (
          <div className="text-center py-3" style={{ color: 'rgba(255,255,255,0.15)' }}>Tehlike yok</div>
        ) : (
          <div className="space-y-1.5">
            {activeHazards.map((h) => {
              void tick; // lint: bilerek okunuyor — canlı yenileme
              const conf      = Math.max(0, calculateCurrentConfidence(h));
              const rel       = routeRelevance[h.id] ?? 0;
              // Mevcut yoğunluk: decay motoru tarafından hesaplanan değer tercih edilir.
              // Motor henüz çalışmadıysa anlık hesap yapılır.
              const intensity = hazardIntensity[h.id]
                ?? calculateFinalIntensity(conf, h.severity, rel, driverAttentionBudget);
              const isActive  = rel >= 0.1;

              return (
                <div key={h.id} className="rounded px-2 py-1.5" style={{
                  background: isActive ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isActive ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'}`,
                }}>
                  {/* Başlık satırı */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold" style={{ color: isActive ? '#fbbf24' : 'rgba(255,255,255,0.55)' }}>
                      {TYPE_LABELS[h.type] ?? h.type}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>{h.source}</span>
                  </div>
                  {/* Metrikler */}
                  <div className="grid grid-cols-4 gap-x-2 text-[9px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    <div>
                      <div>Güven</div>
                      <div style={{ color: conf < 0.3 ? '#ef4444' : '#22c55e' }}>{pct(conf)}</div>
                    </div>
                    <div>
                      <div>Şiddet</div>
                      <div style={{ color: 'rgba(255,255,255,0.75)' }}>{pct(h.severity)}</div>
                    </div>
                    <div>
                      <div>İlgi</div>
                      <div style={{ color: rel < 0.1 ? 'rgba(255,255,255,0.25)' : '#3b82f6' }}>{rel.toFixed(2)}</div>
                    </div>
                    <div>
                      <div>Yoğunluk</div>
                      <div style={{ color: intensity > 0.6 ? '#ef4444' : intensity > 0.3 ? '#f59e0b' : 'rgba(255,255,255,0.55)' }}>
                        {intensity.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {/* ID */}
                  <div className="mt-1 text-[8px] truncate" style={{ color: 'rgba(255,255,255,0.15)' }}>
                    {h.id}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <hr style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

      {/* ── Decision Matrix ───────────────────────────────────────────── */}
      <section>
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Karar Matrisi
        </div>
        <div className="px-1 py-1.5 rounded" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <span style={{ color: statusColor }}>● {hazardStatus}</span>
          <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>
            {decisionExplain(hazardStatus, globalRiskScore, hasActive)}
          </span>
        </div>
        <div className="mt-1.5 space-y-0.5 px-1 text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          <div>AWARENESS: risk &lt; 0.20  ·  PREPARE: &lt; 0.45  ·  ATTENTION: ≥ 0.45</div>
          <div>DAB &lt; 0.4 veya ATTENTION → TTS kısaltılır</div>
        </div>
      </section>

      {IS_DEV && (
        <>
          <hr style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

          {/* ── Control Center (Dev Only) ─────────────────────────────── */}
          <section>
            <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Kontrol Merkezi <span style={{ color: '#ef4444' }}>● DEV</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['ACCIDENT', 'CONSTRUCTION', 'SPEED_CAM', 'WEATHER', 'ROAD_DAMAGE'] as HazardType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => injectSpecific(t)}
                  className="px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide transition-colors active:scale-95"
                  style={{
                    background: 'rgba(245,158,11,0.12)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    color: '#fbbf24',
                  }}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
              <button
                onClick={injectTestHazard}
                className="px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide transition-colors active:scale-95"
                style={{
                  background: 'rgba(59,130,246,0.12)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  color: '#93c5fd',
                }}
              >
                RASTGELE
              </button>
            </div>
            <button
              onClick={() => {
                const { activeHazards: hz, removeHazard } = useHazardStore.getState();
                hz.forEach((h) => removeHazard(h.id));
              }}
              className="mt-1.5 w-full py-1 rounded text-[9px] font-bold uppercase tracking-wide transition-colors active:scale-95"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#f87171',
              }}
            >
              TÜMÜNü TEMİZLE
            </button>
          </section>
        </>
      )}
    </div>
  );
});
