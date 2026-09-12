/**
 * fuelCostModel — yakıt maliyeti analizi, SAF model (V-16/5).
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · React importu YOK.
 * Girdi yapısaldır (RPC satırları), çıktı saf veridir.
 *
 * ── NEDEN "DÜRÜSTLÜK KATMANI" ÖNCE GELİYOR ─────────────────────────────────
 * Enterprise sayfası "Yakıt maliyet analizi" vaat ediyordu. Prod ölçümü
 * (2026-08-22, 34 yolculuk) neyin gerçekten elde olduğunu gösterdi:
 *
 *   distance_source = MEASURED            ← ölçülmüş
 *   fuel_source     = ESTIMATED  (34/34)  ← ÖLÇÜLMEMİŞ
 *   cost_source     = ESTIMATED  (34/34)
 *   price_source    = DEFAULT_FALLBACK    ← gerçek yakıt fiyatı HİÇ GİRİLMEMİŞ
 *
 * Yani bugün üretilebilecek "maliyet", ölçülmüş mesafe × TAHMİNİ tüketim ×
 * VARSAYILAN fiyattır. Bunu sade bir "₺ 1.234" olarak göstermek, tam olarak
 * bu projede yasak olan sahte kesinliktir.
 *
 * ── KURAL: TOPLAM, EN ZAYIF GİRDİSİ KADAR GÜÇLÜDÜR ─────────────────────────
 * Her toplamın kalitesi, onu oluşturan girdilerin EN ZAYIFINDAN gelir.
 * Ölçülmüş mesafe, tahmini yakıtı "ölçülmüş" yapmaz.
 *
 * ── ÜÇ AYRI "YOK" ──────────────────────────────────────────────────────────
 *  · okunamadı  (RPC/yetki/ağ)          → UNREADABLE
 *  · yolculuk yok                        → NO_TRIPS
 *  · yolculuk var ama maliyet üretilemez → NO_COST_INPUT
 * Üçünü tek bir boş ekrana indirmek, farklı arızaları aynı görüntüye ezerdi.
 */

/**
 * RPC'den gelen, bu modelin İHTİYAÇ DUYDUĞU alanlar (tamamı opsiyonel).
 *
 * ── SAYILAR NEDEN `string | number` ────────────────────────────────────────
 * PostgREST `numeric` kolonlarını **METİN** olarak döndürür (çift duyarlıkta
 * yuvarlama kaybı olmasın diye). Bu alanları yalnız `number` yazmak, üretimde
 * her toplamın sessizce `null` olmasına — yani ekranda her yerde `—`
 * görünmesine — yol açardı. TypeScript bunu yakaladı; kilit de sınıyor.
 */
export type Numeric = number | string | null | undefined;

export interface TripCostRow {
  readonly distance_km?: Numeric;
  readonly distance_source?: string | null;
  readonly fuel_used_l?: Numeric;
  readonly fuel_source?: string | null;
  readonly estimated_cost?: Numeric;
  readonly cost_source?: string | null;
  readonly fuel_unit_price?: Numeric;
  readonly price_source?: string | null;
  readonly started_at?: string | null;
}

/** Bir toplamın kanıt gücü. Sıra ANLAMLIDIR: aşağıdan yukarı zayıflar. */
export type CostQuality = 'MEASURED' | 'ESTIMATED' | 'FALLBACK_PRICE' | 'UNKNOWN';

const QUALITY_RANK: Readonly<Record<CostQuality, number>> = {
  MEASURED: 3, ESTIMATED: 2, FALLBACK_PRICE: 1, UNKNOWN: 0,
};

export const QUALITY_LABEL: Readonly<Record<CostQuality, string>> = {
  MEASURED:       'ÖLÇÜLDÜ',
  ESTIMATED:      'TAHMİN',
  FALLBACK_PRICE: 'VARSAYILAN FİYAT',
  UNKNOWN:        'KAYNAK BİLDİRİLMEDİ',
} as const;

export const QUALITY_NOTE: Readonly<Record<CostQuality, string>> = {
  MEASURED:
    'Değerler araçtan ölçülmüş girdilerden geldi.',
  ESTIMATED:
    'Yakıt tüketimi ÖLÇÜLMEDİ, tahmin edildi. Gerçek tüketim farklı olabilir.',
  FALLBACK_PRICE:
    'Yakıt birim fiyatı GİRİLMEDİ; varsayılan bir fiyat kullanıldı. Tutar gerçek harcamayı YANSITMAZ — fiyatı girin.',
  UNKNOWN:
    'Girdilerin kaynağı bildirilmedi. Bu tutara karar dayandırılmamalıdır.',
} as const;

/** Bir satırın kalitesi — EN ZAYIF girdiye eşitlenir. */
export function rowQuality(r: TripCostRow): CostQuality {
  const price = (r.price_source ?? '').toUpperCase();
  const fuel = (r.fuel_source ?? '').toUpperCase();
  const cost = (r.cost_source ?? '').toUpperCase();

  /* Varsayılan fiyat, her şeyin üstünde bir zayıflıktır: tüketim ölçülmüş
     olsa bile tutar uydurma bir fiyattan çıkar. */
  if (price.includes('FALLBACK') || price.includes('DEFAULT')) return 'FALLBACK_PRICE';
  if (!fuel && !cost) return 'UNKNOWN';
  if (fuel === 'MEASURED' && cost === 'MEASURED') return 'MEASURED';
  if (fuel === 'ESTIMATED' || cost === 'ESTIMATED') return 'ESTIMATED';
  return 'UNKNOWN';
}

export type CostVerdict = 'UNREADABLE' | 'NO_TRIPS' | 'NO_COST_INPUT' | 'OK';

export const COST_VERDICT_LABEL: Readonly<Record<CostVerdict, string>> = {
  UNREADABLE:    'OKUNAMADI',
  NO_TRIPS:      'YOLCULUK YOK',
  NO_COST_INPUT: 'MALİYET ÜRETİLEMEZ — girdi yok',
  OK:            'HESAPLANDI',
} as const;

export interface FuelCostSummary {
  readonly verdict: CostVerdict;
  /** İncelenen yolculuk sayısı. */
  readonly tripCount: number;
  /** Maliyete KATKI VEREN yolculuk sayısı (tutarı olanlar). */
  readonly costedTripCount: number;
  /** Ölçülmüş toplam mesafe (km); yoksa `null`. */
  readonly distanceKm: number | null;
  /** Toplam yakıt (L); yoksa `null` — SAHTE 0 ÜRETİLMEZ. */
  readonly litres: number | null;
  /** Toplam tutar; yoksa `null`. */
  readonly cost: number | null;
  /** 100 km başına tutar; mesafe yoksa `null`. */
  readonly costPer100Km: number | null;
  /** 100 km başına litre; mesafe yoksa `null`. */
  readonly litresPer100Km: number | null;
  /** Toplamın kanıt gücü — EN ZAYIF girdiden gelir. */
  readonly quality: CostQuality;
  /** Kalite dağılımı (kaç yolculuk hangi güçte). */
  readonly qualityMix: Readonly<Record<CostQuality, number>>;
  /** Kullanılan birim fiyatlar (tekil) — birden çoksa dönem içinde değişmiş. */
  readonly unitPrices: readonly number[];
}

const EMPTY_MIX: Readonly<Record<CostQuality, number>> = {
  MEASURED: 0, ESTIMATED: 0, FALLBACK_PRICE: 0, UNKNOWN: 0,
};

/**
 * Sayıya çevirir; çevrilemiyorsa `null` (sahte 0 ÜRETİLMEZ).
 *
 * Metin de kabul edilir çünkü PostgREST `numeric`i metin döndürür. Boş metin
 * `Number('')  === 0` tuzağına düşmemek için AYRICA elenir.
 */
function finite(v: Numeric): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Yolculuk satırlarından maliyet özeti.
 *
 * @param rows `null` = OKUNAMADI ("yolculuk yok" DEĞİL).
 */
export function summarizeFuelCost(rows: readonly TripCostRow[] | null): FuelCostSummary {
  const base = {
    tripCount: 0, costedTripCount: 0,
    distanceKm: null, litres: null, cost: null,
    costPer100Km: null, litresPer100Km: null,
    quality: 'UNKNOWN' as CostQuality, qualityMix: EMPTY_MIX, unitPrices: [],
  };

  if (rows === null) return { ...base, verdict: 'UNREADABLE' };
  if (rows.length === 0) return { ...base, verdict: 'NO_TRIPS' };

  const mix: Record<CostQuality, number> = { ...EMPTY_MIX };
  const prices = new Set<number>();

  let dist = 0, distSeen = false;
  let lit = 0, litSeen = false;
  let cost = 0, costSeen = false;
  let costed = 0;
  let weakest = QUALITY_RANK.MEASURED;

  for (const r of rows) {
    const d = finite(r.distance_km);
    if (d !== null) { dist += d; distSeen = true; }

    const l = finite(r.fuel_used_l);
    if (l !== null) { lit += l; litSeen = true; }

    const c = finite(r.estimated_cost);
    if (c !== null) { cost += c; costSeen = true; costed += 1; }

    const p = finite(r.fuel_unit_price);
    if (p !== null) prices.add(p);

    /* Kalite YALNIZ maliyete katkı veren satırlardan sayılır: tutarı olmayan
       bir yolculuk toplamı zayıflatmaz, çünkü toplama HİÇ girmemiştir. */
    if (c !== null) {
      const q = rowQuality(r);
      mix[q] += 1;
      weakest = Math.min(weakest, QUALITY_RANK[q]);
    }
  }

  const distanceKm = distSeen ? dist : null;
  const litres = litSeen ? lit : null;
  const total = costSeen ? cost : null;

  if (total === null) {
    return {
      ...base, verdict: 'NO_COST_INPUT',
      tripCount: rows.length, distanceKm,
      litres, qualityMix: mix,
      unitPrices: Array.from(prices).sort((a, b) => a - b),
    };
  }

  const quality = (Object.keys(QUALITY_RANK) as CostQuality[])
    .find((k) => QUALITY_RANK[k] === weakest) ?? 'UNKNOWN';

  return {
    verdict: 'OK',
    tripCount: rows.length,
    costedTripCount: costed,
    distanceKm,
    litres,
    cost: total,
    /* Mesafe yoksa oran ÜRETİLMEZ — sıfıra bölüp `Infinity` göstermek ya da
       0 yazmak, ikisi de yalan olurdu. */
    costPer100Km: distanceKm !== null && distanceKm > 0 ? (total / distanceKm) * 100 : null,
    litresPer100Km: distanceKm !== null && distanceKm > 0 && litres !== null
      ? (litres / distanceKm) * 100 : null,
    quality,
    qualityMix: mix,
    unitPrices: Array.from(prices).sort((a, b) => a - b),
  };
}

/**
 * Özetin altına yazılacak dürüstlük cümlesi.
 *
 * Tutarın nasıl okunması gerektiğini SÖYLER; kullanıcı rozeti kaçırsa bile
 * cümleyi kaçırmaz.
 */
export function costDisclaimer(s: FuelCostSummary): string {
  if (s.verdict === 'UNREADABLE') {
    return 'Yolculuk verisi OKUNAMADI. Bu, "yolculuk yok" anlamına GELMEZ.';
  }
  if (s.verdict === 'NO_TRIPS') {
    return 'Bu dönemde kayıtlı yolculuk yok (ölçülmüş bir YOK).';
  }
  if (s.verdict === 'NO_COST_INPUT') {
    return 'Yolculuklar var ama tutar üretilemiyor: yakıt ya da fiyat girdisi yok. Sahte bir tutar gösterilmez.';
  }
  const extra = s.unitPrices.length > 1
    ? ` Dönem içinde ${s.unitPrices.length} farklı birim fiyat kullanıldı.`
    : '';
  return `${QUALITY_NOTE[s.quality]}${extra}`;
}
