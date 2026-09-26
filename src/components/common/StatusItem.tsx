/**
 * StatusItem — durum çubuğunun TEK öğe bileşeni (Wi-Fi · BT · OBD · GPS · AI · ses).
 *
 * İkon + KISA ETİKET + anlamsal durum noktası. Durum renkleri tema accent'inden
 * BAĞIMSIZDIR: bağlı → yeşil nokta · bağlanıyor/zayıf → turuncu · hata → kırmızı
 * · kapalı → soluk, nokta yok. Bağlıyken KOPARSA öğe kırmızı yanıp söner,
 * bağlanınca kısa yeşil parlama — CSS-only (index.css `caros-status-*`), JS timer YOK.
 */
import { memo, useState, useEffect, useRef } from 'react';
import type { CSSProperties, ComponentType } from 'react';
import type { StatusPalette } from './StatusControls';

export type StatusItemState = 'ok' | 'active' | 'warn' | 'error' | 'off' | 'neutral';

/** Açık zemin mi (koyu mürekkep) — metin renginin koyu/açık tonunu seçmek için. */
function isLightSurface(ink: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(ink.trim());
  const rgb = m
    ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    : (/rgba?\(([^)]+)\)/i.exec(ink)?.[1].split(',').slice(0, 3).map((v) => parseFloat(v)) ?? null);
  if (!rgb || rgb.some((v) => !Number.isFinite(v))) return false;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;   // mürekkep koyu → zemin açık
}

/** Anlamsal renkler — nokta her zeminde parlak; metin, zemine göre okunur tonda. */
function semantic(state: StatusItemState, light: boolean): { dot: string | null; text: string | null } {
  switch (state) {
    case 'ok':     return { dot: '#22c55e', text: null };
    case 'active':
    case 'warn':   return { dot: '#f59e0b', text: light ? '#b45309' : '#fbbf24' };
    case 'error':  return { dot: '#ef4444', text: light ? '#b91c1c' : '#f87171' };
    default:       return { dot: null, text: null };
  }
}

/**
 * Durum geçişinin görsel geri bildirimi — SAF. Bağlıyken kopma/hata → 'drop'
 * (kırmızı yanıp sönme); bağlı olmayandan bağlıya → 'up' (kısa yeşil parlama).
 * Bağlanıyor ↔ zayıf gibi ara geçişler sessizdir (gürültü üretmez).
 */
export function flashFor(prev: StatusItemState, next: StatusItemState): 'drop' | 'up' | null {
  if (prev === next) return null;
  if (prev === 'ok' && (next === 'off' || next === 'error')) return 'drop';
  if (prev !== 'ok' && next === 'ok') return 'up';
  return null;
}

type StatusIcon = ComponentType<{ style?: CSSProperties; 'aria-hidden'?: boolean }>;

export const StatusItem = memo(function StatusItem({
  Icon, state, caption, label, onClick, palette, size, pulseClassName,
}: {
  Icon: StatusIcon;
  state: StatusItemState;
  /** Öğenin altındaki kısa etiket (ör. "OBD", "V-LINK", "45%"). */
  caption: string;
  /** Tam durum cümlesi — aria-label + title. */
  label: string;
  onClick?: () => void;
  palette: StatusPalette;
  size: number;
  /** Bağlanıyor ('active') durumunda noktaya verilecek animasyon sınıfı. */
  pulseClassName?: string;
}) {
  /* Kopma / bağlanma geçişi — önceki durum ref'te; parlama öğesi `key` ile
     yeniden takılıp CSS animasyonunu BİR KEZ oynar (timer YOK). */
  const prev = useRef(state);
  const [flash, setFlash] = useState<{ kind: 'drop' | 'up'; seq: number } | null>(null);
  useEffect(() => {
    const kind = flashFor(prev.current, state);
    prev.current = state;
    if (kind) setFlash((f) => ({ kind, seq: (f?.seq ?? 0) + 1 }));
  }, [state]);

  const light = isLightSurface(palette.ink);
  const { dot, text } = semantic(state, light);
  const off = state === 'off';
  const iconColor = state === 'error' ? (text ?? palette.ink) : off ? palette.ink2 : palette.ink;
  const captionColor = text ?? (off ? palette.ink2 : palette.ink);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-state={state}
      className="caros-status-item"
      style={{
        position: 'relative', background: 'transparent', border: 'none',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 3, padding: '3px 6px', borderRadius: 10, minWidth: 40, minHeight: 40,
      }}
    >
      <span style={{ position: 'relative', display: 'flex' }}>
        <Icon aria-hidden style={{ width: size, height: size, flexShrink: 0, color: iconColor, opacity: off ? 0.42 : 1 }} />
        {dot && (
          <span
            aria-hidden
            className={state === 'active' ? pulseClassName : undefined}
            style={{
              position: 'absolute', right: -4, bottom: -2, width: 8, height: 8, borderRadius: 999,
              background: dot, boxShadow: palette.surface ? `0 0 0 2px ${palette.surface}` : undefined,
            }}
          />
        )}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: '0.07em', lineHeight: 1, textTransform: 'uppercase',
        color: captionColor, opacity: off ? 0.55 : 1,
        maxWidth: 58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {caption}
      </span>
      {flash && <span key={flash.seq} aria-hidden className={`caros-status-flash caros-status-flash-${flash.kind}`} />}
    </button>
  );
});
