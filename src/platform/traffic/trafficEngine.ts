/**
 * Traffic Engine — Merkezi Traffic Intelligence Orchestratör
 *
 * Tüm veri kaynaklarını (historical, learned, live-API) birleştirir ve
 * tek bir TrafficIntelligenceState üretir.
 *
 * Mimari:
 *  - Saf module-level push state (useSyncExternalStore uyumlu)
 *  - React import YOK — servis katmanında kalır
 *  - routingService / navigationService'e YAZMAZ, sadece OKUR
 *  - OBD + GPS verisi sanity-check edilir (CLAUDE.md §2)
 *  - Tüm timer/listener/subscription'lar dispose() ile temizlenir
 *
 * GPS update throttle:
 *  Sürüş sırasında GPS saniyede gelebilir.
 *  Engine yalnızca 10s'de bir veya 300m+ hareket varsa yeniden hesaplar.
 */

import { useSyncExternalStore } from 'react';
import type {
  TrafficIntelligenceState,
  SegmentTrafficState,
  RouteCostResult,
  LatLng,
} from './trafficTypes';
import { predictRouteSegments } from './trafficPredictionEngine';
import { computeRouteCost } from './trafficRouteCost';
import {
  getCachedSegment,
  setCachedSegment,
  disposeTrafficCache,
} from './trafficCache';
import {
  initLearningEngine,
  disposeLearningEngine,
  getLearnedSpeed,
  getLearnedConfidence,
  updateFromGPS as learningUpdateFromGPS,
  flushLearningWrite,
} from './trafficLearningEngine';
import {
  startSuggestionEngine,
  stopSuggestionEngine,
  triggerSuggestionCheck,
  getLastSuggestion,
} from './trafficSuggestionEngine';
import {
  startApiAdapter,
  stopApiAdapter,
  getLiveSpeedsCached,
  levelFromLiveSpeed,
} from './trafficApiAdapters';
import { onOBDData } from '../obdService';
import type { OBDData } from '../obdService';

/* ── Sabitler ────────────────────────────────────────────────── */

/** Engine yeniden hesaplama için minimum GPS hareketi (metre) */
const MIN_MOVE_METERS    = 300;

/** Engine yeniden hesaplama için minimum süre (saniye) */
const MIN_RECALC_SEC     = 10;

/** Trafik verisinin taze sayıldığı maksimum yaş (dakika) */
const FRESH_THRESHOLD_MIN = 10;

/** GPS hız plausibility sınırı (CLAUDE.md §2 sensor resiliency) */
const MAX_PLAUSIBLE_SPEED_KMH = 300;

/* ── Boş başlangıç state ─────────────────────────────────────── */

const EMPTY_ROUTE_COST: RouteCostResult = {
  baseSeconds:            0,
  trafficDelaySeconds:    0,
  junctionPenaltySeconds: 0,
  adjustedSeconds:        0,
  avgConfidence:          0,
  segmentCount:           0,
};

const INITIAL: TrafficIntelligenceState = {
  segments:      [],
  routeCost:     null,
  alerts:        [],
  alternatives:  [],
  lastRefreshMs: 0,
  isFresh:       false,
};

/* ── Module-level state ──────────────────────────────────────── */

let _state: TrafficIntelligenceState = { ...INITIAL };
const _listeners = new Set<() => void>();

/** Son GPS konumu */
let _lastLat:  number | null = null;
let _lastLng:  number | null = null;
let _lastCalcMs = 0;

/** Mevcut rota geometrisi ([lon, lat][] OSRM format) */
let _routeGeometry: [number, number][] | null = null;

/** OBD unsubscribe fonksiyonu */
let _obdUnsub: (() => void) | null = null;

/** Periyodik refresh timer */
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Engine çalışıyor mu */
let _running = false;

/* ── State yönetimi ──────────────────────────────────────────── */

function _push(partial: Partial<TrafficIntelligenceState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn());
}

/* ── Haversine (bağımsız — dışa import yok) ─────────────────── */

function _haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Segmentleri hesapla ve cache yaz ───────────────────────── */

function _buildSegments(geometry: [number, number][]): SegmentTrafficState[] {
  const predicted = predictRouteSegments(geometry, 50);
  const now       = new Date();
  const hour      = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const nowMs     = Date.now();

  // Adapter cache'den tüm segmentler için anlık hızları al (senkron).
  // Stale segmentler adapter tarafından arka planda refresh kuyruğuna eklenir.
  const segmentIds   = predicted.map((s) => s.segmentId);
  const liveApiSpeeds = getLiveSpeedsCached(segmentIds);

  return predicted.map((seg) => {
    // 1. Live API speed (adapter cache, 30s TTL) — en güvenilir
    const liveSpeed = liveApiSpeeds.get(seg.segmentId);
    if (liveSpeed !== undefined && liveSpeed > 0) {
      const liveSeg: SegmentTrafficState = {
        ...seg,
        avgSpeedKmh:      liveSpeed,
        level:            levelFromLiveSpeed(liveSpeed),
        confidence:       0.95,
        source:           'live',
        timestampMs:      nowMs,
        expectedDelaySec: _recomputeDelay(seg.expectedDelaySec, seg.avgSpeedKmh, liveSpeed),
      };
      setCachedSegment(liveSeg);
      return liveSeg;
    }

    // 2. trafficCache live segment (injectLiveSegment() ile push edilmiş)
    const cached = getCachedSegment(seg.segmentId);
    if (cached && cached.source === 'live' && cached.confidence >= seg.confidence) {
      return cached;
    }

    // 3. Learned data — historical'dan daha güvenilirse kullan
    const learnedConf = getLearnedConfidence(seg.segmentId, hour, isWeekend);
    if (learnedConf > seg.confidence) {
      const learnedSpeed = getLearnedSpeed(seg.segmentId, hour, isWeekend, seg.level);
      const learnedSeg: SegmentTrafficState = {
        ...seg,
        avgSpeedKmh:      learnedSpeed,
        confidence:       learnedConf,
        source:           'learned',
        timestampMs:      nowMs,
        expectedDelaySec: _recomputeDelay(seg.expectedDelaySec, seg.avgSpeedKmh, learnedSpeed),
      };
      setCachedSegment(learnedSeg);
      return learnedSeg;
    }

    // 4. Historical tahmin (fallback)
    if (cached && cached.confidence >= seg.confidence) return cached;
    setCachedSegment(seg);
    return seg;
  });
}

/** Learned hız farkına göre gecikme oranını ölçekler */
function _recomputeDelay(baseDelaySec: number, oldSpeedKmh: number, newSpeedKmh: number): number {
  if (newSpeedKmh <= 0 || oldSpeedKmh <= 0) return baseDelaySec;
  // Gecikme hızla ters orantılı: daha hızlı → daha az gecikme
  const scaled = Math.round(baseDelaySec * (oldSpeedKmh / newSpeedKmh));
  return Math.max(0, scaled);
}

/* ── Rota maliyet hesabı ─────────────────────────────────────── */

function _buildRouteCost(
  segments:     SegmentTrafficState[],
  baseDurationS: number,
  stepCount:    number,
): RouteCostResult {
  if (baseDurationS <= 0 || segments.length === 0) return EMPTY_ROUTE_COST;
  return computeRouteCost(baseDurationS, segments, stepCount);
}

/* ── Ana recalculate ─────────────────────────────────────────── */

function _recalculate(
  geometry:      [number, number][],
  baseDurationS: number,
  stepCount:     number,
): void {
  const segments  = _buildSegments(geometry);
  const routeCost = _buildRouteCost(segments, baseDurationS, stepCount);
  const nowMs     = Date.now();

  // Öneri motoruna yeni segment durumunu bildir (10s throttle içinde)
  // Tek rota: [{ segments, baseEtaSec }], 0 — multi-route ADAS için slice burayı genişletir
  triggerSuggestionCheck([{ segments, baseEtaSec: baseDurationS }], 0);

  // triggerSuggestionCheck senkron — sonucu hemen okuyabiliriz
  const sug = getLastSuggestion();

  _push({
    segments,
    routeCost,
    alerts:       [],
    alternatives: sug.alternative ? [sug.alternative] : [],
    lastRefreshMs: nowMs,
    isFresh:      true,
  });
}

/* ── GPS throttle guard ──────────────────────────────────────── */

function _shouldRecalcOnGPS(lat: number, lng: number): boolean {
  const nowMs  = Date.now();
  const elapsedS = (nowMs - _lastCalcMs) / 1_000;
  if (elapsedS < MIN_RECALC_SEC) return false;

  if (_lastLat === null || _lastLng === null) return true;

  const moved = _haversineM(_lastLat, _lastLng, lat, lng);
  return moved >= MIN_MOVE_METERS;
}

/* ── OBD data handler ────────────────────────────────────────── */

function _onObd(data: OBDData): void {
  // Plausibility check (CLAUDE.md §2)
  const speed = data.speed;
  if (speed < 0 || speed > MAX_PLAUSIBLE_SPEED_KMH) return;

  // Araç dururken trafik yeniden hesaplama — düşük değer sessiz geçiş
  if (speed < 5 && _state.segments.length > 0) return;
}

/* ── Periyodik refresh (10 dakika) ───────────────────────────── */

function _startRefreshTimer(): void {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(() => {
    if (!_running || !_routeGeometry) return;

    // isFresh süresi dolmuşsa yeniden hesapla
    const ageMin = (Date.now() - _state.lastRefreshMs) / 60_000;
    if (ageMin >= FRESH_THRESHOLD_MIN) {
      _push({ isFresh: false });
    }
  }, 60_000); // Her 1 dakikada freshness kontrolü
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Engine'i başlat.
 * İdempotent — birden fazla kez çağrılabilir.
 */
export function startTrafficEngine(): void {
  if (_running) return;
  _running = true;

  initLearningEngine();
  startSuggestionEngine();
  startApiAdapter();

  // OBD subscriber
  _obdUnsub = onOBDData(_onObd);

  _startRefreshTimer();
}

/**
 * Rota değiştiğinde çağrılır.
 * routingService.ts'ten yeni rota alındığında FullMapView bu fonksiyonu çağırır.
 *
 * @param geometry     OSRM [lon, lat][] formatında rota koordinatları
 * @param baseDurationS OSRM toplam süre (saniye)
 * @param stepCount    Rota adım sayısı (kavşak penalty için)
 */
export function updateTrafficRoute(
  geometry:      [number, number][],
  baseDurationS: number,
  stepCount:     number,
): void {
  _routeGeometry = geometry;
  _lastCalcMs    = Date.now();
  _recalculate(geometry, baseDurationS, stepCount);
}

/**
 * GPS güncellendiğinde çağrılır.
 * Throttle korumalı — her çağrıda hesap yapmaz.
 */
export function updateTrafficGPS(lat: number, lng: number, speedKmh?: number): void {
  if (!_running || !_routeGeometry) return;

  // Plausibility check
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

  // Geçerli hız varsa yakın segmentleri learning engine'e besle
  if (
    speedKmh !== undefined &&
    Number.isFinite(speedKmh) &&
    speedKmh >= 0 &&
    speedKmh <= MAX_PLAUSIBLE_SPEED_KMH &&
    _state.segments.length > 0
  ) {
    const nowMs = Date.now();
    // En yakın 3 segmenti öğren (tüm rotayı değil — pozisyona yakın olanlar)
    const nearbyLimit = Math.min(3, _state.segments.length);
    for (let i = 0; i < nearbyLimit; i++) {
      const seg = _state.segments[i];
      if (seg) {
        learningUpdateFromGPS(seg.segmentId, speedKmh, nowMs);
      }
    }
  }

  if (!_shouldRecalcOnGPS(lat, lng)) return;

  _lastLat  = lat;
  _lastLng  = lng;
  _lastCalcMs = Date.now();

  // GPS değişince tarihsel tahmini yenile (live API yoksa)
  _recalculate(
    _routeGeometry,
    _state.routeCost?.baseSeconds ?? 0,
    _state.segments.length,
  );
}

/**
 * Live API'den segment verisi geldiğinde çağrılır.
 * trafficApiAdapters.ts bu fonksiyonu çağırır.
 */
export function injectLiveSegment(segment: SegmentTrafficState): void {
  if (!_running) return;
  setCachedSegment(segment);

  // State'teki mevcut segmenti güncelle
  const updated = _state.segments.map((s) =>
    s.segmentId === segment.segmentId ? segment : s,
  );

  if (updated.length === _state.segments.length) {
    _push({ segments: updated });
  }
}

/**
 * Navigasyon durduğunda rotayı temizle.
 */
export function clearTrafficRoute(): void {
  _routeGeometry = null;
  _lastCalcMs    = 0;
  _push({ ...INITIAL, lastRefreshMs: Date.now() });
}

/**
 * Engine'i tamamen durdur ve temizle.
 */
export function stopTrafficEngine(): void {
  _running = false;

  if (_obdUnsub) { _obdUnsub(); _obdUnsub = null; }
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }

  _routeGeometry = null;
  _lastLat = null;
  _lastLng = null;
  _lastCalcMs = 0;

  flushLearningWrite();
  disposeLearningEngine();
  stopSuggestionEngine();
  stopApiAdapter();
  disposeTrafficCache();
  _push({ ...INITIAL });
}

/* ── External subscription (non-React) ──────────────────────── */

export function onTrafficIntelligence(fn: (s: TrafficIntelligenceState) => void): () => void {
  const wrapped = () => fn(_state);
  _listeners.add(wrapped);
  wrapped(); // ilk değeri hemen gönder
  return () => _listeners.delete(wrapped);
}

/* ── Getter ──────────────────────────────────────────────────── */

export function getTrafficIntelligence(): TrafficIntelligenceState {
  return _state;
}

/* ── React hook — useSyncExternalStore pattern ───────────────── */

export function useTrafficIntelligence(): TrafficIntelligenceState {
  return useSyncExternalStore(
    (onStoreChange) => {
      _listeners.add(onStoreChange);
      return () => { _listeners.delete(onStoreChange); };
    },
    () => _state,
    () => INITIAL,
  );
}

/**
 * Hafif selector hook — sadece routeCost değiştiğinde render tetikler.
 * NavigationHUD için.
 */
export function useTrafficRouteCost(): RouteCostResult | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      _listeners.add(onStoreChange);
      return () => { _listeners.delete(onStoreChange); };
    },
    () => _state.routeCost,
    () => null,
  );
}

/**
 * Koordinat dönüştürücü — LatLng → kullanıcı arayüzü için.
 * Engine dışında ihtiyaç duyulursa buradan re-export edilir.
 */
export type { LatLng };

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopTrafficEngine());
}
