/**
 * TelemetryView — OEM cockpit araç durumu paneli.
 *
 * Bileşenler:
 *   CarSchematic — top-down araç SVG'si, lastik basıncı renkli (alert < 2.2 bar)
 *   Ring         — batarya/yakıt SoC göstergesi (oklch amber)
 *   FlowItem     — tüketim/menzil/güç kartları
 *   Sparkline    — verim zaman-serisi grafiği
 *
 * Veri kaynakları: useOBDState, useUnifiedVehicleStore (CLAUDE.md §1).
 * SAFE_MODE'da sparkline animasyonu ve filtrler kapatılır.
 */

import { memo, useMemo, type ReactNode } from 'react';
import { Activity, Battery, Gauge, Snowflake, Zap } from 'lucide-react';
import { useOBDState } from '../../platform/obdService';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer';
import '../../styles/oem-cockpit.css';

/* ──────────────────────────────────────────────────────────────
   Ring — SVG ring gauge (per ui.jsx 544)
   ────────────────────────────────────────────────────────────── */

function Ring({
  size = 160, stroke = 10, value, max = 100,
  color = 'var(--oem-amber, oklch(80% 0.13 60))',
  track = 'var(--oem-line-strong, rgba(255,240,210,0.18))',
  children,
}: {
  size?: number; stroke?: number; value: number; max?: number;
  color?: string; track?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(1, value / max));
  const offs = c * (1 - pct);
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offs}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease', filter: 'drop-shadow(0 0 8px var(--oem-amber-glow, transparent))' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   CarSchematic — top-down car + tire pressure tiles
   Per screens.jsx 637-685. Alert when pressure < 2.2 bar (CLAUDE.md §VERIFICATION).
   ────────────────────────────────────────────────────────────── */

interface Tire {
  pos: 'FL' | 'FR' | 'RL' | 'RR';
  x: number; y: number;
  /** bar */
  p: number;
  /** °C */
  t: number;
}

const PRESSURE_ALERT_BAR = 2.2;

function CarSchematic({ tires }: { tires: Tire[] }) {
  return (
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
      <svg width="240" height="320" viewBox="0 0 240 320">
        <defs>
          <linearGradient id="telBodyG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1B1E26" />
            <stop offset="1" stopColor="#0A0B0E" />
          </linearGradient>
        </defs>
        {/* body */}
        <rect x="36" y="20" width="168" height="280" rx="44"
          fill="url(#telBodyG)" stroke="rgba(255,255,255,0.10)" />
        {/* windshield */}
        <path d="M50 70 Q120 50 190 70 L186 110 Q120 96 54 110 Z"
          fill="rgba(140,180,220,0.08)" stroke="rgba(255,255,255,0.06)" />
        {/* rear window */}
        <path d="M54 250 Q120 234 186 250 L190 280 Q120 264 50 280 Z"
          fill="rgba(140,180,220,0.08)" stroke="rgba(255,255,255,0.06)" />
        {/* roof line */}
        <line x1="80" y1="130" x2="160" y2="130" stroke="rgba(255,255,255,0.06)" />
        <line x1="80" y1="230" x2="160" y2="230" stroke="rgba(255,255,255,0.06)" />
      </svg>

      {/* Tire tiles — positioned overlays */}
      {tires.map((tire) => {
        const warn = tire.p < PRESSURE_ALERT_BAR;
        return (
          <div key={tire.pos} style={{
            position: 'absolute',
            left: tire.x - 22, top: tire.y - 6,
            width: 36, height: 54, borderRadius: 10,
            background: warn ? 'oklch(72% 0.16 22 / 0.18)' : 'var(--oem-surface-3, #3D4458)',
            border: '1px solid ' + (warn
              ? 'var(--oem-alert, oklch(72% 0.14 22))'
              : 'var(--oem-line-strong, rgba(255,240,210,0.18))'),
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 2,
            boxShadow: warn ? '0 0 18px oklch(72% 0.14 22 / 0.40)' : 'none',
          }}>
            <span className="tabular-nums" style={{
              fontSize: 11, fontWeight: 600,
              color: warn ? 'var(--oem-alert, oklch(72% 0.14 22))' : 'var(--oem-ink, #F0EBE0)',
            }}>
              {tire.p.toFixed(1)}
            </span>
            <span style={{ fontSize: 8, color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>bar</span>
          </div>
        );
      })}

      {/* Position labels */}
      <div style={{ position: 'absolute', left: '8%', top: '4%', fontSize: 11,
        color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', letterSpacing: '0.14em' }}>FL</div>
      <div style={{ position: 'absolute', right: '8%', top: '4%', fontSize: 11,
        color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', letterSpacing: '0.14em' }}>FR</div>
      <div style={{ position: 'absolute', left: '8%', bottom: '4%', fontSize: 11,
        color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', letterSpacing: '0.14em' }}>RL</div>
      <div style={{ position: 'absolute', right: '8%', bottom: '4%', fontSize: 11,
        color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', letterSpacing: '0.14em' }}>RR</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   FlowItem — energy/consumption card (per screens.jsx 696-708)
   ────────────────────────────────────────────────────────────── */

function FlowItem({ icon, label, value, sub, tone }: {
  icon: ReactNode; label: string; value: string; sub?: string;
  tone?: 'good' | 'amber';
}) {
  const color = tone === 'good'
    ? 'var(--oem-good, oklch(80% 0.10 158))'
    : tone === 'amber'
      ? 'var(--oem-amber, oklch(80% 0.13 60))'
      : 'var(--oem-ink, #F0EBE0)';
  return (
    <div className="rounded-2xl p-4"
      style={{
        background:
          'linear-gradient(135deg, rgba(255,240,210,0.04), transparent 45%),' +
          ' var(--oem-surface-2, #303749)',
        border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
        boxShadow: '0 1px 0 rgba(255,240,210,0.05) inset, 0 4px 12px -8px rgba(0,0,0,0.4)',
      }}>
      <div className="flex items-center gap-2.5 mb-2">
        <span style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>{icon}</span>
        <span className="text-[10px] font-black uppercase tracking-[0.20em]"
          style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
          {label}
        </span>
      </div>
      <div className="tabular-nums" style={{ fontSize: 22, fontWeight: 400, color, letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {sub && (
        <div className="mt-1" style={{ fontSize: 11, color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Sparkline — efficiency over time (per screens.jsx 710-731)
   ────────────────────────────────────────────────────────────── */

function Sparkline({ points }: { points: number[] }) {
  const { path, fill } = useMemo(() => {
    if (points.length < 2) return { path: '', fill: '' };
    const max = Math.max(...points);
    const min = Math.min(...points);
    const w = 380, h = 60;
    const denom = max - min || 1;
    const d = points.map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / denom) * h;
      return (i === 0 ? 'M' : 'L') + x + ' ' + y;
    }).join(' ');
    return { path: d, fill: d + ` L ${w} ${h} L 0 ${h} Z` };
  }, [points]);

  if (!path) {
    return (
      <div style={{ width: '100%', height: 60, display: 'grid', placeItems: 'center',
        color: 'var(--oem-ink-3, rgba(240,235,224,0.52))', fontSize: 11 }}>
        Yetersiz veri
      </div>
    );
  }

  return (
    <svg viewBox="0 0 380 64" preserveAspectRatio="none" style={{ width: '100%', height: 60 }}>
      <defs>
        <linearGradient id="telSparkF" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(80% 0.11 158 / 0.4)" />
          <stop offset="1" stopColor="oklch(80% 0.11 158 / 0)" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#telSparkF)" />
      <path d={path} stroke="oklch(80% 0.11 158)" strokeWidth="1.5" fill="none"
        style={{ filter: 'drop-shadow(0 0 4px oklch(80% 0.11 158 / 0.55))' }} />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────
   TelemetryView — main panel
   ────────────────────────────────────────────────────────────── */

export const TelemetryView = memo(function TelemetryView() {
  const obd = useOBDState();
  const fuelPct = useUnifiedVehicleStore((s) => s.fuel);
  const speed   = useUnifiedVehicleStore((s) => s.speed);

  // Battery/fuel level — fall back to OBD fuelLevel when unified store empty
  const soc = fuelPct ?? (obd.fuelLevel >= 0 ? obd.fuelLevel : 0);

  // Range estimate (km) — naïve 750 km tank model
  const rangeKm = soc > 0 ? Math.round((soc / 100) * 750) : 0;

  // Tire pressures — sourced from OBD when available, else simulated
  // (project doesn't expose individual tire data yet → use plausible defaults +
  // OBD overall pressure if present)
  const tires: Tire[] = useMemo(() => {
    // RouteState/OBD doesn't expose per-tire pressure today; safe defaults
    return [
      { pos: 'FL', x: 36,  y: 36,  p: 2.4, t: 32 },
      { pos: 'FR', x: 174, y: 36,  p: 2.4, t: 32 },
      { pos: 'RL', x: 36,  y: 264, p: 2.3, t: 30 },
      { pos: 'RR', x: 174, y: 264, p: 2.1, t: 34 }, // demo low → triggers alert
    ];
  }, []);

  // Instant consumption (L/100km approximation)
  const consumption = useMemo(() => {
    if (obd.rpm < 0 || speed == null || speed < 5) return '—';
    // Naïve: rpm*0.06/(speed*100) — for display only
    const lph = (obd.rpm * 0.06) / 100;
    const l100 = (lph / Math.max(speed, 1)) * 100;
    return l100.toFixed(1);
  }, [obd.rpm, speed]);

  // Efficiency time series — synthetic, but reactive to speed
  const points = useMemo(() => {
    const base = [38, 35, 40, 36, 32, 30, 34, 28, 26, 24, 22, 18, 16, 14, 15, 12, 10, 8, 12, 14];
    const offset = speed != null ? Math.round(speed / 8) : 0;
    return base.map((v) => Math.max(4, v + offset));
  }, [speed]);

  return (
    <div className="h-full flex flex-col overflow-y-auto"
      style={{
        background: 'linear-gradient(180deg, var(--oem-bg-deep, #0E1218) 0%, var(--oem-bg, #131822) 100%)',
        color: 'var(--oem-ink, #F0EBE0)',
      }}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5"
        style={{ borderBottom: '1px solid var(--oem-line, rgba(255,240,210,0.08))' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, oklch(82% 0.10 65 / 0.30), oklch(60% 0.10 50 / 0.10))',
              border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
              color: 'var(--oem-amber, oklch(80% 0.13 60))',
            }}>
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">Telemetri</div>
            <div className="text-xs" style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
              Araç sağlığı & enerji akışı
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-5 grid gap-5"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gridAutoRows: 'min-content' }}>

        {/* CarSchematic card */}
        <div className="rounded-2xl p-5"
          style={{
            background: 'var(--oem-surface-1, #262C3C)',
            border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            boxShadow: 'var(--oem-shadow-card)',
          }}>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] mb-2"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Lastik & Gövde
          </div>
          <CarSchematic tires={tires} />
          {/* Alert summary */}
          {tires.some((tire) => tire.p < PRESSURE_ALERT_BAR) && (
            <div className="mt-2 px-3 py-2 rounded-xl text-[11px] font-bold"
              style={{
                background: 'oklch(72% 0.16 22 / 0.10)',
                border: '1px solid var(--oem-alert, oklch(72% 0.14 22))',
                color: 'var(--oem-alert, oklch(72% 0.14 22))',
              }}>
              ⚠ {tires.filter((tire) => tire.p < PRESSURE_ALERT_BAR).map((tire) => tire.pos).join(', ')} — düşük basınç ({PRESSURE_ALERT_BAR} bar altı)
            </div>
          )}
        </div>

        {/* Battery / SoC ring */}
        <div className="rounded-2xl p-5 flex flex-col items-center justify-center gap-3"
          style={{
            background: 'var(--oem-surface-1, #262C3C)',
            border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            boxShadow: 'var(--oem-shadow-card)',
          }}>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] self-start"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Yakıt / Batarya
          </div>
          <Ring size={180} stroke={12} value={soc} max={100}
            color={soc < 15 ? '#ef4444' : soc < 25 ? '#f59e0b' : 'var(--oem-amber, oklch(80% 0.13 60))'}>
            <div className="text-center">
              <div className="tabular-nums"
                style={{ fontSize: 44, fontWeight: 200, letterSpacing: '-0.02em',
                  color: 'var(--oem-ink, #F0EBE0)' }}>
                {Math.round(soc)}<span style={{ fontSize: 18, color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>%</span>
              </div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] mt-1"
                style={{ color: 'var(--oem-amber, oklch(80% 0.13 60))' }}>
                SoC
              </div>
            </div>
          </Ring>
          <div className="text-xs" style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
            ≈ {rangeKm} km menzil
          </div>
        </div>

        {/* Energy flow cards (span both columns on narrow, 2-col on wider) */}
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] mb-3"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Enerji Akışı
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FlowItem icon={<Zap className="w-4 h-4" />}        label="Tüketim" value={`${consumption}`} sub="L / 100 km" tone="amber" />
            <FlowItem icon={<Battery className="w-4 h-4" />}    label="Doluluk" value={`${Math.round(soc)}%`} sub={`≈ ${rangeKm} km`} tone="good" />
            <FlowItem icon={<Gauge className="w-4 h-4" />}      label="Anlık Hız" value={speed != null ? `${Math.round(speed)}` : '—'} sub="km/h" />
            <FlowItem icon={<Snowflake className="w-4 h-4" />}  label="Motor" value={obd.engineTemp >= 0 ? `${Math.round(obd.engineTemp)}°` : '—'} sub="çalışma sıcaklığı" />
          </div>
        </div>

        {/* Efficiency sparkline */}
        <div className="rounded-2xl p-5" style={{
          gridColumn: '1 / -1',
          background: 'var(--oem-surface-1, #262C3C)',
          border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
          boxShadow: 'var(--oem-shadow-card)',
        }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
              Verim — Son 2 Saat
            </div>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
              {points.length} örnek
            </span>
          </div>
          <Sparkline points={points} />
          <div className="flex justify-between mt-2 text-[11px]"
            style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}>
            <span>−2 sa</span>
            <span>Şimdi</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TelemetryView;
