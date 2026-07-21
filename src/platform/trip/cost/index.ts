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

export {
  computeLodgingCost,
  createLodgingProvider,
  LODGING_NO_STAY_CONFIDENCE,
  type LodgingKind,
  type LodgingPricingUnit,
  type LodgingStayInput,
  type LodgingPriceEntry,
  type LodgingProviderInput,
  type LodgingCostBreakdown,
  type LodgingMatchedStayBreakdown,
  type LodgingMissingStayBreakdown,
  type LodgingUnsupportedPricingUnitStayBreakdown,
  type LodgingMismatchedCurrencyStayBreakdown,
} from './providers/lodgingProvider';

export {
  computeParkingCost,
  createParkingProvider,
  PARKING_NO_STOP_CONFIDENCE,
  type ParkingStopKind,
  type ParkingPricingUnit,
  type ParkingStopInput,
  type ParkingPriceEntry,
  type ParkingProviderInput,
  type ParkingCostBreakdown,
  type ParkingMatchedStopBreakdown,
  type ParkingMissingPriceStopBreakdown,
  type ParkingMissingDurationStopBreakdown,
  type ParkingMismatchedCurrencyStopBreakdown,
} from './providers/parkingProvider';

export {
  buildFuelProvider,
  buildTollProvider,
  buildLodgingProvider,
  buildParkingProvider,
  type TripFuelCategoryInput,
  type TripTollCategoryInput,
  type TripLodgingCategoryInput,
  type TripParkingCategoryInput,
} from './tripCostAdapters';

export {
  buildTripCostProviders,
  runTripCostPipeline,
  type TripCostInput,
} from './tripCostPipeline';

export {
  buildTripPlanFromActiveRoute,
  buildTripPlanFromPreviewLegs,
  type TripPlanMetadata,
} from './tripCostRouteAdapter';
