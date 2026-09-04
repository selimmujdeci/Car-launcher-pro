/**
 * videoSafetyPolicy.ts — MUSIC F7.2 · Hız/duruş sınıflandırması (SAF, ADVISORY).
 *
 * SAHA BUGFIX (2026-09-03) · ÜRÜN KARARI DEĞİŞTİ: CarOS artık hareket/hız
 * nedeniyle videoyu OTOMATİK ENGELLEMEZ. Bu modül eskiden bir GATE'di —
 * `decideVideoVisibility` sonucu `MediaScreen`/`useVoiceCommandHandler`
 * içinde video render'ını/açma isteğini REDDEDİYORDU. O bağlama artık
 * HİÇBİR yerden çağrılmıyor; modül bilinçli olarak SİLİNMEDİ çünkü:
 *   · saf sınıflandırma hâlâ doğru ve test edilebilir (LAB gözlemi için),
 *   · gelecekte ülke/mevzuat gerektirirse opt-in bir politikaya (ayrı bir
 *     karar noktasında, açıkça bağlanarak) temel olabilir.
 *
 * BUGÜNKÜ SÖZLEŞME: bu modülün çıktısı hiçbir yerde playback/görüntü/ses
 * reddi ÜRETMEZ. `ALLOWED`/`BLOCKED_*` yalnız ADVISORY bir etikettir —
 * kimse buna bağlı olarak bir surface'i gizlemek/kapatmak ZORUNDA DEĞİLDİR.
 *
 * KARAR SINIRI (pazarlıksız, değişmedi):
 *   · Bu modül YALNIZ bir **sınıflandırma** üretir — kendisi bir GATE DEĞİLDİR.
 *   · **SESE ASLA DOKUNMAZ** (Cross-Domain §7 — güvenlik/performans truth'u
 *     değiştirmez, §16 — bir alanın kısıtı diğerini kapatmaz).
 *   · Playback truth ÜRETMEZ, komut GÖNDERMEZ, kaynak devri YAPMAZ,
 *     playback authority DEĞİLDİR (Cross-Domain §6).
 *   · Araç hızı truth'unun sahibi değildir; onu `UnifiedVehicleStore`dan OKUR.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOK.
 */

/** Video görüntüsünün gösterilip gösterilemeyeceği. */
export type VideoVisibilityDecision =
  /** Duruş KANITLANDI — görüntü gösterilebilir. */
  | 'ALLOWED'
  /** Araç hareket hâlinde ölçüldü — görüntü gizli, ses devam eder. */
  | 'BLOCKED_MOVING'
  /** Hız ölçülemiyor — duruş kanıtı YOK, görüntü gizli, ses devam eder. */
  | 'BLOCKED_SPEED_UNKNOWN';

/**
 * Histerezis eşikleri (CLAUDE.md §2.3): tek eşik, dur-kalk trafiğinde video
 * görüntüsünü saniyede bir açıp kapatırdı (hem tehlikeli hem rahatsız edici).
 *
 * `ALLOW_BELOW_KMH` <= `BLOCK_ABOVE_KMH` olmalıdır; aradaki bant "kararı
 * DEĞİŞTİRME" bölgesidir.
 */
export const VIDEO_ALLOW_BELOW_KMH = 1;
export const VIDEO_BLOCK_ABOVE_KMH = 3;

/** Ölçülemez/imkânsız hız — sinyal bozuksa duruş kanıtı SAYILMAZ. */
const MAX_PLAUSIBLE_KMH = 300;

export interface VideoSafetyInput {
  /** Kanonik araç hızı (km/h). `null` = ölçüm YOK (sahte 0 KABUL EDİLMEZ). */
  readonly speedKmh: number | null;
  /**
   * Bir önceki karar — histerezis bandında bu KORUNUR. İlk çağrıda
   * `BLOCKED_SPEED_UNKNOWN` verilir (fail-closed başlangıç).
   */
  readonly previous: VideoVisibilityDecision;
}

/**
 * Görüntü görünürlüğü kararı. Deterministik ve yan etkisizdir.
 *
 * - Hız yok / bozuk  → `BLOCKED_SPEED_UNKNOWN` (duruş kanıtlanamadı)
 * - Hız > 3 km/h     → `BLOCKED_MOVING`
 * - Hız <= 1 km/h    → `ALLOWED`
 * - 1 < hız <= 3     → önceki karar korunur (histerezis); önceki karar
 *   "hız bilinmiyor" ise artık ölçüm VAR demektir ve hareket kabul edilir.
 */
export function decideVideoVisibility(input: VideoSafetyInput): VideoVisibilityDecision {
  const s = input.speedKmh;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > MAX_PLAUSIBLE_KMH) {
    return 'BLOCKED_SPEED_UNKNOWN';
  }
  if (s > VIDEO_BLOCK_ABOVE_KMH) return 'BLOCKED_MOVING';
  if (s <= VIDEO_ALLOW_BELOW_KMH) return 'ALLOWED';
  /* Histerezis bandı: ölçüm var ama duruş kanıtı da yok. Önceki karar
     ALLOWED ise korunur (dur-kalk trafiğinde titreme olmaz); değilse
     hareket kabul edilir (fail-closed). */
  return input.previous === 'ALLOWED' ? 'ALLOWED' : 'BLOCKED_MOVING';
}

/** Karar görüntüyü engelliyor mu. */
export function isVideoBlocked(d: VideoVisibilityDecision): boolean {
  return d !== 'ALLOWED';
}

/**
 * Kullanıcıya gösterilecek GEREKÇE. Sessiz engelleme YASAK: kullanıcı videonun
 * neden görünmediğini okuyabilmelidir. Ses etkilenmediği de açıkça söylenir.
 */
export function videoBlockReason(d: VideoVisibilityDecision): string | null {
  switch (d) {
    case 'BLOCKED_MOVING':
      return 'Araç hareket hâlinde — video görüntüsü gizlendi. Ses çalmaya devam ediyor.';
    case 'BLOCKED_SPEED_UNKNOWN':
      return 'Araç hızı ölçülemiyor — duruş doğrulanmadan video açılmaz. Ses çalmaya devam ediyor.';
    default:
      return null;
  }
}
