/**
 * FuelCostProvider — Faz A saf yakıt maliyet hesabı — TRIP-COST-A1.
 *
 * Formül: liters = Σ(distanceKm) × consumptionL100Km / 100
 *         fuelCost = liters × pricePerLiter
 * YUVARLAMA YOK — çekirdekte tam hassasiyet korunur (gösterim katmanı yuvarlar).
 *
 * OBD/araç-profili ÖNCELİKLENDİRMESİ BU DOSYAYA GÖMÜLMEDİ: `computeFuelCost`
 * yalnız kendisine VERİLEN doğrulanmış `consumptionL100Km`/`pricePerLiter`
 * değerlerini hesaplar. "OBD gerçek > profil > sınıf varsayılanı" önceliği
 * wiring katmanının sorumluluğudur (Faz A'da YOK — bkz. mimari doküman §1).
 *
 * Kurallar:
 *   - `distanceKm < 0` → geçersiz girdi, THROW (CostEngine bunu yakalayıp
 *     provider'ı izole eder — bkz. costEngine.ts).
 *   - `pricePerLiter < 0` → geçersiz girdi, THROW.
 *   - `consumptionL100Km` yok/`<=0`/finite değil → `unknown` (value:null,
 *     confidence:0) — bu bir HATA DEĞİL, "veri yok" durumudur.
 *   - `pricePerLiter` yok (`null`/`undefined`) → `unknown`.
 *   - `source:'calculated'` varsayılan; çağıran `source:'user'` gibi bir
 *     girdi kaynağı METADATA'sı geçirirse KORUNUR (provider kendi kaynağını
 *     asla 'calculated'a zorlamaz — girdinin gerçek kökenini yansıtır).
 */
import type { CostItem, CostItemSource } from '../models';
import { makeCostItem } from '../models';
import type { TripPlan } from '../models';
import type { CostProvider, CostProviderContext } from './types';

/** `computeFuelCost` girdisi — TripPlan'dan BAĞIMSIZ, saf ilkel değerler. */
export interface FuelCostInput {
  /** Yalnız `distanceKm` okunur — tam `TripLeg` şart değil (test/adapter kolaylığı). */
  legs:                readonly { distanceKm: number }[];
  consumptionL100Km:   number | null | undefined;
  pricePerLiter:       number | null | undefined;
  currency:            string;
  /** Girdinin gerçek kökeni — verilmezse `'calculated'`. */
  source?:             CostItemSource;
  /** Bilinen/hesaplanan kalem için confidence — verilmezse `0.7`
   *  (`source:'user'` ise `0.9`). `unknown` durumunda HER ZAMAN `0`'a
   *  normalize edilir (bkz. `makeCostItem`) — burada verilen değer YOK SAYILIR. */
  confidence?:         number;
  editable?:           boolean;
}

/** Şeffaflık kırılımı — mesafe×tüketim×fiyat hesabının nasıl türetildiği. */
export interface FuelCostBreakdown {
  totalDistanceKm:    number;
  consumptionL100Km:  number | null;
  estimatedLiters:    number | null;
  pricePerLiter:      number | null;
  legCount:           number;
  [key: string]: unknown;
}

/**
 * SAF yakıt maliyeti hesabı — TripPlan/ctx'ten BAĞIMSIZ. `createFuelCostProvider`
 * bu fonksiyonu bir `CostProvider`e sarar (bkz. aşağı).
 */
export function computeFuelCost(input: FuelCostInput): CostItem {
  const legs = input.legs ?? [];

  let totalDistanceKm = 0;
  for (const leg of legs) {
    if (!Number.isFinite(leg.distanceKm) || leg.distanceKm < 0) {
      throw new RangeError(
        `computeFuelCost: geçersiz mesafe (${leg.distanceKm}) — negatif olamaz veya sonlu değil.`,
      );
    }
    totalDistanceKm += leg.distanceKm;
  }

  const price = input.pricePerLiter;
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    throw new RangeError(`computeFuelCost: geçersiz birim fiyat (${price}) — negatif olamaz veya sonlu değil.`);
  }

  const consumption = input.consumptionL100Km;
  const legCount     = legs.length;
  const source       = input.source ?? 'calculated';
  const editable     = input.editable ?? true;

  const consumptionUnknown = consumption == null || !Number.isFinite(consumption) || consumption <= 0;
  const priceUnknown       = price == null;

  if (consumptionUnknown || priceUnknown) {
    const breakdown: FuelCostBreakdown = {
      totalDistanceKm,
      consumptionL100Km: consumptionUnknown ? null : (consumption as number),
      estimatedLiters:   null,
      pricePerLiter:      priceUnknown ? null : (price as number),
      legCount,
    };
    return makeCostItem({
      id:         'fuel',
      category:   'fuel',
      value:      null,
      currency:   input.currency,
      source:     'unknown',
      confidence: 0,
      editable,
      status:     'unknown',
      breakdown,
      noteKey:    consumptionUnknown ? 'fuel_consumption_unknown' : 'fuel_price_unknown',
    });
  }

  const c = consumption as number;
  const p = price as number;
  const estimatedLiters = (totalDistanceKm * c) / 100; // YUVARLAMA YOK
  const value            = estimatedLiters * p;         // YUVARLAMA YOK

  const breakdown: FuelCostBreakdown = {
    totalDistanceKm,
    consumptionL100Km: c,
    estimatedLiters,
    pricePerLiter: p,
    legCount,
  };

  return makeCostItem({
    id:         'fuel',
    category:   'fuel',
    value,
    currency:   input.currency,
    source,
    confidence: input.confidence ?? (source === 'user' ? 0.9 : 0.7),
    editable,
    status:     'known',
    breakdown,
  });
}

/**
 * `computeFuelCost`i bir `CostProvider`e sarar — CostEngine'e DI ile
 * verilebilsin diye. `resolveInput` çağıranın TripPlan'dan hangi
 * `consumptionL100Km`/`pricePerLiter` değerini kullanacağına karar verir —
 * bu KARAR wiring katmanının işidir, burada VARSAYILAN/UYDURULMUŞ değer YOK.
 */
export function createFuelCostProvider(
  resolveInput: (plan: TripPlan, ctx: CostProviderContext) => FuelCostInput,
): CostProvider {
  return function fuelCostProvider(plan: TripPlan, ctx: CostProviderContext): CostItem {
    return computeFuelCost(resolveInput(plan, ctx));
  };
}
