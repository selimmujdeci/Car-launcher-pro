/**
 * Traffic Learning Engine — Segment Bazlı Hız Öğrenme (v3 — final)
 *
 * HourBucket: { ema, speedSum, count }
 *  - ema      → adaptive EMA, kısa vadeli adaptasyon
 *  - speedSum → tarihsel kümülatif toplam (debug / kalite / analiz)
 *  - count    → confidence ve alpha hesabı temeli
 *
 * Temel formüller:
 *  rawConf   = min(1, count / TARGET)
 *  decayed   = rawConf × (1 − DAILY_DECAY_RATE × ageDays)  — stale koruma
 *  effConf   = count<3 ? min(decayed, count/3 × 0.15) : decayed
 *  alpha     = clamp(0.10, 0.30, 0.10 + 0.20 × rawConf)   — adaptive
 *  finalSpeed = lerp(refSpeed, ema, effConf)               — asla null yok
 *
 * Migration (geriye uyumluluk):
 *  v1: { speedSum, count }           → ema = speedSum / count
 *  v2: { ema, count }                → speedSum ≈ ema × count  [DEV log]
 *  v3: { ema, speedSum, count }      → doğrudan kullan
 *  Başarısız migration → silent fallback reset (crash yok)
 *
 * Korumalar (CLAUDE.md §2-3):
 *  - GPS spam    : per-segment 30 s cooldown
 *  - Disk spam   : 5 s debounce + dirty flag (gereksiz serialize yok)
 *  - Outlier     : obs > ema × 2.5 (cold: > 160 km/h) → reddet
 *  - Spike       : global delta > 80 km/h → reddet, sıfırla
 *  - LRU         : max 500 segment
 *  - Stale       : günlük %7 confidence decay (2 gün → ~%86 güven)
 */

import { refSpeedKmh } from './trafficTypes';
import type { TrafficLevel } from './trafficTypes';

/* ── Sabitler ────────────────────────────────────────────────── */

const STORAGE_KEY             = 'car-traffic-learning-detail-v3';
const FORMAT_VERSION          = 3;

/** Bu count'tan itibaren confidence = 1 (tam güven) */
const TARGET_SAMPLES          = 20;
/** Bu count altı: blend cap devreye girer */
const SOFT_MIN_COUNT          = 3;
/** Düşük count'ta max blend oranı (count=1 → %5, count=2 → %10, count=3 → %15) */
const SOFT_MIN_MAX_CONF       = 0.15;

/** Alpha adaptive sınırları */
const ALPHA_MIN               = 0.10;
const ALPHA_MAX               = 0.30;

/** Stale confidence decay — günlük %7 */
const DAILY_DECAY_RATE        = 0.07;

const PER_SEGMENT_COOLDOWN_MS = 30_000;
const MAX_RECORDS             = 500;
const WRITE_DEBOUNCE_MS       = 5_000;
const MAX_SPEED_KMH           = 300;
const MIN_SPEED_KMH           = 5;
const MAX_COLD_OUTLIER_KMH    = 160;
const OUTLIER_FACTOR          = 2.5;
const MAX_GLOBAL_DELTA_KMH    = 80;

/* ── Dahili yapılar ──────────────────────────────────────────── */

interface HourBucket {
  ema:      number;   // adaptive EMA — kısa vadeli
  speedSum: number;   // kümülatif toplam — tarihsel stabilite
  count:    number;   // gözlem sayısı
}

interface LearningRecord {
  segmentId:     string;
  weekday:       HourBucket[];  // [0..23]
  weekend:       HourBucket[];  // [0..23]
  totalSamples:  number;
  lastUpdatedMs: number;
}

interface StorageEnvelope {
  version: number;
  records: Record<string, LearningRecord>;
  savedMs: number;
}

/* ── Factory ─────────────────────────────────────────────────── */

function _emptyBucket(): HourBucket {
  return { ema: 0, speedSum: 0, count: 0 };
}

function _emptyHours(): HourBucket[] {
  return Array.from({ length: 24 }, _emptyBucket);
}

function _emptyRecord(id: string): LearningRecord {
  return {
    segmentId:     id,
    weekday:       _emptyHours(),
    weekend:       _emptyHours(),
    totalSamples:  0,
    lastUpdatedMs: 0,
  };
}

/* ── Confidence + alpha ──────────────────────────────────────── */

/** Ham confidence — sade count bazlı, decay uygulanmamış */
function _rawConfidence(count: number): number {
  return Math.min(1, count / TARGET_SAMPLES);
}

/**
 * Stale data decay uygulanmış confidence.
 * Günlük %7 azalır.
 * 1 gün → ×0.93 | 2 gün → ×0.86 | 14 gün → ×0.38
 * Sıfırın altına düşmez.
 */
function _decayedConfidence(count: number, lastUpdatedMs: number): number {
  const raw     = _rawConfidence(count);
  const ageDays = Math.max(0, (Date.now() - lastUpdatedMs) / 86_400_000);
  const decay   = Math.max(0, 1 - DAILY_DECAY_RATE * ageDays);
  return raw * decay;
}

/**
 * Etkili confidence — decay + düşük count edge case birleşik.
 *
 * count < SOFT_MIN_COUNT (3) durumunda blend oranı maksimum %15 ile sınırlanır:
 *   count=1 → max 0.05 | count=2 → max 0.10 | count=3 → max 0.15
 *
 * Bu sayede 1–2 gözlemle alınan ema değeri finalSpeed'i fazla çekmez.
 */
function _effectiveConfidence(count: number, lastUpdatedMs: number): number {
  const decayed = _decayedConfidence(count, lastUpdatedMs);

  if (count < SOFT_MIN_COUNT) {
    const cap = (count / SOFT_MIN_COUNT) * SOFT_MIN_MAX_CONF;
    return Math.min(decayed, cap);
  }

  return decayed;
}

/**
 * Adaptive EMA alpha — confidence arttıkça responsiveness artar.
 * conf=0 → alpha=0.10 (conservative) | conf=1 → alpha=0.30 (responsive)
 * Explicit clamp: float precision edge case'lere karşı güvenli.
 */
function _alpha(count: number): number {
  const conf = _rawConfidence(count); // alpha için decay uygulanmaz
  const raw  = ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * conf;
  return Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, raw));
}

/* ── Hız blend — asla null dönmez ───────────────────────────── */

/**
 * finalSpeed = lerp(refSpeed, ema, effectiveConfidence)
 *
 * effConf = 0 → tamamen refSpeed (cold start / stale / düşük sample)
 * effConf = 1 → tamamen ema      (tam güven)
 */
function _blended(
  bucket:        HourBucket,
  lastUpdatedMs: number,
  refSpeed:      number,
): number {
  if (bucket.count === 0) return refSpeed;

  const effConf = _effectiveConfidence(bucket.count, lastUpdatedMs);
  if (effConf <= 0) return refSpeed;

  const emaVal = bucket.ema > 0 ? bucket.ema : refSpeed;
  return refSpeed * (1 - effConf) + emaVal * effConf;
}

/* ── Migration helpers ───────────────────────────────────────── */

/**
 * Eski format bucket'larını v3'e normalize et.
 *
 * v1: { speedSum, count }         — ema = speedSum / count
 * v2: { ema, count }              — speedSum ≈ ema × count  [DEV: precision log]
 * v3: { ema, speedSum, count }    — doğrudan kullan
 */
function _migrateBucket(raw: Record<string, unknown>): HourBucket {
  const count    = typeof raw['count']    === 'number' ? raw['count']    : 0;
  const speedSum = typeof raw['speedSum'] === 'number' ? raw['speedSum'] : 0;
  const rawEma   = typeof raw['ema']      === 'number' ? raw['ema']      : undefined;

  let ema: number;
  let resolvedSpeedSum: number;

  if (rawEma !== undefined && speedSum > 0) {
    // v3: tüm alanlar mevcut
    ema              = rawEma;
    resolvedSpeedSum = speedSum;
  } else if (rawEma !== undefined && speedSum === 0 && count > 0) {
    // v2 migration: speedSum eksik — ema × count yaklaşımı
    ema              = rawEma;
    resolvedSpeedSum = rawEma * count;

    if (import.meta.env.DEV) {
      // Yaklaşım kaybını logla — gerçek toplam bilinemiyor
      console.debug(
        `[TrafficLearning] v2→v3 migration: speedSum≈${resolvedSpeedSum.toFixed(1)} ` +
        `(ema×count approx, actual precision unknown)`,
      );
    }
  } else if (rawEma === undefined && speedSum > 0 && count > 0) {
    // v1 migration: ema eksik — tarihsel ortalamadan türet
    ema              = speedSum / count;
    resolvedSpeedSum = speedSum;
  } else {
    // Tanımsız veya boş bucket
    ema              = 0;
    resolvedSpeedSum = 0;
  }

  return { ema, speedSum: resolvedSpeedSum, count };
}

function _migrateRecord(raw: Record<string, unknown>): LearningRecord | null {
  if (typeof raw['segmentId'] !== 'string') return null;

  const weekdayRaw = raw['weekday'];
  const weekendRaw = raw['weekend'];

  if (!Array.isArray(weekdayRaw) || weekdayRaw.length !== 24) return null;
  if (!Array.isArray(weekendRaw) || weekendRaw.length !== 24) return null;

  return {
    segmentId:     raw['segmentId'] as string,
    weekday:       (weekdayRaw as Record<string, unknown>[]).map(_migrateBucket),
    weekend:       (weekendRaw as Record<string, unknown>[]).map(_migrateBucket),
    totalSamples:  typeof raw['totalSamples']  === 'number' ? raw['totalSamples']  : 0,
    lastUpdatedMs: typeof raw['lastUpdatedMs'] === 'number' ? raw['lastUpdatedMs'] : 0,
  };
}

/* ── Modül state ─────────────────────────────────────────────── */

let _records        = new Map<string, LearningRecord>();
const _lastUpdateMs = new Map<string, number>();
let _globalLastSpeedKmh: number | null = null;
let _writeTimer:    ReturnType<typeof setTimeout> | null = null;
let _lastWrittenJson  = '';
/** Gereksiz serialize önler — sadece veri değişince true */
let _dirty            = false;
let _initialized      = false;

/* ── Yardımcılar ─────────────────────────────────────────────── */

function _isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/* ── LRU eviction ────────────────────────────────────────────── */

function _evictIfNeeded(): void {
  if (_records.size <= MAX_RECORDS) return;
  let oldestMs = Infinity;
  let oldestId = '';
  for (const [id, rec] of _records) {
    if (rec.lastUpdatedMs < oldestMs) {
      oldestMs = rec.lastUpdatedMs;
      oldestId = id;
    }
  }
  if (oldestId) {
    _records.delete(oldestId);
    _lastUpdateMs.delete(oldestId);
  }
}

/* ── Disk I/O ────────────────────────────────────────────────── */

function _serialize(): string {
  const env: StorageEnvelope = {
    version: FORMAT_VERSION,
    records: Object.fromEntries(_records),
    savedMs: Date.now(),
  };
  return JSON.stringify(env);
}

/**
 * Deserialize + migration.
 * Herhangi bir hata → explicit new Map() fallback (crash yok).
 * Desteklenen eski formatlar: version 1, 2, 3.
 */
function _deserialize(raw: string): Map<string, LearningRecord> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return new Map();

    const envelope = parsed as Record<string, unknown>;
    const version  = envelope['version'];

    if (version !== 1 && version !== 2 && version !== 3) {
      if (import.meta.env.DEV) {
        console.warn(`[TrafficLearning] unknown format v${String(version)}, resetting`);
      }
      return new Map();
    }

    const rawRecords = envelope['records'];
    if (typeof rawRecords !== 'object' || rawRecords === null) return new Map();

    const map = new Map<string, LearningRecord>();
    for (const [id, rec] of Object.entries(rawRecords as Record<string, unknown>)) {
      if (typeof rec !== 'object' || rec === null) continue;
      const migrated = _migrateRecord(rec as Record<string, unknown>);
      if (migrated) map.set(id, migrated);
    }

    return map;
  } catch (e) {
    // Parse hatası veya beklenmedik yapı → sessiz sıfırlama
    if (import.meta.env.DEV) {
      console.warn('[TrafficLearning] deserialization failed, resetting:', e);
    }
    return new Map();
  }
}

function _commitWrite(): void {
  if (!_dirty) return; // gereksiz serialize önle
  try {
    const json = _serialize();
    if (json === _lastWrittenJson) { _dirty = false; return; }
    localStorage.setItem(STORAGE_KEY, json);
    _lastWrittenJson = json;
    _dirty = false;
  } catch (e) {
    // Quota / private browsing — sessizce devam, dirty = true kalır
    if (import.meta.env.DEV) console.warn('[TrafficLearning] write failed:', e);
  }
}

function _scheduleWrite(): void {
  if (_writeTimer !== null) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    _commitWrite();
  }, WRITE_DEBOUNCE_MS);
}

function _cancelWrite(): void {
  if (_writeTimer !== null) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
  }
}

/* ── Engine yaşam döngüsü ────────────────────────────────────── */

export function initLearningEngine(): void {
  if (_initialized) return;
  _initialized = true;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      _records = _deserialize(raw);
      return;
    }

    // Eski key'leri de dene — migration
    const legacyKeys = [
      'car-traffic-learning-detail-v2',
      'car-traffic-learning-detail-v1',
    ];
    for (const key of legacyKeys) {
      const legacyRaw = localStorage.getItem(key);
      if (!legacyRaw) continue;
      const loaded = _deserialize(legacyRaw);
      if (loaded.size > 0) {
        _records = loaded;
        _dirty   = true;    // yeni key'e yaz
        _scheduleWrite();
        break;
      }
    }
  } catch {
    _records = new Map(); // son güvenli sıfırlama
  }
}

export function disposeLearningEngine(): void {
  _cancelWrite();
  _commitWrite();
  _records.clear();
  _lastUpdateMs.clear();
  _globalLastSpeedKmh = null;
  _initialized        = false;
  _lastWrittenJson    = '';
  _dirty              = false;
}

/* ══════════════════════════════════════════════════════════════ */
/* ── Public API                                                 */
/* ══════════════════════════════════════════════════════════════ */

/**
 * Öğrenilmiş hız tahmini — asla null dönmez.
 *
 * finalSpeed = lerp(refSpeed, ema, effectiveConfidence)
 *
 * Stale test (2 gün veri yok):
 *   count=20, ageDays=2 → decayed = 1.0 × (1 − 0.07×2) = 0.86
 *   effConf = 0.86 → finalSpeed ≈ %86 EMA, %14 refSpeed
 *
 * Düşük sample test (count=2):
 *   rawConf = 2/20 = 0.1 | cap = (2/3) × 0.15 = 0.10
 *   effConf = min(0.1×decay, 0.10) ≈ 0.09 → neredeyse tamamen refSpeed
 */
export function getLearnedSpeed(
  segmentId:     string,
  hour:          number,
  isWeekend?:    boolean,
  fallbackLevel: TrafficLevel = 'moderate',
): number {
  if (!_initialized) initLearningEngine();

  const refSpeed = refSpeedKmh(fallbackLevel);
  const record   = _records.get(segmentId);
  if (!record) return refSpeed;

  const safeHour = Math.max(0, Math.min(23, Math.round(hour)));
  const weekend  = isWeekend ?? _isWeekend(new Date());
  const bucket   = (weekend ? record.weekend : record.weekday)[safeHour]!;

  return _blended(bucket, record.lastUpdatedMs, refSpeed);
}

/**
 * Etkili confidence (decay + low-count cap dahil).
 * trafficEngine.ts → SegmentTrafficState.confidence için kullanır.
 */
export function getLearnedConfidence(
  segmentId: string,
  hour:      number,
  isWeekend?: boolean,
): number {
  if (!_initialized) initLearningEngine();

  const record = _records.get(segmentId);
  if (!record) return 0;

  const safeHour = Math.max(0, Math.min(23, Math.round(hour)));
  const weekend  = isWeekend ?? _isWeekend(new Date());
  const bucket   = (weekend ? record.weekend : record.weekday)[safeHour]!;

  return _effectiveConfidence(bucket.count, record.lastUpdatedMs);
}

/**
 * GPS gözleminden segment hız profilini güncelle.
 *
 * Test senaryoları:
 *
 * GPS jitter: aynı segmentte 55/56/54 km/h → cooldown korur (30s),
 *   sadece ilk değer yazılır; diğerleri redde düşer.
 *
 * Ani trafik değişimi: 80→25 km/h → delta=55 < MAX_GLOBAL_DELTA (80),
 *   kabul edilir. 80→5 km/h → delta=75 < 80, kabul; MIN_SPEED kontrolü
 *   geçer. 80→3 km/h → MIN_SPEED reddine düşer.
 *
 * Stale segment: lastUpdatedMs=2 gün önce → getLearnedSpeed confidence
 *   decay ile refSpeed'e yaklaşır; updateFromGPS yeni veri gelince ema
 *   ALPHA_MAX (0.30) ile güncellenir.
 */
export function updateFromGPS(
  segmentId:   string,
  observedKmh: number,
  timestampMs: number,
): void {
  if (!_initialized) initLearningEngine();

  /* ── Hız plausibility ────────────────────────────────────── */
  if (
    !Number.isFinite(observedKmh) ||
    observedKmh < MIN_SPEED_KMH   ||
    observedKmh > MAX_SPEED_KMH
  ) return;

  /* ── Timestamp plausibility ──────────────────────────────── */
  const nowMs = Date.now();
  if (timestampMs > nowMs + 5_000 || nowMs - timestampMs > 3_600_000) return;

  /* ── Global spike rejection ──────────────────────────────── */
  if (
    _globalLastSpeedKmh !== null &&
    Math.abs(observedKmh - _globalLastSpeedKmh) > MAX_GLOBAL_DELTA_KMH
  ) {
    _globalLastSpeedKmh = null;
    return;
  }
  _globalLastSpeedKmh = observedKmh;

  /* ── Per-segment cooldown ────────────────────────────────── */
  const lastMs = _lastUpdateMs.get(segmentId) ?? 0;
  if (timestampMs - lastMs < PER_SEGMENT_COOLDOWN_MS) return;
  _lastUpdateMs.set(segmentId, timestampMs);

  /* ── Outlier filtresi ────────────────────────────────────── */
  let record = _records.get(segmentId);
  const date    = new Date(timestampMs);
  const hour    = date.getHours();
  const weekend = _isWeekend(date);

  if (record) {
    const bucket   = (weekend ? record.weekend : record.weekday)[hour]!;
    const maxAllow = bucket.count > 0
      ? bucket.ema * OUTLIER_FACTOR
      : MAX_COLD_OUTLIER_KMH;
    if (observedKmh > maxAllow) return;
  }

  /* ── Record oluştur ──────────────────────────────────────── */
  if (!record) {
    record = _emptyRecord(segmentId);
    _records.set(segmentId, record);
    _evictIfNeeded();
  }

  /* ── Adaptive EMA + speedSum güncelle ───────────────────── */
  const bucket = (weekend ? record.weekend : record.weekday)[hour]!;
  const alpha  = _alpha(bucket.count); // pre-update count ile hesapla

  bucket.ema      = bucket.count === 0
    ? observedKmh                                          // ilk gözlem: saf başlangıç
    : bucket.ema * (1 - alpha) + observedKmh * alpha;     // EMA güncelle

  bucket.speedSum       += observedKmh; // tarihsel toplam — korunur
  bucket.count          += 1;
  record.totalSamples   += 1;
  record.lastUpdatedMs   = timestampMs;

  /* ── Dirty flag + debounced write ───────────────────────── */
  _dirty = true;
  _scheduleWrite();
}

/* ── Yardımcı sorgular ───────────────────────────────────────── */

/** Toplam gözlem sayısı. */
export function getSegmentSampleCount(segmentId: string): number {
  return _records.get(segmentId)?.totalSamples ?? 0;
}

/**
 * Saatlik profil — her bucket için ema, historicalAvg, count.
 * historicalAvg = speedSum / count — EMA'dan bağımsız doğrulama için.
 */
export function getSegmentProfile(
  segmentId: string,
): {
  weekday: ReadonlyArray<Readonly<HourBucket>>;
  weekend: ReadonlyArray<Readonly<HourBucket>>;
} | null {
  const rec = _records.get(segmentId);
  if (!rec) return null;
  return { weekday: rec.weekday, weekend: rec.weekend };
}

/**
 * Saatlik diagnostik — EMA ile tarihsel ortalama karşılaştırması.
 * Büyük sapma = EMA anlamlı kısa vadeli değişim yakaladı.
 */
export function getHourDiagnostics(
  segmentId: string,
  hour:      number,
  isWeekend = false,
): {
  ema:            number;
  historicalAvg:  number;
  speedSum:       number;
  count:          number;
  rawConfidence:  number;
  effectiveConf:  number;
  alpha:          number;
  lastUpdatedMs:  number;
} | null {
  if (!_initialized) initLearningEngine();

  const record = _records.get(segmentId);
  if (!record) return null;

  const safeHour = Math.max(0, Math.min(23, hour));
  const bucket   = (isWeekend ? record.weekend : record.weekday)[safeHour]!;

  return {
    ema:           bucket.ema,
    historicalAvg: bucket.count > 0 ? bucket.speedSum / bucket.count : 0,
    speedSum:      bucket.speedSum,
    count:         bucket.count,
    rawConfidence: _rawConfidence(bucket.count),
    effectiveConf: _effectiveConfidence(bucket.count, record.lastUpdatedMs),
    alpha:         _alpha(bucket.count),
    lastUpdatedMs: record.lastUpdatedMs,
  };
}

/** Bekleyen yazımı hemen flush et — app kapanması için. */
export function flushLearningWrite(): void {
  _cancelWrite();
  _commitWrite();
}

/** Tüm öğrenilmiş veriyi sil — kullanıcı "geçmişi temizle". */
export function clearLearningData(): void {
  _cancelWrite();
  _records.clear();
  _lastUpdateMs.clear();
  _globalLastSpeedKmh = null;
  _lastWrittenJson    = '';
  _dirty              = false;
  const keysToRemove = [
    STORAGE_KEY,
    'car-traffic-learning-detail-v1',
    'car-traffic-learning-detail-v2',
  ];
  for (const k of keysToRemove) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

/** Engine özet istatistikleri. */
export function getLearningStats(): {
  totalSegments: number;
  totalSamples:  number;
  oldestMs:      number;
  newestMs:      number;
} {
  let totalSamples = 0;
  let oldestMs     = Infinity;
  let newestMs     = 0;
  for (const rec of _records.values()) {
    totalSamples += rec.totalSamples;
    if (rec.lastUpdatedMs < oldestMs) oldestMs = rec.lastUpdatedMs;
    if (rec.lastUpdatedMs > newestMs) newestMs = rec.lastUpdatedMs;
  }
  return {
    totalSegments: _records.size,
    totalSamples,
    oldestMs:      oldestMs === Infinity ? 0 : oldestMs,
    newestMs,
  };
}

/* ── Visibility change → flush ───────────────────────────────── */

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLearningWrite();
  }, { passive: true });
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeLearningEngine());
}
