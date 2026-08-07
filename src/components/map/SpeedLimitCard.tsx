/**
 * SpeedLimitCard — mini harita ve tam ekranın PAYLAŞTIĞI hız limiti kartı.
 *
 * ── TEK KART, TEK OTORİTE (görev §9) ────────────────────────────────────────
 * İki ekran aynı `EffectiveSpeedLimit` hükmünü alır ve aynı kartı çizer; farklı
 * yalnız ÖLÇEKTİR. Böylece "mini haritada 110 yazarken tam ekranda 95 yazıyor"
 * sınıfı bir çelişki YAPISAL olarak imkânsızdır.
 *
 * ── DÜRÜSTLÜK KURALLARI ─────────────────────────────────────────────────────
 *  · Gösterilebilir değilse kart HİÇ ÇİZİLMEZ — "—" veya sahte 0 YAZILMAZ.
 *  · Sayı KESİN değilse (yalnız yol sınırı / belirsiz sınıf / çelişki) çerçeve
 *    KESİKLİDİR ve altındaki etiket bunu açıkça söyler.
 *  · Kart değişiminde flaş/animasyon YOKTUR. Tek istisna hız AŞIMIDIR — o bir
 *    güvenlik sinyalidir, kart değişimi değil.
 */

import { memo } from 'react';
import {
  isEffectiveLimitDisplayable, isEffectiveLimitDefinitive,
  type EffectiveSpeedLimit,
} from '../../platform/navigation/core/vehicleAwareSpeedLimitAuthority';

export interface SpeedLimitCardProps {
  readonly limit: EffectiveSpeedLimit;
  /** `mini` = mini harita köşesi · `full` = tam ekran HUD. */
  readonly size?: 'mini' | 'full';
  /** Sürücü sınırı aşıyor mu — levha kırmızıya döner (güvenlik sinyali). */
  readonly overSpeed?: boolean;
}

const _DIM = {
  mini: { circle: 38, border: 4, font: 15, fontWide: 13, label: 7 },
  full: { circle: 52, border: 5, font: 19, fontWide: 16, label: 8 },
} as const;

export const SpeedLimitCard = memo(function SpeedLimitCard({
  limit, size = 'mini', overSpeed = false,
}: SpeedLimitCardProps) {
  if (!isEffectiveLimitDisplayable(limit)) return null;

  const kmh = limit.effectiveLimitKmh as number;
  const d = _DIM[size];
  const definitive = isEffectiveLimitDefinitive(limit);

  return (
    <div className="flex flex-col items-center" data-testid="speed-limit-card"
      data-state={limit.state} data-source-label={limit.sourceLabel}>
      <div
        className={`flex items-center justify-center rounded-full ${overSpeed ? 'animate-pulse' : ''}`}
        style={{
          width: d.circle, height: d.circle,
          background: overSpeed ? '#dc2626' : '#ffffff',
          border: `${d.border}px ${definitive ? 'solid' : 'dashed'} ${overSpeed ? '#7f1d1d' : '#d92b2b'}`,
          boxShadow: overSpeed
            ? '0 0 24px rgba(220,38,38,0.75), 0 4px 18px rgba(0,0,0,0.55)'
            : '0 2px 10px rgba(0,0,0,0.5)',
        }}
        aria-label={`Uygulanabilir hız limiti ${kmh} kilometre saat, kaynak ${limit.sourceLabel}`}
        title={limit.reason}
      >
        <span style={{
          color: overSpeed ? '#ffffff' : '#111',
          fontWeight: 900, lineHeight: 1,
          fontSize: kmh >= 100 ? d.fontWide : d.font,
          fontVariantNumeric: 'tabular-nums',
        }}>{kmh}</span>
      </div>

      {/* Küçük kaynak etiketi — sayının NEREDEN geldiğini söyler. */}
      <span
        className="font-black uppercase leading-none"
        style={{
          fontSize: d.label,
          marginTop: 3,
          letterSpacing: '0.06em',
          color: 'var(--oem-ink-2, rgba(240,235,224,0.74))',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          whiteSpace: 'nowrap',
        }}
      >
        {limit.sourceLabel}
      </span>
    </div>
  );
});
