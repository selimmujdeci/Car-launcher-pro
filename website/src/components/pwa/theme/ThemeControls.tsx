'use client';

/**
 * ThemeControls — Tema Stüdyo tam ekran editörünün girdi ilkelleri.
 *
 * MOBİL ÖNCELİK (görev §10): her kontrol en az 44 px dokunma yüksekliğinde,
 * yatay taşma yok, slider'lar tam genişlik, renk seçici büyük kare.
 *
 * MİRAS KURALI: her alanın "Tema varsayılanı" (null) hâli VARDIR ve tek dokunuşla
 * geri alınır. Null = araçta tema kendi rengini kullanır → kullanıcı bir alana
 * dokunmadıkça araç görünümü DEĞİŞMEZ.
 */

import { memo, useCallback } from 'react';
import {
  isSafeColor,
  makeSolid,
  paintToCss,
  type Paint,
  type PaintKind,
} from '@/lib/theme/themeManifest';

/* ── Ortak kabuk ──────────────────────────────────────────────────── */

export function FieldRow({
  label, hint, inherited, onReset, children,
}: {
  label: string;
  hint?: string;
  inherited: boolean;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl p-3"
      style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-bold truncate" style={{ color: 'var(--pwa-text-2)' }}>{label}</p>
          {hint && <p className="text-[10px] mt-0.5" style={{ color: 'var(--pwa-text-3)' }}>{hint}</p>}
        </div>
        {inherited ? (
          <span
            className="text-[9px] font-bold px-2 py-1 rounded-lg flex-shrink-0"
            style={{ background: 'var(--pwa-surface)', color: 'var(--pwa-text-3)' }}
          >
            TEMA VARSAYILANI
          </span>
        ) : (
          <button
            type="button"
            onClick={onReset}
            className="text-[9px] font-bold px-2.5 py-1.5 rounded-lg flex-shrink-0 active:scale-95"
            style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171' }}
          >
            GERİ AL
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── Renk ─────────────────────────────────────────────────────────── */

export const COLOR_SWATCHES = [
  '#F2871C', '#E0822E', '#5B8DFF', '#E31937',
  '#D4AF37', '#00D4FF', '#22C55E', '#A855F7',
  '#F59E0B', '#EC4899', '#FFFFFF', '#94A0B8',
  '#131C10', '#111A2B', '#221B13', '#101117',
];

export const ColorField = memo(function ColorField({
  label, hint, value, onChange, swatches = COLOR_SWATCHES,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  swatches?: string[];
}) {
  const current = value ?? '#808080';
  return (
    <FieldRow label={label} hint={hint} inherited={value === null} onReset={() => onChange(null)}>
      <div className="flex items-center gap-3">
        <label className="relative flex-shrink-0" style={{ width: 52, height: 44 }}>
          <span
            className="absolute inset-0 rounded-xl block"
            style={{
              background: value ?? 'repeating-linear-gradient(45deg, #444 0 6px, #666 6px 12px)',
              border: '2px solid var(--pwa-border)',
            }}
          />
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#808080'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full"
            aria-label={`${label} rengi`}
          />
        </label>
        <input
          type="text"
          inputMode="text"
          value={value ?? ''}
          placeholder="tema varsayılanı"
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v === '') onChange(null);
            else if (isSafeColor(v)) onChange(v);
          }}
          className="flex-1 min-w-0 text-[12px] font-mono rounded-xl px-3"
          style={{
            height: 44,
            background: 'var(--pwa-surface)',
            border: '1px solid var(--pwa-border)',
            color: 'var(--pwa-text-2)',
          }}
          aria-label={`${label} renk kodu`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={c}
            className="rounded-xl active:scale-90"
            style={{
              width: 40, height: 40, backgroundColor: c,
              border: value === c ? '3px solid #fff' : '1.5px solid var(--pwa-border)',
            }}
          />
        ))}
      </div>
    </FieldRow>
  );
});

/* ── Sayı (slider) ────────────────────────────────────────────────── */

export const NumberField = memo(function NumberField({
  label, hint, value, min, max, step = 1, unit = '', fallback, onChange,
}: {
  label: string;
  hint?: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Slider'ın null iken göstereceği başlangıç (temanın makul değeri). */
  fallback: number;
  onChange: (v: number | null) => void;
}) {
  const shown = value ?? fallback;
  return (
    <FieldRow label={label} hint={hint} inherited={value === null} onReset={() => onChange(null)}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 min-w-0"
          style={{ height: 32, accentColor: '#60a5fa' }}
          aria-label={label}
        />
        <span
          className="text-[12px] font-mono tabular-nums text-right flex-shrink-0"
          style={{ width: 62, color: value === null ? 'var(--pwa-text-3)' : 'var(--pwa-text-2)' }}
        >
          {Number.isInteger(shown) ? shown : shown.toFixed(2)}{unit}
        </span>
      </div>
    </FieldRow>
  );
});

/* ── Seçim ────────────────────────────────────────────────────────── */

export function ChoiceField<T extends string>({
  label, hint, value, options, onChange,
}: {
  label: string;
  hint?: string;
  value: T | null;
  options: { id: T; label: string; preview?: React.CSSProperties }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <FieldRow label={label} hint={hint} inherited={value === null} onReset={() => onChange(null)}>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="rounded-xl px-3 text-[12px] font-semibold active:scale-95"
            style={{
              minHeight: 46,
              background: value === o.id ? 'rgba(96,165,250,0.16)' : 'var(--pwa-surface)',
              border: `1.5px solid ${value === o.id ? 'rgba(96,165,250,0.5)' : 'var(--pwa-border)'}`,
              color: value === o.id ? '#60a5fa' : 'var(--pwa-text-2)',
              ...o.preview,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </FieldRow>
  );
}

/* ── Aç/Kapat ─────────────────────────────────────────────────────── */

export const ToggleField = memo(function ToggleField({
  label, hint, value, onChange, disabled, disabledNote,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  disabled?: boolean;
  disabledNote?: string;
}) {
  return (
    <FieldRow label={label} hint={hint} inherited={value === null} onReset={() => onChange(null)}>
      {disabled ? (
        <p className="text-[11px]" style={{ color: '#fbbf24' }}>{disabledNote ?? 'Bu bileşen gizlenemez.'}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: true, label: 'Görünür' },
            { v: false, label: 'Gizli' },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => onChange(o.v)}
              className="rounded-xl text-[12px] font-semibold active:scale-95"
              style={{
                minHeight: 46,
                background: value === o.v ? 'rgba(96,165,250,0.16)' : 'var(--pwa-surface)',
                border: `1.5px solid ${value === o.v ? 'rgba(96,165,250,0.5)' : 'var(--pwa-border)'}`,
                color: value === o.v ? '#60a5fa' : 'var(--pwa-text-2)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </FieldRow>
  );
});

/* ── Arka plan (boya: düz / gradient) ─────────────────────────────── */

const PAINT_KIND_LABEL: Record<PaintKind, string> = {
  solid: 'Tek Renk',
  linear: 'Doğrusal',
  radial: 'Dairesel',
};

export const PaintField = memo(function PaintField({
  label, hint, value, onChange,
}: {
  label: string;
  hint?: string;
  value: Paint | null;
  onChange: (v: Paint | null) => void;
}) {
  const patch = useCallback((p: Partial<Paint>) => {
    const base: Paint = value ?? makeSolid('#1a1a1a');
    const next: Paint = { ...base, ...p };
    if (next.kind !== 'solid' && !next.to) next.to = '#000000';
    onChange(next);
  }, [value, onChange]);

  return (
    <FieldRow label={label} hint={hint} inherited={value === null} onReset={() => onChange(null)}>
      <div
        className="rounded-xl"
        style={{ height: 52, background: value ? paintToCss(value) : 'repeating-linear-gradient(45deg, #333 0 8px, #555 8px 16px)', border: '1px solid var(--pwa-border)' }}
      />
      <div className="grid grid-cols-3 gap-2">
        {(['solid', 'linear', 'radial'] as PaintKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => patch({ kind: k })}
            className="rounded-xl text-[11px] font-semibold active:scale-95"
            style={{
              minHeight: 42,
              background: value?.kind === k ? 'rgba(96,165,250,0.16)' : 'var(--pwa-surface)',
              border: `1.5px solid ${value?.kind === k ? 'rgba(96,165,250,0.5)' : 'var(--pwa-border)'}`,
              color: value?.kind === k ? '#60a5fa' : 'var(--pwa-text-2)',
            }}
          >
            {PAINT_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <ColorField
        label="1. Renk"
        value={value?.from ?? null}
        onChange={(c) => (c === null ? onChange(null) : patch({ from: c }))}
      />

      {value && value.kind !== 'solid' && (
        <>
          <ColorField
            label="2. Renk"
            value={value.to}
            onChange={(c) => patch({ to: c ?? '#000000' })}
          />
          {value.kind === 'linear' && (
            <NumberField label="Gradient Yönü" value={value.angle} min={0} max={360} unit="°" fallback={180}
              onChange={(v) => patch({ angle: v ?? 180 })} />
          )}
          <NumberField label="1. Durak" value={value.stopA} min={0} max={100} unit="%" fallback={0}
            onChange={(v) => patch({ stopA: v ?? 0 })} />
          <NumberField label="2. Durak" value={value.stopB} min={0} max={100} unit="%" fallback={100}
            onChange={(v) => patch({ stopB: v ?? 100 })} />
        </>
      )}

      {value && (
        <NumberField label="Saydamlık" value={value.alpha} min={0} max={100} unit="%" fallback={100}
          onChange={(v) => patch({ alpha: v ?? 100 })} />
      )}
    </FieldRow>
  );
});

/* ── Bölüm başlığı ────────────────────────────────────────────────── */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-black uppercase tracking-[0.3em] mt-2 mb-1"
      style={{ color: 'var(--pwa-text-3)' }}
    >
      {children}
    </p>
  );
}
