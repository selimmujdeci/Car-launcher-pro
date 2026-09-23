/**
 * Traffic Service — Gerçek zamanlı trafik verisi.
 *
 * Öncelik sırası:
 *   1. HERE Traffic Flow v7 API   (VITE_HERE_API_KEY varsa)
 *   2. TomTom Traffic Flow API    (VITE_TOMTOM_API_KEY varsa)
 *
 * ANAHTAR YOKSA VERİ YOKTUR (2026-09-23): eskiden saat tablosundan "tahmini" yoğunluk ve
 * SABİT LİSTEDEN uydurma yol adları ("Çevre Yolu", "Bulvar") üretilip konumun etrafına
 * rastgele noktalar olarak çiziliyordu — sahada Tarsus'ta gerçek olmayan "Çevre Yolu ·
 * doğu · Akıcı" gösterildi. CLAUDE.md §8: sahte veri yerine `summary: null` +
 * `unavailable` nedeni. TomTom: akış katmanı + bulunulan yol + olaylar (tomtomTraffic).
 *
 * Kaynak: trafficSummary.source  →  'here' | 'tomtom'
 */

import { signalWithTimeout } from '../utils/abortCompat';
import { useState, useEffect } from 'react';
import { injectOfficialHazard } from './hazardService';
import type { HazardType } from '../store/useHazardStore';
import {
  fetchRoad, fetchIncidents, flowTileUrl,
  type TrafficRoad, type TrafficIncident,
} from './traffic/tomtomTraffic';

export type { TrafficRoad, TrafficIncident } from './traffic/tomtomTraffic';

/* ── Tipler ──────────────────────────────────────────────── */

export type TrafficLevel  = 'free' | 'moderate' | 'heavy' | 'standstill';
export type TrafficSource = 'here' | 'tomtom';
export type TrafficUnavailable = 'no_key' | 'no_location' | 'fetch_failed';

export interface TrafficSegment {
  label:     string;
  level:     TrafficLevel;
  delayMin:  number;
  direction: string;
}

export interface TrafficSummary {
  level:       TrafficLevel;
  delayMin:    number;
  updatedAt:   number;
  segments:    TrafficSegment[];
  tileEnabled: boolean;
  source:      TrafficSource;
  /** Bulunulan yol (TomTom akış) — yoksa null. */
  road:        TrafficRoad | null;
  /** Çevredeki olaylar (TomTom) — gecikmeye göre sıralı. */
  incidents:   TrafficIncident[];
}

export interface TrafficState {
  summary:      TrafficSummary | null;
  tileLayerUrl: string;
  showLayer:    boolean;
  loading:      boolean;
  error:        string | null;
  /** Veri neden yok (summary null iken). */
  unavailable:  TrafficUnavailable | null;
}

/* ── Env anahtarları ─────────────────────────────────────── */

const HERE_KEY    = import.meta.env.VITE_HERE_API_KEY    as string | undefined;
const TOMTOM_KEY  = import.meta.env.VITE_TOMTOM_API_KEY  as string | undefined;

/* ── HERE Traffic Flow v7 ────────────────────────────────── */

interface HereFlowResult {
  currentFlow?: {
    speed?: number;
    freeFlow?: number;
    jamFactor?: number;  // 0 (serbest) → 10 (tıkalı)
    traversability?: string;
  };
  location?: { description?: string };
}

async function fetchHereTraffic(lat: number, lng: number): Promise<TrafficSummary> {
  const delta = 0.15;  // ~15 km yarıçap bbox
  const url =
    `https://data.traffic.hereapi.com/v7/flow` +
    `?apiKey=${HERE_KEY}` +
    `&in=bbox:${lng - delta},${lat - delta},${lng + delta},${lat + delta}` +
    `&locationReferencing=shape`;

  const res  = await fetch(url, { signal: signalWithTimeout(8000) });
  if (!res.ok) throw new Error(`HERE HTTP ${res.status}`);
  const data  = await res.json() as { results?: HereFlowResult[] };
  const items = data.results ?? [];

  if (items.length === 0) throw new Error('HERE: boş yanıt');

  // Ortalama jamFactor hesapla
  let totalJam = 0, count = 0;
  const segments: TrafficSegment[] = [];

  for (const item of items.slice(0, 5)) {
    const cf = item.currentFlow;
    if (!cf) continue;
    const jf   = cf.jamFactor ?? 0;
    const lv   = jamFactorToLevel(jf);
    totalJam  += jf;
    count++;
    segments.push({
      label:     item.location?.description ?? 'Segment',
      level:     lv,
      delayMin:  Math.round(jf * 3),
      direction: '',
    });
  }

  const avgJam  = count > 0 ? totalJam / count : 0;
  const level   = jamFactorToLevel(avgJam);

  return {
    level,
    delayMin:   segments.reduce((s, x) => s + x.delayMin, 0),
    updatedAt:  Date.now(),
    segments:   segments.slice(0, 4),
    tileEnabled: !!_state.tileLayerUrl,
    source:     'here',
    road:       null,
    incidents:  [],
  };
}

function jamFactorToLevel(jf: number): TrafficLevel {
  if (jf < 2)   return 'free';
  if (jf < 5)   return 'moderate';
  if (jf < 8)   return 'heavy';
  return 'standstill';
}

/**
 * NAV-5: tek nokta jamFactor'ü (rota trafik renklendirmesi örneklemesi için). HERE anahtarı
 * yoksa null (BYOK). Küçük bbox (~3km) → ilk flow sonucunun jamFactor'ü. Fail-soft, bounded.
 */
export async function fetchHereJamFactorAt(lat: number, lng: number): Promise<number | null> {
  if (!HERE_KEY || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const d = 0.03; // ~3 km bbox (nokta çevresi)
  const url =
    `https://data.traffic.hereapi.com/v7/flow` +
    `?apiKey=${HERE_KEY}` +
    `&in=bbox:${lng - d},${lat - d},${lng + d},${lat + d}` +
    `&locationReferencing=shape`;
  try {
    const res = await fetch(url, { signal: signalWithTimeout(6000) });
    if (!res.ok) return null;
    const data = await res.json() as { results?: HereFlowResult[] };
    const jf = data.results?.[0]?.currentFlow?.jamFactor;
    return typeof jf === 'number' ? jf : null;
  } catch { return null; }
}

/* ── NAV-4: HERE Traffic Incidents v7 → resmi tehlike (kaza/yol kapama) ──── */

interface HereIncidentResult {
  incidentDetails?: { id?: string; type?: string; criticality?: string };
  location?: { shape?: { links?: { points?: { lat: number; lng: number }[] }[] } };
}

/** HERE olay tipi → CarOS HazardType (yalnız sürücüye anlamlı olanlar; gerisi atlanır). */
const _HERE_INCIDENT_MAP: Record<string, HazardType | undefined> = {
  accident:        'ACCIDENT',
  construction:    'CONSTRUCTION',
  roadClosure:     'CONSTRUCTION',
  laneRestriction: 'CONSTRUCTION',
  plannedEvent:    'CONSTRUCTION',
  roadHazard:      'ROAD_DAMAGE',
  disabledVehicle: 'ROAD_DAMAGE',
  weather:         'WEATHER',
  // congestion / massTransit / other → hazard olarak GÖSTERİLMEZ (yoğunluk zaten flow'da)
};

/**
 * Aracın bbox'ındaki resmi trafik olaylarını çeker ve Hazard motoruna enjekte eder
 * (banner + NAV-3 sesli anons). Flow'dan BAĞIMSIZ, best-effort. Dönüş: enjekte edilen sayı.
 */
async function fetchHereIncidents(lat: number, lng: number): Promise<number> {
  const delta = 0.15; // ~15 km bbox
  const url =
    `https://data.traffic.hereapi.com/v7/incidents` +
    `?apiKey=${HERE_KEY}` +
    `&in=bbox:${lng - delta},${lat - delta},${lng + delta},${lat + delta}` +
    `&locationReferencing=shape`;

  const res = await fetch(url, { signal: signalWithTimeout(8000) });
  if (!res.ok) throw new Error(`HERE Incidents HTTP ${res.status}`);
  const data  = await res.json() as { results?: HereIncidentResult[] };
  const items = data.results ?? [];

  let injected = 0;
  for (const it of items.slice(0, 20)) {           // bounded — payload/CPU bütçesi
    const rawType = it.incidentDetails?.type;
    const type    = rawType ? _HERE_INCIDENT_MAP[rawType] : undefined;
    if (!type) continue;                            // ilgisiz/yoğunluk → atla
    const pt = it.location?.shape?.links?.[0]?.points?.[0];
    if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) continue;
    const id = it.incidentDetails?.id ?? `${type}_${pt.lat.toFixed(4)}_${pt.lng.toFixed(4)}`;
    injectOfficialHazard(id, pt.lat, pt.lng, type, 'HERE');
    injected++;
  }
  return injected;
}

/* ── TomTom: akış + olaylar (paralel) ───────────────────── */

async function fetchTomTomTraffic(lat: number, lng: number): Promise<TrafficSummary> {
  const key = TOMTOM_KEY!;
  const [roadR, incR] = await Promise.allSettled([fetchRoad(key, lat, lng), fetchIncidents(key, lat, lng)]);
  const road = roadR.status === 'fulfilled' ? roadR.value : null;
  const incidents = incR.status === 'fulfilled' ? incR.value : [];
  if (roadR.status === 'rejected' && incR.status === 'rejected') throw roadR.reason;
  return {
    level:      road ? road.level : 'free',
    delayMin:   road ? Math.round(road.delaySec / 60) : 0,
    updatedAt:  Date.now(),
    segments:   [],
    tileEnabled: !!_state.tileLayerUrl,
    source:     'tomtom',
    road,
    incidents,
  };
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: TrafficState = {
  summary:      null,
  // TomTom anahtarı varsa resmî akış katmanı (yollar trafiğe göre renklenir).
  tileLayerUrl: TOMTOM_KEY ? flowTileUrl(TOMTOM_KEY) : '',
  showLayer:    false,
  loading:      false,
  error:        null,
  unavailable:  null,
};

let _state: TrafficState = { ...INITIAL };
const _listeners = new Set<(s: TrafficState) => void>();
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _currentLat: number | undefined;
let _currentLng: number | undefined;

function push(partial: Partial<TrafficState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach(fn => fn(_state));
}

/* ── Fetch + fallback ────────────────────────────────────── */

async function loadTraffic(lat?: number, lng?: number): Promise<void> {
  if (!HERE_KEY && !TOMTOM_KEY) { push({ loading: false, summary: null, unavailable: 'no_key' }); return; }
  if (lat == null || lng == null) { push({ loading: false, summary: null, unavailable: 'no_location' }); return; }
  push({ loading: true, error: null });

  // NAV-4: RESMİ OLAYLAR (kaza/yol kapama) — flow'dan BAĞIMSIZ, best-effort. Hazard motoruna
  // enjekte edilir (banner + NAV-3 sesli). Flow başarısız olsa bile olaylar çekilir. Fire-forget.
  if (HERE_KEY) {
    fetchHereIncidents(lat, lng).catch((e) => console.warn('[Traffic] HERE incidents başarısız:', e));
  }

  // 1. TomTom (akış + olaylar + katman — en zengin görünüm)
  if (TOMTOM_KEY) {
    try {
      const summary = await fetchTomTomTraffic(lat, lng);
      push({ loading: false, summary, error: null, unavailable: null });
      return;
    } catch (e) {
      console.warn('[Traffic] TomTom başarısız:', e);
    }
  }

  // 2. HERE
  if (HERE_KEY) {
    try {
      const summary = await fetchHereTraffic(lat, lng);
      push({ loading: false, summary, error: null, unavailable: null });
      return;
    } catch (e) {
      console.warn('[Traffic] HERE başarısız:', e);
    }
  }

  // Veri alınamadı — eski özet SAKLANMAZ (bayat trafik "güncel" gösterilmez).
  push({ loading: false, summary: null, error: 'Trafik verisi alınamadı', unavailable: 'fetch_failed' });
}

/* ── Refresh döngüsü ─────────────────────────────────────── */

function scheduleRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // Anahtar yoksa yenileme döngüsü KURULMAZ (üretilecek veri yok).
  if (!HERE_KEY && !TOMTOM_KEY) return;
  _refreshTimer = setTimeout(() => {
    loadTraffic(_currentLat, _currentLng).catch(() => {});
    scheduleRefresh();
  }, 3 * 60_000);
}

/* ── Public API ──────────────────────────────────────────── */

export function startTrafficService(lat?: number, lng?: number): void {
  _currentLat = lat;
  _currentLng = lng;
  loadTraffic(lat, lng).catch(() => {});
  scheduleRefresh();
}

export function updateTrafficLocation(lat: number, lng?: number): void {
  _currentLat = lat;
  if (lng != null) _currentLng = lng;
  if (!_state.summary || Date.now() - _state.summary.updatedAt > 60_000) {
    loadTraffic(lat, _currentLng).catch(() => {});
  }
}

export function setTrafficTileUrl(url: string): void {
  push({ tileLayerUrl: url });
}

export function setTrafficLayerVisible(visible: boolean): void {
  push({ showLayer: visible });
}

export function getTrafficState(): TrafficState { return _state; }

export function getTrafficCurrentLocation(): { lat: number; lng: number } | null {
  if (_currentLat == null || _currentLng == null) return null;
  return { lat: _currentLat, lng: _currentLng };
}

export function stopTrafficService(): void {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
}

/** Google Maps / TomTom relative renkleriyle uyumlu (yeşil → turuncu → kırmızı → koyu kırmızı). */
export const TRAFFIC_COLORS: Record<TrafficLevel, string> = {
  free:       '#34A853',
  moderate:   '#F9A825',
  heavy:      '#E53935',
  standstill: '#8E1B1B',
};

export const TRAFFIC_LABELS: Record<TrafficLevel, string> = {
  free:       'Açık',
  moderate:   'Orta',
  heavy:      'Yoğun',
  standstill: 'Tıkalı',
};

/* ── React hook ──────────────────────────────────────────── */

export function useTrafficState(): TrafficState {
  const [state, setState] = useState<TrafficState>(_state);
  useEffect(() => {
    setState(_state);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
