/**
 * overspeedModel — hız sınırı aşımı: levha rengi + TEK SEFERLİK sesli uyarı. **SAF.**
 *
 * Kullanıcı kuralı (2026-09-24): "50 yazan levha, 50'yi geçince kırmızıya döner;
 * 'hız sınırını aştınız' diye BİR KEZ uyarır — her seferinde uyarması sıkıntı."
 *
 *  · Görsel: hız > sınır + tolerans → kırmızı (tüm ekranlar AYNI kuralı kullanır).
 *  · Ses: aynı sınır değeri boyunca YALNIZ BİR KEZ. Yeniden kurulma: sınır
 *    değeri değişince (yeni yol/bölüm). Aynı sınırda tekrar tekrar aşmak ikinci
 *    anons ÜRETMEZ.
 *  · Kısa sıçrama anons üretmez: aşım en az `OVERSPEED_CONFIRM_MS` sürmeli.
 *  · Sık değişen bölümler (cihaz 2026-09-24, Tarsus: 4,8 km'de 30↔50 altı kez)
 *    aynı değeri tekrar kurmaz: son uyarılan değer `OVERSPEED_REPEAT_MS` içinde
 *    geri gelirse "söylendi" sayılır.
 *  · Hız ya da sınır bilinmiyorsa karar YOK (sahte "aşmadınız" da yok).
 */

/** Görsel ve ses için ortak tolerans (km/sa) — gösterge/ölçüm payı. */
export const OVERSPEED_TOLERANCE_KMH = 5;
/** Ses için aşımın kesintisiz sürmesi gereken süre. */
export const OVERSPEED_CONFIRM_MS = 3_000;
/** Aynı sınır değeri bu süre içinde yeniden gelirse ikinci anons yok. */
export const OVERSPEED_REPEAT_MS = 120_000;

export function isOverspeed(speedKmh: number | null, limitKmh: number | null): boolean {
  return speedKmh !== null && limitKmh !== null && Number.isFinite(speedKmh) && Number.isFinite(limitKmh)
    && limitKmh > 0 && speedKmh > limitKmh + OVERSPEED_TOLERANCE_KMH;
}

export interface OverspeedLedger {
  /** Uyarının yapıldığı sınır değeri; `null` = bu sınır için henüz uyarılmadı. */
  readonly warnedForLimit: number | null;
  /** Aşımın başladığı an; `null` = şu an aşım yok. */
  readonly overSinceMs: number | null;
  /** Son görülen sınır — değişince defter yeniden kurulur. */
  readonly lastLimit: number | null;
  /** Son anons: hangi değer, ne zaman (bölüm değişse de kısa sürede tekrar yok). */
  readonly lastWarned: { readonly limit: number; readonly atMs: number } | null;
}

export const EMPTY_OVERSPEED_LEDGER: OverspeedLedger = { warnedForLimit: null, overSinceMs: null, lastLimit: null, lastWarned: null };

export interface OverspeedStep {
  readonly ledger: OverspeedLedger;
  /** Söylenecek metin; yoksa `null`. */
  readonly speak: string | null;
}

export function stepOverspeed(
  ledger: OverspeedLedger, speedKmh: number | null, limitKmh: number | null, nowMs: number,
): OverspeedStep {
  if (limitKmh === null || !Number.isFinite(limitKmh) || limitKmh <= 0) {
    return { ledger: { ...ledger, overSinceMs: null }, speak: null };
  }
  // Yeni sınır (yeni yol/bölüm) → tek seferlik hak yeniden doğar.
  const lw = ledger.lastWarned;
  const recentlyWarned = lw !== null && lw.limit === limitKmh && nowMs - lw.atMs < OVERSPEED_REPEAT_MS;
  let l: OverspeedLedger = ledger.lastLimit !== limitKmh
    ? { warnedForLimit: recentlyWarned ? limitKmh : null, overSinceMs: null, lastLimit: limitKmh, lastWarned: lw }
    : ledger;
  if (!isOverspeed(speedKmh, limitKmh)) {
    return { ledger: { ...l, overSinceMs: null }, speak: null };
  }
  if (l.overSinceMs === null) l = { ...l, overSinceMs: nowMs };
  if (l.warnedForLimit === limitKmh) return { ledger: l, speak: null };
  if (nowMs - (l.overSinceMs as number) < OVERSPEED_CONFIRM_MS) return { ledger: l, speak: null };
  return {
    ledger: { ...l, warnedForLimit: limitKmh, lastWarned: { limit: limitKmh, atMs: nowMs } },
    speak: `Hız sınırı ${Math.round(limitKmh)}. Hız sınırını aştınız.`,
  };
}
