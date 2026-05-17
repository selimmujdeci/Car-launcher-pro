/**
 * IntelligenceInspector — T1 + T2 + T3 + T4 derin denetim paneli.
 * DEV modunda görünür; production build'de tree-shake edilir.
 */

import { memo } from 'react';
import {
  useVehicleIntelligenceStore,
  type HealthState,
  type ThermalStatus,
} from '../../../store/useVehicleIntelligenceStore';
import { injectFault, clearAllFaults } from '../../../platform/vehicleIntelligenceService';

const IS_DEV = import.meta.env.DEV;

/* ── Renk / etiket haritaları ─────────────────────────────── */

const HEALTH_COLOR: Record<HealthState, string> = {
  HEALTHY:      '#22c55e', MONITOR: '#3b82f6', STRESSED: '#f59e0b',
  ATTENTION:    '#ef4444', SERVICE_SOON: '#7f1d1d',
};
const HEALTH_LABEL: Record<HealthState, string> = {
  HEALTHY: 'SAĞLIKLI', MONITOR: 'İZLENİYOR', STRESSED: 'GERGİN',
  ATTENTION: 'DİKKAT', SERVICE_SOON: 'SERVİS',
};
const THERMAL_COLOR: Record<ThermalStatus, string> = {
  COLD: '#60a5fa', WARM: '#fbbf24', OPTIMAL: '#22c55e',
  HEAT_SOAK: '#f97316', OVERHEAT_RISK: '#ef4444',
};
const THERMAL_LABEL: Record<ThermalStatus, string> = {
  COLD: 'SOĞUK', WARM: 'ISINIYOR', OPTIMAL: 'OPTİMAL',
  HEAT_SOAK: 'ISI SOAK', OVERHEAT_RISK: 'AŞIRI ISI',
};
const SEVERITY_SCORE: Record<HealthState, number> = {
  HEALTHY: 0.0, MONITOR: 0.25, STRESSED: 0.50, ATTENTION: 0.75, SERVICE_SOON: 1.0,
};
const PID_LABEL: Record<string, string> = {
  'rpm.jump':           'RPM Sıçrama',
  'coolant.jump':       'Soğutma Sıçrama',
  'speed.gps_mismatch': 'GPS/OBD Uyumsuzluk',
  'rpm.load_mismatch':  'RPM/Yük Uyumsuzluk',
  'coolantTemp.stale':  'Soğutma Stale',
  'fuel.stale':         'Yakıt Stale',
  'obdSpeed.stale':     'OBD Hız Stale',
  'rpm.stale':          'RPM Stale',
};
const DEV_FAULTS = [
  { pid: 'rpm.jump',           label: 'RPM Sıçrama' },
  { pid: 'speed.gps_mismatch', label: 'GPS/OBD' },
  { pid: 'coolantTemp.stale',  label: 'Soğutma Stale' },
  { pid: 'fuel.stale',         label: 'Yakıt Stale' },
];

/* ── Yardımcılar ──────────────────────────────────────────── */

function pct(v: number, d = 0): string { return `${(v * 100).toFixed(d)}%`; }

function trustColor(s: number): string {
  if (s > 0.85) return '#22c55e';
  if (s > 0.65) return '#3b82f6';
  if (s > 0.45) return '#f59e0b';
  if (s > 0.25) return '#ef4444';
  return '#7f1d1d';
}
function fidelityColor(f: number): string {
  return f > 0.75 ? '#22c55e' : f > 0.45 ? '#f59e0b' : '#ef4444';
}
function charColor(v: number): string {
  return v < 0.33 ? '#22c55e' : v < 0.66 ? '#f59e0b' : '#ef4444';
}
function debtColor(d: number): string {
  return d < 0.35 ? '#22c55e' : d < 0.65 ? '#f59e0b' : '#ef4444';
}
function dtdtColor(v: number): string {
  if (v > 2) return '#ef4444'; if (v > 1) return '#f59e0b'; if (v < -2) return '#60a5fa';
  return '#22c55e';
}

/* ── Bileşenler ───────────────────────────────────────────── */

function MiniBar({ value, color, degraded = false }: { value: number; color: string; degraded?: boolean }) {
  return (
    <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, value * 100))}%`, height: '100%',
        background: degraded ? 'rgba(255,255,255,0.18)' : color, transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

/**
 * T4: Çift katmanlı güven ağırlıklı stres çubuğu.
 * Gri arka plan → ham mekanik şiddet (güven ağırlığı yok)
 * Renkli ön plan  → güven ağırlıklı görüntülenen şiddet
 * Açık boşluk    → güven kısıtlamasının tuttuğu şiddet
 */
function TrustWeightedBar({ rawScore, displayScore }: { rawScore: number; displayScore: number }) {
  const color = displayScore > 0.6 ? '#ef4444' : displayScore > 0.3 ? '#f59e0b' : '#22c55e';
  const rPct  = Math.max(0, Math.min(100, rawScore * 100));
  const dPct  = Math.max(0, Math.min(100, displayScore * 100));
  return (
    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
      {/* Ham şiddet — gri */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: `${rPct}%`,
        background: 'rgba(255,255,255,0.18)',
      }} />
      {/* Ağırlıklı şiddet — renkli */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: `${dPct}%`,
        background: color, transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="px-1 mb-1" style={{ color: 'rgba(255,255,255,0.20)', fontSize: 9, letterSpacing: '0.10em' }}>
      {text}
    </div>
  );
}

/* ── Ana bileşen ──────────────────────────────────────────── */

export const IntelligenceInspector = memo(function IntelligenceInspector() {
  // T1/T2
  const trust          = useVehicleIntelligenceStore((s) => s.telemetryTrustScore);
  const report         = useVehicleIntelligenceStore((s) => s.plausibilityReport);
  const character      = useVehicleIntelligenceStore((s) => s.drivingCharacter);
  const health         = useVehicleIntelligenceStore((s) => s.healthState);
  const rawHealth      = useVehicleIntelligenceStore((s) => s.rawHealthState);
  const stalePIDs      = useVehicleIntelligenceStore((s) => s.stalePIDs);
  const samples        = useVehicleIntelligenceStore((s) => s.sampleCount);
  const isReliable     = useVehicleIntelligenceStore((s) => s.isCharacterReliable);
  const isDiagDeg      = useVehicleIntelligenceStore((s) => s.isDiagnosticDegraded);
  const sps            = useVehicleIntelligenceStore((s) => s.samplesPerSecond);
  const jitter         = useVehicleIntelligenceStore((s) => s.jitterMs);
  const fidelity       = useVehicleIntelligenceStore((s) => s.connectionFidelity);
  const jStability     = useVehicleIntelligenceStore((s) => s.jitterStability);
  // T3
  const thermalSt      = useVehicleIntelligenceStore((s) => s.thermalStatus);
  const thermalDebt    = useVehicleIntelligenceStore((s) => s.thermalDebt);
  const coolingEff     = useVehicleIntelligenceStore((s) => s.coolingEfficiency);
  const maxTrend       = useVehicleIntelligenceStore((s) => s.maxCoolantTrend);
  const dTdt           = useVehicleIntelligenceStore((s) => s.coolantTrendDtDt);

  const faultKeys      = Object.keys(report);
  const faultCount     = faultKeys.filter((k) => !report[k].isValid).length;

  // T4: ham ve görüntülenen şiddet skorları
  const rawScore       = SEVERITY_SCORE[rawHealth];
  const displayScore   = SEVERITY_SCORE[health];
  const isTrustCapping = rawScore > displayScore;

  const tc = THERMAL_COLOR[thermalSt];

  // T4: Tanı Güvenilirliği skoru (bağlantı fidelity × trust)
  const diagFidelity  = Math.min(1, fidelity * trust * 2);  // 0–1 normalize

  return (
    <div className="space-y-2 font-mono text-[10px]">

      {/* ── T4: Tanı Bozulma Uyarısı ────────────────────── */}
      {isDiagDeg && (
        <div className="px-2 py-2 rounded" style={{
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
        }}>
          <div style={{ color: '#f87171', fontSize: 9, fontWeight: 900, letterSpacing: '0.08em' }}>
            ⚠ VERİ KALİTESİ DÜŞÜK
          </div>
          <div style={{ color: 'rgba(248,113,113,0.65)', fontSize: 8, marginTop: 2 }}>
            Tahminler Kısıtlandı — ATTENTION/SERVICE_SOON askıya alındı
          </div>
        </div>
      )}

      {/* ── Trust 2.0 + T4 Tanı Güvenilirliği ──────────── */}
      <div className="px-1">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>VHS 2.0</span>
            {/* T4: Tanı Güvenilirliği rozeti */}
            <span style={{
              fontSize: 8, fontWeight: 700, color: fidelityColor(diagFidelity),
              background: `${fidelityColor(diagFidelity)}15`,
              padding: '1px 5px', borderRadius: 3,
            }}>
              {isDiagDeg ? 'DX KISITLANDı' : `DX ${pct(diagFidelity)}`}
            </span>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 900, letterSpacing: '0.1em',
            color: HEALTH_COLOR[health], background: `${HEALTH_COLOR[health]}18`,
            padding: '1px 6px', borderRadius: 4,
          }}>
            {HEALTH_LABEL[health]}
          </span>
        </div>

        {/* Trust bar */}
        <div className="flex items-center gap-2 mb-1">
          <MiniBar value={trust} color={trustColor(trust)} />
          <span style={{ color: trustColor(trust), fontWeight: 900, fontSize: 11, minWidth: 36, textAlign: 'right' }}>
            {pct(trust)}
          </span>
        </div>

        {/* T4: Güven Ağırlıklı Stres çubuğu */}
        <div className="mb-1">
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8, width: 46, flexShrink: 0 }}>Stres</span>
            <TrustWeightedBar rawScore={rawScore} displayScore={displayScore} />
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8, minWidth: 42, textAlign: 'right' }}>
              {isTrustCapping
                ? <span style={{ color: '#f59e0b' }}>↓ KISIT</span>
                : <span style={{ color: '#22c55e' }}>= TAM</span>
              }
            </span>
          </div>
          {isTrustCapping && (
            <div className="flex justify-between px-0.5 mt-0.5" style={{ color: 'rgba(255,255,255,0.20)', fontSize: 8 }}>
              <span>Ham: <span style={{ color: HEALTH_COLOR[rawHealth] }}>{HEALTH_LABEL[rawHealth]}</span></span>
              <span>Ağırlıklı: <span style={{ color: HEALTH_COLOR[health] }}>{HEALTH_LABEL[health]}</span></span>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-1" style={{ color: 'rgba(255,255,255,0.20)', fontSize: 9 }}>
          <span>Örnekler: {samples}</span>
          <span>Hata: <span style={{ color: faultCount > 0 ? '#ef4444' : '#22c55e' }}>{faultCount}</span></span>
          <span>Stale: <span style={{ color: stalePIDs.length > 0 ? '#f59e0b' : '#22c55e' }}>{stalePIDs.length}</span></span>
        </div>
      </div>

      {/* ── T3: Termal Bellek ─────────────────────────────── */}
      <div>
        <SectionLabel text="TERMAL BELLEK" />
        <div className="flex items-center gap-2 px-1 mb-1.5">
          <span style={{
            fontSize: 9, fontWeight: 900, letterSpacing: '0.12em',
            color: tc, background: `${tc}18`,
            padding: '2px 8px', borderRadius: 4, border: `1px solid ${tc}30`,
          }}>
            {THERMAL_LABEL[thermalSt]}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.20)', fontSize: 9 }}>
            max: <span style={{ color: maxTrend > 2 ? '#ef4444' : '#22c55e' }}>{maxTrend.toFixed(1)}°C/dak</span>
          </span>
        </div>
        <div className="space-y-1.5 px-1">
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, width: 62, flexShrink: 0 }}>Isı Borcu</span>
            <MiniBar value={thermalDebt} color={debtColor(thermalDebt)} />
            <span style={{ color: debtColor(thermalDebt), fontSize: 9, fontWeight: 700, minWidth: 30, textAlign: 'right' }}>
              {pct(thermalDebt)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, width: 62, flexShrink: 0 }}>Soğuma Eff.</span>
            <MiniBar value={coolingEff} color={coolingEff > 0.6 ? '#22c55e' : '#f59e0b'} />
            <span style={{ color: coolingEff > 0.6 ? '#22c55e' : '#f59e0b', fontSize: 9, fontWeight: 700, minWidth: 30, textAlign: 'right' }}>
              {pct(coolingEff)}
            </span>
          </div>
          <div className="flex items-center justify-between px-0.5">
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>Anlık dT/dt</span>
            <span style={{ color: dtdtColor(dTdt), fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>
              {dTdt > 0 ? '+' : ''}{dTdt.toFixed(2)} °C/dak
            </span>
          </div>
        </div>
      </div>

      {/* ── Bağlantı Kalitesi ─────────────────────────────── */}
      <div>
        <SectionLabel text="BAĞLANTI KALİTESİ" />
        <div className="space-y-1.5 px-1">
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, width: 46, flexShrink: 0 }}>SPS</span>
            <MiniBar value={Math.min(1, sps / 5)} color={fidelityColor(fidelity)} />
            <span style={{ color: fidelityColor(fidelity), fontSize: 9, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>
              {sps.toFixed(1)} Hz
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, width: 46, flexShrink: 0 }}>Jitter</span>
            <MiniBar value={Math.min(1, jitter / 400)} color={jitter < 50 ? '#22c55e' : jitter < 200 ? '#f59e0b' : '#ef4444'} />
            <span style={{ color: jitter < 50 ? '#22c55e' : jitter < 200 ? '#f59e0b' : '#ef4444', fontSize: 9, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>
              {jitter.toFixed(0)} ms
            </span>
          </div>
          <div className="flex gap-3 pt-0.5" style={{ color: 'rgba(255,255,255,0.20)', fontSize: 9 }}>
            <span>Fidelity: <span style={{ color: fidelityColor(fidelity) }}>{pct(fidelity)}</span></span>
            <span>Stability: <span style={{ color: jStability > 0.7 ? '#22c55e' : '#f59e0b' }}>{pct(jStability)}</span></span>
          </div>
        </div>
      </div>

      {/* ── Plausibility Grid ──────────────────────────────── */}
      <div>
        <SectionLabel text="PLAUSIBILITY" />
        <div className="space-y-0.5">
          {faultKeys.length === 0 ? (
            <div className="text-center py-1.5" style={{ color: 'rgba(255,255,255,0.15)', fontSize: 9 }}>
              Tüm sensörler geçerli ✓
            </div>
          ) : faultKeys.map((key) => {
            const e = report[key];
            return (
              <div key={key} className="flex items-start gap-2 px-2 py-1 rounded"
                style={{ background: e.isValid ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.08)' }}>
                <span style={{ color: e.isValid ? '#22c55e' : '#ef4444', fontSize: 11, lineHeight: 1.2 }}>
                  {e.isValid ? '●' : '✕'}
                </span>
                <div className="flex flex-col min-w-0">
                  <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: 700 }}>
                    {PID_LABEL[key] ?? key}
                  </span>
                  {!e.isValid && e.reason && (
                    <span style={{ color: 'rgba(239,68,68,0.65)', fontSize: 8, marginTop: 1 }}>{e.reason}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Stale PIDs ─────────────────────────────────────── */}
      {stalePIDs.length > 0 && (
        <div className="px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.08)' }}>
          <span style={{ color: '#f59e0b', fontSize: 9, fontWeight: 700 }}>STALE: </span>
          <span style={{ color: 'rgba(255,255,255,0.50)', fontSize: 9 }}>{stalePIDs.join(', ')}</span>
        </div>
      )}

      {/* ── DCE 2.0 ────────────────────────────────────────── */}
      <div>
        <SectionLabel text={`DRIVING CHARACTER${!isReliable ? ' · GÜVENİLMEZ' : ''}`} />
        {!isReliable && (
          <div className="px-2 py-0.5 mb-1 rounded" style={{ background: 'rgba(239,68,68,0.08)' }}>
            <span style={{ color: 'rgba(239,68,68,0.60)', fontSize: 8 }}>Bağlantı zayıf — karakter verileri güvenilmez</span>
          </div>
        )}
        <div className="space-y-1.5 px-1">
          {([
            ['Agresiflik', character.aggression, charColor(character.aggression)],
            ['Düzgünlük',  character.smoothness,  charColor(1 - character.smoothness)],
            ['Ekonomi',    character.economy,      '#22c55e'],
          ] as [string, number, string][]).map(([label, value, color]) => (
            <div key={label} className="flex items-center gap-2">
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, width: 60, flexShrink: 0 }}>{label}</span>
              <MiniBar value={value} color={color} degraded={!isReliable} />
              <span style={{ color: isReliable ? color : 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: 700, minWidth: 30, textAlign: 'right' }}>
                {isReliable ? pct(value) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── DEV: Fault Injector ────────────────────────────── */}
      {IS_DEV && (
        <div>
          <SectionLabel text="DEV · FAULT INJECTOR" />
          <div className="flex flex-wrap gap-1 px-1">
            {DEV_FAULTS.map(({ pid, label }) => (
              <button key={pid} onClick={() => injectFault(pid)} style={{
                fontSize: 8, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#f87171', fontFamily: 'monospace',
              }}>{label}</button>
            ))}
            <button onClick={clearAllFaults} style={{
              fontSize: 8, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
              background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.22)',
              color: '#4ade80', fontFamily: 'monospace',
            }}>Temizle</button>
          </div>
        </div>
      )}
    </div>
  );
});
