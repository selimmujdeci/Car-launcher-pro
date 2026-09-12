/**
 * locationConfidence.ts — KONUM GÜVENİ VE DURUMU (SAF).
 *
 * ── §4 ANA KURAL ──────────────────────────────────────────────────────
 * **TEK GPS FIX'İ `HIGH` DEĞİLDİR.**
 *
 * Neden: tek bir fix şunları ayırt edemez —
 *   · gerçek konum mu, yoksa çok yollu yansıma (multipath) mı,
 *   · soğuk başlangıçta ilk kaba fix mi,
 *   · tünel çıkışında sıçramış gürültülü fix mi.
 * Bunlar ancak **süreklilik** (birbirini doğrulayan ardışık fix'ler) ile
 * ayrılır. Bu yüzden güven üç bağımsız kanıttan türetilir:
 *   (1) hassasiyet (accuracy)   (2) tazelik (age)   (3) süreklilik (streak)
 * ve **en zayıf kanıt tavanı belirler** (zincirin en zayıf halkası).
 *
 * ── §6 DURUM ──────────────────────────────────────────────────────────
 * `LIVE · STALE · LAST_KNOWN · OFFLINE · UNKNOWN` — "cihaz ayakta" ile
 * "konum güncel" AYRI gerçeklerdir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

import type {
  LocationConfidence,
  LocationProviderId,
  RawLocationSample,
} from './locationProvider';

/* ── Eşikler ───────────────────────────────────────────────────────────── */

/**
 * Hassasiyet kovaları (m).
 *
 * `EXCELLENT ≤ 10 m`: şerit seviyesi değil ama yol seviyesi güvenilir.
 * `GOOD ≤ 25 m`: kentsel kanyonda tipik iyi fix.
 * `FAIR ≤ 75 m`: yol eşleştirme için sınırda.
 * Üstü: kaba (hücresel/WiFi türevi olabilir).
 */
export const ACCURACY_BUCKETS_M = {
  EXCELLENT: 10,
  GOOD: 25,
  FAIR: 75,
} as const;

/**
 * Tazelik eşikleri (ms).
 *
 * `FRESH 3 s`: 2 Hz taban akışta bir kaçırılan fix'e tolerans.
 * `STALE_AFTER 15 s`: bunun ötesi "canlı" iddia edilemez.
 * `OFFLINE_AFTER 5 dk`: kaynak tamamen sustu.
 */
export const FRESHNESS_MS = {
  FRESH: 3_000,
  STALE_AFTER: 15_000,
  OFFLINE_AFTER: 5 * 60_000,
} as const;

/**
 * Süreklilik eşikleri (ardışık kabul edilmiş fix sayısı).
 *
 * `MIN_FOR_HIGH = 3`: en az üç birbirini doğrulayan fix.
 * `MIN_FOR_VERY_HIGH = 6`.
 * Bu, §4'ün "tek fix HIGH değildir" kuralının somut biçimidir.
 */
export const STREAK = {
  MIN_FOR_HIGH: 3,
  MIN_FOR_VERY_HIGH: 6,
} as const;

/* ── Kanıt kovaları ────────────────────────────────────────────────────── */

export type AccuracyClass = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'COARSE' | 'UNKNOWN';

export function classifyAccuracy(accuracyM: number | null): AccuracyClass {
  if (accuracyM === null) return 'UNKNOWN';
  if (accuracyM <= ACCURACY_BUCKETS_M.EXCELLENT) return 'EXCELLENT';
  if (accuracyM <= ACCURACY_BUCKETS_M.GOOD) return 'GOOD';
  if (accuracyM <= ACCURACY_BUCKETS_M.FAIR) return 'FAIR';
  return 'COARSE';
}

/* ── Güven türetimi ────────────────────────────────────────────────────── */

export interface ConfidenceInput {
  readonly sample: RawLocationSample;
  readonly nowMs: number;
  /** Ardışık kabul edilmiş fix sayısı (bu örnek dahil). */
  readonly streak: number;
}

const ORDER: readonly LocationConfidence[] =
  ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];

/** İki güvenin DAHA ZAYIFINI verir (zincirin en zayıf halkası). */
export function weakest(a: LocationConfidence, b: LocationConfidence): LocationConfidence {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

/**
 * Konum güvenini türetir.
 *
 * Üç kanıt bağımsız tavanlar üretir, sonuç EN ZAYIF tavandır:
 *
 *   hassasiyet: EXCELLENT→VERY_HIGH · GOOD→HIGH · FAIR→MEDIUM · COARSE→LOW
 *               UNKNOWN→MEDIUM (hassasiyet bilinmiyorsa yüksek İDDİA EDİLEMEZ)
 *   tazelik:    ≤FRESH→VERY_HIGH · ≤STALE_AFTER→MEDIUM · üstü→LOW
 *   süreklilik: ≥6→VERY_HIGH · ≥3→HIGH · <3→MEDIUM  ← TEK FIX ASLA HIGH DEĞİL
 *
 * `LAST_KNOWN` sağlayıcısı tavanı **LOW**'dur: kalıcı depodan okunan konum
 * ne kadar hassas olursa olsun ŞU AN'ı temsil etmez.
 */
export function deriveConfidence(input: ConfidenceInput): LocationConfidence {
  const { sample, nowMs, streak } = input;

  const ageMs = nowMs - sample.timestampMs;
  /* Gelecekten gelen fix (istemci saat kayması) güvenilmez. */
  if (ageMs < -FRESHNESS_MS.FRESH) return 'UNKNOWN';

  const acc = classifyAccuracy(sample.accuracyM);
  const accCap: LocationConfidence =
    acc === 'EXCELLENT' ? 'VERY_HIGH'
    : acc === 'GOOD' ? 'HIGH'
    : acc === 'FAIR' ? 'MEDIUM'
    : acc === 'COARSE' ? 'LOW'
    : 'MEDIUM';   // UNKNOWN hassasiyet → yüksek iddia edilemez

  const freshCap: LocationConfidence =
    ageMs <= FRESHNESS_MS.FRESH ? 'VERY_HIGH'
    : ageMs <= FRESHNESS_MS.STALE_AFTER ? 'MEDIUM'
    : 'LOW';

  const streakCap: LocationConfidence =
    streak >= STREAK.MIN_FOR_VERY_HIGH ? 'VERY_HIGH'
    : streak >= STREAK.MIN_FOR_HIGH ? 'HIGH'
    : 'MEDIUM';   // ← TEK FIX HIGH DEĞİLDİR

  let result = weakest(weakest(accCap, freshCap), streakCap);

  /* LAST_KNOWN kalıcı depodan gelir — şu anı temsil ETMEZ. */
  if (sample.provider === 'LAST_KNOWN') result = weakest(result, 'LOW');

  return result;
}

/* ── §6 Konum durumu ───────────────────────────────────────────────────── */

export const LOCATION_STATES = [
  'LIVE',        // taze fix, canlı sağlayıcıdan
  'STALE',       // fix var ama tazelik penceresi geçti
  'LAST_KNOWN',  // kalıcı depodan; ŞU AN'ı temsil ETMEZ
  'OFFLINE',     // kaynak tamamen sustu (OFFLINE_AFTER geçti)
  'UNKNOWN',     // hiç kanıt yok veya okunamadı
] as const;
export type LocationState = (typeof LOCATION_STATES)[number];

export interface LocationStateInput {
  readonly sample: RawLocationSample | null;
  readonly nowMs: number;
  /** Sağlayıcı okuması BAŞARILI oldu mu — "yok" ile "okunamadı" ayrımı. */
  readonly readable: boolean;
}

/**
 * Konum durumunu türetir.
 *
 * `LAST_KNOWN` sağlayıcısı ne kadar taze görünürse görünsün **ASLA `LIVE`
 * olmaz** — bu, "eski veriyi canlı gibi sunma" kuralının yapısal biçimi.
 */
export function deriveLocationState(input: LocationStateInput): LocationState {
  const { sample, nowMs, readable } = input;
  if (!readable) return 'UNKNOWN';
  if (sample === null) return 'UNKNOWN';

  if (sample.provider === 'LAST_KNOWN') {
    /* Kalıcı konum çok eskiyse "son bilinen" demek de yanıltıcıdır. */
    return nowMs - sample.timestampMs > FRESHNESS_MS.OFFLINE_AFTER
      ? 'OFFLINE' : 'LAST_KNOWN';
  }

  const ageMs = nowMs - sample.timestampMs;
  if (ageMs > FRESHNESS_MS.OFFLINE_AFTER) return 'OFFLINE';
  if (ageMs > FRESHNESS_MS.STALE_AFTER) return 'STALE';
  return 'LIVE';
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function locationStateLabel(state: LocationState): string {
  switch (state) {
    case 'LIVE':       return 'Canlı konum';
    case 'STALE':      return 'Konum güncel değil';
    case 'LAST_KNOWN': return 'Son bilinen konum';
    case 'OFFLINE':    return 'Konum kaynağı yok';
    case 'UNKNOWN':    return 'Konum bilinmiyor';
  }
}

export function confidenceLabel(c: LocationConfidence): string {
  switch (c) {
    case 'VERY_HIGH': return 'Çok yüksek';
    case 'HIGH':      return 'Yüksek';
    case 'MEDIUM':    return 'Orta';
    case 'LOW':       return 'Düşük';
    case 'UNKNOWN':   return 'Bilinmiyor';
  }
}

export function providerLabel(id: LocationProviderId): string {
  switch (id) {
    case 'EXTERNAL_GPS':  return 'Harici GPS';
    case 'HEAD_UNIT_GPS': return 'Araç ünitesi GPS';
    case 'PHONE_HUB_GPS': return 'Telefon GPS';
    case 'LAST_KNOWN':    return 'Son bilinen konum';
  }
}
