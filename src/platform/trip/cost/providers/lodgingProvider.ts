/**
 * LodgingProvider — Faz A saf konaklama (gece) maliyet hesabı — TRIP-COST-A3.
 *
 * `computeTollCost`/`createTollProvider` seam'i BİREBİR izlenir (bkz.
 * tollProvider.ts): SAF hesap fonksiyonu + `CostProvider`e saran ince
 * adaptör. OSM/Overpass/gerçek otel API'sine BAĞLANMAZ — yalnız kendisine
 * VERİLEN doğrulanmış konaklama listesi + kullanıcı ücret tablosunu (DI ile)
 * işler.
 *
 * ÜÇ DURUM (toll ile birebir, mimari doküman §4-5):
 *   1. Konaklama yok (stays boş)      → value=0, status='known' (kesin gerçek).
 *   2. TÜM stay'lerin fiyatı var VE para birimi tutarlı VE pricingUnit
 *      desteklenmiş ('per_stay')      → toplanır, status='known'|'stale'.
 *   3. En az bir stay fiyatsız VEYA desteklenmeyen pricingUnit'te VEYA
 *      para birimi tutarsız            → value=null, status='unknown'
 *      (PARÇALI toplam `breakdown.knownSubtotal`'da görünür AMA ana `value`'ya
 *      ASLA sızmaz — sahte "tam ücret" yasak).
 *
 * Kurallar:
 *   - Eşleşme `stay.key === priceEntry.stayKey` ile yapılır.
 *   - `stayCost = nights × perNightValue`. YUVARLAMA YOK.
 *   - Bu FAZDA yalnız `pricingUnit:'per_stay'` hesaplanır. Eşleşen fiyat
 *     kaydının `pricingUnit`i başka bir şeyse (`per_person`/`per_adult`/
 *     `per_child`) o stay SESSİZCE yanlış hesaplanmaz — "fiyatlanamaz"
 *     sayılır, fail-closed `unknown`a düşürür (throw DEĞİL — bu gelecek-
 *     özellik boşluğu, bozuk girdi değil).
 *   - `stays[]` içinde AYNI `id` birden çok kez geçmesi GEÇERSİZ girdidir
 *     (toll'daki segment.id davranışının AKSİNE) — THROW. Farklı `id` AMA
 *     AYNI `key` → iki gerçek rezervasyon, İKİSİ DE hesaplanır (toll'daki
 *     "iki gerçek geçiş" deseniyle AYNI).
 *   - `nights <= 0` → geçersiz girdi — THROW (gerçekten konaklama yoksa
 *     `stays`'e hiç eklenmez).
 *   - `priceEntries[]` içinde AYNI `stayKey` birden fazla kez geçerse
 *     belirsiz (ambiguous) fiyat tablosu — THROW.
 *   - Negatif/NaN/Infinity `perNightValue` VEYA 0..1 dışı confidence → THROW.
 *   - `perNightValue:0` GEÇERLİDİR (ücretsiz kamp, `source:'user'` →
 *     known, unknown DEĞİL).
 *   - Para birimi OTOMATİK ÇEVRİLMEZ — `reportCurrency`den farklı bir
 *     eşleşen fiyat varsa fail-closed `unknown` (döviz UYDURMA).
 */
import type { CostItem, CostItemSource } from '../models';
import { makeCostItem } from '../models';
import type { TripPlan } from '../models';
import type { CostProvider, CostProviderContext } from './types';

/* ── Girdi modelleri ─────────────────────────────────────────────────────── */

export type LodgingKind =
  | 'camp' | 'hotel' | 'chalet' | 'bungalow' | 'caravan_site' | 'hostel' | 'apartment' | 'other';

/** Bu FAZDA yalnız `'per_stay'` hesaplanır — diğerleri "unpriceable" sayılır. */
export type LodgingPricingUnit = 'per_stay' | 'per_person' | 'per_adult' | 'per_child';

/** TEK bir konaklama (kamp/otel/bungalov…). Routing/OSM/geocoding YAPILMAZ;
 *  bu veri DIŞARIDAN gelir. */
export interface LodgingStayInput {
  /** Bu REZERVASYONUN kimliği — AYNI id iki kez GEÇERSİZDİR (toll'un aksine). */
  id:            string;
  /** Fiyat eşleşmesi İÇİN kullanılan anahtar — `LodgingPriceEntry.stayKey` ile eşleşir. */
  key:           string;
  nights:        number;
  kind:          LodgingKind;
  label?:        string;
  locationId?:   string;
  checkInDate?:  string;
  checkOutDate?: string;
}

/** Kullanıcı ücret tablosundan (veya cache'ten) TEK bir gecelik fiyat kaydı. */
export interface LodgingPriceEntry {
  stayKey:        string;
  perNightValue:  number;
  currency:       string;
  source:         CostItemSource;
  confidence:     number;
  stale?:         boolean;
  /** Faz A'da TTL hesaplaması YAPILMAZ — `stale` DI ile açıkça belirtilir. */
  updatedAt?:     number;
  pricingUnit:    LodgingPricingUnit;
}

/** `computeLodgingCost` girdisi — TripPlan'dan BAĞIMSIZ, saf ilkel değerler. */
export interface LodgingProviderInput {
  stays:           readonly LodgingStayInput[];
  priceEntries:    readonly LodgingPriceEntry[];
  reportCurrency:  string;
  editable?:       boolean; // verilmezse true (fuel/toll ile tutarlı varsayılan)
}

/* ── Şeffaflık kırılımı ──────────────────────────────────────────────────── */

export interface LodgingMatchedStayBreakdown {
  stayId:          string;
  stayKey:         string;
  nights:          number;
  perNightValue:   number;
  stayCost:        number;
  currency:        string;
  source:          CostItemSource;
  confidence:      number;
  stale:           boolean;
  kind:            LodgingKind;
  label?:          string;
}

export interface LodgingMissingStayBreakdown {
  stayId:   string;
  stayKey:  string;
  nights:   number;
  kind:     LodgingKind;
  label?:   string;
}

export interface LodgingUnsupportedPricingUnitStayBreakdown {
  stayId:       string;
  stayKey:      string;
  pricingUnit:  LodgingPricingUnit;
}

export interface LodgingMismatchedCurrencyStayBreakdown {
  stayId:            string;
  stayKey:           string;
  currency:          string;
  expectedCurrency:  string;
}

export interface LodgingCostBreakdown {
  stayCount:                     number;
  matchedCount:                  number;
  missingCount:                  number;
  totalNights:                   number;
  /** Bu FAZDA sabit — yalnız 'per_stay' hesaplanır. */
  pricingUnit:                   'per_stay';
  /** Yalnız DURUM 2/3'te dolu — DURUM 3'te PARÇALI, ana `value`'ya SIZMAZ. */
  knownSubtotal?:                 number;
  matchedStays?:                  LodgingMatchedStayBreakdown[];
  missingStays?:                  LodgingMissingStayBreakdown[];
  staleStays?:                    LodgingMatchedStayBreakdown[];
  mismatchedCurrencyStays?:       LodgingMismatchedCurrencyStayBreakdown[];
  unsupportedPricingUnitStays?:   LodgingUnsupportedPricingUnitStayBreakdown[];
  [key: string]: unknown;
}

/**
 * Hiç konaklama yokken kullanılan sabit confidence — "konaklama yok" bilgisi
 * KESİN bir gerçektir (plan verisinden doğrudan türetilir), bu yüzden en
 * yüksek güvenle işaretlenir. Test tarafından kilitlenmiştir.
 */
export const LODGING_NO_STAY_CONFIDENCE = 1;

/* ── Ana hesap ───────────────────────────────────────────────────────────── */

/**
 * SAF konaklama maliyeti hesabı — TripPlan/ctx'ten BAĞIMSIZ. `createLodgingProvider`
 * bu fonksiyonu bir `CostProvider`e sarar (bkz. aşağı).
 */
export function computeLodgingCost(input: LodgingProviderInput): CostItem {
  const stays          = input.stays ?? [];
  const priceEntries    = input.priceEntries ?? [];
  const reportCurrency  = input.reportCurrency;
  const editable        = input.editable ?? true;

  // 1) stays[] doğrulama — AYNI id iki kez VEYA nights<=0 → THROW.
  const seenStayIds = new Set<string>();
  for (const stay of stays) {
    if (seenStayIds.has(stay.id)) {
      throw new RangeError(
        `computeLodgingCost: stays içinde AYNI id ('${stay.id}') birden fazla kez geçiyor — geçersiz girdi (toll'un aksine dedup YOK, bu hatadır).`,
      );
    }
    seenStayIds.add(stay.id);
    if (!Number.isFinite(stay.nights) || stay.nights <= 0) {
      throw new RangeError(
        `computeLodgingCost: geçersiz gece sayısı (${stay.nights}) — id '${stay.id}' için pozitif olmalı (gerçekten konaklama yoksa stays'e eklenmemeli).`,
      );
    }
  }

  // 2) priceEntries[] doğrulama — TÜMÜ (kullanılıp kullanılmadığına
  //    bakılmaksızın): geçersiz fiyat/confidence VEYA belirsiz (duplicate)
  //    stayKey → THROW.
  const seenKeys = new Set<string>();
  for (const entry of priceEntries) {
    if (!Number.isFinite(entry.perNightValue) || entry.perNightValue < 0) {
      throw new RangeError(
        `computeLodgingCost: geçersiz gecelik fiyat (${entry.perNightValue}) — stayKey '${entry.stayKey}' için negatif olamaz veya sonlu değil.`,
      );
    }
    if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
      throw new RangeError(
        `computeLodgingCost: geçersiz confidence (${entry.confidence}) — stayKey '${entry.stayKey}' için 0..1 aralığında olmalı.`,
      );
    }
    if (seenKeys.has(entry.stayKey)) {
      throw new RangeError(
        `computeLodgingCost: priceEntries içinde AYNI stayKey ('${entry.stayKey}') birden fazla kez geçiyor — belirsiz (ambiguous) fiyat tablosu.`,
      );
    }
    seenKeys.add(entry.stayKey);
  }

  const priceMap = new Map<string, LodgingPriceEntry>();
  for (const entry of priceEntries) priceMap.set(entry.stayKey, entry);

  const stayCount    = stays.length;
  const totalNights  = stays.reduce((sum, s) => sum + s.nights, 0);

  // ── DURUM 1 — konaklama yok ────────────────────────────────────────────
  if (stayCount === 0) {
    const breakdown: LodgingCostBreakdown = {
      stayCount: 0, matchedCount: 0, missingCount: 0, totalNights: 0, pricingUnit: 'per_stay',
    };
    return makeCostItem({
      id:         'lodging',
      category:   'lodging',
      value:      0,
      currency:   reportCurrency,
      source:     'calculated',
      confidence: LODGING_NO_STAY_CONFIDENCE,
      editable,
      status:     'known',
      breakdown,
    });
  }

  const matched:     LodgingMatchedStayBreakdown[] = [];
  const missing:      LodgingMissingStayBreakdown[] = [];
  const unsupported:  LodgingUnsupportedPricingUnitStayBreakdown[] = [];

  for (const stay of stays) {
    const entry = priceMap.get(stay.key);
    if (!entry) {
      missing.push({ stayId: stay.id, stayKey: stay.key, nights: stay.nights, kind: stay.kind, label: stay.label });
      continue;
    }
    if (entry.pricingUnit !== 'per_stay') {
      // Gelecek-özellik boşluğu (kişi-başı tarife Faz A'da yok) — bozuk girdi
      // DEĞİL, SESSİZCE yanlış hesaplama da YAPILMAZ. "unpriceable" say.
      unsupported.push({ stayId: stay.id, stayKey: stay.key, pricingUnit: entry.pricingUnit });
      continue;
    }
    const stayCost = stay.nights * entry.perNightValue; // YUVARLAMA YOK
    matched.push({
      stayId:         stay.id,
      stayKey:        stay.key,
      nights:         stay.nights,
      perNightValue:  entry.perNightValue,
      stayCost,
      currency:       entry.currency,
      source:         entry.source,
      confidence:     entry.confidence,
      stale:          entry.stale === true,
      kind:           stay.kind,
      label:          stay.label,
    });
  }

  const matchedCount = matched.length;
  const missingCount = missing.length;

  // ── DURUM 3a — en az bir stay fiyatsız VEYA desteklenmeyen pricingUnit'te ──
  // Eksik/unpriceable + stale birlikte olsa bile UNKNOWN ÖNCELİKLİDİR (bu
  // kontrol currency kontrolünden ÖNCE yapılır).
  if (missingCount > 0 || unsupported.length > 0) {
    const knownSubtotal = matched.reduce((sum, m) => sum + m.stayCost, 0); // PARÇALI — ana value'ya SIZMAZ
    const breakdown: LodgingCostBreakdown = {
      stayCount,
      matchedCount,
      missingCount,
      totalNights,
      pricingUnit: 'per_stay',
      knownSubtotal,
      matchedStays: matched,
      missingStays: missing,
      unsupportedPricingUnitStays: unsupported,
    };
    return makeCostItem({
      id:         'lodging',
      category:   'lodging',
      value:      null,
      currency:   reportCurrency,
      source:     'unknown',
      confidence: 0,
      editable,
      status:     'unknown',
      breakdown,
      noteKey:    'lodging_price_required',
    });
  }

  // ── DURUM 3b — tüm stay'ler fiyatlı AMA para birimi tutarsız ─────────────
  const mismatched = matched.filter((m) => m.currency !== reportCurrency);
  if (mismatched.length > 0) {
    const breakdown: LodgingCostBreakdown = {
      stayCount,
      matchedCount,
      missingCount: 0,
      totalNights,
      pricingUnit: 'per_stay',
      matchedStays: matched,
      mismatchedCurrencyStays: mismatched.map((m) => ({
        stayId:            m.stayId,
        stayKey:           m.stayKey,
        currency:          m.currency,
        expectedCurrency:  reportCurrency,
      })),
    };
    return makeCostItem({
      id:         'lodging',
      category:   'lodging',
      value:      null,
      currency:   reportCurrency,
      source:     'unknown',
      confidence: 0,
      editable,
      status:     'unknown',
      breakdown,
      noteKey:    'lodging_currency_mismatch',
    });
  }

  // ── DURUM 2 — tüm stay'ler fiyatlı, para birimi tutarlı, pricingUnit destekli ──
  const knownSubtotal    = matched.reduce((sum, m) => sum + m.stayCost, 0);
  const staleStays       = matched.filter((m) => m.stale);
  const anyStale          = staleStays.length > 0;
  const distinctSources   = new Set(matched.map((m) => m.source));
  const source: CostItemSource = distinctSources.size === 1 ? matched[0].source : 'calculated';

  // Maliyet-ağırlıklı confidence (toll/confidenceLedger ile AYNI num/den
  // deseni). ΣstayCost=0 ise (tüm eşleşen fiyatlar 0) bölme YAPILMAZ —
  // deterministik geri düşüş: eşleşen confidence'ların BASİT ortalaması
  // (matchedCount>0 bu daldan garanti — sıfıra bölme riski YOK).
  let num = 0;
  let den = 0;
  for (const m of matched) { num += m.stayCost * m.confidence; den += m.stayCost; }
  const confidence = den > 0
    ? num / den
    : matched.reduce((sum, m) => sum + m.confidence, 0) / matchedCount;

  const breakdown: LodgingCostBreakdown = {
    stayCount,
    matchedCount,
    missingCount: 0,
    totalNights,
    pricingUnit: 'per_stay',
    matchedStays: matched,
    knownSubtotal,
    staleStays,
  };

  return makeCostItem({
    id:         'lodging',
    category:   'lodging',
    value:      knownSubtotal,
    currency:   reportCurrency,
    source,
    confidence,
    editable,
    status:     anyStale ? 'stale' : 'known',
    breakdown,
  });
}

/**
 * `computeLodgingCost`i bir `CostProvider`e sarar — CostEngine'e DI ile
 * verilebilsin diye. `resolveInput` çağıranın TripPlan'dan hangi konaklama/
 * fiyat tablosunu kullanacağına karar verir (OSM/otel API/kullanıcı tablosu
 * bağlama işi wiring katmanının sorumluluğudur — Faz A'da YOK).
 */
export function createLodgingProvider(
  resolveInput: (plan: TripPlan, ctx: CostProviderContext) => LodgingProviderInput,
): CostProvider {
  return function lodgingCostProvider(plan: TripPlan, ctx: CostProviderContext): CostItem {
    return computeLodgingCost(resolveInput(plan, ctx));
  };
}
