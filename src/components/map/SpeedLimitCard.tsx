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
 *
 * ── OEM SUNUM KATMANI (2026-08-07, OEM Navigation Experience sprint'i) ──────
 * Bu tur YALNIZ sunumu değiştirir; hüküm (`EffectiveSpeedLimit`), gösterilebilirlik
 * kapısı, kesinlik ayrımı ve kaynak etiketi AYNEN korunur. İki kusur giderildi:
 *
 *  1. ORANSIZ LEVHA. Boyutlar iki ayrı sabit kümesinde (mini/full) elle
 *     yazılıydı ve halka kalınlığı çapın %9,6–10,5'iydi. Viyana Sözleşmesi'ne
 *     uyan gerçek trafik levhasında kırmızı halka çapın **~%13'ü**, rakam
 *     yüksekliği **~%47'sidir**; Google Maps ve Android Automotive bu oranı
 *     korur. İnce halka, levhayı ilk bakışta "trafik levhası" değil "beyaz
 *     daire" gibi gösteriyordu. Artık TEK çap değeri var ve halka · rakam ·
 *     etiket ondan ORANLA türetiliyor → iki ölçek arasında sapma İMKÂNSIZ.
 *
 *  2. SABİT PİKSEL — KÜÇÜK EKRANDA ORANTISIZ. Çap 38/52 px sabitti. Head
 *     unit'te (H≈600) doğru duran levha, telefon yatayında (H≈400) ve dikey
 *     navigasyonda ekranın çok büyük bir bölümünü kaplıyordu — HU için yazılmış
 *     mutlak ölçülerin küçük ekranda çökmesi bu üründe ölçülmüş bir kusur
 *     ailesidir (kütük #329/#330). Çap artık `clamp(min, vmin, max)` ile
 *     viewport'a bağlı: dar/kısa ekranda küçülür, HU'da tavana oturur.
 *     JS dinleyicisi YOK → yeniden render YOK, sızıntı riski YOK; dikey
 *     navigasyonda da otomatik doğru ölçek.
 *
 * `em` zinciri bilinçlidir: dış sarmalayıcının `fontSize`ı ÇAPTIR; halka, rakam
 * ve etiket `em` ile ondan türer. Tek sayı değişince levha bütün olarak ölçeklenir.
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

/**
 * Levha ÇAPI — tek ölçü kaynağı. Diğer her şey bundan oranla türer.
 *
 * `clamp(taban, viewport, tavan)`: `vmin` ekranın KISA kenarıdır, bu yüzden
 * yatay ve dikey navigasyonda aynı fiziksel büyüklüğü verir. Taban değer,
 * levhanın en küçük ekranda bile okunabilir kalmasını garanti eder; tavan,
 * büyük head unit'te ekranı kaplamasını engeller.
 */
const _DIAMETER = {
  mini: 'clamp(26px, 6.2vmin, 40px)',
  full: 'clamp(34px, 8.4vmin, 56px)',
} as const;

/* Viyana Sözleşmesi levha oranları (çapa göre) — Google Maps / AAOS ile aynı. */
const _RING       = 0.13;   // kırmızı halka kalınlığı
const _NUMERAL    = 0.47;   // iki haneli rakam yüksekliği
const _NUMERAL_3D = 0.40;   // üç hanede taşmayı önlemek için daralt
const _LABEL      = 0.16;   // kaynak etiketi
/** Etiket boşluğu — etiketin KENDİ punto'suna göre (≈ çapın %6'sı). */
const _LABEL_GAP  = 0.38;

export const SpeedLimitCard = memo(function SpeedLimitCard({
  limit, size = 'mini', overSpeed = false,
}: SpeedLimitCardProps) {
  if (!isEffectiveLimitDisplayable(limit)) return null;

  const kmh = limit.effectiveLimitKmh as number;
  const definitive = isEffectiveLimitDefinitive(limit);

  return (
    <div
      className="flex flex-col items-center"
      data-testid="speed-limit-card"
      data-state={limit.state}
      data-source-label={limit.sourceLabel}
      /* Bu `fontSize` bir yazı boyutu değil, LEVHA ÇAPIDIR — altındaki tüm
         `em` ölçüleri buradan türer. */
      style={{ fontSize: _DIAMETER[size] }}
    >
      <div
        className={`flex items-center justify-center rounded-full ${overSpeed ? 'animate-pulse' : ''}`}
        role="img"
        style={{
          width: '1em', height: '1em',
          background: overSpeed ? '#dc2626' : '#ffffff',
          border: `${_RING}em ${definitive ? 'solid' : 'dashed'} ${overSpeed ? '#7f1d1d' : '#d92b2b'}`,
          /* Dış ince koyu hat: parlak harita zemininde (gündüz uydu/kar) beyaz
             disk sınırını kaybediyordu — OEM levhalarında da bu ayırıcı vardır. */
          boxShadow: overSpeed
            ? '0 0 0 0.035em rgba(0,0,0,0.55), 0 0 0.45em rgba(220,38,38,0.75), 0 0.08em 0.32em rgba(0,0,0,0.55)'
            : '0 0 0 0.035em rgba(0,0,0,0.5), 0 0.05em 0.2em rgba(0,0,0,0.5)',
        }}
        aria-label={`Uygulanabilir hız limiti ${kmh} kilometre saat, kaynak ${limit.sourceLabel}`}
        title={limit.reason}
      >
        <span style={{
          color: overSpeed ? '#ffffff' : '#111',
          fontWeight: 900, lineHeight: 1,
          fontSize: `${kmh >= 100 ? _NUMERAL_3D : _NUMERAL}em`,
          /* Tabular: 1 ile 8 aynı genişlikte → sayı değişince levha oynamaz. */
          fontVariantNumeric: 'tabular-nums',
        }}>{kmh}</span>
      </div>

      {/* Küçük kaynak etiketi — sayının NEREDEN geldiğini söyler. */}
      <span
        className="font-black uppercase leading-none"
        style={{
          fontSize: `${_LABEL}em`,
          marginTop: `${_LABEL_GAP}em`,
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
