/**
 * Trip Cost Route Adapter — SAF gerçek-rota → TripPlan dönüşümü — TRIP-COST-B2.
 *
 * Gerçek rota verisi iki yerde yaşıyor (kendi okumamla doğrulandı):
 *   - `tripApplyEngine.ActiveRoute`      { geometry, distanceM, durationS, etaEpochMs, meta? }
 *   - `tripPreviewEngine.LegRouteResult`/`OriginalRoute` { geometry, distanceM, durationS }
 * İkisi de origin/destination/id TAŞIMAZ (yalnız geometri+mesafe+süre). Maliyet
 * modelinin `TripLeg { id, distanceKm, durationSeconds?, origin, destination }`
 * ise geometry/ETA TAŞIMAZ — bu yüzden dönüşüm KAYIPLI ve TEK YÖNLÜDÜR: yalnız
 * maliyet hesabına gereken alanlar (mesafe/süre) aktarılır; origin/destination/
 * id/nights/travellers/vehicleProfile rota modelinde HİÇ YOK — bunlar
 * `TripPlanMetadata` ile DIŞARIDAN, ZORUNLU olarak verilir (uydurma YASAK).
 *
 * Bu dosya SAF: yalnız `./models` (type-only) + `../tripApplyEngine` (type-only)
 * + `../tripPreviewEngine` (type-only) içe aktarır. `import type` kullanıldığı
 * için bu iki modülün ÇALIŞMA ZAMANI kodu hiç yüklenmez/çalışmaz — yalnız tip
 * bilgisi derleme zamanında kullanılır. `tripApplyEngine`/`tripPreviewEngine`e
 * ÇAĞRI YOK, `tripCostPipeline`e OTOMATİK WIRING YOK (yalnız dönüşüm sözleşmesi).
 *
 * Model export DEĞİŞİKLİĞİ GEREKMEDİ: `ActiveRoute`/`LegRouteResult` zaten
 * `export interface` (tripApplyEngine.ts:27, tripPreviewEngine.ts:28) —
 * bu dosya onları OLDUĞU GİBİ type-only import eder, yeniden tanımlamaz
 * (duplicate-type YASAK), `any`/geniş-cast YOK.
 */
import type { TripPlan, TripLeg, TravellerComposition, VehicleCostProfile } from './models';
import type { ActiveRoute } from '../tripApplyEngine';
import type { LegRouteResult } from '../tripPreviewEngine';

/**
 * `TripPlan`da GERÇEKTEN var olan ama rota modelinde HİÇ olmayan alanlar.
 * Hepsi ZORUNLU (opsiyonel `legEndpoints` hariç) — adapter bunları UYDURMAZ,
 * çağıran dışarıdan sağlamak ZORUNDADIR.
 */
export interface TripPlanMetadata {
  id:              string;
  currency:        string;
  origin:          string;
  destination:     string;
  nights:          number;
  travellers:      TravellerComposition;
  vehicleProfile:  VehicleCostProfile;
  /**
   * Çoklu-leg (preview) dönüşümünde HER bacağın kendi origin/destination'ını
   * belirler: `length === legs.length + 1` ([origin, ...ara-duraklar...,
   * destination]); `leg[i] = { origin: legEndpoints[i], destination: legEndpoints[i+1] }`.
   * Verilmezse VEYA uzunluk uyuşmazsa `buildTripPlanFromPreviewLegs` FAIL-CLOSED
   * THROW eder (per-leg isim UYDURULMAZ). Tek-leg (`buildTripPlanFromActiveRoute`)
   * bu alanı hiç OKUMAZ — `metadata.origin`/`metadata.destination` kullanılır.
   */
  legEndpoints?:   readonly string[];
}

/* ── Doğrulama — adapter seviyesi, deterministik throw (provider-style
      unknown CostItem ÜRETİLMEZ; bu katman "veri şekli" hatasıdır) ──────── */

function validateMetadata(metadata: TripPlanMetadata): void {
  if (!metadata) {
    throw new RangeError('TripCostRouteAdapter: metadata zorunludur.');
  }
  if (typeof metadata.id !== 'string' || metadata.id.trim() === '') {
    throw new RangeError('TripCostRouteAdapter: metadata.id boş olamaz (rastgele/UUID uydurulmaz).');
  }
  if (typeof metadata.currency !== 'string' || metadata.currency.trim() === '') {
    throw new RangeError('TripCostRouteAdapter: metadata.currency boş olamaz.');
  }
  if (typeof metadata.origin !== 'string' || metadata.origin.trim() === '') {
    throw new RangeError('TripCostRouteAdapter: metadata.origin boş olamaz (rota modelinde yok — uydurulmaz).');
  }
  if (typeof metadata.destination !== 'string' || metadata.destination.trim() === '') {
    throw new RangeError('TripCostRouteAdapter: metadata.destination boş olamaz (rota modelinde yok — uydurulmaz).');
  }
  if (!Number.isFinite(metadata.nights) || metadata.nights < 0) {
    throw new RangeError(`TripCostRouteAdapter: geçersiz nights (${metadata.nights}) — finite VE >=0 olmalı.`);
  }
}

function validateDistanceDuration(distanceM: number, durationS: number, label: string): void {
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError(`TripCostRouteAdapter: geçersiz distanceM (${distanceM}) — ${label} için negatif olamaz veya sonlu değil.`);
  }
  if (!Number.isFinite(durationS) || durationS < 0) {
    throw new RangeError(`TripCostRouteAdapter: geçersiz durationS (${durationS}) — ${label} için negatif olamaz veya sonlu değil.`);
  }
}

/** metre → km. YUVARLAMA YOK — tam hassasiyet korunur (ör. 1234 → 1.234). */
function metersToKm(distanceM: number): number {
  return distanceM / 1000;
}

/* ── API 1 — TEK leg (ActiveRoute) ──────────────────────────────────────── */

/**
 * `ActiveRoute` (aktif/uygulanmış tek rota) → tek-leg `TripPlan`.
 * `leg.origin`/`leg.destination` = `metadata.origin`/`metadata.destination`
 * (ActiveRoute'ta origin/destination YOK — metadata'dan gelir).
 */
export function buildTripPlanFromActiveRoute(route: ActiveRoute, metadata: TripPlanMetadata): TripPlan {
  validateMetadata(metadata);
  if (!route) {
    throw new RangeError('buildTripPlanFromActiveRoute: route zorunludur.');
  }
  validateDistanceDuration(route.distanceM, route.durationS, 'ActiveRoute');

  const leg: TripLeg = {
    id:              `${metadata.id}:leg:0`, // deterministik — rastgele/UUID YASAK
    distanceKm:      metersToKm(route.distanceM),
    durationSeconds: route.durationS,
    origin:          metadata.origin,
    destination:     metadata.destination,
  };

  return {
    id:             metadata.id,
    origin:         metadata.origin,
    destination:    metadata.destination,
    legs:           [leg],
    nights:         metadata.nights,
    travellers:     metadata.travellers,
    vehicleProfile: metadata.vehicleProfile,
    currency:       metadata.currency,
  };
}

/* ── API 2 — ÇOKLU leg (preview) ────────────────────────────────────────── */

/**
 * `LegRouteResult[]` (preview çok-bacak zinciri) → çoklu-leg `TripPlan`.
 * Giriş SIRASI korunur; rota toplamı adapter içinde TEKRAR hesaplanıp ayrı
 * bir alana YAZILMAZ (cost provider'lar `legs[]`den kendi toplamını çıkarır).
 *
 * `metadata.legEndpoints` ZORUNLU ve `length === legs.length + 1` olmalı —
 * yoksa/uyuşmazsa per-leg isim UYDURULAMAYACAĞI için FAIL-CLOSED THROW eder.
 */
export function buildTripPlanFromPreviewLegs(
  legs: readonly LegRouteResult[],
  metadata: TripPlanMetadata,
): TripPlan {
  validateMetadata(metadata);
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new RangeError(
      'buildTripPlanFromPreviewLegs: legs listesi boş olamaz ("henüz rota yok" durumunda bu adapter hiç çağrılmamalı).',
    );
  }

  const endpoints = metadata.legEndpoints;
  if (!endpoints || endpoints.length !== legs.length + 1) {
    throw new RangeError(
      `buildTripPlanFromPreviewLegs: metadata.legEndpoints eksik veya uzunluğu uyuşmuyor ` +
      `(beklenen ${legs.length + 1}, gelen ${endpoints ? endpoints.length : 'yok'}) — per-leg isim UYDURULMAZ.`,
    );
  }

  const tripLegs: TripLeg[] = legs.map((legResult, index) => {
    validateDistanceDuration(legResult.distanceM, legResult.durationS, `preview leg[${index}]`);
    return {
      id:              `${metadata.id}:leg:${index}`, // deterministik — rastgele/UUID YASAK
      distanceKm:      metersToKm(legResult.distanceM),
      durationSeconds: legResult.durationS,
      origin:          endpoints[index],
      destination:     endpoints[index + 1],
    };
  });

  return {
    id:             metadata.id,
    origin:         metadata.origin,
    destination:    metadata.destination,
    legs:           tripLegs,
    nights:         metadata.nights,
    travellers:     metadata.travellers,
    vehicleProfile: metadata.vehicleProfile,
    currency:       metadata.currency,
  };
}
