/**
 * navMonotonicTime.ts — NAV v3 · MONOTONİK ZAMAN SÖZLEŞMESİ (SAF · F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/6 · v2 ADR-N09 ("Zaman: monotonik zorunlu").
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · `performance.now` YOK · React YOK ·
 * modül durumu YOK. Bu dosya bir SAAT OKUMAZ — yalnız zaman DEĞERLERİNİN
 * anlamını ve aralarındaki hesabı tiple sabitler. "Şu an" değeri her zaman
 * kenardan (runtime binding) enjekte edilir.
 *
 * ── NEDEN (ölçülmüş) ──────────────────────────────────────────────────────
 * Araçta akü kesintisi ve NTP düzeltmesi sistem duvar saatini GERİYE atar.
 * Duvar-saati farkı kullanan bir ETA / yaş / tazelik hesabı o anda SESSİZCE
 * yanlışlanır (CLAUDE.md · "Clock Jump Protection"). Bu yüzden navigasyonun
 * TÜM süre/yaş/eşik hesapları monotonik saat (`performance.now()` alanı)
 * tabanlıdır; `Date.now()` yalnız kullanıcıya GÖSTERİLEN takvim anı ve
 * kalıcılık damgası içindir.
 *
 * ── KURAL (bağlayıcı) ─────────────────────────────────────────────────────
 *  · `core/**` ve `contracts/**`: hiçbir saat OKUNMAZ (ne monotonik ne duvar).
 *  · L2–L6 runtime: süre/yaş/tazelik = `MonotonicMs`. `Date.now()` YASAK.
 *  · `WallClockMs`: yalnız kullanıcıya gösterilen an + `safeStorage` damgası.
 *  · İki alan aritmetikte KARIŞTIRILAMAZ (marka tipleri bunu derleyicide tutar).
 */

/**
 * Monotonik milisaniye — `performance.now()` alanından gelen, GERİYE GİTMEYEN
 * zaman. Süre/yaş/tazelik hesaplarının TEK kabul edilen zaman birimidir.
 */
export type MonotonicMs = number & { readonly __brand: 'NavMonotonicMs' };

/**
 * Duvar-saati milisaniyesi — `Date.now()` alanı. Geriye gidebilir. YALNIZ
 * kullanıcıya gösterilen takvim anı ve kalıcılık damgası için.
 */
export type WallClockMs = number & { readonly __brand: 'NavWallClockMs' };

/** Sonlu bir sayıyı `MonotonicMs` olarak işaretler (kenar/runtime kullanımı). */
export function asMonotonic(n: number): MonotonicMs {
  return n as MonotonicMs;
}

/** Sonlu bir sayıyı `WallClockMs` olarak işaretler (yalnız takvim/kalıcılık). */
export function asWallClock(n: number): WallClockMs {
  return n as WallClockMs;
}

/** Geçerli monotonik değer mi (sonlu, negatif değil). */
export function isMonotonic(n: number | null | undefined): n is MonotonicMs {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * İki monotonik an arasındaki yaş (ms). Girdilerden biri geçersizse `null`
 * (uydurma yaş üretilmez). Negatif fark 0'a kırpılır — monotonik saatte
 * "gelecekten gelen" örnek bir ölçüm hatasıdır, süre değil.
 */
export function monoAgeMs(
  fromMono: MonotonicMs | number | null | undefined,
  nowMono: MonotonicMs | number | null | undefined,
): number | null {
  if (!isMonotonic(fromMono) || !isMonotonic(nowMono)) return null;
  return Math.max(0, nowMono - fromMono);
}

/**
 * Monotonik tazelik hükmü. Bayatlık YALNIZ iki koşul birden sağlanırsa verilir:
 *   (1) geçerli bir monotonik `fromMono` damgası var, ve
 *   (2) tanımlı, pozitif bir `budgetMs` eşiği var.
 * Eşik yoksa/geçersizse bayatlık HESAPLANMAZ → `false` (sessiz "taze" iddiası
 * değil; çağıran eşik yokluğunu ayrıca ele alır).
 */
export function isMonoStale(
  fromMono: MonotonicMs | number | null | undefined,
  nowMono: MonotonicMs | number | null | undefined,
  budgetMs: number | null | undefined,
): boolean {
  if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || budgetMs <= 0) return false;
  const age = monoAgeMs(fromMono, nowMono);
  if (age === null) return false;
  return age > budgetMs;
}
