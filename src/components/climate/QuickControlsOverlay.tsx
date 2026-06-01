/**
 * QuickControlsOverlay — Kabin & Araç hızlı kontrol overlay'i.
 *
 * Bileşenler:
 *   ZoneTile   — sürücü/yolcu/arka iklim bölgesi
 *   SeatTile   — koltuk ısıtma/havalandırma seviyesi
 *   ActionTile — araç toggle (kilit, defrost, şarj…) — cinematic amber active
 *   Ambient    — ortam aydınlatması (warm/cool/off) — oklch token'larıyla
 *
 * Renkler --oem-* token'larından gelir; SAFE_MODE altında glow'lar bastırılır.
 */

import { memo, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import {
  X, Wind, Snowflake, Droplets, RotateCcw, Sun, Moon,
  Lock, Camera, Shield, Zap, Volume2, SunMedium,
  Plus, Minus, type LucideIcon,
} from 'lucide-react';
import '../../styles/oem-cockpit.css';

/* ────────────── ZoneTile ────────────── */

function ZoneTile({ label, t, onUp, onDown }: {
  label: string; t: number; onUp: () => void; onDown: () => void;
}) {
  return (
    <div className="rounded-2xl p-4"
      style={{
        background:
          'linear-gradient(135deg, rgba(255,240,210,0.04), transparent 45%),' +
          ' var(--oem-surface-2, #303749)',
        border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
        boxShadow: '0 1px 0 rgba(255,240,210,0.05) inset, 0 4px 12px -8px rgba(0,0,0,0.4)',
      }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.22em]"
          style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
          {label}
        </span>
        <div className="flex gap-1">
          <button onClick={onDown} aria-label={`${label} soğut`}
            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-all"
            style={{
              background: 'transparent',
              border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
            }}>
            <Minus className="w-3 h-3" />
          </button>
          <button onClick={onUp} aria-label={`${label} ısıt`}
            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-all"
            style={{
              background: 'transparent',
              border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
            }}>
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="tabular-nums"
        style={{
          fontSize: 28, fontWeight: 300, color: 'var(--oem-ink, #F0EBE0)',
          letterSpacing: '-0.02em',
        }}>
        {t.toFixed(1)}°
      </div>
    </div>
  );
}

/* ────────────── SeatTile ────────────── */

function SeatTile({ label, level, kind, onLevelChange }: {
  label: string; level: number; kind: 'heat' | 'vent';
  onLevelChange: (next: number) => void;
}) {
  const max = 3;
  const fillColor = kind === 'heat'
    ? 'var(--oem-warn, oklch(82% 0.12 78))'
    : 'var(--oem-cyan, oklch(82% 0.06 220))';
  return (
    <button onClick={() => onLevelChange((level + 1) % (max + 1))}
      aria-label={`${label}: ${level}/${max}`}
      className="rounded-2xl p-4 text-left active:scale-[0.98] transition-all"
      style={{
        background:
          'linear-gradient(135deg, rgba(255,240,210,0.04), transparent 45%),' +
          ' var(--oem-surface-2, #303749)',
        border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
        boxShadow: '0 1px 0 rgba(255,240,210,0.05) inset, 0 4px 12px -8px rgba(0,0,0,0.4)',
      }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.20em]"
          style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
          {label}
        </span>
        <span className="text-[10px] font-bold"
          style={{ color: kind === 'heat' ? 'var(--oem-warn, oklch(82% 0.12 78))' : 'var(--oem-cyan, oklch(82% 0.06 220))' }}>
          {kind === 'heat' ? 'HEAT' : 'VENT'}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 8, borderRadius: 4,
            background: i < level ? fillColor : 'var(--oem-line-strong, rgba(255,240,210,0.18))',
            transition: 'background 0.2s ease',
            boxShadow: i < level ? `0 0 10px ${fillColor}` : 'none',
          }} />
        ))}
      </div>
    </button>
  );
}

/* ────────────── ActionTile ────────────── */

function ActionTile({ Icon, label, initial = false, onChange }: {
  Icon: LucideIcon; label: string; initial?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const [on, setOn] = useState(initial);
  const toggle = () => {
    const next = !on;
    setOn(next);
    onChange?.(next);
  };
  return (
    <button onClick={toggle}
      aria-pressed={on}
      className="rounded-2xl p-4 flex flex-col items-center gap-2.5 active:scale-95 transition-all"
      style={on
        ? {
            color: 'var(--oem-amber, oklch(80% 0.13 60))',
            background:
              'radial-gradient(120% 80% at 50% 0%, var(--oem-amber-glow, oklch(80% 0.13 60 / 0.32)), transparent 60%),' +
              ' var(--oem-amber-soft, oklch(80% 0.13 60 / 0.18))',
            border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
            boxShadow:
              '0 1px 0 rgba(255,240,210,0.10) inset,' +
              ' 0 0 24px var(--oem-amber-glow, transparent)',
          }
        : {
            color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
            background: 'var(--oem-surface-0, #1E2331)',
            border: '1px solid var(--oem-line, rgba(255,240,210,0.08))',
          }}>
      <Icon className="w-6 h-6" style={{
        filter: on ? `drop-shadow(0 0 10px var(--oem-amber-glow, transparent))` : 'none',
      }} />
      <span className="text-[11px] font-bold uppercase" style={{ letterSpacing: '0.08em' }}>
        {label}
      </span>
    </button>
  );
}

/* ────────────── ClimateChip (Oto/Klima/Buğu) ────────────── */

function ClimateChip({ Icon, label, active }: {
  Icon: LucideIcon; label: string; active?: boolean;
}) {
  return (
    <button
      className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] active:scale-95 transition-all"
      style={active
        ? {
            background:
              'linear-gradient(180deg, var(--oem-amber-soft, oklch(80% 0.13 60 / 0.20)), transparent 70%),' +
              ' var(--oem-surface-3, #3D4458)',
            border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
            color: 'var(--oem-amber, oklch(80% 0.13 60))',
            boxShadow: '0 0 14px var(--oem-amber-glow, transparent)',
          }
        : {
            background: 'transparent',
            border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
          }}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

/* ────────────── Card frame ────────────── */

function Card({ title, sub, children, span }: {
  title: string; sub?: string; children: ReactNode; span?: number;
}) {
  return (
    <div className="rounded-3xl p-5 flex flex-col"
      style={{
        gridColumn: span ? `span ${span}` : undefined,
        background:
          'linear-gradient(135deg, rgba(255,240,210,0.04), transparent 30%),' +
          ' var(--oem-surface-1, #262C3C)',
        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
        boxShadow: 'var(--oem-shadow-card)',
      }}>
      <div className="mb-4">
        <div className="text-[10px] font-black uppercase tracking-[0.22em]"
          style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
          {sub || ''}
        </div>
        <h3 className="text-[18px] font-semibold tracking-tight mt-1"
          style={{ color: 'var(--oem-ink, #F0EBE0)', letterSpacing: '-0.01em' }}>
          {title}
        </h3>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* ────────────── Meter (used in ambient intensity) ────────────── */

function Meter({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'var(--oem-line-strong, rgba(255,240,210,0.18))' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: color,
        boxShadow: `0 0 10px ${color}`,
        transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   QuickControlsOverlay
   ────────────────────────────────────────────────────────────── */

interface Props {
  onClose: () => void;
}

type AmbientId = 'warm' | 'cool' | 'off';

export const QuickControlsOverlay = memo(function QuickControlsOverlay({ onClose }: Props) {
  // Climate zones
  const [driver, setDriver]     = useState(21.0);
  const [pax, setPax]           = useState(20.5);
  const [rearL, setRearL]       = useState(20.0);
  const [rearR, setRearR]       = useState(20.0);

  // Seat heat/vent
  const [seatHeatDr, setSeatHeatDr] = useState(2);
  const [seatHeatPx, setSeatHeatPx] = useState(1);
  const [seatVentDr, setSeatVentDr] = useState(0);
  const [seatVentPx, setSeatVentPx] = useState(0);

  // Theme + ambient
  const [themeMode, setThemeMode] = useState<'night' | 'auto' | 'day'>('auto');
  const [ambient, setAmbient]     = useState<AmbientId>('warm');

  const tempStep = 0.5;
  const adjust = (setter: Dispatch<SetStateAction<number>>) => (delta: number) =>
    setter((v) => Math.max(16, Math.min(28, +(v + delta * tempStep).toFixed(1))));

  return (
    <div className="fixed inset-0 z-[70] flex flex-col"
      style={{
        background:
          'linear-gradient(180deg, var(--oem-chrome-bg-strong, rgba(20,16,12,0.85)), var(--oem-chrome-bg-soft, rgba(20,16,12,0.40)) 80%, transparent),' +
          ' var(--oem-bg-deep, #0E1218)',
        backdropFilter: 'blur(calc(var(--rt-blur, 1) * 24px)) saturate(120%)',
        WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 24px)) saturate(120%)',
        color: 'var(--oem-ink, #F0EBE0)',
      }}>
      {/* Header */}
      <div className="flex items-center justify-between px-9 py-6 flex-shrink-0">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em]"
            style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
            Hızlı Kontroller
          </div>
          <h2 className="mt-2" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Kabin & Araç
          </h2>
        </div>
        <button onClick={onClose} aria-label="Kapat"
          className="w-12 h-12 rounded-full flex items-center justify-center active:scale-90 transition-all"
          style={{
            background: 'transparent',
            border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
          }}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-9 pb-9"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>

        {/* Climate zones */}
        <Card title="İklim Bölgeleri" sub="Kabin">
          <div className="grid grid-cols-2 gap-3">
            <ZoneTile label="Sürücü"   t={driver} onUp={() => adjust(setDriver)(+1)} onDown={() => adjust(setDriver)(-1)} />
            <ZoneTile label="Yolcu"    t={pax}    onUp={() => adjust(setPax)(+1)}    onDown={() => adjust(setPax)(-1)} />
            <ZoneTile label="Arka Sol" t={rearL}  onUp={() => adjust(setRearL)(+1)}  onDown={() => adjust(setRearL)(-1)} />
            <ZoneTile label="Arka Sağ" t={rearR}  onUp={() => adjust(setRearR)(+1)}  onDown={() => adjust(setRearR)(-1)} />
          </div>
          <div className="flex gap-2 mt-4">
            <ClimateChip Icon={Wind}      label="Oto"   active />
            <ClimateChip Icon={Snowflake} label="Klima" />
            <ClimateChip Icon={Droplets}  label="Buğu"  />
          </div>
        </Card>

        {/* Seats */}
        <Card title="Koltuklar" sub="Konfor">
          <div className="grid grid-cols-2 gap-3">
            <SeatTile label="Sürücü ısı"  level={seatHeatDr} kind="heat" onLevelChange={setSeatHeatDr} />
            <SeatTile label="Yolcu ısı"   level={seatHeatPx} kind="heat" onLevelChange={setSeatHeatPx} />
            <SeatTile label="Sürücü hava" level={seatVentDr} kind="vent" onLevelChange={setSeatVentDr} />
            <SeatTile label="Yolcu hava"  level={seatVentPx} kind="vent" onLevelChange={setSeatVentPx} />
          </div>
        </Card>

        {/* Display & sound */}
        <Card title="Ekran & Ses" sub="Kabin Atmosferi">
          <div className="rounded-2xl p-4 mb-3"
            style={{ background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line, rgba(255,240,210,0.08))' }}>
            <div className="flex items-center gap-3 mb-2.5">
              <SunMedium className="w-4 h-4" style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }} />
              <span className="text-[14px] font-semibold">Parlaklık</span>
              <span className="ml-auto text-[13px] tabular-nums" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>68</span>
            </div>
            <Meter value={0.68} color="var(--oem-ink, #F0EBE0)" />
          </div>
          <div className="rounded-2xl p-4 mb-3"
            style={{ background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line, rgba(255,240,210,0.08))' }}>
            <div className="flex items-center gap-3 mb-2.5">
              <Volume2 className="w-4 h-4" style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }} />
              <span className="text-[14px] font-semibold">Ses</span>
              <span className="ml-auto text-[13px] tabular-nums" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>46</span>
            </div>
            <Meter value={0.46} color="var(--oem-ink, #F0EBE0)" />
          </div>
          <div className="flex gap-2">
            {(['night', 'auto', 'day'] as const).map((mode) => {
              const active = themeMode === mode;
              const Icon = mode === 'night' ? Moon : mode === 'day' ? Sun : RotateCcw;
              const label = mode === 'night' ? 'Gece' : mode === 'day' ? 'Gündüz' : 'Oto';
              return (
                <button key={mode} onClick={() => setThemeMode(mode)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-[13px] active:scale-95 transition-all"
                  style={active
                    ? {
                        background:
                          'linear-gradient(180deg, var(--oem-amber-soft, oklch(80% 0.13 60 / 0.20)), transparent 70%),' +
                          ' var(--oem-surface-3, #3D4458)',
                        border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                        color: 'var(--oem-amber, oklch(80% 0.13 60))',
                        boxShadow: '0 0 14px var(--oem-amber-glow, transparent)',
                      }
                    : {
                        background: 'transparent',
                        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                        color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                      }}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Vehicle toggles — spans 2 columns */}
        <Card title="Araç" sub="Hızlı İşlemler" span={2}>
          <div className="grid grid-cols-6 gap-3">
            <ActionTile Icon={Lock}      label="Kilit"    initial />
            <ActionTile Icon={Droplets}  label="Arka Buz" />
            <ActionTile Icon={Snowflake} label="Ön Soğut" />
            <ActionTile Icon={Zap}       label="Şarj"     />
            <ActionTile Icon={Camera}    label="360°"     />
            <ActionTile Icon={Shield}    label="Gözcü"    initial />
          </div>
        </Card>

        {/* Ambient lighting */}
        <Card title="Ortam Aydınlatması" sub="Atmosfer">
          <div className="flex gap-2 mb-4">
            {([
              { id: 'warm', color: 'oklch(78% 0.10 78)',  label: 'Sıcak' },
              { id: 'cool', color: 'oklch(82% 0.09 220)', label: 'Soğuk' },
              { id: 'off',  color: 'transparent',          label: 'Kapalı' },
            ] as const).map((a) => {
              const active = ambient === a.id;
              return (
                <button key={a.id} onClick={() => setAmbient(a.id)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] active:scale-95 transition-all"
                  style={active
                    ? {
                        background:
                          'linear-gradient(180deg, var(--oem-amber-soft, oklch(80% 0.13 60 / 0.20)), transparent 70%),' +
                          ' var(--oem-surface-3, #3D4458)',
                        border: '1px solid var(--oem-line-warm, oklch(66% 0.10 55 / 0.42))',
                        color: 'var(--oem-amber, oklch(80% 0.13 60))',
                        boxShadow: '0 0 14px var(--oem-amber-glow, transparent)',
                      }
                    : {
                        background: 'transparent',
                        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                        color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
                      }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 999,
                    background: a.color,
                    border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
                    boxShadow: a.id !== 'off' ? `0 0 12px ${a.color}` : 'none',
                    flexShrink: 0,
                  }} />
                  {a.label}
                </button>
              );
            })}
          </div>
          <div className="rounded-2xl p-4"
            style={{ background: 'var(--oem-surface-2, #303749)', border: '1px solid var(--oem-line, rgba(255,240,210,0.08))' }}>
            <div className="flex justify-between mb-2">
              <span className="text-[11px] font-black uppercase tracking-[0.20em]"
                style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>
                Yoğunluk
              </span>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--oem-ink-2, rgba(240,235,224,0.74))' }}>62</span>
            </div>
            <Meter value={0.62} color="var(--oem-amber, oklch(80% 0.13 60))" />
          </div>
        </Card>

      </div>
    </div>
  );
});

export default QuickControlsOverlay;
