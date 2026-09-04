/**
 * useVideoSafety.ts — MUSIC F7.2 · Hız/duruş sınıflandırmasının UI kancası (ADVISORY).
 *
 * SAHA BUGFIX (2026-09-03) · ÜRÜN KARARI DEĞİŞTİ: bu kancanın döndürdüğü
 * `allowed`/`reason` artık HİÇBİR bileşende video render/açma kararını
 * GATE'LEMEK için kullanılmıyor (`MediaScreen` bu hook'u artık çağırmıyor).
 * Hook bilinçli olarak SİLİNMEDİ — saf `videoSafetyPolicy` sınıflandırmasını
 * LAB gözlemi veya gelecekteki opt-in bir mevzuat politikası için hazır
 * tutar. Kimse bu değere bağlı kalarak bir surface'i KAPATMAK ZORUNDA DEĞİLDİR.
 *
 * SINIR (değişmedi): burada KARAR YOKTUR — sınıflandırma `videoSafetyPolicy`
 * (saf) tarafından üretilir. Bu kanca yalnız kanonik araç hızını OKUR,
 * histerezis için önceki durumu taşır ve sonucu projekte eder (Cross-Domain
 * §14: UI bir projeksiyondur, ikinci bir güvenlik/playback otoritesi değildir).
 *
 * SESE DOKUNMAZ.
 */

import { useRef } from 'react';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  decideVideoVisibility, videoBlockReason,
  type VideoVisibilityDecision,
} from '../platform/media/videoSafetyPolicy';

export interface VideoSafety {
  readonly decision: VideoVisibilityDecision;
  readonly allowed: boolean;
  /** Engelin GEREKÇESİ — izin varsa `null`. Sessiz engelleme YASAK. */
  readonly reason: string | null;
  /** Kararın dayandığı ölçüm; `null` = hız ölçülemiyor (sahte 0 YOK). */
  readonly speedKmh: number | null;
}

/**
 * Video görüntüsü şu an gösterilebilir mi.
 *
 * Hız değiştikçe bileşen yeniden render olur (store aboneliği); histerezis
 * bandında karar DEĞİŞMEZ → dur-kalk trafiğinde video titremez.
 */
export function useVideoSafety(): VideoSafety {
  const speedKmh = useUnifiedVehicleStore((s) => s.speed);
  /* Fail-closed başlangıç: duruş kanıtlanana kadar görüntü kapalı. */
  const previous = useRef<VideoVisibilityDecision>('BLOCKED_SPEED_UNKNOWN');

  const decision = decideVideoVisibility({ speedKmh, previous: previous.current });
  previous.current = decision;

  return {
    decision,
    allowed: decision === 'ALLOWED',
    reason: videoBlockReason(decision),
    speedKmh,
  };
}
