/**
 * Trip Cost Adapters — Faz A SAF biçim dönüşümü — TRIP-COST-B1.
 *
 * Bu dosya HESAPLAMA YAPMAZ. Her `buildXxxProvider` yalnızca kategoriye özgü
 * (DI ile verilen, doğrulanmış) girdiyi ilgili saf provider'ın
 * `createXxxProvider(resolveInput)` seam'ine (bkz. fuelCostProvider.ts /
 * tollProvider.ts / lodgingProvider.ts / parkingProvider.ts) uygun şekle
 * dönüştürür. Gerçek matematik TAMAMEN o provider'ların içindedir — burada
 * TEKRARLANMAZ.
 *
 * SAFLIK: bu dosya yalnız `./providers/*` içe aktarır. UI/store/network/
 * routingService/OBD importu YOK. OBD/araç-profili fallback YOK — yalnız
 * kendisine verilen `fuel.consumptionL100Km`/`fuel.pricePerLiter` kullanılır.
 *
 * routingService ÇAĞRILMAZ — toll segmentleri de tıpkı fuel/lodging/parking
 * gibi DI ile (`toll.segments`/`toll.priceEntries`) dışarıdan gelir; bu
 * dosyada rota/OSM sorgusu YOK.
 */
import type { CostItemSource } from './models';
import type { TripPlan } from './models';
import type { CostProvider, CostProviderContext } from './providers/types';
import { createFuelCostProvider } from './providers/fuelCostProvider';
import { createTollProvider, type TollSegmentInput, type TollPriceEntry } from './providers/tollProvider';
import { createLodgingProvider, type LodgingStayInput, type LodgingPriceEntry } from './providers/lodgingProvider';
import { createParkingProvider, type ParkingStopInput, type ParkingPriceEntry } from './providers/parkingProvider';

/* ── Kategori girdi sözleşmeleri (TripCostInput'un parçaları) ───────────── */

/** Fuel kategorisi — `plan.legs` otomatik okunur; tüketim/fiyat/kaynak
 *  YALNIZ bu nesneden gelir (OBD/profil fallback YOK). */
export interface TripFuelCategoryInput {
  enabled:             boolean;
  consumptionL100Km?:  number;
  pricePerLiter?:      number;
  source?:             CostItemSource;
  confidence?:         number;
}

export interface TripTollCategoryInput {
  enabled:       boolean;
  segments:      readonly TollSegmentInput[];
  priceEntries:  readonly TollPriceEntry[];
}

export interface TripLodgingCategoryInput {
  enabled:       boolean;
  stays:         readonly LodgingStayInput[];
  priceEntries:  readonly LodgingPriceEntry[];
}

export interface TripParkingCategoryInput {
  enabled:       boolean;
  stops:         readonly ParkingStopInput[];
  priceEntries:  readonly ParkingPriceEntry[];
}

/* ── Adapter'lar — yalnız biçim dönüşümü ─────────────────────────────────── */

/**
 * Fuel adaptörü: `plan.legs` (TripPlan'dan) + `fuel.*` (kategoriden) →
 * `FuelCostInput`. `currency` her zaman `ctx.reportCurrency` (pipeline'da
 * `plan.currency`'ye eşitlenir). Tüketim/fiyat kaynağı yalnız `fuel`
 * nesnesinden — OBD/araç-profili SORGULANMAZ.
 */
export function buildFuelProvider(fuel: TripFuelCategoryInput): CostProvider {
  return createFuelCostProvider((plan: TripPlan, ctx: CostProviderContext) => ({
    legs:               plan.legs,
    consumptionL100Km:  fuel.consumptionL100Km,
    pricePerLiter:      fuel.pricePerLiter,
    currency:           ctx.reportCurrency,
    source:             fuel.source,
    confidence:         fuel.confidence,
  }));
}

/**
 * Toll adaptörü: `toll.segments`/`toll.priceEntries` (dışarıdan DI) +
 * `ctx.reportCurrency` → `TollProviderInput`. `routingService.detectToll`
 * ÇAĞRILMAZ — segment listesi tamamen dışarıdan gelir.
 */
export function buildTollProvider(toll: TripTollCategoryInput): CostProvider {
  return createTollProvider((_plan: TripPlan, ctx: CostProviderContext) => ({
    segments:        toll.segments,
    priceEntries:    toll.priceEntries,
    reportCurrency:  ctx.reportCurrency,
  }));
}

/**
 * Lodging adaptörü: `lodging.stays`/`lodging.priceEntries` (dışarıdan DI) +
 * `ctx.reportCurrency` → `LodgingProviderInput`. OSM/otel API'si ÇAĞRILMAZ.
 */
export function buildLodgingProvider(lodging: TripLodgingCategoryInput): CostProvider {
  return createLodgingProvider((_plan: TripPlan, ctx: CostProviderContext) => ({
    stays:            lodging.stays,
    priceEntries:     lodging.priceEntries,
    reportCurrency:   ctx.reportCurrency,
  }));
}

/**
 * Parking adaptörü: `parking.stops`/`parking.priceEntries` (dışarıdan DI) +
 * `ctx.reportCurrency` → `ParkingProviderInput`. OSM/otopark API'si ÇAĞRILMAZ.
 */
export function buildParkingProvider(parking: TripParkingCategoryInput): CostProvider {
  return createParkingProvider((_plan: TripPlan, ctx: CostProviderContext) => ({
    stops:            parking.stops,
    priceEntries:     parking.priceEntries,
    reportCurrency:   ctx.reportCurrency,
  }));
}
