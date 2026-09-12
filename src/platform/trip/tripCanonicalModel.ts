/**
 * tripCanonicalModel.ts — KANONİK TRIP MODELİ (SAF).
 *
 * ── NEDEN ─────────────────────────────────────────────────────────────
 * Bugün TEK trip otoritesi `tripLogService.ts`'dir ve `TripRecord` on bir
 * alan taşır. Ancak Fleet Reports · Driver DNA · Fleet Intelligence ·
 * Cost Analysis · Digital Twin · AI için bu yetmez ve daha kötüsü,
 * `TripRecord`'daki iki alan **DÜRÜST DEĞİLDİR**:
 *
 *   · `fuelConsumptionL` ÖLÇÜLMÜŞ DEĞİL — `distanceKm/100 × 8.5` sabitiyle
 *     TAHMİN ediliyor. `fuelAtStart` yakalanıyor ama kayıtta KULLANILMIYOR.
 *   · `fuelCostTL` sabit `45 TL/L` ile çarpım — kullanıcının gerçek yakıt
 *     fiyatı DEĞİL.
 *
 * Bu model o iki değeri SİLMEZ (geriye uyum), ama **kaynağını açıkça
 * işaretler**: `MEASURED` · `ESTIMATED` · `UNAVAILABLE`. Fleet tarafında
 * tahmin edilmiş yakıt "ölçüldü" gibi sunulamaz.
 *
 * ── §4 ANA KURAL ──────────────────────────────────────────────────────
 * **Veri yoksa `null`. Tahmin ÜRETİLMEZ.** Var olmayan bir metriği `0` ile
 * doldurmak Driver DNA ve Cost Analysis'i kalıcı olarak yanlış eğitir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

/* ── Metrik kaynağı (dürüstlük etiketi) ────────────────────────────────── */

export const METRIC_SOURCES = [
  'MEASURED',     // gerçek sensörden ölçüldü (GPS haversine, OBD yakıt seviyesi)
  'DERIVED',      // ölçülen değerlerden HESAPLANDI (ortalama hız = mesafe/süre)
  'ESTIMATED',    // sabit/varsayım kullanıldı (8.5 L/100km, 45 TL/L)
  'UNAVAILABLE',  // kanıt yok
] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

/** Değer + kaynağı birlikte taşır — değer ile güvenilirliği ASLA ayrılmaz. */
export interface Metric {
  /** `null` = BİLİNMİYOR (0 DEĞİL). */
  readonly value: number | null;
  readonly source: MetricSource;
}

export const UNAVAILABLE_METRIC: Metric = Object.freeze({
  value: null, source: 'UNAVAILABLE',
});

/** Ölçüm kurucu — geçersiz sayı `UNAVAILABLE`'a düşer. */
export function metric(value: unknown, source: MetricSource): Metric {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UNAVAILABLE_METRIC;
  return { value, source };
}

/* ── §3 Yaşam döngüsü ──────────────────────────────────────────────────── */

export const TRIP_STATES = [
  'RUNNING',    // araç hareket halinde, ölçüm birikiyor
  'PAUSED',     // durdu ama trip bitmedi (idle penceresi içinde)
  'RESUMED',    // duruştan sonra yeniden hareket (geçiş durumu)
  'COMPLETED',  // trip kapandı, özet üretildi — henüz yüklenmedi
  'UPLOADED',   // sunucu kabul etti (revizyon aldı)
  'ARCHIVED',   // yerel saklama penceresinden çıktı
] as const;
export type TripState = (typeof TRIP_STATES)[number];

/** Yüklenebilir durumlar — yalnız kapanmış trip yüklenir. */
export function isUploadable(state: TripState): boolean {
  return state === 'COMPLETED';
}

/** Terminal durumlar — bir daha ölçüm KABUL ETMEZ. */
export function isTerminal(state: TripState): boolean {
  return state === 'UPLOADED' || state === 'ARCHIVED';
}

/* ── §2 TripMetrics ────────────────────────────────────────────────────── */

/**
 * Trip metrikleri. **Her alan `Metric`** — çıplak sayı YOK, çünkü çıplak
 * sayı kaynağını kaybeder ve tahmin ölçüm gibi görünür.
 */
export interface TripMetrics {
  readonly distanceKm: Metric;
  readonly durationMin: Metric;
  readonly averageSpeedKmh: Metric;
  readonly maximumSpeedKmh: Metric;
  readonly fuelUsedL: Metric;
  readonly estimatedCost: Metric;
  readonly idleTimeMin: Metric;
  readonly movingTimeMin: Metric;
  /**
   * BİLİNMEYEN süre — `idle`den AYRI kova.
   *
   * "Veri yoktu" ile "duruyordu" AYNI ŞEY DEĞİLDİR. Bu alan olmazsa
   * ölçülemeyen süre ya rölantiye yazılır (Driver DNA'yı yanlış eğitir)
   * ya da sessizce kaybolur (süre invaryantı denetlenemez hâle gelir).
   */
  readonly unknownTimeMin: Metric;
  readonly stopCount: Metric;
  readonly maxRpm: Metric;
  readonly maxEngineTempC: Metric;
  readonly speedViolations: Metric;
  readonly harshBrakeCount: Metric;
  readonly harshAccelCount: Metric;
}

/** Tüm alanlar `UNAVAILABLE` — şablon nesne (V8 hidden-class kararlılığı). */
export const EMPTY_TRIP_METRICS: TripMetrics = Object.freeze({
  distanceKm: UNAVAILABLE_METRIC,
  durationMin: UNAVAILABLE_METRIC,
  averageSpeedKmh: UNAVAILABLE_METRIC,
  maximumSpeedKmh: UNAVAILABLE_METRIC,
  fuelUsedL: UNAVAILABLE_METRIC,
  estimatedCost: UNAVAILABLE_METRIC,
  idleTimeMin: UNAVAILABLE_METRIC,
  movingTimeMin: UNAVAILABLE_METRIC,
  unknownTimeMin: UNAVAILABLE_METRIC,
  stopCount: UNAVAILABLE_METRIC,
  maxRpm: UNAVAILABLE_METRIC,
  maxEngineTempC: UNAVAILABLE_METRIC,
  speedViolations: UNAVAILABLE_METRIC,
  harshBrakeCount: UNAVAILABLE_METRIC,
  harshAccelCount: UNAVAILABLE_METRIC,
});

/* ── §2 TripEvent ──────────────────────────────────────────────────────── */

export const TRIP_EVENT_KINDS = [
  'HARSH_BRAKE',
  'HARSH_ACCEL',
  'SPEED_VIOLATION',
  'STOP',
  'RESUME',
] as const;
export type TripEventKind = (typeof TRIP_EVENT_KINDS)[number];

/**
 * Trip içi olay.
 *
 * ⚠️ **KOORDİNAT TAŞIMAZ.** Olay konumu kişisel veridir ve Trip özetiyle
 * birlikte yüklenmez (rota geçmişi bu paketin KAPSAMI DIŞINDA). Yalnız
 * "ne oldu, ne zaman, ne şiddette" taşınır.
 */
export interface TripEvent {
  readonly kind: TripEventKind;
  /** Trip başlangıcından itibaren geçen ms (mutlak zaman DEĞİL). */
  readonly atOffsetMs: number;
  /** Olayın şiddeti (ör. hız deltası km/h). Bilinmiyorsa `null`. */
  readonly magnitude: number | null;
}

/* ── §4 Fiyat anlık görüntüsü (kanonik taşıyıcı) ──────────────────────── */

/**
 * Trip BAŞINDA alınmış birim fiyat.
 *
 * Trip kapandıktan sonra kullanıcı fiyatı değiştirirse **geçmiş trip'in
 * maliyeti DEĞİŞMEMELİDİR** — bu yüzden fiyat trip ile birlikte taşınır ve
 * saklanır. Aksi halde geçen ayın raporu bu ayın fiyatıyla yeniden yazılır.
 *
 * (Üretim tarafı `tripCostModel.PriceSnapshot`; bu kanonik ikizdir —
 * kanonik model'in üretim modülüne bağımlı OLMAMASI için ayrı durur.)
 */
export interface TripPriceSnapshot {
  readonly unitPrice: number | null;
  readonly currency: string | null;
  /** `USER_DEFINED` · `DEFAULT_FALLBACK` · `UNAVAILABLE`; bilinmiyorsa `null`. */
  readonly source: string | null;
  readonly capturedAtMs: number | null;
}

export const UNAVAILABLE_PRICE_SNAPSHOT: TripPriceSnapshot = Object.freeze({
  unitPrice: null, currency: null, source: null, capturedAtMs: null,
});

/* ── §9 Kapsama kanıtı ────────────────────────────────────────────────── */

/**
 * Confidence'ın DAYANDIĞI kanıt.
 *
 * Confidence'ı taşıyıp kanıtını taşımamak onu **denetlenemez** kılar:
 * "neden LOW?" sorusunun cevabı olmadan bir güven seviyesi sezgisel bir
 * sayıdan farksızdır.
 */
export interface TripCoverage {
  readonly speedSampleCount: number | null;
  /** 0–1 arası; OBD örneklerinin payı. */
  readonly obdCoverage: number | null;
  /** 0–1 arası; sınıflandırılabilmiş sürenin payı. */
  readonly timeCoverage: number | null;
  readonly dataGapCount: number | null;
  readonly sourceSwitchCount: number | null;
  /** Genel güveni hangi kanıt SINIRLADI. */
  readonly limitedBy: string | null;
}

export const EMPTY_TRIP_COVERAGE: TripCoverage = Object.freeze({
  speedSampleCount: null, obdCoverage: null, timeCoverage: null,
  dataGapCount: null, sourceSwitchCount: null, limitedBy: null,
});

/** Yakıt ölçüm birimi — yüzde ölçümü ile litre dönüşümü KARIŞMASIN. */
export type FuelUnit = 'L' | 'PERCENT';

/* ── §2 TripSummary ────────────────────────────────────────────────────── */

/**
 * `VERY_HIGH` P2'de EKLENDİ (§9): kanıta dayalı türetme beş kova ister.
 * DB tarafında 046'nın CHECK kısıtı yalnız dördünü kabul ediyordu; migration
 * 047 onu genişletir — aksi halde `VERY_HIGH` bir trip yüklenemez.
 */
export const TRIP_CONFIDENCES = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type TripConfidence = (typeof TRIP_CONFIDENCES)[number];

/**
 * Kanonik trip özeti — **buluta giden TEK biçim**.
 *
 * `revision`: aynı trip yeniden yüklenirse sunucu tekrarı reddeder (§6).
 * `tripKey`: istemci-üretimli deterministik kimlik; dedupe anahtarıdır.
 */
export interface TripSummary {
  /** Yerel trip kimliği (`tripLogService` üretimi). */
  readonly tripId: string;
  /**
   * DEDUPE ANAHTARI — deterministik. Aynı trip iki kez kapansa (uygulama
   * yeniden başlatma yarışı) aynı anahtarı üretir → sunucu ikinciyi reddeder.
   */
  readonly tripKey: string;
  readonly state: TripState;
  /** Epoch ms. */
  readonly startedAtMs: number;
  /** Epoch ms; trip kapanmadıysa `null`. */
  readonly endedAtMs: number | null;
  readonly metrics: TripMetrics;
  /** Sürüş skoru 0–100; hesaplanamadıysa `null`. */
  readonly score: number | null;
  readonly confidence: TripConfidence;
  /** Olay listesi (koordinat İÇERMEZ). */
  readonly events: readonly TripEvent[];
  /** İstemci revizyonu — her yeniden gönderimde artar. */
  readonly revision: number;

  /* ── P2 ────────────────────────────────────────────────────────────── */

  /**
   * ÖLÇÜLEN yakıt tüketimi — **yüzde puan**, litre DEĞİL.
   *
   * Litre dönüşümü depo kapasitesine bağlıdır ve `DERIVED`'dır; yüzde ise
   * doğrudan sensör farkıdır. İkisini tek alanda taşımak, kapasite
   * bilinmediğinde uydurma litre üretilmesine yol açar.
   */
  readonly fuelUsedPercent: Metric;
  /** `fuelUsedL` hangi birimde ölçüldü — `null` = bilinmiyor. */
  readonly fuelUnit: FuelUnit | null;
  /** Yakıt ölçümü REDDEDİLDİYSE gerekçe (`NO_START`, `REFUEL_SUSPECTED`, …). */
  readonly fuelRejectReason: string | null;
  /** Trip başında alınan birim fiyat — sonradan DEĞİŞMEZ. */
  readonly price: TripPriceSnapshot;
  /** Confidence'ın dayandığı kanıt. */
  readonly coverage: TripCoverage;
  /** Metrik şema sürümü — alan kümesi değişirse artar. */
  readonly metricsVersion: number | null;
}

/* ── §2 TripStatistics ─────────────────────────────────────────────────── */

/** Toplu istatistik — Fleet Reports'un okuduğu biçim. */
export interface TripStatistics {
  readonly tripCount: number;
  readonly totalDistanceKm: Metric;
  readonly totalDurationMin: Metric;
  readonly totalFuelL: Metric;
  readonly totalCost: Metric;
  readonly averageScore: number | null;
  /** Yüklenmeyi bekleyen trip sayısı. */
  readonly pendingUploadCount: number;
  /** Yükleme kalıcı olarak başarısız olan trip sayısı. */
  readonly failedUploadCount: number;
}

/* ── Dedupe anahtarı ───────────────────────────────────────────────────── */

/**
 * Deterministik trip anahtarı üretir.
 *
 * Girdi: başlangıç anı (saniye çözünürlüğü) + bitiş anı + yuvarlanmış
 * mesafe. Neden bu üçü: aynı fiziksel yolculuk, uygulama yeniden başlasa
 * bile aynı üçlüyü verir; iki FARKLI yolculuk aynı üçlüyü vermez.
 *
 * `tripId` (rastgele UUID) dedupe için KULLANILAMAZ — yeniden başlatmada
 * yeni UUID üretilir ve aynı yolculuk iki kez yüklenir.
 */
export function buildTripKey(input: {
  startedAtMs: number;
  endedAtMs: number | null;
  distanceKm: number | null;
}): string {
  const s = Math.floor(input.startedAtMs / 1_000);
  const e = input.endedAtMs === null ? 0 : Math.floor(input.endedAtMs / 1_000);
  const d = input.distanceKm === null ? 0 : Math.round(input.distanceKm * 100);
  return `t${s}-${e}-${d}`;
}

/* ── Güven türetimi ────────────────────────────────────────────────────── */

export interface ConfidenceInput {
  /** Mesafe GPS haversine'den mi geldi (ölçüm), yoksa OBD Euler mi (türetme)? */
  readonly distanceSource: MetricSource;
  /** Süre monotonik saatten mi ölçüldü? */
  readonly durationSource: MetricSource;
  /** Hız örneği sayısı — az örnek ortalamayı güvensiz kılar. */
  readonly speedSampleCount: number;
  /** Yakıt gerçekten OBD'den ölçüldü mü? */
  readonly fuelSource: MetricSource;
}

/**
 * Trip güvenini türetir.
 *
 * **`HIGH` yalnız mesafe ÖLÇÜLDÜYSE ve yeterli hız örneği varsa** verilir.
 * OBD Euler entegrasyonu ile hesaplanan mesafe (GPS yokken) `MEDIUM`'u
 * aşamaz: hız×zaman toplamı viraj/rampa hatası biriktirir.
 *
 * Yakıt tahmin edilmişse bu güveni DÜŞÜRMEZ — yakıt ayrı bir alandır ve
 * kendi `ESTIMATED` etiketini taşır; mesafe/süre doğruluğunu etkilemez.
 */
export function deriveTripConfidence(input: ConfidenceInput): TripConfidence {
  if (input.distanceSource === 'UNAVAILABLE' || input.durationSource === 'UNAVAILABLE') {
    return 'UNKNOWN';
  }
  const enoughSamples = input.speedSampleCount >= 10;
  if (input.distanceSource === 'MEASURED' && enoughSamples) return 'HIGH';
  if (input.distanceSource === 'MEASURED' || enoughSamples) return 'MEDIUM';
  return 'LOW';
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function tripStateLabel(state: TripState): string {
  switch (state) {
    case 'RUNNING':   return 'Sürüşte';
    case 'PAUSED':    return 'Durdu';
    case 'RESUMED':   return 'Devam ediyor';
    case 'COMPLETED': return 'Yükleme bekliyor';
    case 'UPLOADED':  return 'Yüklendi';
    case 'ARCHIVED':  return 'Arşivlendi';
  }
}

/** Ölçüm metni. `null` → "Veri yok"; tahmin edilmiş değer ETİKETLENİR. */
export function metricLabel(m: Metric, unit: string): string {
  if (m.value === null) return 'Veri yok';
  const base = `${m.value} ${unit}`.trim();
  if (m.source === 'ESTIMATED') return `${base} (tahmini)`;
  return base;
}

export function metricSourceLabel(source: MetricSource): string {
  switch (source) {
    case 'MEASURED':    return 'Ölçüldü';
    case 'DERIVED':     return 'Hesaplandı';
    case 'ESTIMATED':   return 'Tahmini';
    case 'UNAVAILABLE': return 'Veri yok';
  }
}

export function tripConfidenceLabel(c: TripConfidence): string {
  switch (c) {
    case 'VERY_HIGH': return 'Çok yüksek';
    case 'HIGH':    return 'Yüksek';
    case 'MEDIUM':  return 'Orta';
    case 'LOW':     return 'Düşük';
    case 'UNKNOWN': return 'Bilinmiyor';
  }
}
