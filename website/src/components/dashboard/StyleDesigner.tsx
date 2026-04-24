'use client';

/**
 * StyleDesigner — PWA live design studio.
 *
 * Kullanıcı renk, blur ve radius'u değiştirdiğinde araçtaki
 * CSS custom property'leri (--neon-accent, --card-blur, --card-radius)
 * Supabase vehicle_commands INSERT üzerinden anlık güncellenir.
 *
 * Zero-Leak (CLAUDE.md §1): _mounted ref, unmount sonrası state set önler.
 * Write Throttling (CLAUDE.md §3): 150ms throttle — hızlı kaydırma sırasında
 *   çok fazla INSERT atılmasını önler.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

interface Props { vehicleId: string }

/* ── Throttled Supabase INSERT ───────────────────────────── */

function useStyleSender(vehicleId: string, delayMs = 150) {
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Record<string, string>>({});

  const send = useCallback((vars: Record<string, string>) => {
    latest.current = { ...latest.current, ...vars };
    if (timer.current) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const snapshot = latest.current;
      if (!supabaseBrowser || !vehicleId) return;
      await supabaseBrowser.from('vehicle_commands').insert({
        vehicle_id: vehicleId,
        type:       'set_style',
        payload:    { vars: snapshot },
        status:     'pending',
      });
    }, delayMs);
  }, [vehicleId, delayMs]);

  // Cleanup on unmount
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return send;
}

/* ── Slider ──────────────────────────────────────────────── */

function Slider({
  label, value, min, max, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
          {label}
        </span>
        <span className="text-[10px] font-mono text-white/60">
          {value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-red-500 cursor-pointer"
        style={{ accentColor: 'var(--neon-accent, #ef4444)' }}
      />
    </div>
  );
}

/* ── Color swatch row ────────────────────────────────────── */

const ACCENT_PRESETS = [
  { label: 'Neon Red',    value: '#ef4444' },
  { label: 'Neon Cyan',   value: '#06b6d4' },
  { label: 'Neon Green',  value: '#22c55e' },
  { label: 'Neon Purple', value: '#a855f7' },
  { label: 'Neon Amber',  value: '#f59e0b' },
  { label: 'Neon White',  value: '#f8fafc' },
];

/* ── Main component ──────────────────────────────────────── */

export function StyleDesigner({ vehicleId }: Props) {
  const [accent, setAccent] = useState('#ef4444');
  const [blur,   setBlur]   = useState(12);
  const [radius, setRadius] = useState(12);
  const [sent,   setSent]   = useState(false);
  const _mounted = useRef(true);

  useEffect(() => () => { _mounted.current = false; }, []);

  const send = useStyleSender(vehicleId);

  function handleAccent(val: string) {
    setAccent(val);
    send({ '--neon-accent': val });
    flash();
  }

  function handleBlur(val: number) {
    setBlur(val);
    send({ '--card-blur': `${val}px` });
    flash();
  }

  function handleRadius(val: number) {
    setRadius(val);
    send({ '--card-radius': `${val}px` });
    flash();
  }

  function flash() {
    if (!_mounted.current) return;
    setSent(true);
    setTimeout(() => { if (_mounted.current) setSent(false); }, 800);
  }

  return (
    <div
      className="glass-panel rounded-2xl p-4 flex flex-col gap-4"
      style={{ border: '1px solid rgba(239,68,68,0.15)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-red-400 flex-shrink-0">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="7" cy="7" r="2" fill="currentColor"/>
            <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white/80">
            Live Design Studio
          </span>
        </div>
        {/* Sync flash */}
        <span
          className="text-[9px] font-semibold uppercase tracking-widest transition-opacity duration-300"
          style={{
            color:   '#ef4444',
            opacity: sent ? 1 : 0,
          }}
        >
          ● Sync
        </span>
      </div>

      {/* Accent color row */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
          Neon Accent
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => handleAccent(p.value)}
              title={p.label}
              className="w-6 h-6 rounded-full border-2 transition-all duration-150 hover:scale-110 active:scale-95"
              style={{
                background:   p.value,
                borderColor:  accent === p.value ? '#fff' : 'transparent',
                boxShadow:    accent === p.value
                  ? `0 0 10px ${p.value}99`
                  : 'none',
              }}
            />
          ))}
          {/* Custom color picker */}
          <label className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform overflow-hidden" title="Özel renk">
            <input
              type="color"
              value={accent}
              onChange={(e) => handleAccent(e.target.value)}
              className="w-8 h-8 opacity-0 absolute cursor-pointer"
            />
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="white" strokeWidth="1.3" strokeLinecap="round" opacity="0.5"/>
            </svg>
          </label>
        </div>
      </div>

      {/* Sliders */}
      <Slider
        label="Card Blur"
        value={blur}
        min={0} max={24}
        unit="px"
        onChange={handleBlur}
      />
      <Slider
        label="Card Radius"
        value={radius}
        min={0} max={24}
        unit="px"
        onChange={handleRadius}
      />

      <p className="text-[9px] text-white/20 text-center mt-1">
        Değişiklikler araca anlık iletilir
      </p>
    </div>
  );
}
