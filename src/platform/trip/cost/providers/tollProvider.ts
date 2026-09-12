/**
 * TollProvider — Faz A saf toll (ücretli geçiş) maliyet hesabı — TRIP-COST-A2.
 *
 * `computeFuelCost`/`createFuelCostProvider` seam'i BİREBİR izlenir (bkz.
 * fuelCostProvider.ts): SAF hesap fonksiyonu + `CostProvider`e saran ince
 * adaptör. routingService/OSM/gerçek toll DB'ye BAĞLANMAZ — yalnız kendisine
 * VERİLEN doğrulanmış segment listesi + kullanıcı ücret tablosunu (DI ile)
 * işler. `routingService.detectToll` (yalnız boolean sezgisel) DEĞİŞTİRİLMEDİ.
 *
 * ÜÇ DURUM (mimari doküman §4-5 ile tutarlı, "kaynağı olmayan fiyat UYDURULMAZ"):
 *   1. Hiç ücretli segment yok        → value=0, status='known' (kesin gerçek).
 *   2. TÜM ücretli segmentlerin fiyatı var VE para birimi tutarlı
 *                                      → toplanır, status='known'|'stale'.
 *   3. En az bir ücretli segmentin fiyatı YOK VEYA para birimi tutarsız
 *                                      → value=null, status='unknown'
 *      (PARÇALI toplam `breakdown.knownSubtotal`'da görünür AMA ana `value`'ya
 *      ASLA sızmaz — sahte "tam ücret" yasak).
 *
 * Kurallar:
 *   - Eşleşme `segment.key === priceEntry.segmentKey` ile yapılır.
 *   - `hasToll:false` segment YOK SAYILIR (ücretli sayılmaz).
 *   - AYNI `segment.id` birden çok kez geçebilir (ör. gidiş-dönüşte aynı
 *     köprüden iki geçiş) — dedup YAPILMAZ, İKİSİ DE ayrı ayrı fiyatlanıp
 *     toplanır (bkz. testler).
 *   - `priceEntries[]` içinde AYNI `segmentKey` birden fazla kez geçerse
 *     belirsiz (ambiguous) fiyat tablosu — THROW (CostEngine izole eder).
 *   - Negatif/NaN/Infinity fiyat VEYA 0..1 dışı confidence → THROW.
 *   - Fiyat `0` GEÇERLİDİR (ücretsiz/istisna segment, `source:'user'` →
 *     known, unknown DEĞİL).
 *   - Para birimi OTOMATİK ÇEVRİLMEZ — `reportCurrency`den farklı bir
 *     eşleşen fiyat varsa fail-closed `unknown` (döviz UYDURMA).
 */
import type { CostItem, CostItemSource } from '../models';
import { makeCostItem } from '../models';
import type { TripPlan } from '../models';
import type { CostProvider, CostProviderContext } from './types';

/* ── Girdi modelleri ─────────────────────────────────────────────────────── */

export type TollSegmentKind = 'motorway' | 'bridge' | 'tunnel' | 'ferry' | 'unknown';

/** Rota üzerinde tespit edilmiş TEK bir segment (ücretli olsun/olmasın).
 *  `hasToll` dışındaki alanlar yalnız şeffaflık/teşhis için taşınır — Faz A
 *  hesabını ETKİLEMEZ. Routing/geocoding YAPILMAZ; bu veri DIŞARIDAN gelir. */
export interface TollSegmentInput {
  /** Bu GEÇİŞİN kimliği — AYNI fiziksel segment iki kez geçilirse (gidiş-dönüş)
   *  İKİ AYRI `id` ile iki kez verilir (dedup YOK, ikisi de sayılır). */
  id:           string;
  /** Fiyat eşleşmesi İÇİN kullanılan anahtar — `TollPriceEntry.segmentKey` ile eşleşir. */
  key:          string;
  hasToll:      boolean;
  kind?:        TollSegmentKind;
  label?:       string;
  countryCode?: string;
}

/** Kullanıcı ücret tablosundan (veya cache'ten) TEK bir fiyat kaydı. */
export interface TollPriceEntry {
  segmentKey:  string;
  value:       number;
  currency:    string;
  source:      CostItemSource;
  confidence:  number;
  /** Faz A'da TTL hesaplaması YAPILMAZ — `stale` DI ile açıkça belirtilir. */
  updatedAt?:  number;
  stale?:      boolean;
}

/** `computeTollCost` girdisi — TripPlan'dan BAĞIMSIZ, saf ilkel değerler. */
export interface TollProviderInput {
  segments:        readonly TollSegmentInput[];
  priceEntries:    readonly TollPriceEntry[];
  reportCurrency:  string;
  editable?:       boolean; // verilmezse true (FuelCostInput ile tutarlı varsayılan)
}

/* ── Şeffaflık kırılımı ──────────────────────────────────────────────────── */

export interface TollMatchedSegmentBreakdown {
  segmentId:   string;
  segmentKey:  string;
  value:       number;
  currency:    string;
  source:      CostItemSource;
  confidence:  number;
  stale:       boolean;
  kind?:       TollSegmentKind;
  label?:      string;
}

export interface TollMissingSegmentBreakdown {
  segmentId:   string;
  segmentKey:  string;
  kind?:       TollSegmentKind;
  label?:      string;
}

export interface TollMismatchedCurrencySegmentBreakdown {
  segmentId:        string;
  segmentKey:       string;
  currency:         string;
  expectedCurrency: string;
}

export interface TollCostBreakdown {
  tollSegmentCount:             number;
  matchedCount:                 number;
  missingCount:                 number;
  /** Yalnız DURUM 2/3'te dolu — DURUM 3'te PARÇALI, ana `value`'ya SIZMAZ. */
  knownSubtotal?:                number;
  matchedSegments?:              TollMatchedSegmentBreakdown[];
  missingSegments?:              TollMissingSegmentBreakdown[];
  mismatchedCurrencySegments?:   TollMismatchedCurrencySegmentBreakdown[];
  [key: string]: unknown;
}

/**
 * Hiç ücretli segment yokken kullanılan sabit confidence — "toll yok" bilgisi
 * KESİN bir gerçektir (rota verisinden doğrudan türetilir), bu yüzden en
 * yüksek güvenle işaretlenir. Test tarafından kilitlenmiştir — değiştirmek
 * isteyen birinin bilinçli bir karar vermesini zorlar.
 */
export const TOLL_NO_SEGMENT_CONFIDENCE = 1;

/* ── Ana hesap ───────────────────────────────────────────────────────────── */

/**
 * SAF toll maliyeti hesabı — TripPlan/ctx'ten BAĞIMSIZ. `createTollProvider`
 * bu fonksiyonu bir `CostProvider`e sarar (bkz. aşağı).
 */
export function computeTollCost(input: TollProviderInput): CostItem {
  const segments      = input.segments ?? [];
  const priceEntries  = input.priceEntries ?? [];
  const reportCurrency = input.reportCurrency;
  const editable       = input.editable ?? true;

  // 1) Girdi tablosu doğrulama — TÜM priceEntries (kullanılıp kullanılmadığına
  //    bakılmaksızın, fuel'in tüm leg'leri doğrulaması gibi): geçersiz fiyat/
  //    confidence VEYA belirsiz (duplicate) segmentKey → THROW.
  const seenKeys = new Set<string>();
  for (const entry of priceEntries) {
    if (!Number.isFinite(entry.value) || entry.value < 0) {
      throw new RangeError(
        `computeTollCost: geçersiz toll fiyatı (${entry.value}) — segmentKey '${entry.segmentKey}' için negatif olamaz veya sonlu değil.`,
      );
    }
    if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
      throw new RangeError(
        `computeTollCost: geçersiz confidence (${entry.confidence}) — segmentKey '${entry.segmentKey}' için 0..1 aralığında olmalı.`,
      );
    }
    if (seenKeys.has(entry.segmentKey)) {
      throw new RangeError(
        `computeTollCost: priceEntries içinde AYNI segmentKey ('${entry.segmentKey}') birden fazla kez geçiyor — belirsiz (ambiguous) fiyat tablosu.`,
      );
    }
    seenKeys.add(entry.segmentKey);
  }

  const priceMap = new Map<string, TollPriceEntry>();
  for (const entry of priceEntries) priceMap.set(entry.segmentKey, entry);

  // 2) Ücretli segmentler — hasToll=false YOK SAYILIR. Dedup YOK: aynı id
  //    iki kez geçerse iki gerçek geçiş olarak İKİSİ DE işlenir.
  const tollSegments    = segments.filter((s) => s.hasToll === true);
  const tollSegmentCount = tollSegments.length;

  // ── DURUM 1 — hiç ücretli segment yok ────────────────────────────────
  if (tollSegmentCount === 0) {
    const breakdown: TollCostBreakdown = { tollSegmentCount: 0, matchedCount: 0, missingCount: 0 };
    return makeCostItem({
      id:         'toll',
      category:   'toll',
      value:      0,
      currency:   reportCurrency,
      source:     'calculated',
      confidence: TOLL_NO_SEGMENT_CONFIDENCE,
      editable,
      status:     'known',
      breakdown,
    });
  }

  const matched: TollMatchedSegmentBreakdown[] = [];
  const missing: TollMissingSegmentBreakdown[] = [];

  for (const seg of tollSegments) {
    const entry = priceMap.get(seg.key);
    if (!entry) {
      missing.push({ segmentId: seg.id, segmentKey: seg.key, kind: seg.kind, label: seg.label });
      continue;
    }
    matched.push({
      segmentId:  seg.id,
      segmentKey: seg.key,
      value:      entry.value,
      currency:   entry.currency,
      source:     entry.source,
      confidence: entry.confidence,
      stale:      entry.stale === true,
      kind:       seg.kind,
      label:      seg.label,
    });
  }

  const matchedCount = matched.length;
  const missingCount = missing.length;

  // ── DURUM 3a — en az bir ücretli segmentin fiyatı YOK ────────────────
  // Eksik fiyat + stale birlikte olsa bile UNKNOWN ÖNCELİKLİDİR (missing
  // kontrolü currency/stale kontrolünden ÖNCE yapılır).
  if (missingCount > 0) {
    const knownSubtotal = matched.reduce((sum, m) => sum + m.value, 0); // PARÇALI — ana value'ya SIZMAZ
    const breakdown: TollCostBreakdown = {
      tollSegmentCount,
      matchedCount,
      missingCount,
      knownSubtotal,
      matchedSegments: matched,
      missingSegments: missing,
    };
    return makeCostItem({
      id:         'toll',
      category:   'toll',
      value:      null,
      currency:   reportCurrency,
      source:     'unknown',
      confidence: 0,
      editable,
      status:     'unknown',
      breakdown,
      noteKey:    'toll_price_required',
    });
  }

  // ── DURUM 3b — tüm fiyatlar var AMA para birimi tutarsız ─────────────
  // Döviz OTOMATİK ÇEVRİLMEZ; ledger'ın mixed-currency fail-closed
  // davranışıyla aynı ruh — provider seviyesinde erken yakalanır.
  const mismatched = matched.filter((m) => m.currency !== reportCurrency);
  if (mismatched.length > 0) {
    const breakdown: TollCostBreakdown = {
      tollSegmentCount,
      matchedCount,
      missingCount: 0,
      matchedSegments: matched,
      mismatchedCurrencySegments: mismatched.map((m) => ({
        segmentId:        m.segmentId,
        segmentKey:       m.segmentKey,
        currency:         m.currency,
        expectedCurrency: reportCurrency,
      })),
    };
    return makeCostItem({
      id:         'toll',
      category:   'toll',
      value:      null,
      currency:   reportCurrency,
      source:     'unknown',
      confidence: 0,
      editable,
      status:     'unknown',
      breakdown,
      noteKey:    'toll_currency_mismatch',
    });
  }

  // ── DURUM 2 — tüm ücretli segmentlerin fiyatı var, para birimi tutarlı ──
  const knownSubtotal   = matched.reduce((sum, m) => sum + m.value, 0);
  const anyStale         = matched.some((m) => m.stale);
  const distinctSources  = new Set(matched.map((m) => m.source));
  const source: CostItemSource = distinctSources.size === 1 ? matched[0].source : 'calculated';

  // Fiyat-ağırlıklı confidence (confidenceLedger.weightedConfidence ile AYNI
  // num/den deseni). Σvalue=0 ise (tüm eşleşen fiyatlar 0) bölme YAPILMAZ —
  // deterministik geri düşüş: eşleşen confidence'ların BASİT ortalaması
  // (matchedCount>0 bu daldan garanti — sıfıra bölme riski YOK).
  let num = 0;
  let den = 0;
  for (const m of matched) { num += m.value * m.confidence; den += m.value; }
  const confidence = den > 0
    ? num / den
    : matched.reduce((sum, m) => sum + m.confidence, 0) / matchedCount;

  const breakdown: TollCostBreakdown = {
    tollSegmentCount,
    matchedCount,
    missingCount: 0,
    matchedSegments: matched,
    knownSubtotal,
  };

  return makeCostItem({
    id:         'toll',
    category:   'toll',
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
 * `computeTollCost`i bir `CostProvider`e sarar — CostEngine'e DI ile
 * verilebilsin diye. `resolveInput` çağıranın TripPlan'dan hangi segment/
 * fiyat tablosunu kullanacağına karar verir (routing/OSM/kullanıcı tablosu
 * bağlama işi wiring katmanının sorumluluğudur — Faz A'da YOK).
 */
export function createTollProvider(
  resolveInput: (plan: TripPlan, ctx: CostProviderContext) => TollProviderInput,
): CostProvider {
  return function tollCostProvider(plan: TripPlan, ctx: CostProviderContext): CostItem {
    return computeTollCost(resolveInput(plan, ctx));
  };
}
