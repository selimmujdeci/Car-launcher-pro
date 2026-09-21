/**
 * tripComputerModel — YOLCULUK BİLGİSAYARI sayfasının SAF KARAR MODELİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE YAPAR / NE YAPMAZ
 *
 * Yolculuk ölçümlerinin SAHİBİ `tripLogService`dir. Bu dosya yeni bir trip
 * motoru · telemetri · yakıt otoritesi · kalıcılık KURMAZ; yalnız o
 * otoritenin iki hâlini (SÜREN yolculuk / SON TAMAMLANAN yolculuk) aynı
 * kanonik `TripMetrics` biçimine çevirir.
 *
 * SAF: I/O YOK · DOM YOK · React YOK · timer YOK · abonelik YOK.
 *
 * ── KAYNAK ETİKETLERİ KOPYALANMAZ, PAYLAŞILIR ─────────────────────────────
 * Tamamlanmış yolculuk için hüküm `toCanonicalTripSummary` tarafından
 * verilir — burada YENİDEN YAZILMAZ. Süren yolculuk için aynı kurallar
 * uygulanır ve her biri satır satır o fonksiyonun sözleşmesine referansla
 * gerekçelendirilir:
 *   mesafe   → GPS haversine payı büyükse MEASURED, OBD Euler ise DERIVED
 *   süre     → MEASURED (monotonik `performance.now()` deltası)
 *   ort. hız → DERIVED (hız örneklerinin ortalaması)
 *   maks hız → MEASURED (gözlenen tepe)
 *   yakıt    → ölçüm kapıları geçtiyse DERIVED (ölçülen % + YAPILANDIRILMIŞ
 *              depo hacmi), aksi hâlde UNAVAILABLE — ESTIMATED sayı ÜRETİLMEZ
 *   maliyet  → fiyat anlık görüntüsü varsa DERIVED, yoksa UNAVAILABLE
 *
 * ── EN ÖNEMLİ KURAL ───────────────────────────────────────────────────────
 * UNKNOWN ≠ 0 · UNSUPPORTED ≠ 0 · ESTIMATED ≠ MEASURED.
 * Ölçülmemiş hiçbir alan için BU KATMANDA sayı üretilmez;
 * `Metric.value === null` ve `Metric.source === 'UNAVAILABLE'` olur.
 *
 * Yolculuk bilgisayarı ekranı, geliştirme döneminde veri akmayan alanı
 * ekranda tutup 0 çizer — fakat bu karar YALNIZ SUNUM KATMANINDADIR
 * (`TripComputerScreen`). Buraya sızmaz: gerçek bir 0 ile veri yokluğu
 * domain'de aynı değere indirgenirse hangi toplama zincirinin çalışmadığı
 * bir daha ayırt edilemez.
 */

import {
  EMPTY_TRIP_METRICS, UNAVAILABLE_METRIC,
  type Metric, type MetricSource, type TripMetrics,
} from '../../platform/trip/tripCanonicalModel';
import { toCanonicalTripSummary } from '../../platform/trip/tripLifecycle';
/* Yakıt hükmünün TEK sahibi akümülatördür; kapılar burada YENİDEN YAZILMAZ. */
import {
  evaluateFuelMeasurement, fuelPercentToLitres,
  type TripMetricsAccumulator,
} from '../../platform/trip/tripMetricsAccumulator';
import type { TripRecord, TripState } from '../../platform/tripLogService';

/** Sayfanın hangi yolculuğu gösterdiği — sekme YOKTUR, durum tek. */
export type TripView =
  /** Şu anda süren yolculuk. */
  | 'active'
  /** Son tamamlanan yolculuk (araç duruyor). */
  | 'last'
  /** Gösterilecek yolculuk yok. */
  | 'none';

export interface TripComputerState {
  readonly view: TripView;
  readonly metrics: TripMetrics;
  /** Yolculuğun başlangıç anı (epoch ms) — bilinmiyorsa `null`. */
  readonly startedAtMs: number | null;
  /** Tamamlanan yolculukta bitiş anı; süren yolculukta `null`. */
  readonly endedAtMs: number | null;
  /** Yakıt biriminin para birimi — bilinmiyorsa `null` (sembol UYDURULMAZ). */
  readonly currency: string | null;
  /** Fiyatın nereden geldiği (LAB/şeffaflık) — bilinmiyorsa `null`. */
  readonly priceSource: string | null;
  /**
   * Yapılandırılmış depo hacmi (L) — ÖLÇÜM DEĞİL, araç profili ayarı.
   * Ekran yakıtı depoya oranla gösterirken bunu kullanır; yoksa oran çizilmez.
   */
  readonly tankL: number | null;
}

export const EMPTY_TRIP_COMPUTER: TripComputerState = Object.freeze({
  view: 'none',
  metrics: EMPTY_TRIP_METRICS,
  startedAtMs: null,
  endedAtMs: null,
  currency: null,
  priceSource: null,
  tankL: null,
});

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function metric(value: number | null | undefined, source: MetricSource): Metric {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return UNAVAILABLE_METRIC;
  }
  return Object.freeze({ value, source });
}

/** Ölçüm gerçekten bir sayı taşıyor mu? */
export function has(m: Metric): boolean {
  return m.value !== null && m.source !== 'UNAVAILABLE';
}

/** `ms` → tam dakika; ölçülemeyen negatif/NaN değer `null`. */
function msToMin(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 60_000);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Süren yolculuk — canlı akümülatörden
 * ════════════════════════════════════════════════════════════════════════ */

/** `TripState.current` içinden okunan alanların en dar sözleşmesi. */
export interface ActiveTripView {
  readonly startTime: number;
  readonly liveDistanceKm: number;
  readonly liveDurationMin: number;
  readonly maxSpeedKmh: number;
  readonly speedSum: number;
  readonly speedCount: number;
  readonly gpsDistanceKm: number;
  readonly obdDistanceKm: number;
  /**
   * Canlı akumulator. `evaluateFuelMeasurement` TAM kaydi ister (gerekce
   * ayrimi icin ornek sayaclarini da okur), bu yuzden tip daraltilmaz.
   *
   * SERT MANEVRA SAYAÇLARI DA BURADADIR: `ActiveTrip.harshBrakeEvents`
   * ARTIK OKUNMAZ (bkz. `harshBrakeCount` satiri).
   */
  readonly metrics: TripMetricsAccumulator;
  readonly price: {
    readonly unitPrice: number | null;
    readonly currency: string | null;
    readonly source: string;
  };
}

/** Yapılandırılmış depo hacmi — kullanıcı ayarı; yoksa `null`. */
export interface TripFuelConfig {
  readonly tankL: number | null;
}

/**
 * Canlı yolculuğu kanonik ölçüm kümesine çevirir.
 *
 * YAKIT KAPILARI: ölçüm yalnız (a) başlangıç ve o anki yakıt yüzdesi VARSA,
 * (b) yakıt ALMA şüphesi yoksa, (c) OBD sürekliliği kırılmadıysa, (d) depo
 * hacmi yapılandırılmışsa üretilir. Biri bile eksikse `UNAVAILABLE` —
 * tahmini bir litre değeri UYDURULMAZ.
 */
export function fromActiveTrip(a: ActiveTripView, fuel: TripFuelConfig): TripComputerState {
  const m = a.metrics;

  /* Mesafe kaynağı: GPS haversine payı baskınsa ÖLÇÜM, OBD Euler ise TÜRETME
     (`toCanonicalTripSummary` ile aynı hüküm). */
  const distanceSource: MetricSource = a.gpsDistanceKm >= a.obdDistanceKm ? 'MEASURED' : 'DERIVED';

  const avgFromSamples = a.speedCount > 0 ? a.speedSum / a.speedCount : null;

  /* ── YAKIT: HÜKÜM KANONİK SAHİBİNDEN GELİR ───────────────────────────
     `evaluateFuelMeasurement` şu kapıları uygular ve hiçbiri burada
     tekrarlanmaz: başlangıç/bitiş okuması, yakıt alma şüphesi, OBD
     sürekliliği, NEGATİF fark, mesafesiz makullük sınaması ve
     %/100km fiziksel üst sınırı. `fuelPercentToLitres` ayrıca depo
     kapasitesini 20–200 L makullük bandında sınar (kullanıcı girdisi
     doğrulanmamıştır). Yüzde ÖLÇÜLENDİR; litre DERIVED'dır. */
  let fuelUsedL: Metric = UNAVAILABLE_METRIC;
  let estimatedCost: Metric = UNAVAILABLE_METRIC;
  const verdict = evaluateFuelMeasurement(m, a.liveDistanceKm);
  if (verdict.measured) {
    const liters = fuelPercentToLitres(verdict.usedPercent, fuel.tankL);
    if (liters !== null) {
      fuelUsedL = metric(liters, 'DERIVED');
      if (a.price.unitPrice !== null && a.price.unitPrice >= 0) {
        estimatedCost = metric(Math.round(liters * a.price.unitPrice * 100) / 100, 'DERIVED');
      }
    }
  }

  const metrics: TripMetrics = Object.freeze({
    ...EMPTY_TRIP_METRICS,
    distanceKm:      metric(a.liveDistanceKm, distanceSource),
    durationMin:     metric(a.liveDurationMin, 'MEASURED'),
    averageSpeedKmh: metric(avgFromSamples === null ? null : Math.round(avgFromSamples), 'DERIVED'),
    maximumSpeedKmh: metric(a.maxSpeedKmh, 'MEASURED'),
    fuelUsedL,
    estimatedCost,
    movingTimeMin:   metric(msToMin(m.movingMs), 'MEASURED'),
    idleTimeMin:     metric(msToMin(m.idleMs), 'MEASURED'),
    unknownTimeMin:  metric(msToMin(m.unknownMs), 'MEASURED'),
    stopCount:       metric(m.stopCount, 'MEASURED'),
    maxRpm:          metric(m.maxRpm, 'MEASURED'),
    maxEngineTempC:  metric(m.maxEngineTempC, 'MEASURED'),
    /* ── SERT MANEVRA: TEK KANONIK SAYIM ─────────────────────────────
       Sayim otoritesi `tripMetricsAccumulator`dir — KAPANIŞTA TripRecord'a
       muhurlenen (`tripLogService` `_endTrip`) sayac ile AYNI state. Eskiden
       burada `ActiveTrip.harshBrakeEvents` okunuyordu; o sayac YALNIZ GPS
       yolundan besleniyor, debounce ve kaynak-sureklilik kapilarini
       uygulamiyordu. Sonuc: ayni yolculuk sururken 3, kapaninca 2 gorunebilir
       ve salt-OBD yolculukta canli ekran 0'da kalirdi. Ayni gercegin iki
       sayisi OLMAZ — canli goruntu de kayit da bu satirdan okur. */
    harshBrakeCount: metric(m.harshBrakeCount, 'MEASURED'),
    harshAccelCount: metric(m.harshAccelCount, 'MEASURED'),
  });

  return Object.freeze({
    view: 'active' as const,
    metrics,
    startedAtMs: Number.isFinite(a.startTime) && a.startTime > 0 ? a.startTime : null,
    endedAtMs: null,
    currency: a.price.currency,
    priceSource: a.price.source === 'UNAVAILABLE' ? null : a.price.source,
    tankL: fuel.tankL,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tamamlanmış yolculuk — kanonik dönüştürücüye DEVREDİLİR
 * ════════════════════════════════════════════════════════════════════════ */

export function fromCompletedRecord(r: TripRecord): TripComputerState {
  /* Hüküm burada YENİDEN yazılmaz: kaynak etiketlerinin tek sahibi
     `toCanonicalTripSummary`dir. */
  const summary = toCanonicalTripSummary(r, 'COMPLETED');
  return Object.freeze({
    view: 'last' as const,
    metrics: summary.metrics,
    startedAtMs: Number.isFinite(r.startTime) && r.startTime > 0 ? r.startTime : null,
    endedAtMs: Number.isFinite(r.endTime) && r.endTime > 0 ? r.endTime : null,
    currency: r.currency ?? null,
    priceSource: r.priceSource ?? null,
    /* Tamamlanmış kayıtta depo hacmi saklanmaz — oran çizilmez. */
    tankL: null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hangi yolculuk gösterilecek
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * SEKME YOKTUR: süren bir yolculuk varsa O gösterilir, yoksa son tamamlanan.
 * Hiçbiri yoksa `none` — sahte sıfırlarla dolu bir özet ÜRETİLMEZ.
 */
export function selectTrip(
  state: Pick<TripState, 'active' | 'current' | 'history'>,
  fuel: TripFuelConfig,
): TripComputerState {
  /* FAIL-CLOSED: kısmen geri yüklenmiş / beklenmedik bir durum nesnesi
     sayfayı DÜŞÜRMEZ; gösterilecek yolculuk yok sayılır. */
  if (!state || typeof state !== 'object') return EMPTY_TRIP_COMPUTER;
  if (state.active && state.current) {
    return fromActiveTrip(state.current as unknown as ActiveTripView, fuel);
  }
  const last = Array.isArray(state.history) ? state.history[0] : undefined;
  if (last) return fromCompletedRecord(last);
  return EMPTY_TRIP_COMPUTER;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Türetilmiş görünüm değerleri
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Ortalama tüketim (L/100 km). YALNIZ hem litre hem mesafe varsa üretilir
 * ve kaynağı litreninkinden ZAYIF olamaz.
 */
export function consumptionL100(m: TripMetrics): Metric {
  if (!has(m.fuelUsedL) || !has(m.distanceKm)) return UNAVAILABLE_METRIC;
  const km = m.distanceKm.value!;
  if (km < 1) return UNAVAILABLE_METRIC;          // kısa mesafede oran anlamsız
  const l100 = (m.fuelUsedL.value! / km) * 100;
  return Object.freeze({ value: Math.round(l100 * 10) / 10, source: m.fuelUsedL.source });
}

/**
 * Süre bileşimi (hareket / duruş / ölçülemeyen) oranları.
 * Ölçülemeyen süre ayrı taşınır — duruşa YAZILMAZ.
 */
export interface TimeComposition {
  readonly movingMin: number;
  readonly idleMin: number;
  readonly unknownMin: number;
  readonly totalMin: number;
  /** Üç kova da ölçülmüş mü — değilse çubuk çizilmez. */
  readonly measured: boolean;
}

export function timeComposition(m: TripMetrics): TimeComposition {
  const mv = has(m.movingTimeMin) ? m.movingTimeMin.value! : 0;
  const id = has(m.idleTimeMin) ? m.idleTimeMin.value! : 0;
  const un = has(m.unknownTimeMin) ? m.unknownTimeMin.value! : 0;
  const measured = has(m.movingTimeMin) || has(m.idleTimeMin) || has(m.unknownTimeMin);
  return { movingMin: mv, idleMin: id, unknownMin: un, totalMin: mv + id + un, measured };
}

/** `dk` → "1 sa 42 dk" / "42 dk". Ölçüm yoksa `null`. */
export function formatDuration(min: number | null): string | null {
  if (min === null || !Number.isFinite(min) || min < 0) return null;
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}
