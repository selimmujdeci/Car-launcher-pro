/**
 * driverDna.ts — SÜRÜCÜ DNA'SI: KANONİK MODEL VE SÖZLEŞME (P1).
 *
 * ── BU BİR PUANLAMA SİSTEMİ DEĞİLDİR ───────────────────────────────────
 * Amaç sürücüye not vermek değil, zaman içinde **kanıtla oluşan** bir sürüş
 * karakteri çıkarmaktır: alışkanlıklar, araç kullanım şekli, risk profili ve
 * araç üzerindeki etki. Tek bir "sürücü puanı" bilinçli olarak ÜRETİLMEZ —
 * bir sayı, farklı sebeplerden gelen farklı gerçekleri tek bir yalana çevirir.
 *
 * ── BU PAKET AI ÜRETMEZ (BAĞLAYICI) ────────────────────────────────────
 * Burada model eğitimi, tahmin, öneri veya doğal dil YOKTUR. Bu katman,
 * AI'nin GELECEKTE güvenle kullanabileceği **kanıtlanmış altyapıyı** kurar.
 * Her metrik, hangi ölçümden türediğini ve ne kadar kanıta dayandığını
 * TAŞIR; kanıt yoksa değer üretilmez.
 *
 * ── ÜÇ SÖZLEŞME KURALI ─────────────────────────────────────────────────
 *  1. **UNKNOWN gerçek bir cevaptır.** Kanıtı olmayan metrik `0` DEĞİL,
 *     `UNKNOWN`'dır ve neden bilinmediği (`reason`) yazılır.
 *  2. **Provenance metrikten ayrılamaz.** `MEASURED` (gerçek ölçüm),
 *     `DERIVED` (ölçümlerden hesaplandı) ve `UNKNOWN` aynı alanda taşınır;
 *     tüketici hangisini gördüğünü BİLMEK zorundadır.
 *  3. **Tek sürüş DNA değildir.** Güven, yolculuk sayısı · veri kapsamı ·
 *     bilinmeyen oranıyla birlikte artar; eşik altında DNA OLUŞMAZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · abonelik YOK · React YOK.
 * Zaman ve kanıt DIŞARIDAN verilir.
 */

/* ── Provenance ────────────────────────────────────────────────────────── */

/**
 * Bir metriğin NEREDEN geldiği.
 *
 *   · `MEASURED` — doğrudan ölçümden (OBD/GPS) türedi
 *   · `DERIVED`  — ölçülmüş girdilerden HESAPLANDI (yeni bilgi uydurulmadı)
 *   · `UNKNOWN`  — kanıt yok; değer ÜRETİLMEDİ
 *
 * ⚠️ `ESTIMATED` bilinçli olarak METRİK provenance'ı DEĞİLDİR: tahmin yalnız
 * "araç üzerindeki etki" katmanında bulunur ve orada ayrıca işaretlenir
 * (bkz. {@link VehicleImpactEstimate}). Bir tahmini metrik gibi sunmak,
 * DNA'yı kanıt olmaktan çıkarır.
 */
export const DNA_PROVENANCES = ['MEASURED', 'DERIVED', 'UNKNOWN'] as const;
export type DnaProvenance = (typeof DNA_PROVENANCES)[number];

/** Metrik neden bilinmiyor — bounded KOD (serbest metin YOK). */
export const DNA_UNKNOWN_REASONS = [
  'NO_EVIDENCE_SOURCE',   // bu sinyali ÜRETEN bir kaynak YOK (yapısal eksik)
  'INSUFFICIENT_TRIPS',   // kanıt var ama yolculuk sayısı yetersiz
  'INSUFFICIENT_DISTANCE',// örneklem çok kısa (kısa mesafede oran anlamsız)
  'NO_MEASURED_INPUT',    // yolculuklar bu alanı ölçmemiş (UNAVAILABLE)
  'CONTRADICTORY_EVIDENCE', // kanıtlar çelişiyor → fail-closed
] as const;
export type DnaUnknownReason = (typeof DNA_UNKNOWN_REASONS)[number];

/* ── Bileşenler ────────────────────────────────────────────────────────── */

/**
 * DNA BİLEŞENLERİ.
 *
 * ⚠️ Listedeki her bileşen BUGÜN ÖLÇÜLEBİLİR DEĞİLDİR ve bu bilinçlidir:
 * ölçülemeyeni "0" ya da "ortalama" saymak, DNA'yı ilk günden yalancı
 * yapardı. Ölçülemeyenler kalıcı `UNKNOWN` + `NO_EVIDENCE_SOURCE` taşır ve
 * kanıt kaynağı eklendiğinde SÖZLEŞME DEĞİŞMEDEN dolarlar.
 */
export const DNA_COMPONENTS = [
  'DRIVING_SMOOTHNESS',
  'AGGRESSIVENESS',
  'FUEL_DISCIPLINE',
  'MECHANICAL_SYMPATHY',
  'NIGHT_DRIVING',
  'URBAN_DRIVING',
  'HIGHWAY_DRIVING',
  'IDLE_BEHAVIOUR',
  'BRAKING_STYLE',
  'ACCELERATION_STYLE',
  'CORNERING_STYLE',
  'ENGINE_CARE',
  'BATTERY_CARE',
  'CONSISTENCY',
] as const;
export type DnaComponent = (typeof DNA_COMPONENTS)[number];

/**
 * Bugün ÖLÇÜLEMEYEN bileşenler — kanıt kaynağı YOK (yapısal eksik).
 *
 *   · `CORNERING_STYLE` — yanal ivme / gyro verisi yolculuk modelinde YOK.
 *     Hızdan "viraj stili" türetmek uydurma olurdu.
 *   · `BATTERY_CARE`    — akü voltajı/şarj döngüsü yolculuk modelinde YOK.
 *     (Native ATRV voltajı okunuyor ama trip kaydına GİRMİYOR.)
 *
 * Bu liste bir EKSİKLİK BEYANIDIR ve testle kilitlenir: bir gün bu
 * bileşenler "dolmaya" başlarsa, kanıt kaynağının gerçekten eklendiği
 * kanıtlanmalıdır.
 */
export const DNA_COMPONENTS_WITHOUT_EVIDENCE: readonly DnaComponent[] =
  Object.freeze(['CORNERING_STYLE', 'BATTERY_CARE']);

/** Bileşenin ölçüm birimi — sayının NE olduğu belirsiz bırakılmaz. */
export const DNA_METRIC_UNITS = [
  'EVENTS_PER_100KM',   // 100 km başına olay (sert fren/hızlanma…)
  'RATIO',              // 0..1 oran (gece payı, rölanti payı…)
  'L_PER_100KM',        // yakıt tüketimi
  'INDEX_0_1',          // ölçümlerden türetilmiş 0..1 endeksi
  'NONE',
] as const;
export type DnaMetricUnit = (typeof DNA_METRIC_UNITS)[number];

/**
 * Tek bir DNA metriği.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, ehliyet, telefon, konum, rota, VIN yoktur —
 * yalnız kimlik referansları, sayısal karakter ve kanıt sayaçları.
 */
export interface DnaMetric {
  readonly component: DnaComponent;
  /** Değer; `provenance === 'UNKNOWN'` ise **daima `null`** (sahte 0 YOK). */
  readonly value: number | null;
  readonly unit: DnaMetricUnit;
  readonly provenance: DnaProvenance;
  /** `UNKNOWN` ise neden — aksi hâlde `null`. */
  readonly unknownReason: DnaUnknownReason | null;
  /** Bu metriğe katkı veren yolculuk sayısı (kanıt ağırlığı). */
  readonly sampleCount: number;
  /** Kanıtın kapsadığı mesafe (km) — oranların anlamlılık ölçüsü. */
  readonly sampleDistanceKm: number;
}

/** Kanıtsız metrik üretir — TEK yol (her yerde aynı sözleşme). */
export function unknownMetric(
  component: DnaComponent, reason: DnaUnknownReason,
): DnaMetric {
  return {
    component, value: null, unit: 'NONE', provenance: 'UNKNOWN',
    unknownReason: reason, sampleCount: 0, sampleDistanceKm: 0,
  };
}

/* ── Öğrenme seviyesi ──────────────────────────────────────────────────── */

/**
 * DNA'nın OLGUNLUK seviyesi — tek sürüş bir karakter değildir.
 *
 * Eşikler yolculuk SAYISINA bakar; güven ayrıca veri kapsamına ve bilinmeyen
 * oranına bağlıdır (bkz. `computeDnaConfidence`). Yani 1000 yolculuk tek
 * başına "yüksek güven" DEMEZ — hepsi kapsamsızsa güven düşük kalır.
 */
export const DNA_LEARNING_LEVELS = [
  'NONE',        // 0 katkı — DNA YOK
  'NASCENT',     // 1–9      · yön fikri bile vermez
  'DEVELOPING',  // 10–99    · eğilim görünür
  'ESTABLISHED', // 100–999  · karakter oturmuş
  'MATURE',      // 1000+    · uzun dönem karakter
] as const;
export type DnaLearningLevel = (typeof DNA_LEARNING_LEVELS)[number];

export const DNA_LEARNING_THRESHOLDS = Object.freeze({
  NASCENT: 1, DEVELOPING: 10, ESTABLISHED: 100, MATURE: 1000,
});

export function dnaLearningLevel(tripCount: number): DnaLearningLevel {
  if (!Number.isFinite(tripCount) || tripCount < DNA_LEARNING_THRESHOLDS.NASCENT) return 'NONE';
  if (tripCount < DNA_LEARNING_THRESHOLDS.DEVELOPING) return 'NASCENT';
  if (tripCount < DNA_LEARNING_THRESHOLDS.ESTABLISHED) return 'DEVELOPING';
  if (tripCount < DNA_LEARNING_THRESHOLDS.MATURE) return 'ESTABLISHED';
  return 'MATURE';
}

/* ── Güven ─────────────────────────────────────────────────────────────── */

export const DNA_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type DnaConfidence = (typeof DNA_CONFIDENCES)[number];

/**
 * DNA OLUŞMA EŞİĞİ — altında DNA **üretilmez** (fail-closed).
 *
 * NEDEN: iki kısa yolculuktan "sürüş karakteri" çıkarmak, kullanıcıya
 * kanıt gibi sunulan bir tahmindir. Eşik hem SAYI hem MESAFE ister:
 * 5 kez 300 metrelik park manevrası bir karakter değildir.
 */
export const DNA_MIN_TRIPS = 5;
export const DNA_MIN_DISTANCE_KM = 50;

/* ── Sapma (drift) ─────────────────────────────────────────────────────── */

export const DNA_DRIFT_STATES = [
  'STABLE',        // taban ile son pencere uyumlu
  'DRIFTING',      // anlamlı ve sürekli bir değişim var
  'INSUFFICIENT',  // karşılaştırma için yeterli örnek yok → karar YOK
] as const;
export type DnaDriftState = (typeof DNA_DRIFT_STATES)[number];

/** Sapma karşılaştırması için her iki pencerede gereken en az yolculuk. */
export const DNA_DRIFT_MIN_WINDOW = 5;

/**
 * Bir metrikteki sapma KANITI.
 *
 * Sapma bir "uyarı" değil, bir GÖZLEMDİR: sürücü değişmiş de olabilir,
 * güzergâh/mevsim değişmiş de. Bu yüzden yorum ÜRETİLMEZ, kanıt taşınır.
 */
export interface DnaDriftEvidence {
  readonly component: DnaComponent;
  readonly baselineValue: number;
  readonly recentValue: number;
  /** `recent - baseline` (işaret yönü taşır). */
  readonly delta: number;
  /** Görece değişim (|delta| / max(|baseline|, eps)). */
  readonly relativeChange: number;
  readonly baselineSampleCount: number;
  readonly recentSampleCount: number;
}

/* ── Araç etkisi (TAHMİN — ayrı katman) ────────────────────────────────── */

export const VEHICLE_IMPACT_KINDS = [
  'BRAKE_WEAR', 'TIRE_WEAR', 'ENGINE_STRESS', 'FUEL_OVERUSE',
] as const;
export type VehicleImpactKind = (typeof VEHICLE_IMPACT_KINDS)[number];

/**
 * Sürücünün araç üzerindeki TAHMİNİ etkisi.
 *
 * ⚠️ **BU BİR ÖLÇÜM DEĞİLDİR.** `estimated: true` alanı kaldırılamaz ve
 * `provenance` daima `DERIVED`'dır: gerçek balata/lastik aşınması ölçülmüyor;
 * yalnız ölçülmüş sürüş olaylarından bir ETKİ EĞİLİMİ türetiliyor. Tüketici
 * bunu ölçüm gibi sunarsa dürüstlük sözleşmesi ihlal edilir.
 */
export interface VehicleImpactEstimate {
  readonly kind: VehicleImpactKind;
  /** 0..1 göreli etki endeksi; kanıt yoksa `null`. */
  readonly index: number | null;
  readonly provenance: DnaProvenance;
  readonly unknownReason: DnaUnknownReason | null;
  /** DEĞİŞMEZ: bu katman her zaman tahmindir. */
  readonly estimated: true;
  /** Hangi metriklerden türedi — izlenebilirlik. */
  readonly basedOn: readonly DnaComponent[];
}

/* ── Kanonik DNA ───────────────────────────────────────────────────────── */

export const DNA_STATUSES = [
  'NO_DNA',      // eşik altında — DNA OLUŞMADI (fail-closed)
  'FORMING',     // eşiği geçti ama güven düşük
  'ACTIVE',      // kullanılabilir DNA
] as const;
export type DnaStatus = (typeof DNA_STATUSES)[number];

/**
 * Bir sürücünün DNA'sı.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, ehliyet, telefon, e-posta, konum, rota ve VIN
 * bu yapıya GİRMEZ — yalnız kimlik referansları, karakter metrikleri ve
 * kanıt sayaçları.
 */
export interface DriverDna {
  readonly driverId: string | null;
  /** DNA sürücüye aittir, araca DEĞİL — ama hangi filoda olduğu kimlik parçasıdır. */
  readonly companyId: string | null;
  readonly status: DnaStatus;
  readonly learningLevel: DnaLearningLevel;
  readonly confidence: DnaConfidence;
  /** Katkı veren yolculuk sayısı (tekrar oynatılanlar SAYILMAZ). */
  readonly tripCount: number;
  readonly totalDistanceKm: number;
  /** İlk ve son katkı anı (epoch ms) — DNA yaşı buradan hesaplanır. */
  readonly firstTripAtMs: number | null;
  readonly lastTripAtMs: number | null;
  readonly metrics: readonly DnaMetric[];
  readonly driftState: DnaDriftState;
  readonly driftEvidence: readonly DnaDriftEvidence[];
  readonly vehicleImpact: readonly VehicleImpactEstimate[];
  /** Her değişimde artar — istemci bayat DNA'yı ayırt edebilsin. */
  readonly revision: number;
}

/** DNA yokken kullanılan güvenli boş değer (sahte sayaç ÜRETMEZ). */
export const NO_DRIVER_DNA: DriverDna = Object.freeze({
  driverId: null, companyId: null,
  status: 'NO_DNA', learningLevel: 'NONE', confidence: 'UNKNOWN',
  tripCount: 0, totalDistanceKm: 0,
  firstTripAtMs: null, lastTripAtMs: null,
  metrics: Object.freeze([]) as readonly DnaMetric[],
  driftState: 'INSUFFICIENT',
  driftEvidence: Object.freeze([]) as readonly DnaDriftEvidence[],
  vehicleImpact: Object.freeze([]) as readonly VehicleImpactEstimate[],
  revision: 0,
});

/* ── Yardımcılar (saf) ─────────────────────────────────────────────────── */

/** DNA'nın yaşı (ms) — ilk katkıdan bu yana. Bilinmiyorsa `null`. */
export function dnaAgeMs(dna: DriverDna, nowMs: number): number | null {
  if (dna.firstTripAtMs === null) return null;
  return Math.max(0, nowMs - dna.firstTripAtMs);
}

/** Son güncellemeden bu yana geçen süre (ms). Bilinmiyorsa `null`. */
export function dnaStalenessMs(dna: DriverDna, nowMs: number): number | null {
  if (dna.lastTripAtMs === null) return null;
  return Math.max(0, nowMs - dna.lastTripAtMs);
}

export function dnaMetric(dna: DriverDna, c: DnaComponent): DnaMetric | null {
  return dna.metrics.find((m) => m.component === c) ?? null;
}

/** Bilinmeyen metrik sayısı — LAB'ın "ne kadarını bilmiyoruz" göstergesi. */
export function dnaUnknownCount(dna: DriverDna): number {
  return dna.metrics.reduce((n, m) => (m.provenance === 'UNKNOWN' ? n + 1 : n), 0);
}

export function dnaMeasuredCount(dna: DriverDna): number {
  return dna.metrics.reduce((n, m) => (m.provenance === 'MEASURED' ? n + 1 : n), 0);
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function dnaComponentLabel(c: DnaComponent): string {
  switch (c) {
    case 'DRIVING_SMOOTHNESS': return 'Sürüş yumuşaklığı';
    case 'AGGRESSIVENESS':     return 'Agresiflik';
    case 'FUEL_DISCIPLINE':    return 'Yakıt disiplini';
    case 'MECHANICAL_SYMPATHY':return 'Mekanik duyarlılık';
    case 'NIGHT_DRIVING':      return 'Gece sürüşü';
    case 'URBAN_DRIVING':      return 'Şehir içi sürüş';
    case 'HIGHWAY_DRIVING':    return 'Şehirler arası sürüş';
    case 'IDLE_BEHAVIOUR':     return 'Rölanti davranışı';
    case 'BRAKING_STYLE':      return 'Fren stili';
    case 'ACCELERATION_STYLE': return 'Hızlanma stili';
    case 'CORNERING_STYLE':    return 'Viraj stili';
    case 'ENGINE_CARE':        return 'Motor bakımı';
    case 'BATTERY_CARE':       return 'Akü bakımı';
    case 'CONSISTENCY':        return 'Tutarlılık';
  }
}

export function dnaLearningLevelLabel(l: DnaLearningLevel): string {
  switch (l) {
    case 'NONE':        return 'Henüz yok';
    case 'NASCENT':     return 'Yeni oluşuyor';
    case 'DEVELOPING':  return 'Gelişiyor';
    case 'ESTABLISHED': return 'Oturmuş';
    case 'MATURE':      return 'Olgun';
  }
}

export function dnaStatusLabel(s: DnaStatus): string {
  switch (s) {
    case 'NO_DNA':  return 'DNA oluşmadı';
    case 'FORMING': return 'Oluşuyor';
    case 'ACTIVE':  return 'Aktif';
  }
}

export function dnaDriftStateLabel(d: DnaDriftState): string {
  switch (d) {
    case 'STABLE':       return 'Kararlı';
    case 'DRIFTING':     return 'Değişim var';
    case 'INSUFFICIENT': return 'Yeterli veri yok';
  }
}

export function dnaUnknownReasonLabel(r: DnaUnknownReason): string {
  switch (r) {
    case 'NO_EVIDENCE_SOURCE':    return 'Bu sinyali üreten kaynak yok';
    case 'INSUFFICIENT_TRIPS':    return 'Yolculuk sayısı yetersiz';
    case 'INSUFFICIENT_DISTANCE': return 'Örneklem mesafesi yetersiz';
    case 'NO_MEASURED_INPUT':     return 'Yolculuklarda ölçüm yok';
    case 'CONTRADICTORY_EVIDENCE':return 'Kanıtlar çelişiyor';
  }
}

export function vehicleImpactKindLabel(k: VehicleImpactKind): string {
  switch (k) {
    case 'BRAKE_WEAR':    return 'Balata aşınması (tahmini)';
    case 'TIRE_WEAR':     return 'Lastik aşınması (tahmini)';
    case 'ENGINE_STRESS': return 'Motor zorlanması (tahmini)';
    case 'FUEL_OVERUSE':  return 'Fazla yakıt tüketimi (tahmini)';
  }
}
