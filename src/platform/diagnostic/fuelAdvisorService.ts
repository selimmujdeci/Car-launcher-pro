/**
 * fuelAdvisorService.ts — Smart Fuel Advisor (S-2 / Low Fuel Response)
 *
 * Akış:
 *   LOW_FUEL olayı gelince (VehicleEventHub)
 *     → Cooldown ve dismissed kontrolü
 *     → useVehicleStore'dan mevcut konum al
 *     → Overpass API: 5 km içindeki amenity=fuel noktaları
 *     → En yakın istasyonu seç
 *     → store.setFuelSuggestionCard() ile kart enjekte et
 *     → smartCardEngine._compute() kart listesine dahil eder (store üzerinden)
 *
 * Offline Tolerance: navigator.onLine false ise sessizce bekle.
 * Zero-Fluff UI: Kart yalnızca gerçek istasyon bulunduğunda çıkar.
 * Dismissed persistence: safeStorage 4h TTL — sürüş boyunca bir daha sorulmaz.
 */

import { onVehicleEvent }      from '../vehicleDataLayer/VehicleEventHub';
import { useUnifiedVehicleStore as useVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { useStore, type SmartCard } from '../../store/useStore';
import { safeGetRaw, safeSetRaw }   from '../../utils/safeStorage';
import { runtimeManager }           from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }              from '../../core/runtime/runtimeTypes';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const COOLDOWN_MS        = 30 * 60_000;   // 30 dk — aynı sürüşte tekrar sorma
const DISMISSED_TTL_MS   = 4  * 60 * 60_000; // 4 saat — "bu sürüş boyunca"
const SEARCH_RADIUS_M    = 5_000;          // 5 km
const FUEL_CLEAR_PCT     = 20;             // %20 üzerine çıkınca kartı kaldır
const OVERPASS_TIMEOUT_S = 10;
const OVERPASS_URL       = 'https://overpass-api.de/api/interpreter';
const DISMISSED_STORAGE  = 'fuel-advisor-dismissed-until';
const CARD_ID            = 'fuel-suggestion'; // sabit ID — dismissed filtresiyle uyumlu

// ── Overpass tipleri ─────────────────────────────────────────────────────────

interface OverpassNode {
  id:   number;
  lat:  number;
  lon:  number;
  tags: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassNode[];
}

interface NearbyStation {
  osmId:      number;
  name:       string;
  brand:      string;
  lat:        number;
  lng:        number;
  distanceKm: number;
}

// ── Modül state ───────────────────────────────────────────────────────────────

let _unsubEvent:   (() => void) | null = null;
let _unsubFuel:    (() => void) | null = null;
let _unsubDismiss: (() => void) | null = null;
let _unsubRuntime: (() => void) | null = null;
let _lastTriggeredAt = 0;   // cooldown takibi
let _active          = false;
// Adaptive Sync: güncel runtime modu (subscribe ile takip edilir)
let _currentMode: string = runtimeManager.getMode();

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _stationName(tags: Record<string, string>): string {
  return tags['name:tr'] ?? tags['name'] ?? tags['brand'] ?? tags['operator'] ?? 'Benzin İstasyonu';
}

function _stationBrand(tags: Record<string, string>): string {
  return tags['brand'] ?? tags['operator'] ?? '';
}

// ── Dismissed persistence ─────────────────────────────────────────────────────

function _isDismissed(): boolean {
  try {
    const raw = safeGetRaw(DISMISSED_STORAGE);
    if (!raw) return false;
    return Date.now() < Number(raw);
  } catch { return false; }
}

function _markDismissed(): void {
  const until = String(Date.now() + DISMISSED_TTL_MS);
  safeSetRaw(DISMISSED_STORAGE, until, 500);
}

// ── Overpass API ──────────────────────────────────────────────────────────────

async function _fetchStations(lat: number, lng: number): Promise<NearbyStation[]> {
  const query = [
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];`,
    `node["amenity"="fuel"](around:${SEARCH_RADIUS_M},${lat},${lng});`,
    'out body 10;',
  ].join('');

  const resp = await fetch(OVERPASS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(query)}`,
    signal:  AbortSignal.timeout(OVERPASS_TIMEOUT_S * 1_000),
  });

  if (!resp.ok) return [];

  const data = await resp.json() as OverpassResponse;

  return (data.elements ?? [])
    .filter((n): n is OverpassNode => n.lat !== undefined && n.lon !== undefined)
    .map((n): NearbyStation => ({
      osmId:      n.id,
      name:       _stationName(n.tags),
      brand:      _stationBrand(n.tags),
      lat:        n.lat,
      lng:        n.lon,
      distanceKm: _haversineKm(lat, lng, n.lat, n.lon),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// ── Kart temizleme ────────────────────────────────────────────────────────────

function _clearCard(): void {
  // Unsubscribe önce: setState → subscriber döngüsünü (stack overflow) önler
  if (_unsubDismiss) { _unsubDismiss(); _unsubDismiss = null; }
  useStore.getState().setFuelSuggestionCard(null);
}

// ── Ana akış ─────────────────────────────────────────────────────────────────

async function _onLowFuel(): Promise<void> {
  if (!_active) return;

  // Adaptive Sync: SAFE_MODE / BASIC_JS'de Overpass sorgusu (ağır ağ işlemi) durdur.
  // Araç düşük CPU bütçesinde çalışıyorken istasyon fiyat analizi ertelenir.
  if (_currentMode === RuntimeMode.SAFE_MODE || _currentMode === RuntimeMode.BASIC_JS) return;

  // 1. Cooldown kontrolü
  const sinceLastMs = Date.now() - _lastTriggeredAt;
  if (_lastTriggeredAt > 0 && sinceLastMs < COOLDOWN_MS) return;

  // 2. Kullanıcı bu sürüşte daha önce reddetti mi?
  if (_isDismissed()) return;

  // 3. Zaten bir öneri kartı gösteriliyor
  if (useStore.getState().fuelSuggestionCard !== null) return;

  // 4. Offline — sessizce bekle
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  // 5. Mevcut konum — OBD/GPS'ten gelen, doğrulanmış değer
  const vs  = useVehicleStore.getState();
  const loc = vs.location;
  if (!loc) return; // konum yoksa kart gösterme

  _lastTriggeredAt = Date.now();

  // 6. Overpass API'den istasyonları çek
  let stations: NearbyStation[];
  try {
    stations = await _fetchStations(loc.latitude, loc.longitude);
  } catch {
    return; // ağ hatası — sessizce bekle
  }

  if (!_active) return; // fetch sırasında servis durdurulmuş olabilir
  if (stations.length === 0) return; // istasyon bulunamadı — kart çıkarma

  const best  = stations[0]!; // en yakın istasyon
  const dist  = best.distanceKm;
  const label = best.brand ? `${best.brand} (${best.name})` : best.name;

  // 7. Yakıt önerisi kartını oluştur
  const card: SmartCard = {
    id:       CARD_ID,
    kind:     'fuel-suggestion',
    title:    '⛽ Yakıt Azaldı',
    subtitle: `${label} · ${dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}`,
    color:    '#f59e0b',
    priority: 87,  // fuel-warning (85) üzerinde, maintenance-urgent (90) altında
    badge:    dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`,
    cta:      'Yol Tarifi Al',
    // search-poi: navigasyon uygulaması istasyonu adıyla bulur
    action:   { type: 'search-poi', query: `${label} benzin istasyonu` },
  };

  // 8. Store'a enjekte et — smartCardEngine._compute() kart listesine dahil eder
  useStore.getState().setFuelSuggestionCard(card);

  // 9. Dismissed watcher: kullanıcı kartı reddederse safeStorage'a yaz
  if (_unsubDismiss) _unsubDismiss();
  _unsubDismiss = useStore.subscribe((state) => {
    if (!_active) return;
    if (state._dismissedCardIds.includes(CARD_ID)) {
      _markDismissed();       // 4h süreyle bir daha sorma
      _clearCard();
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fuel Advisor servisini başlatır.
 * App.tsx'de bir kez çağrılmalı (startSmartCardEngine'den sonra).
 * Tekrar çağrı güvenli (idempotent).
 */
export function startFuelAdvisor(): () => void {
  if (_active) return stopFuelAdvisor;
  _active = true;

  // Adaptive Sync: runtime modu takibi (mod değişiminde _onLowFuel otomatik kontrol eder)
  _unsubRuntime = runtimeManager.subscribe((mode) => { _currentMode = mode; });

  // LOW_FUEL ve CRITICAL_FUEL olaylarını dinle
  _unsubEvent = onVehicleEvent((e) => {
    if (e.type === 'LOW_FUEL' || e.type === 'CRITICAL_FUEL') {
      void _onLowFuel();
    }
  });

  // Yakıt yükselince (kullanıcı doldurdu) kartı kaldır
  _unsubFuel = useVehicleStore.subscribe((state) => {
    if (state.fuel !== null && state.fuel >= FUEL_CLEAR_PCT) {
      if (useStore.getState().fuelSuggestionCard !== null) {
        _clearCard();
        _lastTriggeredAt = 0; // sonraki düşüşte yeniden değerlendir
      }
    }
  });

  return stopFuelAdvisor;
}

export function stopFuelAdvisor(): void {
  if (!_active) return;
  _active = false;
  _unsubRuntime?.(); _unsubRuntime = null;
  _unsubEvent?.();   _unsubEvent   = null;
  _unsubFuel?.();    _unsubFuel    = null;
  _clearCard();      // dismissed watcher da temizlenir
  _lastTriggeredAt = 0;
}
