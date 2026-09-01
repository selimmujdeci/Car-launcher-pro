/**
 * DrivingSpeed — P0-NAV-04 · hız + KANITLI hız limiti.
 *
 * ── OTORİTE (dokunulmadı) ─────────────────────────────────────────────────
 *  · Hız: `useDisplaySpeed()` — tek gösterim otoritesi (kütük #417). Burada
 *    GPS/OBD yeniden hesaplanMAZ, kaynak seçilMEZ, filtre uygulanMAZ.
 *  · Limit: `useEffectiveSpeedLimit()` — tek UI girişi. Levha `SpeedLimitCard`
 *    ile çizilir; **veri yoksa levha HİÇ çizilmez** (boş levha yanıltır) ve
 *    sayı UYDURULMAZ.
 *
 * ── DEĞİŞEN ───────────────────────────────────────────────────────────────
 * Eski küme hızın altına `SafetyTensionBar` (fren/reaksiyon mesafesi çubuğu)
 * gömüyordu; sürüş yüzeyinde bu ÜÇÜNCÜL bilgidir ve rakamın okunma süresini
 * uzatıyordu. Hız kümesi artık yalnız **rakam + birim + levha**.
 * Çubuk kaldırılmadı, HUD'un güvenlik katmanında kendi yerinde kalır.
 */

import { memo } from 'react';
import { SpeedLimitCard } from '../SpeedLimitCard';
import {
  isEffectiveLimitDisplayable, type EffectiveSpeedLimit,
} from '../../../platform/navigation/core/vehicleAwareSpeedLimitAuthority';
import type { HudPresentation } from '../../../platform/navigation/core/hudPresentationModel';

export interface DrivingSpeedProps {
  readonly speedKmh: number;
  readonly speedLimit: EffectiveSpeedLimit;
  readonly hud: HudPresentation;
  /** Güvenlik durumu — semantik renk için (`safetyStateMapper` otoritesi). */
  readonly caution?: boolean;
  readonly intervention?: boolean;
}

/** Aşım payı — mevcut davranışla BİREBİR (yeni eşik icat edilmedi). */
const OVER_SPEED_TOLERANCE_KMH = 5;

export const DrivingSpeed = memo(function DrivingSpeed({
  speedKmh, speedLimit, hud, caution = false, intervention = false,
}: DrivingSpeedProps) {
  const limitKmh  = speedLimit.effectiveLimitKmh;
  const hasLimit  = isEffectiveLimitDisplayable(speedLimit);
  const overSpeed = hasLimit && speedKmh > (limitKmh as number) + OVER_SPEED_TOLERANCE_KMH;
  const rounded   = Math.round(speedKmh);
  const portrait  = hud.layout === 'PORTRAIT';

  /* Rakam rengi SEMANTİKTİR: aşım/müdahale kırmızı, dikkat amber, normalde
     tema mürekkebi. Sabit `#ffffff` gündüz temasında görünmez kalıyordu
     (cihazda ölçülmüş kusur) — token korunur. */
  const digitColor = (overSpeed || intervention) ? '#f87171'
    : caution ? '#fbbf24'
    : 'var(--oem-ink, #F0EBE0)';

  return (
    <div
      data-editable="nav.speed-cluster" data-editable-type="gauge"
      data-testid="driving-speed"
      className="absolute z-[var(--z-map-hud)] pointer-events-none flex items-end gap-2.5"
      style={{
        /* Hız kümesi ALT-SAĞA taşındı: eski yeri sağ ÜSTTÜ ve orada `AR` /
           `ONLINE` / `ANA EKRAN` kutularıyla aynı bölgeyi paylaşıyordu.
           Alt-sağ hem sürücünün doğal bakış hattına yakın hem de haritanın
           ileri görüş alanını (üst yarı) serbest bırakır. */
        right:  'max(12px, var(--sar, 0px))',
        bottom: portrait ? 'calc(env(safe-area-inset-bottom, 0px) + 96px)' : 'calc(env(safe-area-inset-bottom, 0px) + 76px)',
      }}
    >
      {/* Levha ÖNCE (solda): limit, hızdan önce okunur — sürücü "ne kadar
          gidebilirim"i "ne kadar gidiyorum"la karşılaştırır. */}
      <SpeedLimitCard limit={speedLimit} size={portrait ? 'mini' : 'full'} overSpeed={overSpeed} />

      <div
        className="oem-glass flex flex-col items-center rounded-[1.15rem]"
        style={{
          minWidth: portrait ? 74 : 84,
          padding: portrait ? '6px 12px 5px' : '8px 14px 6px',
          background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
          border: `1px solid ${overSpeed
            ? 'rgba(248,113,113,0.55)'
            : 'var(--oem-line-strong, rgba(255,240,210,0.18))'}`,
          boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
          backdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(115%)',
          WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 18px)) saturate(115%)',
        }}
      >
        <span
          data-testid="driving-speed-value"
          className="tabular-nums leading-none"
          style={{
            fontSize: portrait ? 34 : 42,
            fontWeight: 800,
            letterSpacing: '-0.05em',
            color: digitColor,
            transition: 'color 0.4s ease',
          }}
        >
          {rounded}
        </span>
        <span
          data-testid="driving-speed-unit"
          className="leading-none"
          style={{
            /* BİRİM: `km/h`. Eski `km/s` YANLIŞTI — Türkçede sözlü karşılık
               "kilometre saat" olsa da gösterge birimi uluslararası SI
               kısaltmasıdır ve araç kümelerinde `km/h` yazar. Büyük harfe
               ÇEVRİLMEZ: `KM/H` bir kısaltma değil, birimin bozulmuş hâlidir. */
            fontSize: 10, letterSpacing: '0.02em', marginTop: 4,
            fontWeight: 700,
            color: 'var(--oem-ink-3, rgba(240,235,224,0.52))',
          }}
        >
          km/h
        </span>
      </div>
    </div>
  );
});
