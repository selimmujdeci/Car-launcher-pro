/**
 * ParkingProvider — Faz A saf otopark maliyet hesabı — TRIP-COST-A4.
 *
 * `computeLodgingCost`/`createLodgingProvider` seam'i BİREBİR izlenir (bkz.
 * lodgingProvider.ts): SAF hesap fonksiyonu + `CostProvider`e saran ince
 * adaptör. OSM/Overpass/gerçek otopark API'sine BAĞLANMAZ — yalnız kendisine
 * VERİLEN doğrulanmış durak listesi + kullanıcı ücret tablosunu (DI ile) işler.
 *
 * İKİ FİYAT TİPİ (lodging'in tek `per_stay`'inin AKSİNE — burada durak
 * bazında karışık olabilir):
 *   - `'flat'`     → `stopCost = value` (sabit, süre bağımsız).
 *   - `'per_hour'` → `stopCost = durationHours × perHourValue`.
 *   YUVARLAMA YOK (kesirli süre korunur, ör. 2.5 × 30 = 75).
 *
 * ÜÇ DURUM (lodging/toll ile birebir, mimari doküman §4-5):
 *   1. Otopark durağı yok (stops boş)  → value=0, status='known' (kesin gerçek).
 *   2. TÜM durakların fiyatı VE (per_hour ise) süresi VAR VE para birimi
 *      tutarlı                          → toplanır, status='known'|'stale'.
 *   3. En az bir durak fiyatsız/süresiz/para-birimi-tutarsız → value=null,
 *      status='unknown' (PARÇALI toplam `breakdown.knownSubtotal`'da görünür
 *      AMA ana `value`'ya ASLA sızmaz).
 *
 * UNKNOWN ÖNCELİĞİ (deterministik — testle kilitli):
 *   1) eksik FİYAT (flat `value` yok / per_hour `perHourValue` yok / hiç
 *      eşleşen fiyat kaydı yok)         → noteKey='parking_price_required'.
 *   2) fiyat var AMA per_hour SÜRE yok  → noteKey='parking_duration_required'.
 *   3) mixed/uyuşmayan para birimi      → noteKey='parking_currency_mismatch'.
 *
 * Kurallar:
 *   - Eşleşme `stop.key === priceEntry.stopKey` ile yapılır.
 *   - `stops[]` içinde AYNI `id` → GEÇERSİZ girdi — THROW (lodging ile AYNI).
 *     Farklı `id` AMA AYNI `key` → iki gerçek park işlemi, İKİSİ DE hesaplanır.
 *   - `priceEntries[]` içinde AYNI `stopKey` → belirsiz (ambiguous) — THROW.
 *   - `pricingUnit` `'flat'`/`'per_hour'` dışındaysa → THROW (bilinmeyen sözleşme).
 *   - `value`/`perHourValue` ALAN OLARAK VARSA ve negatif/NaN/Infinity ise
 *     → THROW; ALAN YOKSA (undefined) → o durak "fiyat eksik" (unknown, throw DEĞİL).
 *   - `confidence` `0..1` dışı → THROW.
 *   - `durationHours` ALAN OLARAK VARSA ve `<=0` ise → THROW (stop varsa süre
 *     >0 olmalı — ücretsiz/park-yok ile karışmasın); ALAN YOKSA (per_hour
 *     durakta) → "süre eksik" (unknown, throw DEĞİL).
 *   - `value:0`/`perHourValue:0` GEÇERLİDİR (ücretsiz otopark → known).
 *   - Para birimi OTOMATİK ÇEVRİLMEZ — fail-closed `unknown` (döviz UYDURMA).
 */
import type { CostItem, CostItemSource } from '../models';
import { makeCostItem } from '../models';
import type { TripPlan } from '../models';
import type { CostProvider, CostProviderContext } from './types';

/* ── Girdi modelleri ─────────────────────────────────────────────────────── */

export type ParkingStopKind =
  | 'street' | 'lot' | 'garage' | 'park_and_ride' | 'hotel' | 'camp' | 'other';

export type ParkingPricingUnit = 'flat' | 'per_hour';

/** TEK bir otopark durağı. Routing/OSM/geocoding YAPILMAZ; bu veri DIŞARIDAN gelir. */
export interface ParkingStopInput {
  /** Bu PARK İŞLEMİNİN kimliği — AYNI id iki kez GEÇERSİZDİR. */
  id:              string;
  /** Fiyat eşleşmesi İÇİN kullanılan anahtar — `ParkingPriceEntry.stopKey` ile eşleşir. */
  key:             string;
  /** Yalnız `per_hour` fiyatlandırma için gerekli. Alan VARSA `<=0` GEÇERSİZ. */
  durationHours?:  number;
  kind?:           ParkingStopKind;
  label?:          string;
  locationId?:     string;
}

/** Kullanıcı ücret tablosundan (veya cache'ten) TEK bir otopark fiyat kaydı. */
export interface ParkingPriceEntry {
  stopKey:      string;
  pricingUnit:  ParkingPricingUnit;
  /** Yalnız `pricingUnit:'flat'` için okunur. */
  value?:       number;
  /** Yalnız `pricingUnit:'per_hour'` için okunur. */
  perHourValue?: number;
  currency:     string;
  source:       CostItemSource;
  confidence:   number;
  stale?:       boolean;
  /** Faz A'da TTL hesaplaması YAPILMAZ — `stale` DI ile açıkça belirtilir. */
  updatedAt?:   number;
}

/** `computeParkingCost` girdisi — TripPlan'dan BAĞIMSIZ, saf ilkel değerler. */
export interface ParkingProviderInput {
  stops:           readonly ParkingStopInput[];
  priceEntries:    readonly ParkingPriceEntry[];
  reportCurrency:  string;
  editable?:       boolean; // verilmezse true (fuel/toll/lodging ile tutarlı varsayılan)
}

/* ── Şeffaflık kırılımı ──────────────────────────────────────────────────── */

export interface ParkingMatchedStopBreakdown {
  stopId:          string;
  stopKey:         string;
  pricingUnit:     ParkingPricingUnit;
  value?:          number;
  perHourValue?:   number;
  durationHours?:  number;
  stopCost:        number;
  currency:        string;
  source:          CostItemSource;
  confidence:      number;
  stale:           boolean;
  kind?:           ParkingStopKind;
  label?:          string;
}

export interface ParkingMissingPriceStopBreakdown {
  stopId:   string;
  stopKey:  string;
  kind?:    ParkingStopKind;
  label?:   string;
}

export interface ParkingMissingDurationStopBreakdown {
  stopId:   string;
  stopKey:  string;
  kind?:    ParkingStopKind;
  label?:   string;
}

export interface ParkingMismatchedCurrencyStopBreakdown {
  stopId:            string;
  stopKey:           string;
  currency:          string;
  expectedCurrency:  string;
}

export interface ParkingCostBreakdown {
  stopCount:                   number;
  matchedCount:                number;
  /** `missingPriceStops.length + missingDurationStops.length` toplamı. */
  missingCount:                number;
  /** Σ durationHours — TÜM duraklar üzerinden (fiyatlanamayanlar dahil, `undefined→0`). */
  totalDurationHours:          number;
  flatStopCount:               number;
  hourlyStopCount:             number;
  /** Yalnız DURUM 2/3'te dolu — DURUM 3'te PARÇALI, ana `value`'ya SIZMAZ. */
  knownSubtotal?:               number;
  matchedStops?:                ParkingMatchedStopBreakdown[];
  missingPriceStops?:           ParkingMissingPriceStopBreakdown[];
  missingDurationStops?:        ParkingMissingDurationStopBreakdown[];
  staleStops?:                  ParkingMatchedStopBreakdown[];
  mismatchedCurrencyStops?:     ParkingMismatchedCurrencyStopBreakdown[];
  [key: string]: unknown;
}

/**
 * Hiç otopark durağı yokken kullanılan sabit confidence — "otopark yok"
 * bilgisi KESİN bir gerçektir, bu yüzden en yüksek güvenle işaretlenir.
 * Test tarafından kilitlenmiştir.
 */
export const PARKING_NO_STOP_CONFIDENCE = 1;

/* ── Ana hesap ───────────────────────────────────────────────────────────── */

/**
 * SAF otopark maliyeti hesabı — TripPlan/ctx'ten BAĞIMSIZ. `createParkingProvider`
 * bu fonksiyonu bir `CostProvider`e sarar (bkz. aşağı).
 */
export function computeParkingCost(input: ParkingProviderInput): CostItem {
  const stops           = input.stops ?? [];
  const priceEntries     = input.priceEntries ?? [];
  const reportCurrency   = input.reportCurrency;
  const editable         = input.editable ?? true;

  // 1) stops[] doğrulama — AYNI id iki kez VEYA (alan varsa) durationHours<=0 → THROW.
  const seenStopIds = new Set<string>();
  for (const stop of stops) {
    if (seenStopIds.has(stop.id)) {
      throw new RangeError(
        `computeParkingCost: stops içinde AYNI id ('${stop.id}') birden fazla kez geçiyor — geçersiz girdi.`,
      );
    }
    seenStopIds.add(stop.id);
    if (stop.durationHours !== undefined && (!Number.isFinite(stop.durationHours) || stop.durationHours <= 0)) {
      throw new RangeError(
        `computeParkingCost: geçersiz süre (${stop.durationHours}) — id '${stop.id}' için ALAN VERİLDİYSE pozitif olmalı.`,
      );
    }
  }

  // 2) priceEntries[] doğrulama — TÜMÜ (kullanılıp kullanılmadığına
  //    bakılmaksızın): bilinmeyen pricingUnit, geçersiz fiyat/confidence VEYA
  //    belirsiz (duplicate) stopKey → THROW. Yalnız İLGİLİ fiyat alanı (flat→
  //    value, per_hour→perHourValue) doğrulanır; alan yoksa (undefined) bu
  //    aşamada hata DEĞİL — eşleşince "fiyat eksik" sayılır.
  const seenKeys = new Set<string>();
  for (const entry of priceEntries) {
    if (entry.pricingUnit !== 'flat' && entry.pricingUnit !== 'per_hour') {
      throw new RangeError(
        `computeParkingCost: bilinmeyen pricingUnit ('${String(entry.pricingUnit)}') — stopKey '${entry.stopKey}' için yalnız 'flat' veya 'per_hour' desteklenir.`,
      );
    }
    if (entry.pricingUnit === 'flat') {
      if (entry.value !== undefined && (!Number.isFinite(entry.value) || entry.value < 0)) {
        throw new RangeError(
          `computeParkingCost: geçersiz flat fiyat (${entry.value}) — stopKey '${entry.stopKey}' için negatif olamaz veya sonlu değil.`,
        );
      }
    } else {
      if (entry.perHourValue !== undefined && (!Number.isFinite(entry.perHourValue) || entry.perHourValue < 0)) {
        throw new RangeError(
          `computeParkingCost: geçersiz saatlik fiyat (${entry.perHourValue}) — stopKey '${entry.stopKey}' için negatif olamaz veya sonlu değil.`,
        );
      }
    }
    if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
      throw new RangeError(
        `computeParkingCost: geçersiz confidence (${entry.confidence}) — stopKey '${entry.stopKey}' için 0..1 aralığında olmalı.`,
      );
    }
    if (seenKeys.has(entry.stopKey)) {
      throw new RangeError(
        `computeParkingCost: priceEntries içinde AYNI stopKey ('${entry.stopKey}') birden fazla kez geçiyor — belirsiz (ambiguous) fiyat tablosu.`,
      );
    }
    seenKeys.add(entry.stopKey);
  }

  const priceMap = new Map<string, ParkingPriceEntry>();
  for (const entry of priceEntries) priceMap.set(entry.stopKey, entry);

  const stopCount           = stops.length;
  const totalDurationHours  = stops.reduce((sum, s) => sum + (s.durationHours ?? 0), 0);

  // ── DURUM 1 — otopark durağı yok ─────────────────────────────────────────
  if (stopCount === 0) {
    const breakdown: ParkingCostBreakdown = {
      stopCount: 0, matchedCount: 0, missingCount: 0, totalDurationHours: 0,
      flatStopCount: 0, hourlyStopCount: 0,
    };
    return makeCostItem({
      id:         'parking',
      category:   'parking',
      value:      0,
      currency:   reportCurrency,
      source:     'calculated',
      confidence: PARKING_NO_STOP_CONFIDENCE,
      editable,
      status:     'known',
      breakdown,
    });
  }

  const matched:          ParkingMatchedStopBreakdown[] = [];
  const missingPrice:      ParkingMissingPriceStopBreakdown[] = [];
  const missingDuration:   ParkingMissingDurationStopBreakdown[] = [];
  let   flatStopCount     = 0;
  let   hourlyStopCount   = 0;

  for (const stop of stops) {
    const entry = priceMap.get(stop.key);
    if (!entry) {
      missingPrice.push({ stopId: stop.id, stopKey: stop.key, kind: stop.kind, label: stop.label });
      continue;
    }

    if (entry.pricingUnit === 'flat') {
      flatStopCount++;
      if (entry.value === undefined) {
        missingPrice.push({ stopId: stop.id, stopKey: stop.key, kind: stop.kind, label: stop.label });
        continue;
      }
      const stopCost = entry.value; // YUVARLAMA YOK
      matched.push({
        stopId: stop.id, stopKey: stop.key, pricingUnit: 'flat', value: entry.value,
        durationHours: stop.durationHours, stopCost,
        currency: entry.currency, source: entry.source, confidence: entry.confidence,
        stale: entry.stale === true, kind: stop.kind, label: stop.label,
      });
      continue;
    }

    // pricingUnit === 'per_hour'
    hourlyStopCount++;
    if (entry.perHourValue === undefined) {
      missingPrice.push({ stopId: stop.id, stopKey: stop.key, kind: stop.kind, label: stop.label });
      continue;
    }
    if (stop.durationHours === undefined) {
      missingDuration.push({ stopId: stop.id, stopKey: stop.key, kind: stop.kind, label: stop.label });
      continue;
    }
    const stopCost = stop.durationHours * entry.perHourValue; // YUVARLAMA YOK
    matched.push({
      stopId: stop.id, stopKey: stop.key, pricingUnit: 'per_hour', perHourValue: entry.perHourValue,
      durationHours: stop.durationHours, stopCost,
      currency: entry.currency, source: entry.source, confidence: entry.confidence,
      stale: entry.stale === true, kind: stop.kind, label: stop.label,
    });
  }

  const matchedCount = matched.length;
  const missingCount = missingPrice.length + missingDuration.length;

  // ── DURUM 3a-i — en az bir durağın FİYATI eksik (en yüksek öncelik) ─────
  // Eksik + stale birlikte olsa bile UNKNOWN ÖNCELİKLİDİR.
  if (missingPrice.length > 0) {
    const knownSubtotal = matched.reduce((sum, m) => sum + m.stopCost, 0); // PARÇALI
    const breakdown: ParkingCostBreakdown = {
      stopCount, matchedCount, missingCount, totalDurationHours, flatStopCount, hourlyStopCount,
      knownSubtotal, matchedStops: matched, missingPriceStops: missingPrice, missingDurationStops: missingDuration,
    };
    return makeCostItem({
      id: 'parking', category: 'parking', value: null, currency: reportCurrency,
      source: 'unknown', confidence: 0, editable, status: 'unknown', breakdown,
      noteKey: 'parking_price_required',
    });
  }

  // ── DURUM 3a-ii — fiyatlar tam AMA en az bir per_hour durağın SÜRESİ eksik ──
  if (missingDuration.length > 0) {
    const knownSubtotal = matched.reduce((sum, m) => sum + m.stopCost, 0); // PARÇALI
    const breakdown: ParkingCostBreakdown = {
      stopCount, matchedCount, missingCount, totalDurationHours, flatStopCount, hourlyStopCount,
      knownSubtotal, matchedStops: matched, missingPriceStops: [], missingDurationStops: missingDuration,
    };
    return makeCostItem({
      id: 'parking', category: 'parking', value: null, currency: reportCurrency,
      source: 'unknown', confidence: 0, editable, status: 'unknown', breakdown,
      noteKey: 'parking_duration_required',
    });
  }

  // ── DURUM 3b — tüm duraklar fiyatlı+süreli AMA para birimi tutarsız ──────
  const mismatched = matched.filter((m) => m.currency !== reportCurrency);
  if (mismatched.length > 0) {
    const breakdown: ParkingCostBreakdown = {
      stopCount, matchedCount, missingCount: 0, totalDurationHours, flatStopCount, hourlyStopCount,
      matchedStops: matched,
      mismatchedCurrencyStops: mismatched.map((m) => ({
        stopId: m.stopId, stopKey: m.stopKey, currency: m.currency, expectedCurrency: reportCurrency,
      })),
    };
    return makeCostItem({
      id: 'parking', category: 'parking', value: null, currency: reportCurrency,
      source: 'unknown', confidence: 0, editable, status: 'unknown', breakdown,
      noteKey: 'parking_currency_mismatch',
    });
  }

  // ── DURUM 2 — tüm duraklar fiyatlı+süreli, para birimi tutarlı ───────────
  const knownSubtotal   = matched.reduce((sum, m) => sum + m.stopCost, 0);
  const staleStops       = matched.filter((m) => m.stale);
  const anyStale          = staleStops.length > 0;
  const distinctSources   = new Set(matched.map((m) => m.source));
  const source: CostItemSource = distinctSources.size === 1 ? matched[0].source : 'calculated';

  // Maliyet-ağırlıklı confidence (fuel/toll/lodging ile AYNI num/den deseni).
  // ΣstopCost=0 ise (tüm eşleşen fiyatlar 0) bölme YAPILMAZ — deterministik
  // geri düşüş: eşleşen confidence'ların BASİT ortalaması (matchedCount>0
  // bu daldan garanti — sıfıra bölme riski YOK).
  let num = 0;
  let den = 0;
  for (const m of matched) { num += m.stopCost * m.confidence; den += m.stopCost; }
  const confidence = den > 0
    ? num / den
    : matched.reduce((sum, m) => sum + m.confidence, 0) / matchedCount;

  const breakdown: ParkingCostBreakdown = {
    stopCount, matchedCount, missingCount: 0, totalDurationHours, flatStopCount, hourlyStopCount,
    matchedStops: matched, knownSubtotal, staleStops,
  };

  return makeCostItem({
    id: 'parking', category: 'parking', value: knownSubtotal, currency: reportCurrency,
    source, confidence, editable, status: anyStale ? 'stale' : 'known', breakdown,
  });
}

/**
 * `computeParkingCost`i bir `CostProvider`e sarar — CostEngine'e DI ile
 * verilebilsin diye. `resolveInput` çağıranın TripPlan'dan hangi durak/fiyat
 * tablosunu kullanacağına karar verir (OSM/otopark API/kullanıcı tablosu
 * bağlama işi wiring katmanının sorumluluğudur — Faz A'da YOK).
 */
export function createParkingProvider(
  resolveInput: (plan: TripPlan, ctx: CostProviderContext) => ParkingProviderInput,
): CostProvider {
  return function parkingCostProvider(plan: TripPlan, ctx: CostProviderContext): CostItem {
    return computeParkingCost(resolveInput(plan, ctx));
  };
}
