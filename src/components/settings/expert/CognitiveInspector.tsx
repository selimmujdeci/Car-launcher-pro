/**
 * CognitiveInspector — Bilişsel Sistem Anlık Röntgen Paneli
 *
 * Expert Mode'da CognitivePriorityEngine durumunu gösterir:
 *   - Mevcut bilişsel mod (renk kodlu)
 *   - Termal sıcaklık (°C) ve seviye
 *   - Sürücü Dikkat Bütçesi (DAB) - 0.0-1.0
 *   - Suppress edilen servisler listesi
 *   - Son karar zamanı ve recovery geri sayımı (15s)
 *
 * MALI-400 safe: 1s polling, saf div/span, SVG filtre yok, box-shadow yok.
 * Navigasyon veya OBD latency'sini etkilemez.
 */

import { memo, useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { useCognitiveStore, type CognitiveMode } from '../../../store/useCognitiveStore';
import { useHazardStore }                         from '../../../store/useHazardStore';
import { useThermalState }                        from '../../../platform/thermalWatchdog';
import {
  getCognitivePendingMode,
  getCognitiveRecoveryRemainingMs,
} from '../../../platform/system/CognitivePriorityEngine';

/* ── Mod renk haritası ──────────────────────────────────────────────────── */

const MODE_COLOR: Record<CognitiveMode, string> = {
  IMMERSIVE:  '#22c55e',
  AWARE:      '#3b82f6',
  FOCUSED:    '#f59e0b',
  CRITICAL:   '#f97316',
  LIMP_HOME:  '#ef4444',
  PROTECTION: '#a855f7',
};

const MODE_LABEL: Record<CognitiveMode, string> = {
  IMMERSIVE:  'Tam Aktif',
  AWARE:      'Farkındalık',
  FOCUSED:    'Odaklanma',
  CRITICAL:   'Kritik',
  LIMP_HOME:  'Hayatta Kal',
  PROTECTION: 'Koruma',
};

/* ── Termal seviye badge ────────────────────────────────────────────────── */

const THERMAL_BADGE: Record<0|1|2|3, { label: string; color: string }> = {
  0: { label: 'L0 — Normal',   color: '#22c55e' },
  1: { label: 'L1 — Ilık',     color: '#f59e0b' },
  2: { label: 'L2 — Sıcak',    color: '#f97316' },
  3: { label: 'L3 — Kritik',   color: '#ef4444' },
};

/* ── Yardımcı: göreli zaman ─────────────────────────────────────────────── */

function _relTime(ts: number): string {
  if (ts === 0) return 'Henüz yok';
  const ms = Date.now() - ts;
  if (ms < 2_000)    return 'Az önce';
  if (ms < 60_000)   return `${Math.floor(ms / 1000)}s önce`;
  return `${Math.floor(ms / 60_000)} dk önce`;
}

/* ── CognitiveInspector ─────────────────────────────────────────────────── */

export const CognitiveInspector = memo(function CognitiveInspector() {
  const mode        = useCognitiveStore((s) => s.currentMode);
  const lastDecision = useCognitiveStore((s) => s.lastUpdateTs);
  const suppressed  = useCognitiveStore((s) => s.getSuppressedSystems());

  const dab         = useHazardStore((s) => s.driverAttentionBudget);
  const riskScore   = useHazardStore((s) => s.globalRiskScore);

  const thermal     = useThermalState();

  // 1s polling — recovery geri sayımı ve göreli zaman için yeterli frekans
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // Recovery telemetrisi — her tick'te okunur (modül state, zero-cost)
  const pendingMode    = getCognitivePendingMode();
  const recoveryRemMs  = getCognitiveRecoveryRemainingMs();
  const recoverySec    = Math.ceil(recoveryRemMs / 1_000);

  const modeColor = MODE_COLOR[mode];
  const thermalBadge = THERMAL_BADGE[thermal.level as 0|1|2|3] ?? THERMAL_BADGE[0];
  const tempStr   = isFinite(thermal.tempC) ? `${Math.round(thermal.tempC)}°C` : '—';

  // DAB rengi
  const dabColor = dab < 0.20 ? '#ef4444' : dab < 0.40 ? '#f97316' : dab < 0.60 ? '#f59e0b' : '#22c55e';

  // Void kullanımı bastır (tick okunsun)
  void tick;

  return (
    <section
      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4"
      aria-label="Bilişsel Sistem Teşhis Paneli"
    >
      {/* Başlık */}
      <div className="mb-3 flex items-center gap-2">
        <Brain className="h-3.5 w-3.5" style={{ color: modeColor }} />
        <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/35">
          Bilişsel Motor — CognitiveEngine
        </p>
      </div>

      {/* Ana bilgi grid */}
      <div className="grid grid-cols-2 gap-2 mb-2">

        {/* Mevcut Mod */}
        <div
          className="col-span-2 flex items-center justify-between rounded-xl border p-2.5"
          style={{ borderColor: `${modeColor}25`, background: `${modeColor}08` }}
        >
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30">Aktif Mod</p>
            <p className="font-mono text-[13px] font-bold mt-0.5" style={{ color: modeColor }}>
              {mode}
            </p>
            <p className="text-[9px] font-medium text-white/40 mt-0.5">{MODE_LABEL[mode]}</p>
          </div>
          {/* Mod pulse göstergesi — sadece opacity değişimi, MALI-400 safe */}
          <div style={{
            width:        10,
            height:       10,
            borderRadius: '50%',
            background:   modeColor,
            opacity:      mode === 'LIMP_HOME' || mode === 'CRITICAL' ? 1 : 0.6,
            flexShrink:   0,
          }} />
        </div>

        {/* Termal */}
        <_Cell
          label="Termal"
          value={tempStr}
          sub={thermalBadge.label}
          accent={thermalBadge.color}
        />

        {/* Risk Skoru */}
        <_Cell
          label="Risk Skoru"
          value={riskScore.toFixed(2)}
          sub={riskScore > 0.70 ? 'Yüksek' : riskScore > 0.45 ? 'Orta' : 'Düşük'}
          accent={riskScore > 0.70 ? '#ef4444' : riskScore > 0.45 ? '#f59e0b' : '#22c55e'}
        />

        {/* DAB Skoru */}
        <div
          className="col-span-2 flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30">
              Sürücü Dikkat Bütçesi (DAB)
            </p>
            <p className="font-mono text-[11px] font-bold" style={{ color: dabColor }}>
              {dab.toFixed(2)}
            </p>
          </div>
          {/* DAB bar — saf CSS, animasyon yok */}
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height:     '100%',
              width:      `${dab * 100}%`,
              background: dabColor,
            }} />
          </div>
          <div className="flex justify-between">
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: '0.1em' }}>
              LİMP &lt;0.15
            </span>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: '0.1em' }}>
              KRİTİK &lt;0.30
            </span>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: '0.1em' }}>
              NORMAL 1.0
            </span>
          </div>
        </div>

        {/* Son Karar Zamanı */}
        <_Cell
          label="Son Karar"
          value={_relTime(lastDecision)}
          accent="rgba(255,255,255,0.45)"
        />

        {/* Recovery Geri Sayım */}
        <div
          className="flex flex-col gap-1 rounded-xl border p-2.5"
          style={{
            borderColor: pendingMode ? 'rgba(96,165,250,0.20)' : 'rgba(255,255,255,0.06)',
            background:  pendingMode ? 'rgba(96,165,250,0.05)' : 'rgba(255,255,255,0.02)',
          }}
        >
          <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30">Recovery</p>
          {pendingMode ? (
            <>
              <p className="font-mono text-[13px] font-bold text-blue-400">{recoverySec}s</p>
              <p className="text-[8px] font-medium text-white/35">→ {pendingMode}</p>
            </>
          ) : (
            <p className="font-mono text-[11px] font-bold text-white/25">—</p>
          )}
        </div>
      </div>

      {/* Suppress edilen servisler */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
        <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30 mb-1.5">
          Bastırılan Servisler ({suppressed.length})
        </p>
        {suppressed.length === 0 ? (
          <p className="text-[10px] font-medium text-white/25">Tüm servisler aktif</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {suppressed.map((s) => (
              <span
                key={s}
                style={{
                  fontSize:      9,
                  fontWeight:    700,
                  padding:       '2px 7px',
                  borderRadius:  6,
                  background:    'rgba(239,68,68,0.10)',
                  border:        '1px solid rgba(239,68,68,0.20)',
                  color:         '#fca5a5',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

/* ── Alt bileşen ────────────────────────────────────────────────────────── */

function _Cell({ label, value, sub, accent }: {
  label:  string;
  value:  string;
  sub?:   string;
  accent: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
      <p className="text-[8px] font-black uppercase tracking-[0.25em] text-white/30">{label}</p>
      <p className="font-mono text-[11px] font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[8px] font-medium text-white/35">{sub}</p>}
    </div>
  );
}
