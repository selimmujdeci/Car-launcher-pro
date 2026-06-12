/**
 * Weather & Fuel Price Service
 *
 * Weather: Open-Meteo API (free, no API key required)
 *   https://open-meteo.com/
 *
 * Geocoding: Nominatim/OpenStreetMap (free, no API key)
 *   https://nominatim.openstreetmap.org/
 *
 * Fuel Prices: Supabase Edge Function → get-fuel-prices → gerçek EPDK verisi.
 *   API başarısız olursa: taze cache → stale cache → fuelPending=true (UI bekleme).
 *   isSimulated her zaman false — simüle veri dönmez.
 *
 * Architecture:
 *  - Module-level push state
 *  - 15-minute weather cache, 30-minute fuel cache
 *  - Falls back to Istanbul coords when GPS unavailable
 */

import { signalWithTimeout } from '../utils/abortCompat';
import { useState, useEffect } from 'react';
import { getSupabaseClient } from './supabaseClient';
import { logError } from './crashLogger';

/* ── Types ───────────────────────────────────────────────── */

export interface WeatherData {
  temperature: number;       // °C
  feelsLike: number;         // °C
  humidity: number;          // %
  windSpeed: number;         // km/h
  windDirection: number;     // degrees
  description: string;       // Turkish
  emoji: string;             // weather emoji
  code: number;              // WMO weather code
  city: string;
  isDay: boolean;
  uvIndex?: number;
}

export interface FuelStation {
  id: string;
  name: string;
  brand: string;
  emoji: string;
  distanceKm: number;
  gasolinePrice: number;    // TL/L (95 oktan)
  dieselPrice: number;      // TL/L
  lpgPrice?: number;        // TL/L
  isOpen: boolean;
  isCheapest: boolean;
  isSimulated: false;
}

export interface WeatherState {
  weather: WeatherData | null;
  stations: FuelStation[];
  isLoadingWeather: boolean;
  isLoadingFuel: boolean;
  /** true = API + cache ikisi de başarısız; UI "Veri Bekleniyor" göstermeli */
  fuelPending: boolean;
  lastUpdated: number | null;
  error: string | null;
  /** Aktif konum kaynağı — debug ve UI etiketleri için */
  locationSource: 'gps' | 'user_city' | 'none';
}

/* ── WMO weather code → Turkish + emoji ─────────────────── */

interface WeatherDesc { text: string; emoji: string }

function _wmoDesc(code: number, isDay: boolean): WeatherDesc {
  if (code === 0)            return { text: isDay ? 'Açık ve güneşli' : 'Açık gece', emoji: isDay ? '☀️' : '🌙' };
  if (code === 1)            return { text: 'Büyük ölçüde açık', emoji: '🌤️' };
  if (code === 2)            return { text: 'Parçalı bulutlu', emoji: '⛅' };
  if (code === 3)            return { text: 'Kapalı', emoji: '☁️' };
  if (code === 45 || code === 48) return { text: 'Sisli', emoji: '🌫️' };
  if (code === 51)           return { text: 'Hafif çiseleme', emoji: '🌦️' };
  if (code === 53)           return { text: 'Orta çiseleme', emoji: '🌦️' };
  if (code === 55)           return { text: 'Yoğun çiseleme', emoji: '🌧️' };
  if (code === 61)           return { text: 'Hafif yağmur', emoji: '🌧️' };
  if (code === 63)           return { text: 'Orta yağmur', emoji: '🌧️' };
  if (code === 65)           return { text: 'Yoğun yağmur', emoji: '🌧️' };
  if (code === 71)           return { text: 'Hafif kar', emoji: '🌨️' };
  if (code === 73)           return { text: 'Orta kar', emoji: '❄️' };
  if (code === 75)           return { text: 'Yoğun kar', emoji: '❄️' };
  if (code === 77)           return { text: 'Kar taneleri', emoji: '🌨️' };
  if (code === 80)           return { text: 'Hafif sağanak', emoji: '🌦️' };
  if (code === 81)           return { text: 'Orta sağanak', emoji: '🌧️' };
  if (code === 82)           return { text: 'Şiddetli sağanak', emoji: '⛈️' };
  if (code === 85 || code === 86) return { text: 'Karlı sağanak', emoji: '🌨️' };
  if (code === 95)           return { text: 'Gök gürültülü fırtına', emoji: '⛈️' };
  if (code >= 96)            return { text: 'Dolu fırtınası', emoji: '⛈️' };
  return { text: 'Belirsiz', emoji: '🌡️' };
}

/* ── Fuel price cache ────────────────────────────────────── */

const FUEL_CACHE_KEY = 'clp_fuel_cache';
const FUEL_CACHE_TTL = 60 * 60_000; // 60 minutes

interface FuelCache { stations: FuelStation[]; ts: number }

function _normalizeCached(stations: FuelStation[]): FuelStation[] {
  return stations.map(s => ({ ...s, isSimulated: false as const }));
}

function _loadFuelCache(): FuelStation[] | null {
  try {
    const raw = localStorage.getItem(FUEL_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as FuelCache;
    if (Date.now() - cache.ts > FUEL_CACHE_TTL) return null;
    return _normalizeCached(cache.stations);
  } catch { return null; }
}

/** TTL'e bakmaksızın son başarılı cache'i döner — API hatası sonrası stale fallback */
function _loadFuelCacheStale(): FuelStation[] | null {
  try {
    const raw = localStorage.getItem(FUEL_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as FuelCache;
    if (!Array.isArray(cache.stations) || cache.stations.length === 0) return null;
    return _normalizeCached(cache.stations);
  } catch { return null; }
}

function _saveFuelCache(stations: FuelStation[]): void {
  try {
    localStorage.setItem(FUEL_CACHE_KEY, JSON.stringify({ stations, ts: Date.now() } satisfies FuelCache));
  } catch { /* QuotaExceeded — ignore */ }
}

/* ── Dynamic fuel prices via Supabase Edge Function ─────── */

interface FuelAPIResponse { stations: FuelStation[] }

async function _fetchFuelFromAPI(lat: number, lng: number): Promise<FuelStation[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  const anonKey     = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
  if (!supabaseUrl || !anonKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/get-fuel-prices`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
      body:    JSON.stringify({ lat, lng }),
      signal:  signalWithTimeout(10_000), // 10s timeout — araç ağı yavaş olabilir
    });
    if (!res.ok) return null;
    const data = await res.json() as FuelAPIResponse;
    if (!Array.isArray(data.stations) || data.stations.length === 0) return null;
    // Gerçek EPDK verisi — isSimulated her zaman false
    return data.stations.map(s => ({ ...s, isSimulated: false as const }));
  } catch (e) {
    logError('weatherService:fetchFuel', e);
    return null;
  }
}

/* ── Module state ────────────────────────────────────────── */

const INITIAL: WeatherState = {
  weather: null,
  stations: [],
  isLoadingWeather: false,
  isLoadingFuel: false,
  fuelPending: false,
  lastUpdated: null,
  error: null,
  locationSource: 'none',
};

let _state: WeatherState = { ...INITIAL };
const _listeners = new Set<(s: WeatherState) => void>();
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

function _notify(): void {
  const snap = { ..._state, stations: [..._state.stations] };
  _listeners.forEach((fn) => fn(snap));
}

function _setState(partial: Partial<WeatherState>): void {
  _state = { ..._state, ...partial };
  _notify();
}

/* ── Fetch helpers ───────────────────────────────────────── */

/* ── Nominatim rate limit — shared with geocodingService ────── */
let _lastNominatimMs = 0;
const NOMINATIM_GAP  = 1_100;
async function _waitNominatim(): Promise<void> {
  const now  = Date.now();
  const wait = NOMINATIM_GAP - (now - _lastNominatimMs);
  if (wait > 0) await new Promise<void>((res) => setTimeout(res, wait));
  _lastNominatimMs = Date.now();
}

async function _fetchCity(lat: number, lng: number): Promise<string> {
  try {
    await _waitNominatim();
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=tr`,
      { headers: { 'User-Agent': 'CarLauncherPro/1.0' } },
    );
    const json = await res.json() as { address?: { city?: string; town?: string; village?: string; county?: string } };
    return json.address?.city ?? json.address?.town ?? json.address?.village ?? json.address?.county ?? 'Bilinmeyen';
  } catch {
    return 'Bilinmeyen';
  }
}

async function _fetchWeather(lat: number, lng: number): Promise<void> {
  _setState({ isLoadingWeather: true, error: null });

  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,` +
      `wind_speed_10m,wind_direction_10m,weather_code,is_day` +
      `&wind_speed_unit=kmh&timezone=auto`;

    const [weatherRes, city] = await Promise.all([
      fetch(url).then((r) => r.json() as Promise<{
        current: {
          temperature_2m: number;
          apparent_temperature: number;
          relative_humidity_2m: number;
          wind_speed_10m: number;
          wind_direction_10m: number;
          weather_code: number;
          is_day: number;
        };
      }>),
      _fetchCity(lat, lng),
    ]);

    const c     = weatherRes.current;
    const isDay = c.is_day === 1;
    const desc  = _wmoDesc(c.weather_code, isDay);

    const weather: WeatherData = {
      temperature:   Math.round(c.temperature_2m),
      feelsLike:     Math.round(c.apparent_temperature),
      humidity:      c.relative_humidity_2m,
      windSpeed:     Math.round(c.wind_speed_10m),
      windDirection: c.wind_direction_10m,
      description:   desc.text,
      emoji:         desc.emoji,
      code:          c.weather_code,
      city,
      isDay,
    };

    _setState({ weather, isLoadingWeather: false, lastUpdated: Date.now() });

  } catch (err) {
    _setState({
      isLoadingWeather: false,
      error: err instanceof Error ? err.message : 'Hava durumu alınamadı',
    });
  }
}

async function _fetchFuel(lat: number, lng: number): Promise<void> {
  _setState({ isLoadingFuel: true, fuelPending: false });

  // 1. Supabase Edge Function → gerçek EPDK verisi
  const apiStations = await _fetchFuelFromAPI(lat, lng);
  if (apiStations) {
    _saveFuelCache(apiStations);
    _setState({ stations: apiStations, isLoadingFuel: false, fuelPending: false });
    return;
  }

  // 2. API başarısız → taze cache (TTL içinde)
  const freshCache = _loadFuelCache();
  if (freshCache) {
    _setState({ stations: freshCache, isLoadingFuel: false, fuelPending: false });
    return;
  }

  // 3. Taze cache yok → stale cache (eski ama var)
  const staleCache = _loadFuelCacheStale();
  if (staleCache) {
    _setState({ stations: staleCache, isLoadingFuel: false, fuelPending: false });
    return;
  }

  // 4. Hiç veri yok → UI "Veri Bekleniyor" durumuna geç
  _setState({ stations: [], isLoadingFuel: false, fuelPending: true });
}

/* ── GPS helpers ─────────────────────────────────────────── */

/** Kullanıcının ayarlardan seçtiği şehir koordinatları (GPS yokken fallback) */
let _fallbackLat = 0;
let _fallbackLng = 0;
let _userFallbackSet = false;

/** Capacitor GPS servisinden beslenen anlık GPS koordinatları (gerçek konum) */
let _activeGPSLat: number | null = null;
let _activeGPSLng: number | null = null;

/**
 * GPS yokken kullanılacak fallback koordinatı ayarla.
 * Kullanıcı şehir seçtiğinde (ayarlar ekranından) çağrılır.
 */
export function setWeatherFallback(lat: number, lng: number): void {
  _fallbackLat = lat;
  _fallbackLng = lng;
  _userFallbackSet = true;
}

/**
 * Gerçek GPS koordinatını weather servisine besle.
 * gpsService.ts / backgroundLocation olayından useLayoutServices tarafından çağrılır.
 * İlk GPS fix'inde otomatik weather refresh tetiklenir.
 */
export function feedGPSLocation(lat: number, lng: number): void {
  const firstFix = _activeGPSLat === null;
  _activeGPSLat = lat;
  _activeGPSLng = lng;
  // İlk gerçek konum fix'inde weather'ı hemen güncelle
  if (firstFix) {
    refreshWeather().catch(() => undefined);
  }
}

/** Aktif konum kaynağını döner — GPS > kullanıcı şehri > yok */
function _getCurrentPosition(): { lat: number; lng: number; source: 'gps' | 'user_city' } | null {
  if (_activeGPSLat !== null && _activeGPSLng !== null) {
    return { lat: _activeGPSLat, lng: _activeGPSLng, source: 'gps' };
  }
  if (_userFallbackSet) {
    return { lat: _fallbackLat, lng: _fallbackLng, source: 'user_city' };
  }
  return null;
}

/* ── Public API ──────────────────────────────────────────── */

export async function refreshWeather(): Promise<void> {
  const pos = _getCurrentPosition();
  if (!pos) {
    // Gerçek GPS yok, kullanıcı şehri de seçilmemiş — veri gösterme
    _setState({
      weather: null,
      stations: [],
      isLoadingWeather: false,
      isLoadingFuel: false,
      error: 'Konum alınamadı — GPS bekleniyor',
      locationSource: 'none',
    });
    return;
  }
  _setState({ locationSource: pos.source });
  await _fetchWeather(pos.lat, pos.lng);
  void _fetchFuel(pos.lat, pos.lng);
}

export async function refreshFuelPrices(): Promise<void> {
  const pos = _getCurrentPosition();
  if (!pos) return;
  _setState({ locationSource: pos.source });
  await _fetchFuel(pos.lat, pos.lng);
}

export function startWeatherService(): void {
  // Initial fetch
  refreshWeather().catch(() => undefined);

  // Auto-refresh every 15 minutes
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    refreshWeather().catch(() => undefined);
  }, 15 * 60_000);
}

export function stopWeatherService(): void {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

export function onWeatherState(fn: (s: WeatherState) => void): () => void {
  _listeners.add(fn);
  fn({ ..._state, stations: [..._state.stations] });
  return () => { _listeners.delete(fn); };
}

export function useWeatherState(): WeatherState {
  const [s, setS] = useState<WeatherState>({ ..._state, stations: [..._state.stations] });
  useEffect(() => onWeatherState(setS), []);
  return s;
}

/**
 * WeatherState'i akıcı bir Türkçe cümleye dönüştürür — TTS için optimize edilmiştir.
 * Veri yoksa kısa bir hata metni döner.
 *
 * Örnek çıktı:
 *   "Mersin'de hava açık ve güneşli, sıcaklık 28 derece,
 *    hissedilen 26, rüzgar 14 kilometre."
 */
export function getWeatherNarrative(state?: WeatherState): string {
  const w = (state ?? _state).weather;
  if (!w) return 'Hava durumu verisi henüz alınamadı.';

  const parts: string[] = [];

  if (w.city && w.city !== 'Bilinmeyen') {
    parts.push(`${w.city}'de hava ${w.description}`);
  } else {
    parts.push(`Hava ${w.description}`);
  }

  parts.push(`sıcaklık ${w.temperature} derece`);

  if (Math.abs(w.feelsLike - w.temperature) >= 2) {
    parts.push(`hissedilen ${w.feelsLike}`);
  }

  if (w.windSpeed > 5) {
    parts.push(`rüzgar ${w.windSpeed} kilometre`);
  }

  return parts.join(', ') + '.';
}
