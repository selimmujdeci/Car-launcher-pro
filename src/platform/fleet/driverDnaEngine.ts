/**
 * driverDnaEngine.ts — DNA ÖĞRENME · GÜVEN · SAPMA MOTORU (SAF).
 *
 * ── NE YAPAR ───────────────────────────────────────────────────────────
 * Yolculuk KANITINI biriktirir (`accumulate`), biriken kanıttan metrikleri
 * TÜRETİR (`buildDna`), yeterli kanıt yoksa DNA ÜRETMEZ ve sapmayı
 * (drift) kanıtla raporlar.
 *
 * ── NE YAPMAZ (BAĞLAYICI) ──────────────────────────────────────────────
 * · Model eğitmez, tahmin etmez, öneri üretmez, doğal dil kurmaz — **AI YOK**.
 * · Eksik veriyi doldurmaz: ölçüm yoksa metrik `UNKNOWN` kalır.
 * · Tek bir "sürücü puanı" üretmez.
 * · Sürücüyü etiketlemez ("kötü sürücü" gibi bir çıktı YOKTUR).
 *
 * ── İDEMPOTENS ─────────────────────────────────────────────────────────
 * Aynı yolculuk iki kez biriktirilmez: çağıran `tripKey` tekilliğini
 * sağlamalıdır (`accumulateTrip` bunu KENDİ İÇİNDE de doğrular). Çevrimdışı
 * kuyruk aynı yolculuğu 10 kez yüklerse DNA 10 kat sapmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  DNA_COMPONENTS, DNA_COMPONENTS_WITHOUT_EVIDENCE,
  DNA_MIN_TRIPS, DNA_MIN_DISTANCE_KM, DNA_DRIFT_MIN_WINDOW,
  NO_DRIVER_DNA, dnaLearningLevel, unknownMetric,
  dnaAgeMs, dnaStalenessMs, dnaUnknownCount, dnaMeasuredCount,
  type DnaComponent, type DnaConfidence, type DnaDriftEvidence,
  type DnaDriftState, type DnaMetric, type DriverDna, type VehicleImpactEstimate,
} from './driverDna';

/* ── Yolculuk kanıtı (girdi sözleşmesi) ────────────────────────────────── */

/** Bir alanın yolculukta NASIL elde edildiği — `vehicle_trips.*_source` ile aynı. */
export const TRIP_SOURCES = ['MEASURED', 'DERIVED', 'ESTIMATED', 'UNAVAILABLE'] as const;
export type TripSource = (typeof TRIP_SOURCES)[number];

/** Değer + kaynağı — kaynak olmadan değer KABUL EDİLMEZ. */
export interface TripSignal {
  readonly value: number | null;
  readonly source: TripSource;
}

export const UNAVAILABLE_SIGNAL: TripSignal = Object.freeze({
  value: null, source: 'UNAVAILABLE',
});

/**
 * DNA'ya katkı veren yolculuk KANITI.
 *
 * ⚠️ Rota, koordinat, VIN, sürücü adı ve maliyet BURAYA GİRMEZ: DNA sürüş
 * karakteridir, bir seyahat kaydı değil.
 */
export interface DnaTripEvidence {
  /** Yolculuğun tekil anahtarı — idempotens kilidi. */
  readonly tripKey: string;
  readonly startedAtMs: number;
  readonly distanceKm: TripSignal;
  readonly durationMin: TripSignal;
  readonly idleMin: TripSignal;
  readonly movingMin: TripSignal;
  readonly avgSpeedKmh: TripSignal;
  readonly maxSpeedKmh: TripSignal;
  readonly harshBrakeCount: TripSignal;
  readonly harshAccelCount: TripSignal;
  readonly speedViolations: TripSignal;
  readonly stopCount: TripSignal;
  readonly maxRpm: TripSignal;
  readonly maxEngineTempC: TripSignal;
  readonly fuelUsedL: TripSignal;
  /**
   * Yolculuğun gece başlayıp başlamadığı — **araç yerel saatinden** gelir.
   * Bilinmiyorsa `null`: UTC'den "gece" uydurmak, farklı saat dilimlerinde
   * yanlış karakter üretirdi.
   */
  readonly startedAtNight: boolean | null;
}

/* ── Birikim (accumulator) ─────────────────────────────────────────────── */

/**
 * Metrik başına ayrı kanıt sayacı tutulur.
 *
 * NEDEN AYRI: bir yolculuk mesafeyi ölçüp sert freni ölçmemiş olabilir.
 * Tek bir "trip sayacı" kullanmak, ölçülmemiş alanı ölçülmüş gibi
 * gösterirdi (UNKNOWN korunmaz).
 */
export interface DnaEvidenceSum {
  readonly sum: number;
  readonly count: number;
  readonly distanceKm: number;
  /** Kanıtın en zayıf halkası — hepsi MEASURED değilse metrik DERIVED olur. */
  readonly measuredOnly: boolean;
}

const EMPTY_SUM: DnaEvidenceSum = Object.freeze({
  sum: 0, count: 0, distanceKm: 0, measuredOnly: true,
});

export interface DnaAccumulator {
  readonly tripKeys: readonly string[];
  readonly tripCount: number;
  readonly totalDistanceKm: number;
  readonly firstTripAtMs: number | null;
  readonly lastTripAtMs: number | null;
  readonly harshBrake: DnaEvidenceSum;
  readonly harshAccel: DnaEvidenceSum;
  readonly speedViolation: DnaEvidenceSum;
  readonly stops: DnaEvidenceSum;
  readonly idle: DnaEvidenceSum;
  readonly moving: DnaEvidenceSum;
  readonly avgSpeed: DnaEvidenceSum;
  readonly maxSpeed: DnaEvidenceSum;
  readonly maxRpm: DnaEvidenceSum;
  readonly maxTemp: DnaEvidenceSum;
  readonly fuel: DnaEvidenceSum;
  readonly night: DnaEvidenceSum;
  /** Tutarlılık için: sert olay oranlarının yolculuk bazlı kareler toplamı. */
  readonly eventRateSquareSum: number;
  readonly eventRateSum: number;
  readonly eventRateCount: number;
}

export const EMPTY_DNA_ACCUMULATOR: DnaAccumulator = Object.freeze({
  tripKeys: Object.freeze([]) as readonly string[],
  tripCount: 0, totalDistanceKm: 0,
  firstTripAtMs: null, lastTripAtMs: null,
  harshBrake: EMPTY_SUM, harshAccel: EMPTY_SUM, speedViolation: EMPTY_SUM,
  stops: EMPTY_SUM, idle: EMPTY_SUM, moving: EMPTY_SUM,
  avgSpeed: EMPTY_SUM, maxSpeed: EMPTY_SUM, maxRpm: EMPTY_SUM,
  maxTemp: EMPTY_SUM, fuel: EMPTY_SUM, night: EMPTY_SUM,
  eventRateSquareSum: 0, eventRateSum: 0, eventRateCount: 0,
});

/** Yolculuk anahtarı halkası tavanı — sınırsız dizi bellek sızıntısıdır. */
export const DNA_TRIP_KEY_MEMORY = 500;

function usable(s: TripSignal): boolean {
  return s.value !== null && Number.isFinite(s.value)
    && (s.source === 'MEASURED' || s.source === 'DERIVED');
}

function addSignal(
  acc: DnaEvidenceSum, s: TripSignal, distanceKm: number,
): DnaEvidenceSum {
  if (!usable(s)) return acc;
  return {
    sum: acc.sum + (s.value as number),
    count: acc.count + 1,
    distanceKm: acc.distanceKm + (Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0),
    measuredOnly: acc.measuredOnly && s.source === 'MEASURED',
  };
}

/**
 * Yolculuk kanıtını birikime EKLER (SAF — girdi değişmez).
 *
 * Aynı `tripKey` daha önce eklendiyse birikim **AYNEN** döner: tekrar
 * oynatma (replay) DNA'yı bozamaz.
 */
export function accumulateTrip(
  acc: DnaAccumulator, ev: DnaTripEvidence,
): DnaAccumulator {
  if (ev.tripKey.length === 0) return acc;
  if (acc.tripKeys.includes(ev.tripKey)) return acc;   // ← REPLAY KİLİDİ

  const dist = usable(ev.distanceKm) ? Math.max(0, ev.distanceKm.value as number) : 0;

  /* Tutarlılık örneği: yalnız hem mesafe hem olay ölçülmüşse anlamlıdır. */
  let rateSum = acc.eventRateSum;
  let rateSq = acc.eventRateSquareSum;
  let rateCount = acc.eventRateCount;
  if (dist > 0 && (usable(ev.harshBrakeCount) || usable(ev.harshAccelCount))) {
    const events = (usable(ev.harshBrakeCount) ? (ev.harshBrakeCount.value as number) : 0)
                 + (usable(ev.harshAccelCount) ? (ev.harshAccelCount.value as number) : 0);
    const rate = (events / dist) * 100;
    rateSum += rate;
    rateSq += rate * rate;
    rateCount += 1;
  }

  const keys = [...acc.tripKeys, ev.tripKey];
  return {
    tripKeys: keys.length > DNA_TRIP_KEY_MEMORY
      ? keys.slice(keys.length - DNA_TRIP_KEY_MEMORY) : keys,
    tripCount: acc.tripCount + 1,
    totalDistanceKm: acc.totalDistanceKm + dist,
    firstTripAtMs: acc.firstTripAtMs === null
      ? ev.startedAtMs : Math.min(acc.firstTripAtMs, ev.startedAtMs),
    lastTripAtMs: acc.lastTripAtMs === null
      ? ev.startedAtMs : Math.max(acc.lastTripAtMs, ev.startedAtMs),
    harshBrake:     addSignal(acc.harshBrake, ev.harshBrakeCount, dist),
    harshAccel:     addSignal(acc.harshAccel, ev.harshAccelCount, dist),
    speedViolation: addSignal(acc.speedViolation, ev.speedViolations, dist),
    stops:          addSignal(acc.stops, ev.stopCount, dist),
    idle:           addSignal(acc.idle, ev.idleMin, dist),
    moving:         addSignal(acc.moving, ev.movingMin, dist),
    avgSpeed:       addSignal(acc.avgSpeed, ev.avgSpeedKmh, dist),
    maxSpeed:       addSignal(acc.maxSpeed, ev.maxSpeedKmh, dist),
    maxRpm:         addSignal(acc.maxRpm, ev.maxRpm, dist),
    maxTemp:        addSignal(acc.maxTemp, ev.maxEngineTempC, dist),
    fuel:           addSignal(acc.fuel, ev.fuelUsedL, dist),
    night: ev.startedAtNight === null ? acc.night : {
      sum: acc.night.sum + (ev.startedAtNight ? 1 : 0),
      count: acc.night.count + 1,
      distanceKm: acc.night.distanceKm + dist,
      measuredOnly: acc.night.measuredOnly,
    },
    eventRateSum: rateSum, eventRateSquareSum: rateSq, eventRateCount: rateCount,
  };
}

/* ── Metrik türetme ────────────────────────────────────────────────────── */

function provenanceOf(e: DnaEvidenceSum): 'MEASURED' | 'DERIVED' {
  return e.measuredOnly ? 'MEASURED' : 'DERIVED';
}

/** 100 km başına olay oranı — mesafe kanıtı yoksa UNKNOWN. */
function ratePer100Km(
  component: DnaComponent, e: DnaEvidenceSum, minDistanceKm: number,
): DnaMetric {
  if (e.count === 0) return unknownMetric(component, 'NO_MEASURED_INPUT');
  if (e.distanceKm < minDistanceKm) {
    return { ...unknownMetric(component, 'INSUFFICIENT_DISTANCE'),
      sampleCount: e.count, sampleDistanceKm: e.distanceKm };
  }
  return {
    component, value: (e.sum / e.distanceKm) * 100, unit: 'EVENTS_PER_100KM',
    provenance: provenanceOf(e), unknownReason: null,
    sampleCount: e.count, sampleDistanceKm: e.distanceKm,
  };
}

function ratioMetric(
  component: DnaComponent, num: DnaEvidenceSum, denomSum: number,
  provenance: 'MEASURED' | 'DERIVED',
): DnaMetric {
  if (num.count === 0 || denomSum <= 0) {
    return unknownMetric(component, 'NO_MEASURED_INPUT');
  }
  return {
    component, value: clamp01(num.sum / denomSum), unit: 'RATIO',
    provenance, unknownReason: null,
    sampleCount: num.count, sampleDistanceKm: num.distanceKm,
  };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 0..1 endeksine normalize eder (üst sınır aşılırsa 1'de doyar). */
function indexOf(value: number, worstAt: number): number {
  if (!Number.isFinite(value) || worstAt <= 0) return 0;
  return clamp01(value / worstAt);
}

/**
 * Birikimden metrikleri TÜRETİR.
 *
 * Kanıt kaynağı OLMAYAN bileşenler (viraj stili, akü bakımı) kalıcı
 * `UNKNOWN` + `NO_EVIDENCE_SOURCE` döner — "ortalama" veya `0` ile
 * DOLDURULMAZ.
 */
export function buildDnaMetrics(acc: DnaAccumulator): DnaMetric[] {
  const out: DnaMetric[] = [];
  const MIN_KM = 10;   // oranın anlamlı olması için asgari kanıt mesafesi

  const brake = ratePer100Km('BRAKING_STYLE', acc.harshBrake, MIN_KM);
  const accel = ratePer100Km('ACCELERATION_STYLE', acc.harshAccel, MIN_KM);

  for (const component of DNA_COMPONENTS) {
    if (DNA_COMPONENTS_WITHOUT_EVIDENCE.includes(component)) {
      /* YAPISAL EKSİK — kaynak eklenene kadar bilinmez. */
      out.push(unknownMetric(component, 'NO_EVIDENCE_SOURCE'));
      continue;
    }

    switch (component) {
      case 'BRAKING_STYLE':      out.push(brake); break;
      case 'ACCELERATION_STYLE': out.push(accel); break;

      case 'DRIVING_SMOOTHNESS': {
        /* Yumuşaklık = sert olayların YOKLUĞU. İki metrikten türer → DERIVED. */
        if (brake.value === null && accel.value === null) {
          out.push(unknownMetric(component, brake.unknownReason ?? 'NO_MEASURED_INPUT'));
          break;
        }
        const events = (brake.value ?? 0) + (accel.value ?? 0);
        out.push({
          component, value: 1 - indexOf(events, 20), unit: 'INDEX_0_1',
          provenance: 'DERIVED', unknownReason: null,
          sampleCount: Math.max(brake.sampleCount, accel.sampleCount),
          sampleDistanceKm: Math.max(brake.sampleDistanceKm, accel.sampleDistanceKm),
        });
        break;
      }

      case 'AGGRESSIVENESS': {
        const violations = ratePer100Km('AGGRESSIVENESS', acc.speedViolation, MIN_KM);
        if (brake.value === null && accel.value === null && violations.value === null) {
          out.push(unknownMetric(component, 'NO_MEASURED_INPUT'));
          break;
        }
        const raw = (brake.value ?? 0) + (accel.value ?? 0) + (violations.value ?? 0) * 2;
        out.push({
          component, value: indexOf(raw, 30), unit: 'INDEX_0_1',
          provenance: 'DERIVED', unknownReason: null,
          sampleCount: Math.max(brake.sampleCount, accel.sampleCount, violations.sampleCount),
          sampleDistanceKm: Math.max(brake.sampleDistanceKm, violations.sampleDistanceKm),
        });
        break;
      }

      case 'FUEL_DISCIPLINE': {
        if (acc.fuel.count === 0 || acc.fuel.distanceKm < MIN_KM) {
          out.push(unknownMetric(component,
            acc.fuel.count === 0 ? 'NO_MEASURED_INPUT' : 'INSUFFICIENT_DISTANCE'));
          break;
        }
        out.push({
          component, value: (acc.fuel.sum / acc.fuel.distanceKm) * 100,
          unit: 'L_PER_100KM', provenance: provenanceOf(acc.fuel), unknownReason: null,
          sampleCount: acc.fuel.count, sampleDistanceKm: acc.fuel.distanceKm,
        });
        break;
      }

      case 'MECHANICAL_SYMPATHY': {
        if (acc.maxRpm.count === 0 && acc.maxTemp.count === 0) {
          out.push(unknownMetric(component, 'NO_MEASURED_INPUT'));
          break;
        }
        /* Ortalama tepe devir ve tepe sıcaklık ne kadar düşükse duyarlılık o kadar yüksek. */
        const rpmIdx = acc.maxRpm.count > 0
          ? indexOf(acc.maxRpm.sum / acc.maxRpm.count, 6000) : 0;
        const tempIdx = acc.maxTemp.count > 0
          ? indexOf((acc.maxTemp.sum / acc.maxTemp.count) - 90, 30) : 0;
        out.push({
          component, value: 1 - clamp01((rpmIdx + tempIdx) / 2), unit: 'INDEX_0_1',
          provenance: 'DERIVED', unknownReason: null,
          sampleCount: Math.max(acc.maxRpm.count, acc.maxTemp.count),
          sampleDistanceKm: Math.max(acc.maxRpm.distanceKm, acc.maxTemp.distanceKm),
        });
        break;
      }

      case 'NIGHT_DRIVING':
        /* Gece bilgisi araç yerel saatinden gelir; UTC'den TÜRETİLMEZ. */
        out.push(ratioMetric(component, acc.night, acc.night.count, 'DERIVED'));
        break;

      case 'IDLE_BEHAVIOUR': {
        const total = acc.idle.sum + acc.moving.sum;
        out.push(ratioMetric(component, acc.idle, total,
          acc.idle.measuredOnly && acc.moving.measuredOnly ? 'MEASURED' : 'DERIVED'));
        break;
      }

      case 'URBAN_DRIVING': {
        if (acc.avgSpeed.count === 0) {
          out.push(unknownMetric(component, 'NO_MEASURED_INPUT'));
          break;
        }
        /* Düşük ortalama hız + sık duruş → şehir içi. */
        const avg = acc.avgSpeed.sum / acc.avgSpeed.count;
        out.push({
          component, value: 1 - clamp01(avg / 90), unit: 'INDEX_0_1',
          provenance: 'DERIVED', unknownReason: null,
          sampleCount: acc.avgSpeed.count, sampleDistanceKm: acc.avgSpeed.distanceKm,
        });
        break;
      }

      case 'HIGHWAY_DRIVING': {
        if (acc.avgSpeed.count === 0) {
          out.push(unknownMetric(component, 'NO_MEASURED_INPUT'));
          break;
        }
        const avg = acc.avgSpeed.sum / acc.avgSpeed.count;
        out.push({
          component, value: clamp01(avg / 90), unit: 'INDEX_0_1',
          provenance: 'DERIVED', unknownReason: null,
          sampleCount: acc.avgSpeed.count, sampleDistanceKm: acc.avgSpeed.distanceKm,
        });
        break;
      }

      case 'ENGINE_CARE': {
        if (acc.maxTemp.count === 0) {
          out.push(unknownMetric(component, 'NO_MEASURED_INPUT'));
          break;
        }
        const avgTemp = acc.maxTemp.sum / acc.maxTemp.count;
        out.push({
          component, value: 1 - indexOf(avgTemp - 90, 30), unit: 'INDEX_0_1',
          provenance: provenanceOf(acc.maxTemp) === 'MEASURED' ? 'DERIVED' : 'DERIVED',
          unknownReason: null,
          sampleCount: acc.maxTemp.count, sampleDistanceKm: acc.maxTemp.distanceKm,
        });
        break;
      }

      case 'CONSISTENCY': {
        /* Tutarlılık = olay oranının yolculuklar arası DEĞİŞKENLİĞİNİN azlığı.
           Tek yolculuktan varyans hesaplanamaz → UNKNOWN. */
        if (acc.eventRateCount < 2) {
          out.push(unknownMetric(component, 'INSUFFICIENT_TRIPS'));
          break;
        }
        const mean = acc.eventRateSum / acc.eventRateCount;
        const variance = Math.max(0,
          acc.eventRateSquareSum / acc.eventRateCount - mean * mean);
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
        out.push({
          component, value: 1 - clamp01(cv), unit: 'INDEX_0_1',
          provenance: 'DERIVED', unknownReason: null,
          sampleCount: acc.eventRateCount, sampleDistanceKm: acc.totalDistanceKm,
        });
        break;
      }

      /* Kanıt kaynağı olmayanlar yukarıda ele alındı. */
      case 'CORNERING_STYLE':
      case 'BATTERY_CARE':
        out.push(unknownMetric(component, 'NO_EVIDENCE_SOURCE'));
        break;
    }
  }
  return out;
}

/* ── Güven motoru ──────────────────────────────────────────────────────── */

/**
 * DNA GÜVENİ — üç kapıdan geçer ve **en zayıf halka** kazanır.
 *
 *  1. Yolculuk sayısı (öğrenme seviyesi)
 *  2. Kanıt mesafesi
 *  3. Bilinmeyen metrik oranı — yarısından çoğu bilinmiyorsa güven `LOW`'u
 *     aşamaz (metriklerin çoğu boşken "yüksek güvenli DNA" bir yalandır).
 *
 * Eşiğin altında `UNKNOWN` döner ve DNA OLUŞMAZ.
 */
export function computeDnaConfidence(
  acc: DnaAccumulator, metrics: readonly DnaMetric[],
): DnaConfidence {
  if (acc.tripCount < DNA_MIN_TRIPS) return 'UNKNOWN';
  if (acc.totalDistanceKm < DNA_MIN_DISTANCE_KM) return 'UNKNOWN';

  const known = metrics.filter((m) => m.provenance !== 'UNKNOWN').length;
  if (known === 0) return 'UNKNOWN';
  const knownRatio = known / Math.max(1, metrics.length);

  const level = dnaLearningLevel(acc.tripCount);
  let byTrips: DnaConfidence =
    level === 'MATURE' ? 'HIGH'
    : level === 'ESTABLISHED' ? 'HIGH'
    : level === 'DEVELOPING' ? 'MEDIUM'
    : 'LOW';

  /* Bilinmeyen ağırlıklıysa güven KIRPILIR (en zayıf halka). */
  if (knownRatio < 0.5) byTrips = 'LOW';
  else if (knownRatio < 0.7 && byTrips === 'HIGH') byTrips = 'MEDIUM';

  return byTrips;
}

/* ── Sapma (drift) ─────────────────────────────────────────────────────── */

/** Anlamlı sayılan en küçük GÖRECE değişim (%25). */
export const DNA_DRIFT_RELATIVE_THRESHOLD = 0.25;

/**
 * Taban ile son pencereyi karşılaştırır.
 *
 * ⚠️ Sapma bir SUÇLAMA değildir: sürücü değişmiş de olabilir, güzergâh veya
 * mevsim değişmiş de. Bu yüzden yorum ÜRETİLMEZ — yalnız hangi metrikte,
 * ne kadar ve kaç örnekle değiştiği raporlanır.
 */
export function detectDnaDrift(
  baseline: readonly DnaMetric[], recent: readonly DnaMetric[],
): { readonly state: DnaDriftState; readonly evidence: DnaDriftEvidence[] } {
  const evidence: DnaDriftEvidence[] = [];
  let comparable = 0;

  for (const b of baseline) {
    if (b.provenance === 'UNKNOWN' || b.value === null) continue;
    const r = recent.find((m) => m.component === b.component);
    if (r === undefined || r.provenance === 'UNKNOWN' || r.value === null) continue;
    if (b.sampleCount < DNA_DRIFT_MIN_WINDOW || r.sampleCount < DNA_DRIFT_MIN_WINDOW) continue;

    comparable += 1;
    const delta = r.value - b.value;
    const rel = Math.abs(delta) / Math.max(Math.abs(b.value), 1e-6);
    if (rel >= DNA_DRIFT_RELATIVE_THRESHOLD) {
      evidence.push({
        component: b.component,
        baselineValue: b.value, recentValue: r.value,
        delta, relativeChange: rel,
        baselineSampleCount: b.sampleCount, recentSampleCount: r.sampleCount,
      });
    }
  }

  if (comparable === 0) return { state: 'INSUFFICIENT', evidence: [] };
  return { state: evidence.length > 0 ? 'DRIFTING' : 'STABLE', evidence };
}

/* ── Araç etkisi (TAHMİN) ──────────────────────────────────────────────── */

/**
 * Sürücünün araç üzerindeki TAHMİNİ etkisi.
 *
 * ⚠️ Gerçek aşınma ÖLÇÜLMÜYOR. Bu katman yalnız ölçülmüş sürüş olaylarından
 * bir eğilim türetir ve her kayıt `estimated: true` taşır. Kanıt yoksa
 * endeks `null` kalır — "etkisi yok" DEMEK DEĞİLDİR, "bilinmiyor" demektir.
 */
export function buildVehicleImpact(
  metrics: readonly DnaMetric[],
): VehicleImpactEstimate[] {
  const get = (c: DnaComponent) => metrics.find((m) => m.component === c) ?? null;
  const brake = get('BRAKING_STYLE');
  const accel = get('ACCELERATION_STYLE');
  const aggr  = get('AGGRESSIVENESS');
  const fuel  = get('FUEL_DISCIPLINE');
  const mech  = get('MECHANICAL_SYMPATHY');

  const mk = (
    kind: VehicleImpactEstimate['kind'],
    index: number | null,
    basedOn: readonly DnaComponent[],
    reason: VehicleImpactEstimate['unknownReason'],
  ): VehicleImpactEstimate => ({
    kind, index,
    provenance: index === null ? 'UNKNOWN' : 'DERIVED',
    unknownReason: index === null ? reason : null,
    estimated: true, basedOn,
  });

  return [
    mk('BRAKE_WEAR',
      brake?.value == null ? null : clamp01(brake.value / 20),
      ['BRAKING_STYLE'], 'NO_MEASURED_INPUT'),
    mk('TIRE_WEAR',
      accel?.value == null && aggr?.value == null ? null
        : clamp01(((accel?.value ?? 0) / 20 + (aggr?.value ?? 0)) / 2),
      ['ACCELERATION_STYLE', 'AGGRESSIVENESS'], 'NO_MEASURED_INPUT'),
    mk('ENGINE_STRESS',
      mech?.value == null ? null : clamp01(1 - mech.value),
      ['MECHANICAL_SYMPATHY'], 'NO_MEASURED_INPUT'),
    mk('FUEL_OVERUSE',
      fuel?.value == null ? null : clamp01((fuel.value - 5) / 15),
      ['FUEL_DISCIPLINE'], 'NO_MEASURED_INPUT'),
  ];
}

/* ── DNA kurulumu (tek giriş noktası) ──────────────────────────────────── */

export interface BuildDnaInput {
  readonly driverId: string | null;
  readonly companyId: string | null;
  readonly accumulator: DnaAccumulator;
  /** Sapma karşılaştırması için taban ve son pencere (opsiyonel). */
  readonly baseline?: DnaAccumulator;
  readonly recent?: DnaAccumulator;
  readonly revision: number;
}

/**
 * Biriken kanıttan DNA kurar.
 *
 * **EŞİK ALTINDA DNA ÜRETİLMEZ:** yolculuk sayısı veya kanıt mesafesi
 * yetersizse `NO_DNA` döner ve metrik listesi BOŞ kalır — yarım bir DNA
 * göstermek, kullanıcıya kanıt gibi sunulan bir tahmindir.
 */
export function buildDna(input: BuildDnaInput): DriverDna {
  const { accumulator: acc } = input;
  const metrics = buildDnaMetrics(acc);
  const confidence = computeDnaConfidence(acc, metrics);
  const learningLevel = dnaLearningLevel(acc.tripCount);

  if (confidence === 'UNKNOWN') {
    return {
      driverId: input.driverId, companyId: input.companyId,
      status: 'NO_DNA', learningLevel, confidence: 'UNKNOWN',
      tripCount: acc.tripCount, totalDistanceKm: acc.totalDistanceKm,
      firstTripAtMs: acc.firstTripAtMs, lastTripAtMs: acc.lastTripAtMs,
      metrics: [], driftState: 'INSUFFICIENT', driftEvidence: [],
      vehicleImpact: [], revision: input.revision,
    };
  }

  const drift = input.baseline !== undefined && input.recent !== undefined
    ? detectDnaDrift(buildDnaMetrics(input.baseline), buildDnaMetrics(input.recent))
    : { state: 'INSUFFICIENT' as DnaDriftState, evidence: [] as DnaDriftEvidence[] };

  return {
    driverId: input.driverId, companyId: input.companyId,
    status: confidence === 'LOW' ? 'FORMING' : 'ACTIVE',
    learningLevel, confidence,
    tripCount: acc.tripCount, totalDistanceKm: acc.totalDistanceKm,
    firstTripAtMs: acc.firstTripAtMs, lastTripAtMs: acc.lastTripAtMs,
    metrics,
    driftState: drift.state, driftEvidence: drift.evidence,
    vehicleImpact: buildVehicleImpact(metrics),
    revision: input.revision,
  };
}

/* ── Cihaz tarafı gözlem yüzeyi (LAB) ──────────────────────────────────── */

/**
 * DNA deposu — **head unit tarafında BİLİNÇLİ OLARAK BOŞTUR.**
 *
 * DNA sunucuda üretilir (`driver_dna` tablosu, migration 053): karakter
 * uzun dönemli bir kanıt birikimidir ve tek bir cihazın yerel belleğinde
 * yaşayamaz — cihaz değişince kaybolurdu. Head unit'te DNA ÜRETEN bir yol
 * YOKTUR; bu depo yalnız gelecekte bir okuma köprüsü bağlandığında
 * dolacak SÖZLEŞMEYİ ve LAB'ın dürüst "henüz yok" cevabını sağlar.
 *
 * Timer YOK · I/O YOK · ağ çağrısı YOK.
 */
class DriverDnaStore {
  private _dna: DriverDna = NO_DRIVER_DNA;
  private _lastUpdateAtMs: number | null = null;
  private _source: 'NONE' | 'SERVER' = 'NONE';

  /**
   * Sunucudan okunmuş DNA'yı yerleştirir (köprü bağlandığında kullanılacak).
   * Head unit DNA HESAPLAMAZ — yalnız sunucunun ürettiğini taşır.
   */
  setFromServer(dna: DriverDna, nowMs: number): void {
    this._dna = dna;
    this._lastUpdateAtMs = nowMs;
    this._source = 'SERVER';
  }

  clear(): void {
    this._dna = NO_DRIVER_DNA;
    this._lastUpdateAtMs = null;
    this._source = 'NONE';
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(nowMs: number): {
    readonly dna: DriverDna;
    readonly source: 'NONE' | 'SERVER';
    readonly lastUpdateAtMs: number | null;
    readonly dnaAgeMs: number | null;
    readonly stalenessMs: number | null;
    readonly metricCount: number;
    readonly unknownCount: number;
    readonly measuredCount: number;
  } {
    try {
      return {
        dna: this._dna,
        source: this._source,
        lastUpdateAtMs: this._lastUpdateAtMs,
        dnaAgeMs: dnaAgeMs(this._dna, nowMs),
        stalenessMs: dnaStalenessMs(this._dna, nowMs),
        metricCount: this._dna.metrics.length,
        unknownCount: dnaUnknownCount(this._dna),
        measuredCount: dnaMeasuredCount(this._dna),
      };
    } catch {
      return {
        dna: NO_DRIVER_DNA, source: 'NONE', lastUpdateAtMs: null,
        dnaAgeMs: null, stalenessMs: null,
        metricCount: 0, unknownCount: 0, measuredCount: 0,
      };
    }
  }

  /** @internal — testler arası izolasyon. */
  _resetForTest(): void { this.clear(); }
}

export const driverDnaStore = new DriverDnaStore();

/** LAB salt-okuma yüzeyi — DNA ÜRETMEZ, yalnız okur. */
export function readDriverDna(nowMs: number) {
  return driverDnaStore.read(nowMs);
}

/** @internal — testler arası izolasyon. */
export function _resetDriverDnaStoreForTest(): void {
  driverDnaStore._resetForTest();
}
