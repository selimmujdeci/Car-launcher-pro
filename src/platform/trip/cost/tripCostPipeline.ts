/**
 * Trip Cost Pipeline — Faz A ilk uçtan-uca SAF wiring — TRIP-COST-B1.
 *
 * Dört saf provider'ı (fuel/toll/lodging/parking — A1-A4) gerçek `TripPlan`
 * üzerinden `tripCostAdapters.ts` ile `CostEngine`e bağlar → `CostReport`.
 *
 * HÂLÂ CANLI VERİ YOK: yalnız DI ile verilen doğrulanmış girdiler işlenir.
 * routingService/OSM/Overpass/OBD/store/network/UI ÇAĞRILMAZ — bu dosya
 * yalnız `./providers/*`, `./costEngine`, `./models`, `./tripCostAdapters`
 * içe aktarır.
 *
 * ENTEGRASYON SINIRI (bilinçli — bu PR'da YAPILMADI): gerçek rota modeli
 * `tripApplyEngine.ActiveRoute` (geometry/distanceM/durationS/etaEpochMs) ve
 * `tripPreviewEngine.LegRouteResult`/`OriginalRoute` (geometry/distanceM/
 * durationS) üzerinde yaşıyor. Gelecekteki bir `route→TripPlan` adapter'ı
 * (Faz B) bu tipleri `TripPlan.legs`e (km/saniye) çevirecek — BU PR o
 * dönüşümü, preview/apply/store/UI wiring'ini YAPMAZ; yalnız `TripPlan`
 * ZATEN elde VARSA maliyet hesabına bağlar.
 *
 * `tripPreviewEngine`/`tripApplyEngine`'e DOKUNULMADI.
 */
import type { TripPlan, CostReport } from './models';
import { runCostEngine } from './costEngine';
import type { CostProvider } from './providers/types';
import {
  buildFuelProvider, buildTollProvider, buildLodgingProvider, buildParkingProvider,
  type TripFuelCategoryInput, type TripTollCategoryInput,
  type TripLodgingCategoryInput, type TripParkingCategoryInput,
} from './tripCostAdapters';

/**
 * Tüm maliyet pipeline'ının TEK girdi sözleşmesi. `plan` mevcut `TripPlan`
 * modelidir (`plan.currency` = raporun toplanacağı para birimi). Her kategori
 * OPSİYONELDİR — yok veya `enabled:false` → o kategori raporda hiç YER ALMAZ
 * (eksik kalem ÜRETİLMEZ; kullanıcı bu kategoriyi plana dahil etmemiştir).
 */
export interface TripCostInput {
  plan:      TripPlan;
  fuel?:     TripFuelCategoryInput;
  toll?:     TripTollCategoryInput;
  lodging?:  TripLodgingCategoryInput;
  parking?:  TripParkingCategoryInput;
}

/**
 * Yalnız `enabled:true` kategoriler için `CostProvider[]` üretir — SABİT
 * SIRAYLA: fuel → toll → lodging → parking. Sıra `runCostEngine`in
 * deterministik çağrı garantisiyle (bkz. costEngine.ts) birlikte, raporun
 * `knownItems`/`missingItems` sırasını da öngörülebilir kılar.
 */
export function buildTripCostProviders(input: TripCostInput): CostProvider[] {
  const providers: CostProvider[] = [];
  if (input.fuel?.enabled)    providers.push(buildFuelProvider(input.fuel));
  if (input.toll?.enabled)    providers.push(buildTollProvider(input.toll));
  if (input.lodging?.enabled) providers.push(buildLodgingProvider(input.lodging));
  if (input.parking?.enabled) providers.push(buildParkingProvider(input.parking));
  return providers;
}

/**
 * TEK giriş noktası: `TripCostInput → CostReport`.
 *
 * Akış: (1) wiring-seviyesi girdi doğrulaması (plan.id/currency/legs — SAYISAL/
 * fiyat doğrulaması TEKRARLANMAZ, o provider'ların işidir), (2) yalnız enabled
 * kategoriler için provider listesi, (3) SABİT sırayla `runCostEngine`, (4)
 * `reportCurrency = plan.currency`. HİÇBİR UI/store/network yan etkisi YOK.
 *
 * Provider'ların KENDİ throw'ları (ör. negatif fiyat) buraya SIZMAZ —
 * `runCostEngine`in provider-izolasyon katmanı onları zaten bounded `unknown`
 * kaleme çevirir (bkz. costEngine.ts); bu fonksiyon o davranışı DEĞİŞTİRMEZ,
 * yalnız wiring-seviyesi (plan şekli) hatalarını fırlatır.
 */
export function runTripCostPipeline(input: TripCostInput): CostReport {
  validateTripCostInput(input);
  const providers = buildTripCostProviders(input);
  return runCostEngine(input.plan, providers, input.plan.currency);
}

/** Yalnız WIRING-seviyesi doğrulama — provider'ların sayısal/fiyat
 *  invaryantlarını (bkz. makeCostItem) TEKRARLAMAZ. */
function validateTripCostInput(input: TripCostInput): void {
  const plan = input?.plan;
  if (!plan) {
    throw new RangeError('runTripCostPipeline: plan zorunludur.');
  }
  if (typeof plan.id !== 'string' || plan.id.trim() === '') {
    throw new RangeError('runTripCostPipeline: plan.id boş olamaz.');
  }
  if (typeof plan.currency !== 'string' || plan.currency.trim() === '') {
    throw new RangeError('runTripCostPipeline: plan.currency boş olamaz.');
  }
  if (!Array.isArray(plan.legs)) {
    throw new RangeError('runTripCostPipeline: plan.legs bir dizi olmalı.');
  }
}
