/**
 * vehicleTripsView.ts — FLEET TRIPS GÖRÜNÜM MODELİ (SAF).
 *
 * `list_vehicle_trips()` RPC satırlarını kullanıcıya dönük dürüst metinlere
 * çevirir.
 *
 * ── DÜRÜSTLÜK KURALLARI ───────────────────────────────────────────────
 *   1. Kanıt yoksa `null` → "Veri yok". Sahte `0` YASAK.
 *   2. **Tahmin edilmiş metrik "(tahmini)" olarak ETİKETLENİR.** Head unit
 *      yakıtı 8,5 L/100km sabitiyle ve maliyeti sabit birim fiyatla
 *      hesaplıyor — bunlar ölçüm DEĞİLDİR ve öyle sunulamaz.
 *   3. Okunamadı ≠ trip yok. İkisi ayrı gösterilir.
 *   4. Trip **koordinat/rota TAŞIMAZ** — bu katman da üretmez.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  buildTripAttributionView,
  type TripAttributionView,
} from '@/lib/fleet/driverIdentity';

/* ── Kaynak etiketi ────────────────────────────────────────────────────── */

export const TRIP_METRIC_SOURCES = ['MEASURED', 'DERIVED', 'ESTIMATED', 'UNAVAILABLE'] as const;
export type TripMetricSource = (typeof TRIP_METRIC_SOURCES)[number];

export function normalizeTripSource(raw: unknown): TripMetricSource {
  return (TRIP_METRIC_SOURCES as readonly string[]).includes(String(raw))
    ? (raw as TripMetricSource)
    : 'UNAVAILABLE';
}

/* ── Güven seviyesi ────────────────────────────────────────────────────── */

/**
 * `VERY_HIGH` P2'de EKLENDİ (migration 047).
 *
 * Bu listede olmayan bir seviye `UNKNOWN`'a düşer — yani seviye burada
 * tanınmazsa **kanıta dayalı en yüksek güven "Bilinmiyor" gösterilir**.
 * Sunucu enum'u ile bu liste birlikte değişmelidir.
 */
export const TRIP_CONFIDENCE_VIEWS =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type TripConfidenceView = (typeof TRIP_CONFIDENCE_VIEWS)[number];

/* ── Yükleme durumu (Fleet görünümü) ───────────────────────────────────── */

export const TRIP_UPLOAD_VIEW_STATES = ['UPLOADED', 'PENDING', 'FAILED', 'UNKNOWN'] as const;
export type TripUploadViewState = (typeof TRIP_UPLOAD_VIEW_STATES)[number];

/* ── Girdi (RPC satırı) ────────────────────────────────────────────────── */

export interface TripRow {
  readonly trip_key?: string | null;
  readonly trip_id?: string | null;
  readonly revision?: number | null;
  readonly started_at?: string | null;
  readonly ended_at?: string | null;
  readonly distance_km?: number | string | null;
  readonly duration_min?: number | null;
  readonly avg_speed_kmh?: number | string | null;
  readonly max_speed_kmh?: number | string | null;
  readonly fuel_used_l?: number | string | null;
  readonly estimated_cost?: number | string | null;
  readonly idle_time_min?: number | null;
  readonly moving_time_min?: number | null;
  readonly stop_count?: number | null;
  readonly max_rpm?: number | null;
  readonly max_engine_temp_c?: number | string | null;
  readonly speed_violations?: number | null;
  readonly harsh_brake_count?: number | null;
  readonly harsh_accel_count?: number | null;
  readonly score?: number | null;
  readonly confidence?: string | null;
  readonly distance_source?: string | null;
  readonly fuel_source?: string | null;
  readonly cost_source?: string | null;
  readonly received_at?: string | null;

  /* ── P2 (migration 047) ────────────────────────────────────────────────
     Eski 046 satırlarında bu alanlar YOKTUR → `undefined` → `UNAVAILABLE`.
     Bu ayrım korunmalı: "ölçülmedi" ile "sıfır" aynı şey DEĞİLDİR. */
  readonly unknown_time_min?: number | null;
  readonly fuel_used_percent?: number | string | null;
  readonly fuel_unit?: string | null;
  readonly fuel_reject_reason?: string | null;
  readonly fuel_unit_price?: number | string | null;
  readonly currency?: string | null;
  readonly price_source?: string | null;
  readonly price_captured_at?: string | null;
  /* Metrik başına provenance (§2) — tek genel bayrak YETMEZ. */
  readonly duration_source?: string | null;
  readonly avg_speed_source?: string | null;
  readonly max_speed_source?: string | null;
  readonly idle_source?: string | null;
  readonly moving_source?: string | null;
  readonly stop_count_source?: string | null;
  readonly max_rpm_source?: string | null;
  readonly max_temp_source?: string | null;
  readonly speed_violation_source?: string | null;
  readonly harsh_brake_source?: string | null;
  readonly harsh_accel_source?: string | null;
  /* Confidence kanıtı (§9). */
  readonly confidence_limited_by?: string | null;
  readonly speed_sample_count?: number | null;
  readonly obd_coverage?: number | string | null;
  readonly time_coverage?: number | string | null;
  readonly data_gap_count?: number | null;
  readonly source_switch_count?: number | null;
  readonly metrics_version?: number | null;

  /* ── Sürücü attribution (migration 048) ────────────────────────────────
     Sürücüsü bilinmeyen yolculuk NORMALDİR: alanlar `null` kalır ve UI
     "Sürücü bilinmiyor" der — araç sahibine veya son kullanıcıya DÜŞMEZ. */
  readonly driver_id?: string | null;
  readonly driver_name?: string | null;
  readonly driver_attribution_status?: string | null;
  readonly driver_attribution_source?: string | null;
  readonly driver_attribution_confidence?: string | null;
  readonly driver_attributed_at?: string | null;
  readonly driver_attribution_revision?: number | null;
}

/* ── Çıktı ─────────────────────────────────────────────────────────────── */

export interface TripViewValue {
  readonly value: number | null;
  readonly source: TripMetricSource;
}

export interface TripView {
  readonly tripKey: string;
  /**
   * Sunucudaki yolculuk kimliği — `get_subject_evidence(TRIP, …)` bunu ister.
   * `null` = sunucu kimlik vermedi (yerel/henüz yüklenmemiş kayıt) → kanıt
   * SORULAMAZ. Ham kimlik ekrana BASILMAZ, yalnız RPC parametresi olarak
   * kullanılır.
   */
  readonly tripId: string | null;
  readonly startedAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly distanceKm: TripViewValue;
  readonly durationMin: TripViewValue;
  readonly avgSpeedKmh: TripViewValue;
  readonly maxSpeedKmh: TripViewValue;
  readonly fuelUsedL: TripViewValue;
  readonly estimatedCost: TripViewValue;
  readonly score: number | null;
  readonly confidence: TripConfidenceView;
  readonly revision: number | null;
  /** Sunucuda kayıtlı olan trip DAİMA yüklenmiştir. */
  readonly uploadState: TripUploadViewState;

  /* ── P2 ────────────────────────────────────────────────────────────── */

  readonly movingTimeMin: TripViewValue;
  readonly idleTimeMin: TripViewValue;
  /** BİLİNMEYEN süre — rölantiden AYRI. "Veri yoktu" ≠ "duruyordu". */
  readonly unknownTimeMin: TripViewValue;
  readonly stopCount: TripViewValue;
  readonly maxRpm: TripViewValue;
  readonly maxEngineTempC: TripViewValue;
  readonly harshBrakeCount: TripViewValue;
  readonly harshAccelCount: TripViewValue;
  /** Gerçek hız limiti kaynağı yoksa `null` + `UNAVAILABLE` (§8). */
  readonly speedViolations: TripViewValue;
  /** ÖLÇÜLEN yakıt — yüzde puan (litre bir DÖNÜŞÜMDÜR). */
  readonly fuelUsedPercent: TripViewValue;
  readonly fuelRejectReason: string | null;
  /** Maliyetin dayandığı birim fiyat SNAPSHOT'ı. */
  readonly unitPrice: number | null;
  readonly currency: string | null;
  readonly priceSource: string | null;
  readonly priceCapturedAtMs: number | null;
  /** Confidence'ı hangi kanıt sınırladı. */
  readonly confidenceLimitedBy: string | null;
  readonly metricsVersion: number | null;

  /** Yolculuğun sürücüsü — kanıt yoksa `UNKNOWN` (fallback YOK). */
  readonly driver: TripAttributionView;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

/** PostgREST `numeric` alanları METİN olarak döner — sayıya çevrilir. */
function num(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Boş olmayan metin; aksi halde `null` (boş metin bir DEĞER değildir). */
function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/** ISO → epoch ms; geçersizse `null` (uydurma tarih YOK). */
export function tripTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

function value(raw: unknown, source: unknown): TripViewValue {
  const v = num(raw);
  /* Değer yoksa kaynak da anlamsızdır → UNAVAILABLE. */
  return v === null
    ? { value: null, source: 'UNAVAILABLE' }
    : { value: v, source: normalizeTripSource(source) };
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

export function buildTripView(row: TripRow): TripView {
  const conf = String(row.confidence ?? '');
  return {
    tripKey: typeof row.trip_key === 'string' ? row.trip_key : '',
    tripId: typeof row.trip_id === 'string' && row.trip_id !== '' ? row.trip_id : null,
    startedAtMs: tripTimeMs(row.started_at),
    endedAtMs: tripTimeMs(row.ended_at),
    distanceKm:    value(row.distance_km, row.distance_source),
    /* Süre monotonik saatten ölçülür → DERIVED değil MEASURED. */
    durationMin:   value(row.duration_min, 'MEASURED'),
    avgSpeedKmh:   value(row.avg_speed_kmh, 'DERIVED'),
    maxSpeedKmh:   value(row.max_speed_kmh, 'MEASURED'),
    fuelUsedL:     value(row.fuel_used_l, row.fuel_source),
    estimatedCost: value(row.estimated_cost, row.cost_source),
    score: typeof row.score === 'number' && Number.isFinite(row.score)
      ? Math.max(0, Math.min(100, Math.round(row.score))) : null,
    confidence: (TRIP_CONFIDENCE_VIEWS as readonly string[]).includes(conf)
      ? (conf as TripConfidenceView) : 'UNKNOWN',
    revision: typeof row.revision === 'number' && Number.isFinite(row.revision)
      ? row.revision : null,
    /* Sunucudan OKUNAN her trip yüklenmiştir — tanım gereği. */
    uploadState: 'UPLOADED',

    /* ── P2 ──────────────────────────────────────────────────────────────
       Her metrik KENDİ provenance kolonunu kullanır. Eski 046 satırlarında
       o kolonlar yoktur → `UNAVAILABLE`; değer de yoksa "Veri yok" denir. */
    movingTimeMin:   value(row.moving_time_min, row.moving_source),
    idleTimeMin:     value(row.idle_time_min, row.idle_source),
    unknownTimeMin:  value(row.unknown_time_min, 'MEASURED'),
    stopCount:       value(row.stop_count, row.stop_count_source),
    maxRpm:          value(row.max_rpm, row.max_rpm_source),
    maxEngineTempC:  value(row.max_engine_temp_c, row.max_temp_source),
    harshBrakeCount: value(row.harsh_brake_count, row.harsh_brake_source),
    harshAccelCount: value(row.harsh_accel_count, row.harsh_accel_source),
    /* Hız limiti kaynağı yoksa sunucuda da NULL'dur → "Veri yok". */
    speedViolations: value(row.speed_violations, row.speed_violation_source),
    /* Yüzde ölçümü doğrudan sensör farkıdır — varsa ÖLÇÜMDÜR. */
    fuelUsedPercent: value(row.fuel_used_percent, 'MEASURED'),
    fuelRejectReason: text(row.fuel_reject_reason),
    unitPrice: num(row.fuel_unit_price),
    currency: text(row.currency),
    priceSource: text(row.price_source),
    priceCapturedAtMs: tripTimeMs(row.price_captured_at),
    confidenceLimitedBy: text(row.confidence_limited_by),
    metricsVersion: typeof row.metrics_version === 'number'
      && Number.isFinite(row.metrics_version) ? row.metrics_version : null,

    /* Sürücü sonucu KENDİ modelinden kurulur; bu görünüm onu üretmez,
       yalnız taşır. Sürücü kimliği yoksa "atanmış" iddia EDİLEMEZ. */
    driver: buildTripAttributionView(row),
  };
}

export interface TripsViewInput {
  /** RPC satırları; okuma BAŞARISIZ olduysa `null`. */
  readonly rows: readonly TripRow[] | null;
  readonly readable: boolean;
}

export interface TripsView {
  readonly trips: readonly TripView[];
  /** Okuma başarısız → UI "Okunamadı" der, "trip yok" DEMEZ. */
  readonly readable: boolean;
  readonly isEmpty: boolean;
}

export function buildTripsView(input: TripsViewInput): TripsView {
  if (!input.readable || input.rows === null) {
    return { trips: [], readable: false, isEmpty: false };
  }
  const trips = input.rows
    .map(buildTripView)
    .filter((t) => t.tripKey.length > 0);
  return { trips, readable: true, isEmpty: trips.length === 0 };
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

/**
 * Ölçüm metni.
 *
 * `null` → "Veri yok". **`ESTIMATED` → "(tahmini)" eki ZORUNLU** —
 * kullanıcı 8,5 L/100km varsayımını gerçek tüketim sanmamalı.
 */
export function tripValueLabel(v: TripViewValue, unit: string, digits = 1): string {
  if (v.value === null) return 'Veri yok';
  const n = Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(digits);
  const base = unit.length > 0 ? `${n} ${unit}` : n;
  return v.source === 'ESTIMATED' ? `${base} (tahmini)` : base;
}

export function tripSourceLabel(source: TripMetricSource): string {
  switch (source) {
    case 'MEASURED':    return 'Ölçüldü';
    case 'DERIVED':     return 'Hesaplandı';
    case 'ESTIMATED':   return 'Tahmini';
    case 'UNAVAILABLE': return 'Veri yok';
  }
}

export function tripConfidenceLabel(c: TripView['confidence']): string {
  switch (c) {
    case 'VERY_HIGH': return 'Çok yüksek';
    case 'HIGH':    return 'Yüksek';
    case 'MEDIUM':  return 'Orta';
    case 'LOW':     return 'Düşük';
    case 'UNKNOWN': return 'Bilinmiyor';
  }
}

/**
 * Süre metni — dakika.
 *
 * Ölçülen `0 dk` **"Veri yok" DEĞİLDİR**: araç hiç rölantide kalmadıysa
 * doğru cevap sıfırdır. Bu ayrım `tripValueLabel` içinde zaten korunur.
 */
export function tripDurationLabel(v: TripViewValue): string {
  return tripValueLabel(v, 'dk', 0);
}

/**
 * Sayım metni (duruş, sert fren, ihlal…).
 *
 * Kaynağı olmayan sayım "0" DEĞİL "Veri yok"tur — aksi halde ölçülmemiş
 * bir sürücü "hiç sert fren yapmamış" gibi görünür ve Driver DNA yanlış
 * eğitilir.
 */
export function tripCountLabel(v: TripViewValue): string {
  return tripValueLabel(v, '', 0);
}

/**
 * Maliyet metni — para birimi SNAPSHOT'tan gelir.
 *
 * Para birimi bilinmiyorsa tutar birimsiz basılır; **varsayılan bir para
 * birimi UYDURULMAZ** (farklı kurlar sessizce toplanmasın).
 */
export function tripCostLabel(v: TripViewValue, currency: string | null): string {
  return tripValueLabel(v, currency ?? '', 2);
}

/** Yakıt ölçümünün neden reddedildiğini kullanıcı diline çevirir. */
export function fuelRejectReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case null:                return null;
    case 'NO_START':          return 'Yolculuk başındaki yakıt seviyesi okunamadı';
    case 'NO_END':            return 'Yolculuk sonundaki yakıt seviyesi okunamadı';
    case 'REFUEL_SUSPECTED':  return 'Yolculuk sırasında yakıt alındı';
    case 'CONTINUITY_BROKEN': return 'Araç bağlantısı koptu';
    case 'NEGATIVE_DELTA':    return 'Yakıt seviyesi tutarsız';
    case 'IMPLAUSIBLE':       return 'Yakıt farkı gerçekçi değil';
    case 'NO_DISTANCE':       return 'Mesafe bilinmediği için doğrulanamadı';
    case 'NO_TANK_CAPACITY':  return 'Depo hacmi tanımlı değil';
    default:                  return 'Ölçülemedi';
  }
}

export function tripUploadStateLabel(s: TripUploadViewState): string {
  switch (s) {
    case 'UPLOADED': return 'Yüklendi';
    case 'PENDING':  return 'Yükleme bekliyor';
    case 'FAILED':   return 'Yüklenemedi';
    case 'UNKNOWN':  return 'Bilinmiyor';
  }
}

/** Skor metni — yoksa UYDURULMAZ. */
export function tripScoreLabel(score: number | null): string {
  return score === null ? 'Veri yok' : `${score}/100`;
}

/** Tarih/saat metni — geçersiz damga UYDURULMAZ. */
export function tripTimeLabel(atMs: number | null): string {
  if (atMs === null) return 'Veri yok';
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
