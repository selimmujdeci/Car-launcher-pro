import { memo, useState, useEffect, useCallback } from 'react';
import { Power, Thermometer, Wind, X } from 'lucide-react';

/* ── Types ──────────────────────────────────────── */

type AirMode = 'face' | 'feet' | 'both' | 'defrost';
type Heat = 0 | 1 | 2 | 3;

interface CS {
  on:     boolean;
  dTemp:  number;   // 16–30 °C sürücü
  pTemp:  number;   // 16–30 °C yolcu
  fan:    number;   // 0–7
  ac:     boolean;
  auto:   boolean;
  sync:   boolean;
  air:    AirMode;
  rear:   boolean;
  dSeat:  Heat;
  pSeat:  Heat;
  steer:  Heat;
  cabin:  number;   // simüle kabin sıcaklığı
}

const DEF: CS = {
  on: true, dTemp: 22, pTemp: 21, fan: 3,
  ac: true, auto: false, sync: false,
  air: 'face', rear: false,
  dSeat: 1, pSeat: 0, steer: 0, cabin: 29,
};

/* ── Renk hesaplamaları ──────────────────────────── */

type RGB = readonly [number, number, number];

function lc(a: RGB, b: RGB, t: number): string {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(',')})`;
}

function tc(temp: number, on = true): string {
  if (!on) return 'rgba(255,255,255,0.18)';
  const f = Math.max(0, Math.min(1, (temp - 16) / 14));
  if (f < 0.4) return lc([59, 130, 246], [16, 185, 129], f / 0.4);
  if (f < 0.7) return lc([16, 185, 129], [245, 158, 11], (f - 0.4) / 0.3);
  return lc([245, 158, 11], [239, 68, 68], (f - 0.7) / 0.3);
}

function hc(level: Heat): string {
  if (level === 1) return '#fbbf24';
  if (level === 2) return '#f97316';
  if (level === 3) return '#ef4444';
  return 'rgba(255,255,255,0.14)';
}

/* ── Dairesel sıcaklık arki ─────────────────────── */

function Arc({ temp, on }: { temp: number; on: boolean }) {
  const r = 62, cx = 80, cy = 80;
  const xy = (deg: number): [number, number] => {
    const a = (deg - 90) * (Math.PI / 180);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [sx, sy] = xy(210);
  const [ex, ey] = xy(330);
  const frac = Math.max(0, Math.min(1, (temp - 16) / 14));
  const [fx, fy] = xy(210 - frac * 240);
  const col = tc(temp, on);
  const f = (n: number) => n.toFixed(1);
  return (
    <svg width="160" height="160" viewBox="0 0 160 160" className="absolute inset-0 pointer-events-none">
      {/* arka iz */}
      <path
        d={`M${f(sx)} ${f(sy)} A${r} ${r} 0 1 1 ${f(ex)} ${f(ey)}`}
        fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="4.5" strokeLinecap="round"
      />
      {/* dolgu */}
      {frac > 0.005 && (
        <path
          d={`M${f(sx)} ${f(sy)} A${r} ${r} 0 ${frac * 240 > 180 ? 1 : 0} 1 ${f(fx)} ${f(fy)}`}
          fill="none" stroke={col} strokeWidth="4.5" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 7px ${col})`, transition: 'stroke 0.3s' }}
        />
      )}
    </svg>
  );
}

/* ── Fan animasyonu ─────────────────────────────── */

function FanViz({ speed, on }: { speed: number; on: boolean }) {
  const spinning = on && speed > 0;
  const dur = speed > 0 ? `${Math.max(0.12, 0.85 / speed)}s` : '2s';
  return (
    <svg
      width="56" height="56" viewBox="0 0 56 56"
      className={spinning ? 'animate-spin' : ''}
      style={{ animationDuration: dur, opacity: on ? 1 : 0.18, transition: 'opacity 0.3s' }}
    >
      {[0, 90, 180, 270].map(a => (
        <ellipse key={a} cx="28" cy="13" rx="5.5" ry="12"
          fill="rgba(96,165,250,0.72)" transform={`rotate(${a} 28 28)`} />
      ))}
      <circle cx="28" cy="28" r="5" fill="rgba(255,255,255,0.9)" />
    </svg>
  );
}

/* ── Küçük yardımcı butonlar ─────────────────────── */

function TmpBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center text-xl font-light rounded-2xl transition-all duration-100 active:scale-90"
      style={{
        width: 52, height: 52,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: disabled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.75)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function ModBtn({
  label, active, disabled, onClick, col,
}: { label: string; active: boolean; disabled: boolean; onClick: () => void; col: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-[9px] rounded-xl text-[11px] font-extrabold tracking-widest uppercase transition-all duration-150 active:scale-95"
      style={{
        background: active ? `${col}1e` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? col + '55' : 'rgba(255,255,255,0.08)'}`,
        color: active ? col : 'rgba(255,255,255,0.28)',
        boxShadow: active ? `0 0 14px ${col}28` : 'none',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function AirBtn({
  icon, label, active, disabled, onClick,
}: { icon: string; label: string; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 flex flex-col items-center gap-[5px] py-2.5 rounded-xl transition-all duration-150 active:scale-95"
      style={{
        background: active ? 'rgba(59,130,246,0.13)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: active ? '0 0 12px rgba(59,130,246,0.2)' : 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span
        className="text-[10px] font-bold tracking-wider uppercase leading-none"
        style={{ color: active ? '#60a5fa' : 'rgba(255,255,255,0.3)' }}
      >
        {label}
      </span>
    </button>
  );
}

function HeatCtrl({
  label, level, on, onSet, icon,
}: { label: string; level: Heat; on: boolean; onSet: (l: Heat) => void; icon?: string }) {
  const color = hc(level);
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] text-white/35 w-14 shrink-0 font-medium">{icon ? <span className="mr-1">{icon}</span> : null}{label}</span>
      <div className="flex gap-1.5">
        {([0, 1, 2, 3] as Heat[]).map(l => (
          <button
            key={l}
            onClick={() => onSet(l)}
            disabled={!on}
            className="rounded-xl flex items-center justify-center transition-all duration-120 active:scale-90"
            style={{
              width: 32, height: 30,
              background: level === l ? (l === 0 ? 'rgba(255,255,255,0.08)' : `${hc(l)}28`) : 'rgba(255,255,255,0.03)',
              border: `1px solid ${level === l ? (l === 0 ? 'rgba(255,255,255,0.2)' : hc(l) + '66') : 'rgba(255,255,255,0.06)'}`,
              boxShadow: level === l && l > 0 ? `0 0 8px ${hc(l)}35` : 'none',
              cursor: on ? 'pointer' : 'default',
            }}
          >
            <span className="text-[10px] font-extrabold"
              style={{ color: level === l ? (l === 0 ? 'rgba(255,255,255,0.5)' : hc(l)) : 'rgba(255,255,255,0.2)' }}>
              {l === 0 ? '✕' : l}
            </span>
          </button>
        ))}
      </div>
      {level > 0 && on && (
        <div className="flex gap-0.5">
          {Array.from({ length: level }, (_, i) => (
            <div key={i} className="rounded-full" style={{ width: 5, height: 5, background: color }} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Ana bileşen ─────────────────────────────────── */

export const ClimateScreen = memo(function ClimateScreen({ onClose }: { onClose?: () => void }) {
  const [s, setS] = useState<CS>(DEF);

  /* Kabin sıcaklığı simülasyonu */
  useEffect(() => {
    if (!s.on || s.fan === 0) return;
    const target = (s.dTemp + s.pTemp) / 2;
    const id = setInterval(() => {
      setS(p => {
        const diff = target - p.cabin;
        if (Math.abs(diff) < 0.15) return p;
        return { ...p, cabin: +(p.cabin + Math.sign(diff) * s.fan * 0.05).toFixed(2) };
      });
    }, 900);
    return () => clearInterval(id);
  }, [s.on, s.fan, s.dTemp, s.pTemp]);

  const upd = useCallback(<K extends keyof CS>(key: K, val: CS[K]) => {
    setS(p => {
      const next: CS = { ...p, [key]: val };
      if (key === 'dTemp' && p.sync) next.pTemp = val as number;
      if (key === 'pTemp' && p.sync) next.dTemp = val as number;
      if (key === 'auto' && (val as boolean)) { next.ac = true; next.fan = 4; }
      return next;
    });
  }, []);

  const toggleSync = () => setS(p => ({
    ...p, sync: !p.sync, pTemp: !p.sync ? p.dTemp : p.pTemp,
  }));

  const dColor = tc(s.dTemp, s.on);
  const pColor = tc(s.pTemp, s.on);

  return (
    <div
      className="flex flex-col h-full text-white select-none overflow-hidden"
      style={{ background: 'linear-gradient(155deg, #060c1a 0%, #030810 100%)' }}
    >
      {/* ── Başlık ── */}
      <header className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <Wind size={16} className="text-blue-400/70" />
          <span className="text-[13px] font-bold tracking-[0.18em] uppercase text-white/55">
            İklim Kontrolü
          </span>
        </div>

        {/* Kabin sıcaklığı */}
        <div
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
        >
          <Thermometer size={13} className="text-amber-400" />
          <span className="text-[13px] font-mono font-bold tracking-widest">
            {s.cabin.toFixed(1)}°C
          </span>
          <span className="text-[11px] text-white/35 ml-0.5">kabin</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Güç butonu */}
          <button
            onClick={() => upd('on', !s.on)}
            className="flex items-center justify-center rounded-full transition-all duration-200 active:scale-90"
            style={{
              width: 44, height: 44,
              background: s.on ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${s.on ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.1)'}`,
              boxShadow: s.on ? '0 0 18px rgba(16,185,129,0.18)' : 'none',
            }}
          >
            <Power size={17} color={s.on ? '#10b981' : 'rgba(255,255,255,0.25)'} />
          </button>

          {/* Kapat butonu */}
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-full transition-all duration-200 active:scale-90"
              style={{
                width: 44, height: 44,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
              }}
            >
              <X size={18} color="rgba(255,255,255,0.70)" />
            </button>
          )}
        </div>
      </header>

      {/* ── Ayırıcı çizgi ── */}
      <div className="shrink-0 mx-6 h-px" style={{ background: 'rgba(255,255,255,0.055)' }} />

      {/* ── Ana Bölge: Sürücü | Fan/Modlar | Yolcu ── */}
      <div className="flex items-center justify-center gap-3 px-4 py-4 flex-1 min-h-0">

        {/* Sürücü */}
        <div className="flex-1 flex flex-col items-center gap-3">
          <span className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-white/25">Sürücü</span>
          <div className="relative" style={{ width: 160, height: 160 }}>
            <Arc temp={s.dTemp} on={s.on} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span
                className="text-[42px] font-bold tabular-nums leading-none transition-colors duration-300"
                style={{ color: s.on ? dColor : 'rgba(255,255,255,0.18)', fontVariantNumeric: 'tabular-nums' }}
              >
                {s.dTemp.toFixed(1)}
              </span>
              <span className="text-xs text-white/28 mt-0.5">°C</span>
            </div>
          </div>
          <div className="flex gap-3">
            <TmpBtn label="−" disabled={!s.on}
              onClick={() => upd('dTemp', Math.max(16, +(s.dTemp - 0.5).toFixed(1)))} />
            <TmpBtn label="+" disabled={!s.on}
              onClick={() => upd('dTemp', Math.min(30, +(s.dTemp + 0.5).toFixed(1)))} />
          </div>
        </div>

        {/* Merkez: Fan + Mod butonları */}
        <div className="flex flex-col items-center gap-3 shrink-0" style={{ width: 176 }}>
          <FanViz speed={s.fan} on={s.on} />

          {/* Fan hızı çubukları */}
          <div className="flex gap-1.5 items-end h-9">
            {Array.from({ length: 7 }, (_, i) => (
              <button
                key={i}
                onClick={() => upd('fan', s.fan === i + 1 ? 0 : i + 1)}
                disabled={!s.on || s.auto}
                style={{
                  width: 14,
                  height: 10 + i * 4,
                  borderRadius: 4,
                  background: s.fan > i && s.on
                    ? `rgba(96,165,250,${0.45 + i * 0.08})`
                    : 'rgba(255,255,255,0.07)',
                  border: 'none',
                  cursor: s.on && !s.auto ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
          <span className="text-[10px] text-white/25 font-bold tracking-widest">
            {s.fan === 0 ? 'KAPALI' : `HIZ ${s.fan}`}
          </span>

          {/* Mod butonları */}
          <div className="flex flex-col gap-2 w-full">
            <ModBtn label="A/C"  active={s.ac && s.on}   disabled={!s.on}
              onClick={() => upd('ac', !s.ac)} col="#3b82f6" />
            <ModBtn label="AUTO" active={s.auto && s.on} disabled={!s.on}
              onClick={() => upd('auto', !s.auto)} col="#10b981" />
            <ModBtn label="SYNC" active={s.sync && s.on} disabled={!s.on}
              onClick={toggleSync} col="#8b5cf6" />
          </div>
        </div>

        {/* Yolcu */}
        <div className="flex-1 flex flex-col items-center gap-3">
          <span className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-white/25">Yolcu</span>
          <div className="relative" style={{ width: 160, height: 160 }}>
            <Arc temp={s.pTemp} on={s.on} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span
                className="text-[42px] font-bold tabular-nums leading-none transition-colors duration-300"
                style={{ color: s.on ? pColor : 'rgba(255,255,255,0.18)', fontVariantNumeric: 'tabular-nums' }}
              >
                {s.pTemp.toFixed(1)}
              </span>
              <span className="text-xs text-white/28 mt-0.5">°C</span>
            </div>
          </div>
          <div className="flex gap-3">
            <TmpBtn label="−" disabled={!s.on || s.sync}
              onClick={() => upd('pTemp', Math.max(16, +(s.pTemp - 0.5).toFixed(1)))} />
            <TmpBtn label="+" disabled={!s.on || s.sync}
              onClick={() => upd('pTemp', Math.min(30, +(s.pTemp + 0.5).toFixed(1)))} />
          </div>
        </div>
      </div>

      {/* ── Hava yönü ── */}
      <div className="shrink-0 px-4 pb-3">
        <div
          className="rounded-2xl p-4"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}
        >
          <p className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-white/22 mb-3">
            Hava Yönü
          </p>
          <div className="flex gap-2">
            <AirBtn icon="😊" label="Yüz"      active={s.air === 'face'    && s.on} disabled={!s.on} onClick={() => upd('air', 'face')} />
            <AirBtn icon="👣" label="Ayak"     active={s.air === 'feet'    && s.on} disabled={!s.on} onClick={() => upd('air', 'feet')} />
            <AirBtn icon="🌬️" label="İkisi"    active={s.air === 'both'    && s.on} disabled={!s.on} onClick={() => upd('air', 'both')} />
            <AirBtn icon="❄️" label="Ön Cam"   active={s.air === 'defrost' && s.on} disabled={!s.on} onClick={() => upd('air', 'defrost')} />
            <div className="w-px self-stretch mx-0.5" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <AirBtn icon="🔆" label="Arka Cam" active={s.rear && s.on} disabled={!s.on} onClick={() => upd('rear', !s.rear)} />
          </div>
        </div>
      </div>

      {/* ── Koltuk ısıtma + Direksiyon ── */}
      <div className="shrink-0 px-4 pb-5">
        <div
          className="rounded-2xl p-4"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}
        >
          <div className="flex gap-6 items-start">
            <div className="flex-1">
              <p className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-white/22 mb-3">
                Koltuk Isıtma
              </p>
              <div className="flex flex-col gap-2.5">
                <HeatCtrl label="Sürücü" level={s.dSeat} on={s.on} onSet={l => upd('dSeat', l)} />
                <HeatCtrl label="Yolcu"  level={s.pSeat} on={s.on} onSet={l => upd('pSeat', l)} />
              </div>
            </div>
            <div className="w-px self-stretch" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <div>
              <p className="text-[10px] font-extrabold tracking-[0.2em] uppercase text-white/22 mb-3">
                Direksiyon
              </p>
              <HeatCtrl label="" level={s.steer} on={s.on} onSet={l => upd('steer', l)} icon="🚗" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
