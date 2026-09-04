/**
 * drivingContextModel.ts — MUSIC F8 · Sürüş bağlamı SINIFLANDIRMASI (SAF).
 *
 * NE YAPAR: ölçülmüş araç/yolculuk sinyallerinden, müzik kararlarının
 * dayanabileceği **kanıtlı** bir bağlam üretir.
 *
 * NE YAPMAZ:
 *   · Sürüş durumu için İKİNCİ otorite kurmaz — hız `UnifiedVehicleStore`un,
 *     yolculuk `tripLogService`in, rehberlik `navigationService`in kalır.
 *     Burada yalnız o okumaların MÜZİK için ne anlama geldiği sınıflandırılır.
 *   · Çalma başlatmaz, kuyruğa dokunmaz, öneri seçmez (bu `musicIntelligenceModel`).
 *   · Ham konum · rota geçmişi · hedef adı · koordinat GÖRMEZ; girdisi yalnız
 *     sayısal/boolean ölçümlerdir (gizlilik: F8 modeline konum GİRMEZ).
 *
 * DÜRÜSTLÜK: ölçülemeyen her eksen `UNKNOWN` kalır. "Hız yok → duruyordur"
 * gibi bir varsayım YAPILMAZ; kanıtsız bağlam otomatik eyleme yol AÇAMAZ.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/** Gözlemlenebilirlik sözleşmesi `sessionInspectorModel` ile AYNI kelimeleri kullanır. */
export type ContextEvidenceState = 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE';

export interface ContextEvidence {
  /** Sinyalin kanonik sahibi (LAB'da kaynak olarak gösterilir). */
  readonly signal: string;
  readonly state: ContextEvidenceState;
  /** Kısa gerekçe/ölçüm özeti — kişisel veri TAŞIMAZ. */
  readonly detail: string;
}

export type MotionClass = 'PARKED' | 'CITY' | 'HIGHWAY' | 'UNKNOWN';
export type DaypartClass = 'DAY' | 'NIGHT' | 'UNKNOWN';
export type JourneyPhase = 'START' | 'MID' | 'LONG_HAUL' | 'UNKNOWN';
export type ContextConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface DrivingContextInput {
  /** Kanonik araç hızı (km/h). `null` = ÖLÇÜLEMİYOR — sahte 0 DEĞİL. */
  readonly speedKmh: number | null;
  readonly tripActive: boolean;
  readonly tripDurationMin: number | null;
  readonly tripDistanceKm: number | null;
  /** YALNIZ rehberlik gerçekten sürüyor mu (`isGuidanceActive`) — `isNavigating` DEĞİL. */
  readonly guidanceActive: boolean;
  /** Kalan mesafe (m). Yalnız ROTA BOYU ölçümse anlamlıdır. */
  readonly remainingMeters: number | null;
  /** Kalan mesafe kuş uçuşu tahmini mi (kütük #404) — tahminse uzun yol kanıtı SAYILMAZ. */
  readonly remainingIsRouteMeasured: boolean;
  /** Yerel saat (0–23). `null` = okunamadı. */
  readonly localHour: number | null;
  /** Histerezis için önceki sınıf — bant içinde sınıf DEĞİŞMEZ. */
  readonly previousMotion?: MotionClass;
}

export interface DrivingContext {
  readonly motion: MotionClass;
  readonly daypart: DaypartClass;
  readonly journey: JourneyPhase;
  /** Tercih kanıtının anahtarı. Eksenlerden biri bilinmiyorsa `'UNKNOWN'`. */
  readonly bucket: string;
  readonly confidence: ContextConfidence;
  readonly evidence: readonly ContextEvidence[];
  /** Ölçülemeyen sinyaller — LAB'da neyin eksik olduğu görünür. */
  readonly missing: readonly string[];
}

/* ── Eşikler ──────────────────────────────────────────────────────────────
 * Hız eşikleri `smartDrivingEngine.detectDrivingMode` ile AYNI banttadır
 * (1 / 20 km/h); F8 ikinci bir sürüş eşiği TANIMLAMAZ, yalnız histerezis
 * ekler — dur-kalk trafiğinde tercih anahtarının saniyede bir değişmesi
 * kanıtı bozar (aynı yolculuk iki kovaya bölünürdü). */
export const PARKED_ENTER_KMH = 1;
export const PARKED_EXIT_KMH = 2;
export const HIGHWAY_ENTER_KMH = 20;
export const HIGHWAY_EXIT_KMH = 17;

/** Gece bandı — `mapSourceManager.isNightHour` ile AYNI kural (07–19 gündüz). */
export const NIGHT_START_HOUR = 19;
export const NIGHT_END_HOUR = 7;

/** Yolculuk başlangıcı penceresi — otomatik eylem yalnız burada meşrudur. */
export const JOURNEY_START_MAX_MIN = 3;
/** Uzun yol eşikleri. */
export const LONG_HAUL_MIN_KM = 30;
export const LONG_HAUL_MIN_MIN = 45;
export const LONG_HAUL_REMAINING_M = 50_000;

const evidence = (
  signal: string, state: ContextEvidenceState, detail: string,
): ContextEvidence => Object.freeze({ signal, state, detail });

/** Hız → hareket sınıfı (histerezisli). Ölçüm yoksa `UNKNOWN` — varsayım yok. */
export function classifyMotion(
  speedKmh: number | null, previous: MotionClass = 'UNKNOWN',
): MotionClass {
  if (speedKmh === null || !Number.isFinite(speedKmh) || speedKmh < 0) return 'UNKNOWN';

  if (previous === 'HIGHWAY') return speedKmh >= HIGHWAY_EXIT_KMH ? 'HIGHWAY' : 'CITY';
  if (previous === 'PARKED') {
    if (speedKmh < PARKED_EXIT_KMH) return 'PARKED';
    return speedKmh >= HIGHWAY_ENTER_KMH ? 'HIGHWAY' : 'CITY';
  }
  if (speedKmh < PARKED_ENTER_KMH) return 'PARKED';
  return speedKmh >= HIGHWAY_ENTER_KMH ? 'HIGHWAY' : 'CITY';
}

/** Saat → gündüz/gece. Saat okunamadıysa `UNKNOWN` (varsayılan gece YOK). */
export function classifyDaypart(localHour: number | null): DaypartClass {
  if (localHour === null || !Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    return 'UNKNOWN';
  }
  return localHour < NIGHT_END_HOUR || localHour >= NIGHT_START_HOUR ? 'NIGHT' : 'DAY';
}

/** Yolculuk evresi. Yolculuk kanıtı yoksa `UNKNOWN` (park VARSAYILMAZ). */
export function classifyJourney(input: DrivingContextInput): JourneyPhase {
  if (!input.tripActive) return 'UNKNOWN';

  const km = typeof input.tripDistanceKm === 'number' && Number.isFinite(input.tripDistanceKm)
    ? input.tripDistanceKm : null;
  const min = typeof input.tripDurationMin === 'number' && Number.isFinite(input.tripDurationMin)
    ? input.tripDurationMin : null;
  /* Kuş uçuşu tahmin uzun yol KANITI değildir (kütük #404). */
  const remaining = input.guidanceActive && input.remainingIsRouteMeasured
    && typeof input.remainingMeters === 'number' && Number.isFinite(input.remainingMeters)
    ? input.remainingMeters : null;

  if ((km !== null && km >= LONG_HAUL_MIN_KM)
    || (min !== null && min >= LONG_HAUL_MIN_MIN)
    || (remaining !== null && remaining >= LONG_HAUL_REMAINING_M)) {
    return 'LONG_HAUL';
  }
  if (min !== null && min <= JOURNEY_START_MAX_MIN) return 'START';
  if (min !== null || km !== null) return 'MID';
  // Yolculuk açık ama süresi/mesafesi okunamadı: evre BİLİNMİYOR.
  return 'UNKNOWN';
}

/**
 * Bağlamı sınıflandırır.
 *
 * `confidence`:
 *   · `NONE`   — hız ölçülemiyor: hiçbir otomatik/öneri kararı meşru DEĞİL.
 *   · `LOW`    — hız var, başka kanıt yok.
 *   · `MEDIUM` — hız + (gündüz/gece VEYA yolculuk) kanıtı.
 *   · `HIGH`   — hız + gündüz/gece + ölçülü yolculuk evresi.
 */
export function classifyDrivingContext(input: DrivingContextInput): DrivingContext {
  const motion = classifyMotion(input.speedKmh, input.previousMotion ?? 'UNKNOWN');
  const daypart = classifyDaypart(input.localHour);
  const journey = classifyJourney(input);

  const ev: ContextEvidence[] = [];
  const missing: string[] = [];

  if (motion === 'UNKNOWN') {
    ev.push(evidence('vehicle.speed', 'UNAVAILABLE', 'hız ölçülemiyor'));
    missing.push('vehicle.speed');
  } else {
    ev.push(evidence('vehicle.speed', 'OBSERVED', `${Math.round(input.speedKmh as number)} km/h → ${motion}`));
  }

  if (daypart === 'UNKNOWN') {
    ev.push(evidence('clock.localHour', 'UNAVAILABLE', 'saat okunamadı'));
    missing.push('clock.localHour');
  } else {
    ev.push(evidence('clock.localHour', 'DERIVED', `${String(input.localHour)}:00 → ${daypart}`));
  }

  if (!input.tripActive) {
    ev.push(evidence('trip.state', 'UNAVAILABLE', 'açık yolculuk yok'));
    missing.push('trip.state');
  } else {
    ev.push(evidence('trip.state', 'OBSERVED',
      `açık · ${input.tripDurationMin === null ? '?' : Math.round(input.tripDurationMin)} dk · `
      + `${input.tripDistanceKm === null ? '?' : Math.round(input.tripDistanceKm)} km → ${journey}`));
  }

  if (!input.guidanceActive) {
    ev.push(evidence('navigation.guidance', 'UNAVAILABLE', 'rehberlik sürmüyor'));
  } else if (!input.remainingIsRouteMeasured) {
    /* Kuş uçuşu bir tahmindir; ölçüm gibi SUNULMAZ ve uzun yol kanıtı sayılmaz. */
    ev.push(evidence('navigation.guidance', 'DERIVED', 'rehberlik açık · kalan mesafe TAHMİN (kuş uçuşu)'));
  } else {
    ev.push(evidence('navigation.guidance', 'OBSERVED',
      `rehberlik açık · kalan ${input.remainingMeters === null ? '?' : Math.round(input.remainingMeters / 1000)} km`));
  }

  const hasSpeed = motion !== 'UNKNOWN';
  const hasJourney = journey !== 'UNKNOWN';
  const hasDaypart = daypart !== 'UNKNOWN';

  const confidence: ContextConfidence =
    !hasSpeed ? 'NONE'
      : hasJourney && hasDaypart ? 'HIGH'
        : hasJourney || hasDaypart ? 'MEDIUM'
          : 'LOW';

  /* Kova YALNIZ iki eksen de kanıtlıysa kurulur: yarı bilinen bir kovaya
     tercih yazmak, sonradan yanlış bağlamda öneri üretirdi. */
  const bucket = hasSpeed && hasDaypart ? `${motion}_${daypart}` : 'UNKNOWN';

  return Object.freeze({
    motion,
    daypart,
    journey,
    bucket,
    confidence,
    evidence: Object.freeze(ev),
    missing: Object.freeze(missing),
  });
}
