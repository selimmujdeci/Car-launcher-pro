/**
 * Trip Cost AI — Faz A saf çekirdek — genel barrel — TRIP-COST-A1.
 *
 * Yalnız SAF modülleri dışa verir (models/confidenceLedger/costEngine/
 * providers). Wiring katmanı (store/Overpass/BYOK) Faz A'da YOK — bu
 * dosyadan da dışa verilmez.
 */
export type {
  TripPlan,
  TripLeg,
  TravellerComposition,
  VehicleCostProfile,
  CostItem,
  CostItemInput,
  CostItemSource,
  CostItemStatus,
  CostReport,
} from './models';
export { makeCostItem, normalizeCostItem } from './models';

export { buildCostReport } from './confidenceLedger';

export { runCostEngine } from './costEngine';

export type { CostProvider, CostProviderContext } from './providers/types';

export {
  computeFuelCost,
  createFuelCostProvider,
  type FuelCostInput,
  type FuelCostBreakdown,
} from './providers/fuelCostProvider';

export {
  computeTollCost,
  createTollProvider,
  TOLL_NO_SEGMENT_CONFIDENCE,
  type TollSegmentInput,
  type TollSegmentKind,
  type TollPriceEntry,
  type TollProviderInput,
  type TollCostBreakdown,
  type TollMatchedSegmentBreakdown,
  type TollMissingSegmentBreakdown,
  type TollMismatchedCurrencySegmentBreakdown,
} from './providers/tollProvider';
