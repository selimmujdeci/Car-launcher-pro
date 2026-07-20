/**
 * tripPreviewEngine — MAVI 4.0 · TRIP AI · ATOMİK GÖREV MAVI4-TRIP-4
 *
 * "Bu durağı rotaya eklersem ne olur?" sorusunu GERÇEK preview ile yanıtlar.
 * Yalnız HESAP yapar — hiçbir rota UYGULANMAZ.
 *
 * KISITLAR (pazarlıksız):
 *   • Store / EventBus / Navigation state / UI / Voice / Apply YOK.
 *   • Orijinal rota **immutable** — okunur, ASLA mutasyona uğratılmaz.
 *   • estimatedDetour (TRIP-2 kaba tahmini) KULLANILMAZ — gerçek iki-bacak preview hesaplanır.
 *   • Yeni routing algoritması YAZILMAZ: gerçek rota getirme işi enjekte edilen
 *     `LegRouter` ile mevcut RoutingService'e devredilir (yan-etkili wiring ayrı katman).
 *
 * Yan etki içermez: girdiler mutasyona uğratılmaz, global durum okunmaz/yazılmaz.
 * RoutingService'ten `hav` (haversine) somut olarak yeniden kullanılır.
 */

import { hav } from '../routingService';

/* ── Tipler ──────────────────────────────────────────────────────────────── */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Tek bacaklık rota sonucu — RoutingService/offline çıktı formatıyla aynı. */
export interface LegRouteResult {
  geometry:  [number, number][]; // [lon, lat][] — OSRM/RoutingService formatı
  distanceM: number;
  durationS: number;
}

/**
 * Gerçek rota getirme sözleşmesi (enjekte edilir).
 * Production'da RoutingService'in yan-etkisiz bacak-fetch'ine bağlanır; başarısız → null.
 */
export type LegRouter = (
  fromLat: number, fromLon: number,
  toLat: number,   toLon: number,
) => Promise<LegRouteResult | null>;

/** Orijinal (mevcut) rota — immutable referans. */
export interface OriginalRoute {
  geometry:  [number, number][]; // [lon, lat][]
  distanceM: number;
  durationS: number;
}

export interface PreviewInput {
  original:    OriginalRoute;
  origin:      LatLng;
  destination: LatLng;
  poi:         LatLng;
  currentETA:  number; // epoch ms — mevcut varış tahmini
}

export type PreviewErrorCategory =
  | 'NONE'
  | 'INVALID_INPUT'          // orijinal rota / başlangıç / hedef / ETA geçersiz
  | 'INVALID_POI'            // POI koordinatı geçersiz
  | 'SAME_AS_DESTINATION'    // POI hedefe eşit — anlamlı sapma yok
  | 'ROUTE_FAILED';          // bir bacak rota getirilemedi

export interface TripPreview {
  previewRoute:       [number, number][] | null; // origin→POI→dest birleşik geometri
  previewDistance:    number; // metre
  previewDuration:    number; // saniye
  addedDistance:      number; // metre — preview − original
  addedTravelMinutes: number; // dakika — (previewDuration − originalDuration) / 60
  previewETA:         number; // epoch ms — currentETA + eklenen süre
  selectedPoi:        LatLng;
  isValid:            boolean;
  errorCategory:      PreviewErrorCategory;
}

/* ── Sabitler ────────────────────────────────────────────────────────────── */

/** POI, hedefe bu mesafeden yakınsa "aynı hedef" sayılır (metre). */
const SAME_DEST_EPSILON_M = 25;

/* ── Yardımcılar (saf) ───────────────────────────────────────────────────── */

function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return !!p
    && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
}

function isValidOriginal(r: OriginalRoute | null | undefined): r is OriginalRoute {
  return !!r
    && Array.isArray(r.geometry) && r.geometry.length >= 2
    && Number.isFinite(r.distanceM) && r.distanceM >= 0
    && Number.isFinite(r.durationS) && r.durationS >= 0;
}

function isValidLeg(leg: LegRouteResult | null): leg is LegRouteResult {
  return !!leg
    && Array.isArray(leg.geometry) && leg.geometry.length >= 2
    && Number.isFinite(leg.distanceM) && leg.distanceM >= 0
    && Number.isFinite(leg.durationS) && leg.durationS >= 0;
}

/** Hata sonucu üretici — sayılar nötr, previewETA değişmez (currentETA korunur). */
function fail(input: PreviewInput, errorCategory: PreviewErrorCategory): TripPreview {
  return {
    previewRoute:       null,
    previewDistance:    0,
    previewDuration:    0,
    addedDistance:      0,
    addedTravelMinutes: 0,
    previewETA:         Number.isFinite(input.currentETA) ? input.currentETA : 0,
    selectedPoi:        { lat: input.poi?.lat, lng: input.poi?.lng },
    isValid:            false,
    errorCategory,
  };
}

/* ── Ana motor ───────────────────────────────────────────────────────────── */

/**
 * "POI'yi rotaya eklersem ne olur?" — gerçek iki-bacak preview hesaplar.
 * Rota UYGULANMAZ; orijinal rota immutable kalır.
 *
 * @param input  Orijinal rota + başlangıç + hedef + POI + mevcut ETA.
 * @param router Enjekte edilen gerçek bacak-router (origin→POI, POI→dest).
 * @returns TripPreview — geçersiz durumda isValid=false + errorCategory dolu.
 *
 * Saf: input mutasyona uğratılmaz, global durum okunmaz/yazılmaz.
 */
export async function computeTripPreview(
  input: PreviewInput,
  router: LegRouter,
): Promise<TripPreview> {
  // ── Girdi doğrulama (router çağrılmadan) ─────────────────────────────────
  if (!input || !isValidOriginal(input.original)
    || !isValidLatLng(input.origin) || !isValidLatLng(input.destination)
    || !Number.isFinite(input.currentETA)) {
    return fail(input ?? ({ poi: {} } as PreviewInput), 'INVALID_INPUT');
  }
  if (!isValidLatLng(input.poi)) {
    return fail(input, 'INVALID_POI');
  }
  // POI hedefe eşit → anlamlı sapma yok.
  if (hav(input.poi.lat, input.poi.lng, input.destination.lat, input.destination.lng) <= SAME_DEST_EPSILON_M) {
    return fail(input, 'SAME_AS_DESTINATION');
  }

  // ── İki bacak: origin→POI, POI→dest (mevcut RoutingService'e devredilir) ──
  const [leg1, leg2] = await Promise.all([
    router(input.origin.lat, input.origin.lng, input.poi.lat, input.poi.lng),
    router(input.poi.lat, input.poi.lng, input.destination.lat, input.destination.lng),
  ]);

  if (!isValidLeg(leg1) || !isValidLeg(leg2)) {
    return fail(input, 'ROUTE_FAILED');
  }

  // ── Birleştir (POI birleşim noktası tekrarını at) — YENİ dizi; orijinale dokunmaz ──
  const previewRoute: [number, number][] = leg1.geometry.concat(leg2.geometry.slice(1));

  const previewDistance = leg1.distanceM + leg2.distanceM;
  const previewDuration = leg1.durationS + leg2.durationS;
  const addedDistance   = previewDistance - input.original.distanceM;
  const addedDurationS   = previewDuration - input.original.durationS;

  return {
    previewRoute,
    previewDistance,
    previewDuration,
    addedDistance,
    addedTravelMinutes: addedDurationS / 60,
    previewETA:         input.currentETA + addedDurationS * 1000,
    selectedPoi:        { lat: input.poi.lat, lng: input.poi.lng },
    isValid:            true,
    errorCategory:      'NONE',
  };
}
