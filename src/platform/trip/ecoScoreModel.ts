/**
 * ecoScoreModel — EKO SÜRÜŞ PUANI (SAF).
 *
 * I/O · timer · `Date.now` · `Math.random` · global durum YOK; saat ve veri
 * dışarıdan verilir → testler deterministiktir. Tek girdi kanonik
 * `TripRecord.ecoDynamics` kanıtıdır; bu modül yeni bir truth üretmez, onun
 * projeksiyonudur (bkz. `ecoReportModel` — yakıt/CO₂ karnesi ayrı kalır).
 *
 * ── NE ÖLÇER ────────────────────────────────────────────────────────────────
 * Sürücünün KONTROLÜNDEKİ üç davranış (yakıt bedeli en büyük olanlar):
 *   · Hızlanma  — hızlanma süresinin, AB RDE "normal sürüş" güç sınırını
 *                 (`rdeVaPosLimit`) aşan payı. Mevzuat bu payın ≤ %5 olmasını
 *                 "normal" sayar → ölçeğin 80 çapası buradadır.
 *   · Öngörü    — yavaşlama süresinin sert frenle (≤ −2,5 m/s²) geçen payı.
 *   · Seyir hızı— hareket süresinin 110 km/h üstünde geçen payı (130 üstü tam,
 *                 110–130 yarım ağırlık: hava direnci hızın karesiyle artar).
 *
 * Rölanti puana GİRMEZ: yolculuk 60 sn duruşta kapanır (`TRIP_END_IDLE_MS`),
 * yolculuk içi rölanti ışık/trafik beklemesidir — sürücünün seçimi değil.
 * Rölantinin yakıt bedeli `ecoReportModel` karnesinde bilgi olarak durur.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * · Kanıt yoksa puan YOK (`null` + neden). Eski sürüm skorunun aksine veri
 *   yokluğu asla "100" demek değildir.
 * · Her şey ORAN — yolculuk uzunluğundan bağımsız (3 km'deki 2 sert fren ile
 *   300 km'deki 2 sert fren aynı şey değildir).
 * · Puan yolculuk bittikten sonra gösterilir; sürüş sırasında canlı puan yok.
 *
 * ── KALİBRASYON ─────────────────────────────────────────────────────────────
 * Eğri çapaları (aşağıda) v1 başlangıç değerleridir: RDE %5 çapası mevzuattan,
 * diğerleri fiziksel/ergonomik gerekçeden gelir; saha verisiyle ayarlanır.
 * Çapa değişirse `ECO_SCORE_MODEL_VERSION` artırılır. Bu dosya DEVICE/FIELD
 * doğrulaması iddia etmez.
 */
import type { TripRecord } from '../tripLogService';

export const ECO_SCORE_MODEL_VERSION = 1;

export type EcoDimensionId = 'acceleration' | 'anticipation' | 'cruise';

/** Sabit gösterim sırası. */
export const ECO_DIMENSIONS: readonly EcoDimensionId[] = ['acceleration', 'anticipation', 'cruise'];

/** Ağırlıklar (toplam 1) — eksik boyutta kalanlar yeniden normalize edilir. */
export const ECO_WEIGHTS: Readonly<Record<EcoDimensionId, number>> = {
  acceleration: 0.40,
  anticipation: 0.35,
  cruise:       0.25,
};

/** Puan için en az hareket süresi (sn) ve mesafe (km). */
export const MIN_MOVING_SEC = 120;
export const MIN_DISTANCE_KM = 1;
/** Süre kapsaması bunun altındaysa (veri boşlukları) puan verilmez. */
export const MIN_TIME_COVERAGE = 0.6;
/** Bir dinamik boyut için gereken en az faz gözlemi (sn). */
export const MIN_PHASE_SEC = 20;

/** Puan bantları. */
export const BAND_EXCELLENT = 85;
export const BAND_GOOD = 70;
export const BAND_FAIR = 50;
/** Bu puanın altındaki en zayıf boyut "odak" olur. */
export const FOCUS_BELOW = 85;

type Curve = ReadonlyArray<readonly [number, number]>;

/**
 * "Sert an" payı → puan (Hızlanma ve Öngörü AYNI ölçeği kullanır).
 * %5 → 80: RDE'nin normal sürüş sınırındaki sürüş "İyi"nin alt kenarıdır.
 */
export const DYNAMIC_CURVE: Curve = [
  [0, 100], [0.02, 95], [0.05, 80], [0.10, 62], [0.20, 38], [0.35, 15], [0.50, 10],
];
/** Ağırlıklı yüksek hız payı → puan. Tamamı 130+ bir yolculuk 35'te durur. */
export const CRUISE_CURVE: Curve = [
  [0, 100], [0.10, 92], [0.25, 80], [0.50, 62], [0.75, 48], [1, 35],
];

const WEEK_MS = 7 * 24 * 3600_000;

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function curveScore(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export type EcoBand = 'excellent' | 'good' | 'fair' | 'poor';

export function ecoBand(score: number): EcoBand {
  if (score >= BAND_EXCELLENT) return 'excellent';
  if (score >= BAND_GOOD) return 'good';
  if (score >= BAND_FAIR) return 'fair';
  return 'poor';
}

/* ── Yolculuk puanı ────────────────────────────────────────────────────── */

export type EcoScoreStatus =
  | 'OK'
  | 'NOT_RECORDED'       // kanıt yok: v2 öncesi kayıt, çökme sonrası kurtarılan kayıt veya bozuk alan
  | 'TOO_SHORT'          // < 2 dk hareket veya < 1 km
  | 'LOW_COVERAGE'       // veri boşlukları süre kapsamasını düşürdü
  | 'NOT_ENOUGH_SIGNAL'; // yeterli hızlanma/yavaşlama gözlenmedi

export type EcoDimensionStatus = 'OK' | 'TOO_LITTLE';

export interface EcoDimension {
  readonly id: EcoDimensionId;
  readonly status: EcoDimensionStatus;
  /** 0–100; kanıt yetersizse `null`. */
  readonly score: number | null;
  /**
   * Gösterilecek ölçüm (%, tam sayı): Hızlanma → sınırı aşan hızlanma payı,
   * Öngörü → sert yavaşlama payı, Seyir → 110 km/h üstü süre payı.
   */
  readonly metricPct: number | null;
}

export interface TripEcoScore {
  readonly status: EcoScoreStatus;
  readonly score: number | null;
  readonly band: EcoBand | null;
  /** Her zaman 3 eleman, `ECO_DIMENSIONS` sırasıyla. */
  readonly dimensions: readonly EcoDimension[];
  /** Geliştirilecek en zayıf boyut; hepsi iyiyse `null`. */
  readonly focus: EcoDimensionId | null;
}

const EMPTY_DIMS: readonly EcoDimension[] = ECO_DIMENSIONS.map((id) => ({
  id, status: 'TOO_LITTLE' as const, score: null, metricPct: null,
}));

function unscored(status: Exclude<EcoScoreStatus, 'OK'>): TripEcoScore {
  return { status, score: null, band: null, dimensions: EMPTY_DIMS, focus: null };
}

function dim(id: EcoDimensionId, ok: boolean, score: number, metricShare: number): EcoDimension {
  return ok
    ? { id, status: 'OK', score: Math.round(score), metricPct: Math.round(metricShare * 100) }
    : { id, status: 'TOO_LITTLE', score: null, metricPct: null };
}

/** En zayıf (en düşük puanlı) boyut; eşitlikte ağırlığı büyük olan. */
function pickFocus(dims: readonly EcoDimension[]): EcoDimensionId | null {
  let best: EcoDimension | null = null;
  for (const d of dims) {
    if (d.score === null || d.score >= FOCUS_BELOW) continue;
    if (best === null || best.score === null || d.score < best.score) best = d;
  }
  return best ? best.id : null;
}

function weighted(dims: readonly EcoDimension[]): number | null {
  let sum = 0, w = 0;
  for (const d of dims) {
    if (d.score === null) continue;
    sum += d.score * ECO_WEIGHTS[d.id];
    w += ECO_WEIGHTS[d.id];
  }
  return w > 0 ? Math.round(sum / w) : null;
}

export function tripEcoScore(t: TripRecord): TripEcoScore {
  const e = t.ecoDynamics;
  if (
    !e || !num(e.accelSec) || !num(e.accelOverSec) || !num(e.decelSec)
    || !num(e.decelHardSec) || !num(e.movingSec) || !num(e.over110Sec) || !num(e.over130Sec)
  ) return unscored('NOT_RECORDED');

  if (e.movingSec < MIN_MOVING_SEC || !(t.distanceKm >= MIN_DISTANCE_KM)) return unscored('TOO_SHORT');
  if (typeof t.timeCoverage !== 'number' || t.timeCoverage < MIN_TIME_COVERAGE) {
    return unscored('LOW_COVERAGE');
  }

  const accelShare = e.accelSec > 0 ? Math.min(1, e.accelOverSec / e.accelSec) : 0;
  const brakeShare = e.decelSec > 0 ? Math.min(1, e.decelHardSec / e.decelSec) : 0;
  const over110 = Math.min(1, e.over110Sec / e.movingSec);
  const over130 = Math.min(over110, e.over130Sec / e.movingSec);
  /* 110–130 yarım, 130+ tam ağırlık. */
  const cruiseExcess = 0.5 * (over110 - over130) + over130;

  const dims: readonly EcoDimension[] = [
    dim('acceleration', e.accelSec >= MIN_PHASE_SEC, curveScore(DYNAMIC_CURVE, accelShare), accelShare),
    dim('anticipation', e.decelSec >= MIN_PHASE_SEC, curveScore(DYNAMIC_CURVE, brakeShare), brakeShare),
    dim('cruise', true, curveScore(CRUISE_CURVE, cruiseExcess), over110),
  ];

  /* Yalnız seyir hızıyla puan verilmez — davranış kanıtı şart. */
  if (dims[0].score === null && dims[1].score === null) return unscored('NOT_ENOUGH_SIGNAL');

  const score = weighted(dims) as number;
  return { status: 'OK', score, band: ecoBand(score), dimensions: dims, focus: pickFocus(dims) };
}

/* ── Haftalık özet ─────────────────────────────────────────────────────── */

export interface EcoWeek {
  /** Bu haftanın yolculuk sayısı ve puanlananlar. */
  readonly trips: number;
  readonly scoredTrips: number;
  /** Puanlanan yolculukların km-ağırlıklı ortalaması; hiç yoksa `null`. */
  readonly score: number | null;
  readonly band: EcoBand | null;
  /** Boyut başına km-ağırlıklı ortalama (o boyutu ölçülen yolculuklardan). */
  readonly dimensions: readonly EcoDimension[];
  readonly focus: EcoDimensionId | null;
  /** Geçen haftanın puanı ve fark (puan). */
  readonly lastWeekScore: number | null;
  readonly delta: number | null;
  /** Hiçbir yolculuk puanlanamadıysa baskın neden. */
  readonly blocker: Exclude<EcoScoreStatus, 'OK'> | null;
}

interface Aggregate {
  readonly score: number | null;
  readonly dimensions: readonly EcoDimension[];
  readonly scored: number;
  readonly blocker: Exclude<EcoScoreStatus, 'OK'> | null;
}

function aggregate(trips: readonly TripRecord[]): Aggregate {
  let sum = 0, km = 0, scored = 0;
  const dSum: Record<EcoDimensionId, number> = { acceleration: 0, anticipation: 0, cruise: 0 };
  const dKm: Record<EcoDimensionId, number> = { acceleration: 0, anticipation: 0, cruise: 0 };
  const mSum: Record<EcoDimensionId, number> = { acceleration: 0, anticipation: 0, cruise: 0 };
  const reasons = new Map<Exclude<EcoScoreStatus, 'OK'>, number>();

  for (const t of trips) {
    const r = tripEcoScore(t);
    if (r.status !== 'OK') {
      reasons.set(r.status, (reasons.get(r.status) ?? 0) + 1);
      continue;
    }
    if (r.score === null) continue;
    scored++;
    sum += r.score * t.distanceKm;
    km += t.distanceKm;
    for (const d of r.dimensions) {
      if (d.score === null || d.metricPct === null) continue;
      dSum[d.id] += d.score * t.distanceKm;
      mSum[d.id] += d.metricPct * t.distanceKm;
      dKm[d.id] += t.distanceKm;
    }
  }

  let blocker: Aggregate['blocker'] = null;
  if (scored === 0) {
    let n = 0;
    for (const [k, v] of reasons) if (v > n) { n = v; blocker = k; }
  }

  const dimensions = ECO_DIMENSIONS.map((id): EcoDimension => dKm[id] > 0
    ? { id, status: 'OK', score: Math.round(dSum[id] / dKm[id]), metricPct: Math.round(mSum[id] / dKm[id]) }
    : { id, status: 'TOO_LITTLE', score: null, metricPct: null });

  return { score: km > 0 ? Math.round(sum / km) : null, dimensions, scored, blocker };
}

/** Son 7 gün (bu hafta) ve önceki 7 gün (geçen hafta). */
export function buildEcoWeek(history: readonly TripRecord[], nowMs: number): EcoWeek {
  const thisWeek = history.filter((t) => t.endTime > nowMs - WEEK_MS && t.endTime <= nowMs);
  const lastWeek = history.filter((t) => t.endTime > nowMs - 2 * WEEK_MS && t.endTime <= nowMs - WEEK_MS);
  const a = aggregate(thisWeek);
  const b = aggregate(lastWeek);
  return {
    trips: thisWeek.length,
    scoredTrips: a.scored,
    score: a.score,
    band: a.score === null ? null : ecoBand(a.score),
    dimensions: a.dimensions,
    focus: pickFocus(a.dimensions),
    lastWeekScore: b.score,
    delta: a.score !== null && b.score !== null ? a.score - b.score : null,
    blocker: a.blocker,
  };
}

/* ── Metin (TR) ────────────────────────────────────────────────────────── */

export const ECO_DIMENSION_COPY: Readonly<Record<EcoDimensionId, {
  title: string; metric: string; tip: string;
}>> = {
  acceleration: {
    title: 'Hızlanma',
    metric: 'Sınırı aşan hızlanma',
    tip: 'Kalkışta ve sollamada gaza daha kademeli bas.',
  },
  anticipation: {
    title: 'Öngörü',
    metric: 'Sert yavaşlama',
    tip: 'Trafiği daha erken oku; frene basmak yerine gazı erkenden bırak.',
  },
  cruise: {
    title: 'Seyir hızı',
    metric: '110 km/s üstü süre',
    tip: 'Hava direnci hızın karesiyle artar; 110 km/s üstünde tüketim hızla yükselir.',
  },
};

export const ECO_BAND_LABEL: Readonly<Record<EcoBand, string>> = {
  excellent: 'Çok iyi',
  good: 'İyi',
  fair: 'Orta',
  poor: 'Zayıf',
};

/** Puan yokken kullanıcıya gösterilecek neden. */
export const ECO_STATUS_COPY: Readonly<Record<Exclude<EcoScoreStatus, 'OK'>, string>> = {
  NOT_RECORDED: 'Eko ölçümü yok — puan, bu özellikten sonra kaydedilen yolculuklarda oluşur.',
  TOO_SHORT: 'Puan için en az 2 dk hareket ve 1 km gerekir.',
  LOW_COVERAGE: 'Konum/OBD verisi sık kesildi; puan hesaplanmadı.',
  NOT_ENOUGH_SIGNAL: 'Yeterli hızlanma ve yavaşlama gözlenmedi.',
};

/** Hepsi iyi olduğunda. */
export const ECO_ALL_GOOD_COPY = 'Akıcı ve öngörülü bir sürüş. Böyle devam.';

/* ── Sesli cevap (Mavi) ────────────────────────────────────────────────── */

/** Bu farkın altındaki haftalık değişim gürültüdür — söylenmez. */
export const DELTA_SPEAK_MIN = 3;

const lowerTr = (s: string) => s.toLocaleLowerCase('tr-TR');

/**
 * "Eko puanım kaç" sorusunun sesli cevabı (SAF).
 *
 * Sürüşte dinlenir → KISA: haftalık puan, (varsa) son yolculuk YA DA haftalık
 * fark, tek gelişim ipucu. Kanıt yoksa sayı SÖYLENMEZ, nedeni söylenir.
 * Aktif yolculuk puanlanmaz (kayıt kapanınca hesaplanır) — bu açıkça söylenir.
 */
export function buildEcoScoreSpeech(
  history: readonly TripRecord[],
  nowMs: number,
  tripActive: boolean,
): string {
  const week = buildEcoWeek(history, nowMs);
  const pending = tripActive ? ' Şu anki yolculuğun bitince puanlanacak.' : '';

  if (week.score === null || week.band === null) {
    if (week.trips > 0) {
      return `Bu hafta puanlanmış yolculuk yok. ${ECO_STATUS_COPY[week.blocker ?? 'NOT_ENOUGH_SIGNAL']}${pending}`;
    }
    if (week.lastWeekScore !== null) {
      return `Bu hafta henüz yolculuk yok. Geçen haftaki eko puanın ${week.lastWeekScore} olarak hesaplandı.${pending}`;
    }
    return `Henüz puanlanmış bir yolculuğun yok. Eko puanı, en az 2 dakika ve 1 kilometrelik yolculuklardan sonra oluşur.${pending}`;
  }

  const parts = [`Bu hafta eko puanın ${week.score}, ${lowerTr(ECO_BAND_LABEL[week.band])}.`];

  /* Son yolculuk yalnız haftada birden çok puanlı yolculuk varsa söylenir
     (tek yolculukta haftalık puanla AYNI sayıdır). Puansız son yolculuk
     atlanır — "puanlanamadı" ayrıntısı Seyir Defteri'nde. */
  let last: TripRecord | null = null;
  for (const t of history) if (t.endTime <= nowMs && (!last || t.endTime > last.endTime)) last = t;
  const lastScore = last ? tripEcoScore(last).score : null;
  if (lastScore !== null && week.scoredTrips > 1) {
    parts.push(`Son yolculuğun ${lastScore}.`);
  } else if (week.delta !== null && Math.abs(week.delta) >= DELTA_SPEAK_MIN) {
    parts.push(week.delta > 0
      ? `Geçen haftaya göre ${week.delta} puan daha iyi.`
      : `Geçen haftaya göre ${-week.delta} puan geride.`);
  }

  parts.push(week.focus
    ? `Gelişim alanın ${lowerTr(ECO_DIMENSION_COPY[week.focus].title)}. ${ECO_DIMENSION_COPY[week.focus].tip}`
    : ECO_ALL_GOOD_COPY);

  return parts.join(' ') + pending;
}
