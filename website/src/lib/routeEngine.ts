/**
 * routeEngine.ts — Navigasyon Motoru
 *
 * Akış: Adres araması → Koordinat dönüşümü → route_commands INSERT
 *       → vehicle_commands (route_send) tetikleyici
 *
 * Geocoding: Nominatim (OpenStreetMap) — ücretsiz, GDPR uyumlu
 * Sensor guard: koordinat sınır kontrolü
 */

import { supabaseBrowser } from './supabase';
import { sendCommand, subscribeCommandStatus } from './commandService';
import type { RoutePayload, SendResult, StatusEvent } from './commandService';

// ── Tipler ────────────────────────────────────────────────────────────────────

export interface GeoResult {
  lat:         number;
  lng:         number;
  addressName: string;
  city?:       string;
  country?:    string;
}

export type NavProvider = 'google_maps' | 'yandex' | 'waze' | 'apple_maps';

export interface SendRouteOptions {
  vehicleId:       string;
  lat:             number;
  lng:             number;
  addressName:     string;
  provider?:       NavProvider;
  onStatus?:       (ev: StatusEvent) => void;
}

// ── Koordinat doğrulama ───────────────────────────────────────────────────────

function assertValidCoords(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90)
    throw new RangeError(`Geçersiz enlem: ${lat}`);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180)
    throw new RangeError(`Geçersiz boylam: ${lng}`);
}

// ── Nominatim Geocoding ───────────────────────────────────────────────────────

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

interface NominatimItem {
  lat:          string;
  lon:          string;
  display_name: string;
  address?:     { city?: string; town?: string; state?: string; country?: string };
}

export async function geocodeAddress(query: string): Promise<GeoResult[]> {
  if (!query.trim()) return [];

  const url = `${NOMINATIM_BASE}/search?` + new URLSearchParams({
    q:               query,
    format:          'json',
    limit:           '5',
    addressdetails:  '1',
    'accept-language': 'tr,en',
  });

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ArabamCebimde/1.0 (carospro.com)',
      'Accept-Language': 'tr',
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`Geocoding hata: ${res.status}`);

  const items: NominatimItem[] = await res.json();
  return items.map((item) => ({
    lat:         parseFloat(item.lat),
    lng:         parseFloat(item.lon),
    addressName: item.display_name,
    city:        item.address?.city ?? item.address?.town,
    country:     item.address?.country,
  }));
}

// Tek adres için hızlı arama (ilk sonuç)
export async function geocodeFirst(query: string): Promise<GeoResult | null> {
  const results = await geocodeAddress(query);
  return results[0] ?? null;
}

// ── Reverse geocoding ─────────────────────────────────────────────────────────

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  assertValidCoords(lat, lng);
  const url = `${NOMINATIM_BASE}/reverse?` + new URLSearchParams({
    lat:    lat.toFixed(6),
    lon:    lng.toFixed(6),
    format: 'json',
  });
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ArabamCebimde/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const data = await res.json();
  return data.display_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// ── Rota gönder ───────────────────────────────────────────────────────────────

export async function sendRoute(opts: SendRouteOptions): Promise<{
  result: SendResult;
  unsubscribe: () => void;
}> {
  const {
    vehicleId,
    lat,
    lng,
    addressName,
    provider = 'google_maps',
    onStatus,
  } = opts;

  // Koordinat sınır kontrolü (Sensor Resiliency)
  assertValidCoords(lat, lng);

  const payload: RoutePayload = {
    lat,
    lng,
    address_name:    addressName,
    provider_intent: provider,
  };

  // 1. vehicle_commands INSERT
  const result = await sendCommand(vehicleId, 'route_send', { route: payload });
  if (!result.ok || !result.commandId) {
    return { result, unsubscribe: () => {} };
  }

  // 2. route_commands — yapısal navigasyon kaydı
  if (supabaseBrowser) {
    await supabaseBrowser.from('route_commands').insert({
      command_id:      result.commandId,
      vehicle_id:      vehicleId,
      lat,
      lng,
      address_name:    addressName,
      provider_intent: provider,
    });
  }

  // 3. Realtime durum takibi (opsiyonel)
  const unsubscribe = onStatus
    ? subscribeCommandStatus(result.commandId, onStatus)
    : () => {};

  return { result, unsubscribe };
}

// ── Android Intent URI üretici ────────────────────────────────────────────────

export function buildNavIntent(
  lat:      number,
  lng:      number,
  label:    string,
  provider: NavProvider = 'google_maps',
): string {
  const enc = encodeURIComponent(label);
  switch (provider) {
    case 'google_maps':
      return `geo:${lat},${lng}?q=${lat},${lng}(${enc})`;
    case 'waze':
      return `waze://?ll=${lat},${lng}&navigate=yes`;
    case 'yandex':
      return `yandexmaps://maps.yandex.ru/?pt=${lng},${lat}&z=15&l=map`;
    case 'apple_maps':
      return `maps://?ll=${lat},${lng}&q=${enc}`;
  }
}
