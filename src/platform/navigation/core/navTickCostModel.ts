/**
 * navTickCostModel — NAVİGASYON SICAK YOLUNUN MALİYETİ (SAF · P0-NAV-19).
 *
 * SAF: I/O YOK · **TIMER YOK** · `Date.now` YOK · React YOK · ağ YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-19 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * NAV-19 bir ÖLÇÜM turudur ("yeni özellik ekleme"). Ölçülen tablo:
 *
 *   · **Zamanlayıcı disiplini SAĞLAM.** Tüm navigasyon yolunda `setInterval`
 *     YALNIZ BİR TANE: `navigationSessionRuntime._drTimer` (ölü hesap beslemesi,
 *     1 Hz, YALNIZ GPS fix'i yokken) ve ÜÇ ayrı yerde `clearInterval` ile
 *     kapatılıyor. Guardian katmanı kendi timer'ını KURMUYOR (runtimeManager
 *     çarkını kullanıyor). → Bu turda timer EKLENMEDİ.
 *   · **Gecikmeler ZATEN ölçülü:** arama zinciri (`GeocodeTrace.providerMs`),
 *     rota isteği (`routeRequestLedger` sapma→yanıt→uygulama→ilk talimat),
 *     sağlayıcı başına süre (`routeProviderLedger.ms`).
 *   · **Yinelenen istekler ZATEN kapalı:** `claimRouteRequest` +
 *     `suppressedDuplicateCount` + throttle penceresi.
 *
 * Ölçülen TEK boşluk: **sıcak yolun KENDİ maliyeti hiç ölçülmüyordu.**
 * Her GPS fix'inde (ve GPS yokken her DR tick'inde) `matchToRoute` çalışır —
 * rota geometrisi üzerinde arama yapan, rota uzadıkça pahalılaşan tek iş budur.
 * Ne kadar sürdüğü ÜRÜNDE hiçbir yerde bilinmiyordu; düşük-uçlu head unit'te
 * "harita takılıyor" şikâyeti geldiğinde bakılacak bir sayı YOKTU.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KENDİ ÖLÇÜMÜ UCUZ OLMAK ZORUNDA: sabit boyutlu halka, tahsis YOK,
 *    sıralama YALNIZ okuma anında (LAB açıldığında) yapılır — tick'te DEĞİL.
 *  · KARAR ÜRETMEZ: hiçbir eşiği tetiklemez, hiçbir katmanı kapatmaz.
 *  · Ölçüm yoksa `null` — sahte 0 ms YASAK.
 */

/** Halka boyutu — 2 üssü, sabit tahsis. 1 Hz'de ~2 dakikalık pencere. */
export const TICK_COST_WINDOW = 128;

/** Ölçülen aşama. Her biri sıcak yolun AYRI bir parçasıdır. */
export type NavTickPhase =
  /** `matchToRoute` — rota üzerine oturtma (rota uzadıkça pahalılaşır). */
  | 'MAP_MATCH'
  /** Tüm ilerleme tick'i — eşleştirme + adım ilerletme + sapma + ses. */
  | 'PROGRESS_TICK';

export const NAV_TICK_PHASE_LABEL: Readonly<Record<NavTickPhase, string>> = {
  MAP_MATCH:     'harita eşleştirme',
  PROGRESS_TICK: 'ilerleme tick’i (tam)',
} as const;

interface _Window {
  /** Sabit boyutlu halka — tahsis YOK. */
  readonly buf: Float64Array;
  /** Yazılacak sonraki indeks. */
  idx: number;
  /** Halkaya yazılmış toplam örnek (halka boyutuyla sınırlı). */
  filled: number;
  /** Ömür boyu örnek sayısı (halka taşsa da korunur). */
  total: number;
  /** Ömür boyu en büyük süre (ms). Ölçüm yoksa `-1`. */
  max: number;
}

function _newWindow(): _Window {
  return { buf: new Float64Array(TICK_COST_WINDOW), idx: 0, filled: 0, total: 0, max: -1 };
}

const _windows: Record<NavTickPhase, _Window> = {
  MAP_MATCH:     _newWindow(),
  PROGRESS_TICK: _newWindow(),
};

/**
 * Bir tick ölçümünü kaydeder. **THROW ETMEZ · TAHSİS YAPMAZ.**
 *
 * Sıcak yolda çağrıldığı için gövdesi bilinçli olarak dallanmasızdır:
 * yalnız bir dizi yazımı ve üç sayaç. Sıralama/percentil hesabı OKUMA
 * anındadır (LAB açıldığında), tick'te DEĞİL.
 */
export function recordNavTickCost(phase: NavTickPhase, ms: number): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    const w = _windows[phase];
    if (w === undefined) return;
    w.buf[w.idx] = ms;
    w.idx = (w.idx + 1) % TICK_COST_WINDOW;
    if (w.filled < TICK_COST_WINDOW) w.filled += 1;
    w.total += 1;
    if (ms > w.max) w.max = ms;
  } catch { /* fail-soft: ölçüm navigasyonu ASLA düşüremez */ }
}

export interface NavTickCostStats {
  /** Penceredeki örnek sayısı. */
  readonly samples: number;
  /** Ömür boyu örnek sayısı (halka taşsa da korunur). */
  readonly total: number;
  /** Pencere medyanı (ms). Örnek yoksa `null` — sahte 0 YASAK. */
  readonly p50Ms: number | null;
  /** Pencere %95'i (ms). Örnek yoksa `null`. */
  readonly p95Ms: number | null;
  /** ÖMÜR BOYU en büyük (ms). Ölçüm yoksa `null`. */
  readonly maxMs: number | null;
}

const _EMPTY_STATS: NavTickCostStats = Object.freeze({
  samples: 0, total: 0, p50Ms: null, p95Ms: null, maxMs: null,
});

/** Percentil — kopya dizi ÜZERİNDE, yalnız okuma anında. */
function _percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return Math.round(sorted[i] * 100) / 100;
}

export function getNavTickCost(phase: NavTickPhase): NavTickCostStats {
  const w = _windows[phase];
  if (w === undefined || w.filled === 0) return _EMPTY_STATS;
  /* Kopya + sıralama YALNIZ burada (LAB açılışında), sıcak yolda DEĞİL. */
  const arr: number[] = [];
  for (let i = 0; i < w.filled; i++) arr.push(w.buf[i]);
  arr.sort((a, b) => a - b);
  return {
    samples: w.filled,
    total: w.total,
    p50Ms: _percentile(arr, 0.5),
    p95Ms: _percentile(arr, 0.95),
    maxMs: w.max < 0 ? null : Math.round(w.max * 100) / 100,
  };
}

export interface NavTickCostSnapshot {
  readonly mapMatch: NavTickCostStats;
  readonly progressTick: NavTickCostStats;
}

export function getNavTickCostSnapshot(): NavTickCostSnapshot {
  return {
    mapMatch:     getNavTickCost('MAP_MATCH'),
    progressTick: getNavTickCost('PROGRESS_TICK'),
  };
}

/** Yeni oturum — eski rotanın maliyeti yenisine karışmaz (P0-NAV-18 ilkesi). */
export function resetNavTickCost(): void {
  _windows.MAP_MATCH     = _newWindow();
  _windows.PROGRESS_TICK = _newWindow();
}
