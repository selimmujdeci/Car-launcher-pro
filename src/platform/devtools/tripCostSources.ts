/**
 * tripCostSources.ts — CAROS LAB · Trip Cost TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter'lar, her biri kendi try/catch'i
 * içinde. HİÇBİR şey başlatmaz/durdurmaz, komut göndermez, timer kurmaz, ağa
 * çıkmaz. Rota İSTEMEZ, hedef DEĞİŞTİRMEZ, plan KAYDETMEZ.
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6 — pazarlıksız) ──────────
 * **HEDEF ADI, BAŞLANGIÇ ADI, ADRES VE ROTA GEOMETRİSİ BU KATMANDAN GEÇMEZ.**
 * `navigationCoreSources` ile birebir aynı karar. Hedef yalnız **VAR/YOK**
 * olarak taşınır; maliyet hesabına adı gerekir ama LAB'a adı GEREKMEZ —
 * gözlemcinin sorusu "hedef beyan edildi mi", "hedef neresi" değildir.
 *
 * ── NEDEN BURADA HESAP YAPILIYOR ────────────────────────────────────────────
 * `buildTripCostOutcome` SAF ve yan etkisizdir: store okumaz, yazmaz, ağa
 * çıkmaz. Bu yüzden okuma anında çalıştırmak bir "komut" değildir — LAB'ın
 * salt-okunurluk sözleşmesini bozmaz. Modül seviyesinde önbellek TUTULMAZ:
 * her okuma o anın gerçeğini üretir (bayat gösterge riski yok).
 */

import { getRouteState } from '../routingService';
import { getNavigationState } from '../navigationService';
import {
  buildTripCostOutcome,
  type RouteCostSnapshot,
  type TripCostDeclaration,
  type TripCostOutcome,
} from '../trip/cost/tripCostComposition';

/** LAB'a taşınan gözlem — ad/adres/geometri İÇERMEZ. */
export interface TripCostObservationRow {
  /** Aktif rota var mı (mesafe/süre okunabildi mi). */
  readonly routePresent:      boolean;
  readonly totalDistanceKm:   number | null;
  readonly totalDurationSeconds: number | null;
  /** Rota ücretli geçiş içeriyor mu (rota durumundan — tarife DEĞİL). */
  readonly routeHasToll:      boolean | null;
  /** Hedef beyan edildi mi — ADI TAŞINMAZ. */
  readonly destinationDeclared: boolean;
  /** Başlangıç beyan edildi mi — ADI TAŞINMAZ. */
  readonly originDeclared:    boolean;
  /** Saf composition çıktısı (plan/rapor/kategoriler). */
  readonly outcome:           TripCostOutcome;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Canlı rotanın maliyet-ilgili ölçüleri. Geometri TAŞINMAZ. */
function readRouteSnapshot(): RouteCostSnapshot | null {
  return safe(() => {
    const st = getRouteState();
    const distanceM = st?.totalDistanceMeters;
    const durationS = st?.totalDurationSeconds;
    if (typeof distanceM !== 'number' || typeof durationS !== 'number') return null;
    if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) return null;
    /* Rota yoksa store 0 taşıyabilir; geometri yoksa rota YOK sayılır —
       "0 km'lik rota" diye bir gerçek yoktur (sahte 0 yasağı). */
    const hasGeometry = Array.isArray(st?.geometry) && st.geometry.length >= 2;
    if (!hasGeometry) return null;
    return { distanceM, durationS, hasToll: st?.hasToll === true };
  }, null);
}

/**
 * Navigasyon hedefinin ADI — yalnız composition'a girer, LAB'a ÇIKMAZ.
 * Bu, üründe gerçekten var olan tek metadata kaynağıdır.
 */
function readDestinationName(): string | undefined {
  return safe(() => {
    const nav = getNavigationState();
    const name = nav?.destination?.name;
    return typeof name === 'string' && name.trim() !== '' ? name : undefined;
  }, undefined);
}

/**
 * Bugünkü beyan — üründe hangi alanın gerçek kaynağı VARSA yalnız o doldurulur.
 *
 * `origin` · `nights` · `travellers` · `vehicleProfile` BİLEREK boş bırakılır:
 * bunları toplayacak bir ürün yüzeyi henüz yok ve varsayılan atamak uydurma
 * olurdu. Yüzey geldiğinde bu fonksiyon onu okur; composition DEĞİŞMEZ.
 */
function readDeclaration(): TripCostDeclaration {
  const destination = readDestinationName();
  return {
    /* Plan kimliği rotanın kendisinden deterministik türetilir — rastgele/UUID
       YOK (aynı rota → aynı kimlik, gözlem tekrarlanabilir olsun). */
    planId:   'active-route',
    currency: 'TRY',
    destination,
    /* origin/nights/travellers/vehicleProfile: KAYNAK YOK → beyan edilmez. */
  };
}

/** LAB gözlemi — tek okuma, yan etkisiz. */
export function readTripCostObservation(): TripCostObservationRow {
  const route = readRouteSnapshot();
  const declaration = readDeclaration();
  const outcome = safe(
    () => buildTripCostOutcome(route, declaration),
    {
      planBuilt: false,
      blockedBy: ['ROTA_YOK'] as const,
      gaps:      ['ROTA_YOK'] as const,
      plan: null, report: null, categories: [],
      totalDistanceKm: null, totalDurationSeconds: null,
    } as TripCostOutcome,
  );

  return {
    routePresent:         route !== null,
    totalDistanceKm:      outcome.totalDistanceKm,
    totalDurationSeconds: outcome.totalDurationSeconds,
    routeHasToll:         route ? route.hasToll : null,
    destinationDeclared:  declaration.destination !== undefined,
    originDeclared:       declaration.origin !== undefined,
    outcome,
  };
}
