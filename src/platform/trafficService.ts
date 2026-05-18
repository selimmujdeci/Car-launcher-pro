/**
 * Traffic Service — Gerçek zamanlı trafik verisi.
 *
 * Öncelik sırası:
 *   1. HERE Traffic Flow v7 API   (VITE_HERE_API_KEY varsa)
 *   2. TomTom Traffic Flow API    (VITE_TOMTOM_API_KEY varsa)
 *   3. Saat bazlı tahmin          (hiçbir key yoksa, sadece "Tahmini" olarak işaretlenir)
 *
 * Kaynak: trafficSummary.source  →  'here' | 'tomtom' | 'estimated'
 */

import { useState, useEffect } from 'react';

/* ── Tipler ──────────────────────────────────────────────── */

export type TrafficLevel  = 'free' | 'moderate' | 'heavy' | 'standstill';
export type TrafficSource = 'here' | 'tomtom' | 'estimated';

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
}

export interface TrafficState {
  summary:      TrafficSummary | null;
  tileLayerUrl: string;
  showLayer:    boolean;
  loading:      boolean;
  error:        string | null;
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

  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
  };
}

function jamFactorToLevel(jf: number): TrafficLevel {
  if (jf < 2)   return 'free';
  if (jf < 5)   return 'moderate';
  if (jf < 8)   return 'heavy';
  return 'standstill';
}

/* ── TomTom Traffic Flow ─────────────────────────────────── */

async function fetchTomTomTraffic(lat: number, lng: number): Promise<TrafficSummary> {
  // flowSegmentData: tek nokta için anlık hız
  const url =
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
    `?key=${TOMTOM_KEY}` +
    `&point=${lat},${lng}`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
  const data  = await res.json() as {
    flowSegmentData?: {
      currentSpeed?: number;
      freeFlowSpeed?: number;
      currentTravelTime?: number;
      freeFlowTravelTime?: number;
      confidence?: number;
    };
  };
  const fd = data.flowSegmentData;
  if (!fd) throw new Error('TomTom: boş yanıt');

  const current  = fd.currentSpeed    ?? 0;
  const freeFlow = fd.freeFlowSpeed   ?? 80;
  const ratio    = freeFlow > 0 ? current / freeFlow : 1;

  const level = speedRatioToLevel(ratio);
  const delay = Math.max(0, Math.round(
    ((fd.currentTravelTime ?? 0) - (fd.freeFlowTravelTime ?? 0)) / 60,
  ));

  const segments: TrafficSegment[] = [
    { label: 'Anlık güzergah', level, delayMin: delay, direction: '' },
  ];

  return {
    level,
    delayMin:   delay,
    updatedAt:  Date.now(),
    segments,
    tileEnabled: !!_state.tileLayerUrl,
    source:     'tomtom',
  };
}

function speedRatioToLevel(ratio: number): TrafficLevel {
  if (ratio >= 0.80) return 'free';
  if (ratio >= 0.55) return 'moderate';
  if (ratio >= 0.30) return 'heavy';
  return 'standstill';
}

/* ── Saat bazlı tahmin (fallback) ────────────────────────── */

const HOURLY_DENSITY: number[] = [
  0.05, 0.03, 0.02, 0.02, 0.03, 0.10,
  0.30, 0.75, 0.95, 0.80, 0.55, 0.50,
  0.60, 0.55, 0.50, 0.55, 0.70, 0.90,
  0.95, 0.75, 0.50, 0.35, 0.20, 0.10,
];

const SEGMENT_NAMES = ['Çevre Yolu', 'Bağlantı Yolu', 'Bulvar', 'İstasyon Çevresi', 'Ana Cadde'];
const DIRECTIONS    = ['kuzey', 'güney', 'doğu', 'batı'];

function densityToLevel(d: number): TrafficLevel {
  if (d < 0.3)  return 'free';
  if (d < 0.6)  return 'moderate';
  if (d < 0.85) return 'heavy';
  return 'standstill';
}

function buildEstimatedSummary(lat?: number): TrafficSummary {
  const hour    = new Date().getHours();
  const density = HOURLY_DENSITY[hour] ?? 0.3;
  const level   = densityToLevel(density);
  const seed    = lat ? Math.abs(Math.round(lat * 1000)) % 100 : 42;

  const segments: TrafficSegment[] = Array.from({ length: 3 }, (_, i) => {
    const variation = ((seed * (i + 1) * 17) % 30 - 15) / 100;
    const d = Math.max(0, Math.min(1, density + variation));
    const lv = densityToLevel(d);
    return {
      label:    SEGMENT_NAMES[i % SEGMENT_NAMES.length],
      level:    lv,
      delayMin: lv === 'free' ? 0 : lv === 'moderate' ? 3 + i * 2 : lv === 'heavy' ? 8 + i * 3 : 15 + i * 5,
      direction: DIRECTIONS[(seed + i) % 4],
    };
  });

  return {
    level,
    delayMin:   segments.reduce((s, x) => s + x.delayMin, 0),
    updatedAt:  Date.now(),
    segments,
    tileEnabled: !!_state.tileLayerUrl,
    source:     'estimated',
  };
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: TrafficState = {
  summary:      null,
  tileLayerUrl: '',
  showLayer:    false,
  loading:      false,
  error:        null,
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
  push({ loading: true, error: null });

  // 1. HERE
  if (HERE_KEY && lat != null && lng != null) {
    try {
      const summary = await fetchHereTraffic(lat, lng);
      push({ loading: false, summary, error: null });
      return;
    } catch (e) {
      console.warn('[Traffic] HERE başarısız:', e);
    }
  }

  // 2. TomTom
  if (TOMTOM_KEY && lat != null && lng != null) {
    try {
      const summary = await fetchTomTomTraffic(lat, lng);
      push({ loading: false, summary, error: null });
      return;
    } catch (e) {
      console.warn('[Traffic] TomTom başarısız:', e);
    }
  }

  // 3. Saat bazlı tahmin
  push({ loading: false, summary: buildEstimatedSummary(lat), error: null });
}

/* ── Refresh döngüsü ─────────────────────────────────────── */

function scheduleRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // Gerçek API varsa 5 dk, tahmin ise 10 dk
  const hasApi = !!(HERE_KEY || TOMTOM_KEY);
  _refreshTimer = setTimeout(() => {
    loadTraffic(_currentLat, _currentLng).catch(() => {});
    scheduleRefresh();
  }, hasApi ? 5 * 60_000 : 10 * 60_000);
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
  if (_state.summary && Date.now() - _state.summary.updatedAt > 60_000) {
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

export const TRAFFIC_COLORS: Record<TrafficLevel, string> = {
  free:       '#22c55e',
  moderate:   '#f59e0b',
  heavy:      '#ef4444',
  standstill: '#7c3aed',
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
