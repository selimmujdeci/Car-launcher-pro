'use client';

/**
 * ColorPicker — SINIRSIZ renk seçici (Tema Stüdyo).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Kullanıcı: *"renkler yeterli değil sınırsız renk lazım ve yazılarda da renk
 * az."* Ölçülen durum: renk alanları 16 hazır renk + native `<input
 * type="color">` sunuyordu. Native seçici tarayıcıya göre değişir, saydamlığı
 * HİÇ vermez ve küçük bir kare olduğu için "buradan her rengi seçebilirim"
 * bilgisini taşımıyordu — kullanıcı pratikte 16 renge mahkûmdu.
 *
 * Bu seçici tüm RGB uzayını + saydamlığı verir: doygunluk/parlaklık alanı ·
 * ton şeridi · saydamlık şeridi · hex girişi · son kullanılanlar.
 *
 * SÖZLEŞME
 *  · Matematik `@/lib/theme/colorMath`te; bu dosya yalnız ETKİLEŞİM ve çizim.
 *  · Tek kanonik yazım: hex (`#RRGGBB` ya da alfa varsa `#RRGGBBAA`).
 *    Manifest bunu zaten kabul ediyordu (`isSafeColor`) — yeni bir renk
 *    sözleşmesi KURULMADI.
 *  · Sürüklerken `onChange` kare başına EN ÇOK BİR kez çağrılır (rAF) — her
 *    değişim iframe'e canlı manifest yayını tetikler; 60 Hz'de sel olurdu.
 *  · Dokunmatik: `setPointerCapture` ile parmak alandan çıksa da takip sürer.
 *  · Klavye: ton ve saydamlık şeritleri `role="slider"`, ok tuşlarıyla değişir.
 *  · Zero-leak: pointer dinleyicileri elemanın kendisindedir (React), rAF
 *    unmount'ta iptal edilir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hsvToHex, parseToHsv, rgbaToHex, hsvToRgb, type Hsva,
} from '@/lib/theme/colorMath';

/* ── Son kullanılan renkler — tüm alanlarda ORTAK ──────────────────────────
 * Kullanıcının kendi paletini biriktirmesi, hazır listeyi büyütmekten daha
 * işe yarar: 16 renk kimseye yetmez, ama "az önce kullandığım 12 renk" tam
 * olarak o kişinin paletidir. */
const RECENT_KEY = 'caros.studio.recentColors.v1';
const RECENT_MAX = 12;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX);
  } catch { return []; }
}

/** Dışa açık: bir rengi "son kullanılanlar"a yaz (en öne, tekrarsız). */
export function rememberColor(hex: string): void {
  try {
    const cur = readRecents().filter((c) => c.toLowerCase() !== hex.toLowerCase());
    cur.unshift(hex);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)));
  } catch { /* kota / gizli mod — renk seçimi yine çalışır */ }
}

/* ── Damalı saydamlık zemini (tek kaynak) ─────────────────────────────────── */
export const CHECKER_BG =
  'repeating-conic-gradient(#8a8a8a 0% 25%, #cfcfcf 0% 50%) 50% / 12px 12px';

const DEFAULT_HSV: Hsva = { h: 210, s: 0.6, v: 0.9, a: 1 };

/** Normalleştirilmiş (0–1) konumu bir elemanın dikdörtgeninden çıkar. */
function ratioFromEvent(
  el: HTMLElement, clientX: number, clientY: number,
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const x = r.width <= 0 ? 0 : (clientX - r.left) / r.width;
  const y = r.height <= 0 ? 0 : (clientY - r.top) / r.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

interface Props {
  /** Mevcut değer (herhangi bir desteklenen yazım) — `null` = tema varsayılanı. */
  value: string | null;
  onChange: (hex: string) => void;
  /** Saydamlık şeridi gösterilsin mi (zemin alanlarında anlamlı, yazıda genelde değil). */
  allowAlpha?: boolean;
  /** Hızlı erişim renkleri — hazır palet ya da nötr yazı rampası. */
  swatches?: readonly string[];
  swatchLabel?: string;
}

export const ColorPicker = memo(function ColorPicker({
  value, onChange, allowAlpha = true, swatches, swatchLabel,
}: Props) {
  /* Sürükleme sırasında tek gerçek kaynak BURASIDIR; dışarıdan gelen `value`
     yalnız sürükleme YOKKEN içeri alınır (yoksa parmak altında zıplar). */
  const [hsv, setHsv] = useState<Hsva>(() => parseToHsv(value) ?? DEFAULT_HSV);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => { setRecents(readRecents()); }, []);

  useEffect(() => {
    if (draggingRef.current) return;
    const next = parseToHsv(value);
    if (next) setHsv(next);
  }, [value]);

  /* rAF kısıtlaması: kare başına en çok bir `onChange`. */
  const emit = useCallback((hex: string) => {
    pendingRef.current = hex;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const v = pendingRef.current;
      pendingRef.current = null;
      if (v !== null) onChange(v);
    });
  }, [onChange]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const apply = useCallback((next: Hsva) => {
    setHsv(next);
    emit(hsvToHex(next));
  }, [emit]);

  /** Sürükleme bitince rengi "son kullanılanlar"a yaz. */
  const commit = useCallback((next: Hsva) => {
    const hex = hsvToHex(next);
    rememberColor(hex);
    setRecents(readRecents());
    onChange(hex);
  }, [onChange]);

  const hueHex = useMemo(
    () => rgbaToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 })),
    [hsv.h],
  );
  const solidHex = useMemo(
    () => rgbaToHex(hsvToRgb({ ...hsv, a: 1 })),
    [hsv],
  );
  const previewHex = useMemo(() => hsvToHex(hsv), [hsv]);

  /* ── Doygunluk / parlaklık alanı ─────────────────────────────── */
  const svPointer = useCallback((e: React.PointerEvent<HTMLDivElement>, end = false) => {
    const el = e.currentTarget;
    const { x, y } = ratioFromEvent(el, e.clientX, e.clientY);
    const next: Hsva = { ...hsv, s: x, v: 1 - y };
    if (end) commit(next); else apply(next);
  }, [hsv, apply, commit]);

  /* ── Ton / saydamlık şeritleri ───────────────────────────────── */
  const stripPointer = useCallback((
    e: React.PointerEvent<HTMLDivElement>, kind: 'hue' | 'alpha', end = false,
  ) => {
    const { x } = ratioFromEvent(e.currentTarget, e.clientX, e.clientY);
    const next: Hsva = kind === 'hue'
      ? { ...hsv, h: x * 360 }
      : { ...hsv, a: x };
    if (end) commit(next); else apply(next);
  }, [hsv, apply, commit]);

  const onKeyStrip = useCallback((e: React.KeyboardEvent, kind: 'hue' | 'alpha') => {
    const big = e.shiftKey;
    let d = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = 1;
    else return;
    e.preventDefault();
    const next: Hsva = kind === 'hue'
      ? { ...hsv, h: (((hsv.h + d * (big ? 15 : 3)) % 360) + 360) % 360 }
      : { ...hsv, a: Math.min(1, Math.max(0, hsv.a + d * (big ? 0.1 : 0.02))) };
    commit(next);
  }, [hsv, commit]);

  const startDrag = (e: React.PointerEvent) => {
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* eski WebView */ }
  };
  const endDrag = (e: React.PointerEvent) => {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const quick = swatches ?? [];

  return (
    <div className="flex flex-col gap-2" data-color-picker>
      {/* Doygunluk × parlaklık */}
      <div
        role="application"
        aria-label="Doygunluk ve parlaklık alanı"
        onPointerDown={(e) => { startDrag(e); svPointer(e); }}
        onPointerMove={(e) => { if (draggingRef.current) svPointer(e); }}
        onPointerUp={(e) => { svPointer(e, true); endDrag(e); }}
        onPointerCancel={endDrag}
        className="relative w-full rounded-xl"
        style={{
          height: 150,
          touchAction: 'none',
          background:
            `linear-gradient(to top, #000, transparent), `
            + `linear-gradient(to right, #fff, ${hueHex})`,
          border: '1px solid var(--pwa-border)',
          cursor: 'crosshair',
        }}
      >
        <span
          aria-hidden
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 20, height: 20,
            left: `calc(${(hsv.s * 100).toFixed(2)}% - 10px)`,
            top: `calc(${((1 - hsv.v) * 100).toFixed(2)}% - 10px)`,
            border: '2.5px solid #fff',
            boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.5)',
            background: solidHex,
          }}
        />
      </div>

      {/* Ton */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Renk tonu"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={(e) => onKeyStrip(e, 'hue')}
        onPointerDown={(e) => { startDrag(e); stripPointer(e, 'hue'); }}
        onPointerMove={(e) => { if (draggingRef.current) stripPointer(e, 'hue'); }}
        onPointerUp={(e) => { stripPointer(e, 'hue', true); endDrag(e); }}
        onPointerCancel={endDrag}
        className="relative w-full rounded-xl"
        style={{
          height: 34,
          touchAction: 'none',
          background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          border: '1px solid var(--pwa-border)',
        }}
      >
        <span
          aria-hidden
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 22, height: 22, top: 5,
            left: `calc(${((hsv.h / 360) * 100).toFixed(2)}% - 11px)`,
            border: '2.5px solid #fff',
            boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55)',
            background: hueHex,
          }}
        />
      </div>

      {/* Saydamlık */}
      {allowAlpha && (
        <div
          role="slider"
          tabIndex={0}
          aria-label="Saydamlık"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.a * 100)}
          onKeyDown={(e) => onKeyStrip(e, 'alpha')}
          onPointerDown={(e) => { startDrag(e); stripPointer(e, 'alpha'); }}
          onPointerMove={(e) => { if (draggingRef.current) stripPointer(e, 'alpha'); }}
          onPointerUp={(e) => { stripPointer(e, 'alpha', true); endDrag(e); }}
          onPointerCancel={endDrag}
          className="relative w-full rounded-xl overflow-hidden"
          style={{ height: 34, touchAction: 'none', background: CHECKER_BG, border: '1px solid var(--pwa-border)' }}
        >
          <span
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: `linear-gradient(to right, transparent, ${solidHex})` }}
          />
          <span
            aria-hidden
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 22, height: 22, top: 5,
              left: `calc(${(hsv.a * 100).toFixed(2)}% - 11px)`,
              border: '2.5px solid #fff',
              boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55)',
              background: previewHex,
            }}
          />
        </div>
      )}

      {/* Değer + hızlı renkler */}
      <div className="flex items-center gap-2">
        <span
          aria-label="Seçili renk"
          className="rounded-lg flex-shrink-0"
          style={{ width: 40, height: 34, background: CHECKER_BG, border: '1px solid var(--pwa-border)' }}
        >
          <span className="block w-full h-full rounded-lg" style={{ background: previewHex }} />
        </span>
        <code
          className="text-[11px] font-mono px-2 py-1 rounded-lg flex-1 min-w-0 truncate"
          style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
        >
          {previewHex.toUpperCase()}
        </code>
      </div>

      {quick.length > 0 && (
        <div>
          {swatchLabel && (
            <p className="text-[9px] font-black uppercase tracking-[0.25em] mb-1.5"
              style={{ color: 'var(--pwa-text-3)' }}>{swatchLabel}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {quick.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  const next = parseToHsv(c);
                  if (next) { setHsv(next); commit(next); }
                }}
                className="rounded-lg active:scale-90"
                style={{
                  width: 34, height: 34, background: CHECKER_BG,
                  border: previewHex.toLowerCase() === c.toLowerCase()
                    ? '2.5px solid #fff' : '1px solid var(--pwa-border)',
                }}
              >
                <span className="block w-full h-full rounded-md" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {recents.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.25em] mb-1.5"
            style={{ color: 'var(--pwa-text-3)' }}>Son Kullandıkların</p>
          <div className="flex flex-wrap gap-1.5">
            {recents.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  const next = parseToHsv(c);
                  if (next) { setHsv(next); commit(next); }
                }}
                className="rounded-lg active:scale-90"
                style={{ width: 34, height: 34, background: CHECKER_BG, border: '1px solid var(--pwa-border)' }}
              >
                <span className="block w-full h-full rounded-md" style={{ background: c }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
