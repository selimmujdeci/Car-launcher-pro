/**
 * Traffic Service — Canlı trafik yoğunluğu.
 *
 * İki katman çalışır:
 *   1. Widget özeti: saat + konum bazlı gerçekçi yoğunluk simülasyonu
 *      (API key gerektirmez, her zaman çalışır)
 *   2. Harita katmanı: yapılandırılabilir raster tile sağlayıcı
 *      (TomTom / HERE / MapTiler ücretsiz tier desteklenir)
 *
 * Varsayılan tile URL boşsa harita katmanı gösterilmez;
 * widget özeti yine de çalışır.
 */

import { useState, useEffect } from 'react';

/* ── Tipler ──────────────────────────────────────────────── */

export type TrafficLevel = 'free' | 'moderate' | 'heavy' | 'standstill';

export interface TrafficSegment {
  label:     string;
  level:     TrafficLevel;
  delayMin:  number;   // tahmini gecikme dakika
  direction: string;   // 'E-5 Bağcılar yönü' gibi
}

export interface TrafficSummary {
  level:       TrafficLevel;
  delayMin:    number;        // toplam beklenen gecikme
  updatedAt:   number;        // epoch ms
  segments:    TrafficSegment[];
  tileEnabled: boolean;
}

export interface TrafficState {
  summary:    TrafficSummary | null;
  tileLayerUrl: string;       // boş = katman devre dışı
  showLayer:  boolean;
  loading:    boolean;
}

/* ── Sabit: saatlik yoğunluk profili ────────────────────── */

// 24 saatlik yoğunluk katsayısı (0.0 = boş, 1.0 = tıkalı)
const HOURLY_DENSITY: number[] = [
  0.05, 0.03, 0.02, 0.02, 0.03, 0.10,  // 00-05
  0.30, 0.75, 0.95, 0.80, 0.55, 0.50,  // 06-11
  0.60, 0.55, 0.50, 0.55, 0.70, 0.90,  // 12-17
  0.95, 0.75, 0.50, 0.35, 0.20, 0.10,  // 18-23
];

function levelFromDensity(d: number): TrafficLevel {
  if (d < 0.3) return 'free';
  if (d < 0.6) return 'moderate';
  if (d < 0.85) return 'heavy';
  return 'standstill';
}

const SEGMENT_NAMES = [
  'Çevre Yolu', 'Bağlantı Yolu', 'Bulvar', 'İstasyon Çevresi', 'Ana Cadde',
];

const DIRECTIONS = ['kuzey', 'güney', 'doğu', 'batı'];

function buildSegments(density: number, lat?: number): TrafficSegment[] {
  // Konum bazlı küçük rastgelelik — pseudo-deterministik (konuma göre sabit)
  const seed    = lat ? Math.abs(Math.round(lat * 1000)) % 100 : 42;
  const count   = 3;
  const segs: TrafficSegment[] = [];

  for (let i = 0; i < count; i++) {
    const variation = ((seed * (i + 1) * 17) % 30 - 15) / 100;
    const d   = Math.max(0, Math.min(1, density + variation));
    const lv  = levelFromDensity(d);
    segs.push({
      label:    SEGMENT_NAMES[i % SEGMENT_NAMES.length],
      level:    lv,
      delayMin: lv === 'free' ? 0 : lv === 'moderate' ? 3 + (i * 2) : lv === 'heavy' ? 8 + (i * 3) : 15 + (i * 5),
      direction: DIRECTIONS[(seed + i) % 4],
    });
  }
  return segs;
}

/* ── Modül durumu ────────────────────────────────────────── */

const INITIAL: TrafficState = {
  summary:      null,
  tileLayerUrl: '',
  showLayer:    false,
  loading:      false,
};

let _state: TrafficState = { ...INITIAL };
const _listeners = new Set<(s: TrafficState) => void>();
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _currentLat: number | undefined;

function push(partial: Partial<TrafficState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Özet hesapla ────────────────────────────────────────── */

function computeSummary(lat?: number): TrafficSummary {
  const hour    = new Date().getHours();
  const density = HOURLY_DENSITY[hour] ?? 0.3;
  const level   = levelFromDensity(density);
  const segs    = buildSegments(density, lat);
  const totalDelay = segs.reduce((sum, s) => sum + s.delayMin, 0);

  return {
    level,
    delayMin:  totalDelay,
    updatedAt: Date.now(),
    segments:  segs,
    tileEnabled: !!_state.tileLayerUrl,
  };
}

/* ── Refresh döngüsü ─────────────────────────────────────── */

function scheduleRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    push({ summary: computeSummary(_currentLat) });
    scheduleRefresh();
  }, 5 * 60 * 1000); // 5 dk'da bir güncelle
}

/* ── Public API ──────────────────────────────────────────── */

export function startTrafficService(lat?: number): void {
  _currentLat = lat;
  push({ loading: false, summary: computeSummary(lat) });
  scheduleRefresh();
}

export function updateTrafficLocation(lat: number): void {
  _currentLat = lat;
  // Konuma göre özeti yenile (5 dk cache'i iptal etme)
  if (_state.summary && Date.now() - _state.summary.updatedAt > 60_000) {
    push({ summary: computeSummary(lat) });
  }
}

export function setTrafficTileUrl(url: string): void {
  push({ tileLayerUrl: url });
}

export function setTrafficLayerVisible(visible: boolean): void {
  push({ showLayer: visible });
}

export function getTrafficState(): TrafficState { return _state; }

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
