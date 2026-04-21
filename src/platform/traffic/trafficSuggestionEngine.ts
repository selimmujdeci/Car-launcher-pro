/**
 * Traffic Suggestion Engine v2 — Çok Rotalı Karar Motoru
 *
 * Birden fazla rota adayını live + learned + historical blend üzerinden
 * değerlendirir ve en avantajlı rotayı önerir.
 *
 * Rota değerlendirme modeli:
 *   _evaluateRoute(route)
 *     → her segment için effectiveSpeed (zaten trafficEngine'in seçtiği)
 *     → totalTimeSec = baseEtaSec + Σ(segmentAdjustments)
 *     → avgConfidence, segmentCoverage, liveDataRatio, overallFreshness
 *     → routeScore = savingVsBase × avgConfidence × overallFreshness
 *
 * Öneri eşikleri:
 *   savingSeconds  ≥ 30   — küçük fark görmezden gelinir
 *   avgConfidence  ≥ 0.40 — yetersiz veriyle öneri yapılmaz
 *   segmentCoverage ≥ 0.60 — rotanın %60'ı kapsanmalı (live OR learned)
 *
 * Fallback garantisi:
 *   live veri yoksa learned + historical ile çalışır.
 *   Segmentlerin zaten seçilmiş (live>learned>historical) avgSpeedKmh kullanılır.
 *   Engine asla throw yapmaz, asla null döndürmez.
 *
 * trafficEngine entegrasyonu (bozulmaz):
 *   triggerSuggestionCheck([{ segments, baseEtaSec }], 0)
 *   getLastSuggestion() → SuggestionResult
 *
 * DEV modu: her route için score breakdown console.debug'a loglanır.
 */

import type { SegmentTrafficState, RouteAlternative } from './trafficTypes';
import { refSpeedKmh }                                from './trafficTypes';
import { getHourDiagnostics }                         from './trafficLearningEngine';

/* ── Sabitler ────────────────────────────────────────────────── */

/** Öneri için minimum süre kazancı (saniye) */
const MIN_SUGGESTION_GAIN_SEC  = 30;

/** Önerilen rotanın minimum ortalama güveni */
const MIN_CONFIDENCE            = 0.40;

/** Kapsanmış segment minimum oranı (live veya learned) */
const MIN_SEGMENT_COVERAGE      = 0.60;

/** Bir segmentin "kapsanmış" sayılması için minimum güven */
const MIN_COVERAGE_CONF         = 0.30;

/** Tekrar hesaplama için minimum süre (saniye) */
const THROTTLE_SEC              = 10;

/** Freshness taban değeri — çok eski veri için */
const FRESHNESS_MIN             = 0.70;

/** Bu süre (saat) geçince freshness FRESHNESS_MIN'e iner */
const FRESHNESS_FULL_DECAY_H    = 24;

/* ── Stability / hysteresis sabitleri ───────────────────────── */

/** Öneri kabul edildikten sonra yeni öneri için bekleme süresi (ms) */
const COOLDOWN_MS               = 60_000;

/** Kilitli rotayı override etmek için minimum iyileşme oranı */
const OVERRIDE_MIN_IMPROVEMENT  = 0.20;   // %20

/** Öneri üretmeden önce aynı rotanın üst üste "iyi" görünmesi gereken döngü */
const MIN_PERSISTENCE_CYCLES    = 2;

/**
 * Aktif öneri iptal eşiği — START eşiğinden (30s) düşük tutulur.
 * Saving bu değerin altına düşmedikçe aktif öneri ekranda kalır.
 */
const HYSTERESIS_CANCEL_SEC     = 15;

/* ── Public tip tanımları ────────────────────────────────────── */

/** Bir rota adayı — triggerSuggestionCheck'e geçilir */
export interface RouteCandidate {
  /** trafficEngine'in ürettiği segment durumu listesi */
  segments:   SegmentTrafficState[];
  /** OSRM'den gelen ham süre (saniye) */
  baseEtaSec: number;
}

/** Segment bazlı skor detayı (DEV diagnostics) */
export interface SegmentScore {
  segmentId:        string;
  historicalSpeed:  number;
  effectiveSpeed:   number;   // trafficEngine'in seçtiği en iyi hız
  adjustSec:        number;   // + = bu segment beklentiden yavaş
  confidence:       number;
  freshness:        number;
  source:           string;
}

/** Tek bir rota adayının tam değerlendirmesi */
export interface RouteEvaluation {
  routeIndex:       number;
  baseEtaSec:       number;
  /** live + learned + historical blend ile hesaplanan toplam süre */
  totalTimeSec:     number;
  /** base rotaya göre fark: + = bu rota daha yavaş, − = daha hızlı */
  delayVsBaseSec:   number;
  avgConfidence:    number;
  /** live kaynaklı segment oranı — 0 olabilir, öneri yine de çalışır */
  liveDataRatio:    number;
  /** conf ≥ MIN_COVERAGE_CONF olan segment oranı */
  segmentCoverage:  number;
  overallFreshness: number;
  /** Rota skoru: savingVsBase × confidence × freshness */
  score:            number;
  segmentScores:    SegmentScore[];  // DEV'de dolu, PROD'da boş
}

/** Karar motoru çıktısı */
export interface SuggestionResult {
  hasSuggestion:    boolean;
  /** Seçilen en iyi rota indeksi (base ile aynıysa öneri yok) */
  bestRouteIndex:   number;
  /** Base rotaya göre kazanılan süre (saniye) — öneri yoksa 0 */
  savingSeconds:    number;
  /** Eski API compat: savingSeconds ile eşdeğer */
  totalTimeGainSec: number;
  percentSlower:    number;
  reason:           string;
  /** Seçilen rotanın güveni — threshold altındaysa hasSuggestion false */
  confidence:       number;
  alternative:      RouteAlternative | null;
  computedAtMs:     number;
  /** DEV'de tüm rotaların tam değerlendirmesi, PROD'da boş */
  routeEvaluations: RouteEvaluation[];
}

/* ── Boş başlangıç ───────────────────────────────────────────── */

const EMPTY_RESULT: SuggestionResult = {
  hasSuggestion:    false,
  bestRouteIndex:   0,
  savingSeconds:    0,
  totalTimeGainSec: 0,
  percentSlower:    0,
  reason:           '',
  confidence:       0,
  alternative:      null,
  computedAtMs:     0,
  routeEvaluations: [],
};

/* ── Module state ────────────────────────────────────────────── */

let _lastCheckMs   = 0;
let _lastResult    = { ...EMPTY_RESULT };
let _running       = false;
let _suggestionSeq = 0;

const _listeners = new Set<(r: SuggestionResult) => void>();

/* ── Stability state ─────────────────────────────────────────── */

interface StabilityState {
  /** Son kabul edilen önerinin zamanı — cooldown hesabı için */
  lastSuggestionMs:  number;
  /** Kilitlenen rota indeksi — override kararı için. -1 = kilit yok */
  lockedRouteIndex:  number;
  /** Kilitlenen önerinin saving değeri (saniye) — %20 kıyaslaması için */
  lastScore:         number;
}

const _stability: StabilityState = {
  lastSuggestionMs: 0,
  lockedRouteIndex: -1,
  lastScore:        0,
};

/**
 * rota indeksi → üst üste "iyi" döngü sayısı.
 * MIN_PERSISTENCE_CYCLES karşılaşana kadar öneri üretilmez.
 */
const _consecutiveCycles = new Map<number, number>();

/* ── Freshness hesabı (değişmedi) ────────────────────────────── */

function _freshness(lastUpdatedMs: number): number {
  if (lastUpdatedMs <= 0) return FRESHNESS_MIN;
  const ageHours = (Date.now() - lastUpdatedMs) / 3_600_000;
  const t        = Math.min(1, ageHours / FRESHNESS_FULL_DECAY_H);
  return 1.0 - t * (1.0 - FRESHNESS_MIN);
}

/* ── Boş route evaluation ─────────────────────────────────────── */

function _emptyEvaluation(routeIndex: number, baseEtaSec: number): RouteEvaluation {
  return {
    routeIndex, baseEtaSec,
    totalTimeSec: baseEtaSec, delayVsBaseSec: 0,
    avgConfidence: 0, liveDataRatio: 0,
    segmentCoverage: 0, overallFreshness: FRESHNESS_MIN,
    score: 0, segmentScores: [],
  };
}

/* ── Rota değerlendirme ──────────────────────────────────────── */

/**
 * Tek rota adayı için tam değerlendirme üretir.
 *
 * Segment hızı olarak trafficEngine'in zaten seçtiği `seg.avgSpeedKmh`
 * kullanılır (live > learned > historical öncelik zaten uygulandı).
 * Bu fonksiyon ÇİFT hesap yapmaz — sadece o değeri değerlendirir.
 *
 * Adjustment formülü (segment başına):
 *   ratio      = refSpeed(level) / effectiveSpeed
 *   adjustSec  = expectedDelaySec × (ratio − 1)
 *   ratio > 1  → effectiveSpeed < refSpeed → segment yavaş → adjustSec > 0
 *   ratio < 1  → effectiveSpeed > refSpeed → segment hızlı → adjustSec < 0
 */
function _evaluateRoute(
  route:      RouteCandidate,
  routeIndex: number,
  hour:       number,
  isWeekend:  boolean,
): RouteEvaluation {
  const { segments, baseEtaSec } = route;

  if (segments.length === 0) return _emptyEvaluation(routeIndex, baseEtaSec);

  const nowMs       = Date.now();
  const segScores: SegmentScore[] = [];

  let totalAdjustSec  = 0;
  let sumConf         = 0;
  let sumFresh        = 0;
  let liveCount       = 0;
  let coveredCount    = 0;
  const total         = segments.length;

  for (const seg of segments) {
    const historicalSpeed = refSpeedKmh(seg.level);
    const effectiveSpeed  = Math.max(1, seg.avgSpeedKmh);
    const ratio           = historicalSpeed / effectiveSpeed;
    const adjustSec       = Math.round(seg.expectedDelaySec * (ratio - 1));

    // Freshness: live → 1.0, learned → gerçek yaş, historical → taban
    let fresh: number;
    if (seg.source === 'live') {
      fresh = 1.0;
    } else if (seg.source === 'learned') {
      const diag = getHourDiagnostics(seg.segmentId, hour, isWeekend);
      fresh = diag ? _freshness(diag.lastUpdatedMs) : FRESHNESS_MIN;
    } else {
      fresh = FRESHNESS_MIN; // historical / fallback — statik model
    }

    const conf = seg.confidence;

    totalAdjustSec += adjustSec;
    sumConf        += conf;
    sumFresh       += fresh;

    if (seg.source === 'live')       liveCount++;
    if (conf >= MIN_COVERAGE_CONF)   coveredCount++;

    if (import.meta.env.DEV) {
      segScores.push({
        segmentId:     seg.segmentId,
        historicalSpeed,
        effectiveSpeed,
        adjustSec,
        confidence:    conf,
        freshness:     fresh,
        source:        seg.source,
      });
    }
  }

  const avgConfidence    = sumConf  / total;
  const overallFreshness = sumFresh / total;
  const liveDataRatio    = liveCount   / total;
  const segmentCoverage  = coveredCount / total;
  const totalTimeSec     = Math.max(0, Math.round(baseEtaSec + totalAdjustSec));

  if (import.meta.env.DEV) {
    console.debug(
      `[TrafficSuggestion] route[${routeIndex}]` +
      ` totalTime=${totalTimeSec}s (base=${baseEtaSec}s adj=${totalAdjustSec}s)` +
      ` conf=${avgConfidence.toFixed(2)} cov=${(segmentCoverage * 100).toFixed(0)}%` +
      ` live=${(liveDataRatio * 100).toFixed(0)}% fresh=${overallFreshness.toFixed(2)}`,
    );
    segScores.forEach((ss) =>
      console.debug(
        `  seg=${ss.segmentId.slice(0, 14)}` +
        ` src=${ss.source.padEnd(10)}` +
        ` eff=${ss.effectiveSpeed.toFixed(1)}km/h` +
        ` adj=${ss.adjustSec}s conf=${ss.confidence.toFixed(2)}` +
        ` fresh=${ss.freshness.toFixed(2)}`,
      ),
    );
    void nowMs; // suppress unused warning — only used implicitly via Date.now() above
  }

  return {
    routeIndex,
    baseEtaSec,
    totalTimeSec,
    delayVsBaseSec: 0,        // _compute tarafından base kıyasıyla doldurulur
    avgConfidence:  Math.round(avgConfidence    * 1000) / 1000,
    liveDataRatio:  Math.round(liveDataRatio    * 1000) / 1000,
    segmentCoverage: Math.round(segmentCoverage * 1000) / 1000,
    overallFreshness: Math.round(overallFreshness * 1000) / 1000,
    score:          0,        // _compute'da savingVsBase bilinince hesaplanır
    segmentScores:  import.meta.env.DEV ? segScores : [],
  };
}

/* ── Öneri metni ─────────────────────────────────────────────── */

function _buildReason(
  savingSeconds: number,
  bestEval:      RouteEvaluation,
  baseEval:      RouteEvaluation,
): string {
  const mins        = Math.round(savingSeconds / 60);
  const pct         = baseEval.totalTimeSec > 0
    ? Math.round((savingSeconds / baseEval.totalTimeSec) * 100)
    : 0;
  const srcLabel    = bestEval.liveDataRatio >= 0.5
    ? 'anlık veri'
    : bestEval.segmentCoverage >= 0.6
      ? 'öğrenilmiş veri'
      : 'tarihsel tahmin';

  if (mins >= 2) {
    return `${srcLabel} ile ${pct > 0 ? `%${pct} ` : ''}alternatif ≈${mins} dk daha hızlı`;
  }
  return `alternatif rota ${savingSeconds} sn daha hızlı (${srcLabel})`;
}

/* ── Stability / Hysteresis — Decision Layer ─────────────────── */

/** Stability state'i sıfırla — lock kaldırıldığında çağrılır. */
function _clearStability(): void {
  _stability.lockedRouteIndex = -1;
  _stability.lastScore        = 0;
  _consecutiveCycles.clear();
}

/** Öneriyi kabul et — lock yaz, cooldown başlat. */
function _acceptSuggestion(raw: SuggestionResult, nowMs: number): SuggestionResult {
  _stability.lastSuggestionMs = nowMs;
  _stability.lockedRouteIndex = raw.bestRouteIndex;
  _stability.lastScore        = raw.savingSeconds;
  _consecutiveCycles.clear(); // yeni lock → persistence sayacı sıfır
  return raw;
}

/** Öneriyi reddet — hasSuggestion=false döner, reason DEV'e loglanır. */
function _rejectSuggestion(raw: SuggestionResult, reason: string): SuggestionResult {
  if (import.meta.env.DEV) {
    console.debug(`[TrafficSuggestion] reject: ${reason}`);
  }
  return { ...raw, hasSuggestion: false, reason: '', alternative: null };
}

/**
 * Threshold uygulanmadan önce gerçek saving değerini hesaplar.
 * Sadece lock aktifken raw.hasSuggestion=false olduğunda çağrılır
 * (hysteresis cancel kararı için).
 *
 * _evaluateRoute zaten ucuz (Map lookup + basit aritmetik).
 */
function _computeRawSaving(routes: RouteCandidate[], baseIdx: number): number {
  const now       = new Date();
  const hour      = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const evals  = routes.map((r, i) => _evaluateRoute(r, i, hour, isWeekend));
  const safeB  = Math.max(0, Math.min(baseIdx, evals.length - 1));
  const base   = evals[safeB]!;

  let best = base;
  for (const ev of evals) {
    if (ev.routeIndex !== safeB && ev.totalTimeSec < best.totalTimeSec) {
      best = ev;
    }
  }

  return Math.max(0, Math.round(base.totalTimeSec - best.totalTimeSec));
}

/**
 * Stability / Hysteresis karar katmanı.
 *
 * _computeMulti'nin ham çıktısını alır, stabilite kurallarını uygular
 * ve son karara varır. _computeMulti'ye dokunmaz.
 *
 * Karar akışı:
 *
 *   raw.hasSuggestion = false
 *     lock aktif →
 *       rawSaving ≥ 15s → hysteresis HOLD (öneri ekranda kalır)
 *       rawSaving <  15s → lock kaldır, öneri iptal
 *     lock yok → sessizce geç
 *
 *   raw.hasSuggestion = true
 *     1. Persistence: aynı rota ≥ 2 döngü iyi → aksi halde "not stable"
 *     2. Lock farklı rota →
 *          iyileşme ≥ %20 → override (cooldown bypass)
 *          iyileşme <  %20 → "not better enough"
 *     3. Cooldown aktifse → "cooldown"
 *     4. Kabul et
 */
function _decideWithStability(
  raw:     SuggestionResult,
  routes:  RouteCandidate[],
  baseIdx: number,
  nowMs:   number,
): SuggestionResult {
  const locked = _stability.lockedRouteIndex >= 0;

  /* ── raw öneri YOK ────────────────────────────────────────── */
  if (!raw.hasSuggestion) {
    if (locked) {
      const rawSaving = _computeRawSaving(routes, baseIdx);
      if (rawSaving >= HYSTERESIS_CANCEL_SEC) {
        if (import.meta.env.DEV) {
          console.debug(
            `[TrafficSuggestion] hysteresis hold: saving=${rawSaving}s` +
            ` ≥ cancel_threshold=${HYSTERESIS_CANCEL_SEC}s`,
          );
        }
        // Kilitli öneriyi komputedAtMs güncelleyerek koru
        return { ..._lastResult, computedAtMs: nowMs };
      }
      if (import.meta.env.DEV) {
        console.debug(
          `[TrafficSuggestion] hysteresis cancel: saving=${rawSaving}s` +
          ` < cancel_threshold=${HYSTERESIS_CANCEL_SEC}s`,
        );
      }
      _clearStability();
    }
    _consecutiveCycles.clear();
    return raw;
  }

  /* ── raw öneri VAR ────────────────────────────────────────── */

  // 1. Persistence — aynı rota üst üste MIN_PERSISTENCE_CYCLES görünmeli
  const prevCycles = _consecutiveCycles.get(raw.bestRouteIndex) ?? 0;
  const newCycles  = prevCycles + 1;
  _consecutiveCycles.set(raw.bestRouteIndex, newCycles);
  // Diğer rotaların sayacını sıfırla (spike isolation)
  for (const k of [..._consecutiveCycles.keys()]) {
    if (k !== raw.bestRouteIndex) _consecutiveCycles.delete(k);
  }

  if (newCycles < MIN_PERSISTENCE_CYCLES) {
    return _rejectSuggestion(
      raw,
      `not stable: route[${raw.bestRouteIndex}]` +
      ` cycle=${newCycles}/${MIN_PERSISTENCE_CYCLES}`,
    );
  }

  // 2. Override kararı — kilitli rota farklıysa
  if (locked && _stability.lockedRouteIndex !== raw.bestRouteIndex) {
    const improvement = _stability.lastScore > 0
      ? (raw.savingSeconds - _stability.lastScore) / _stability.lastScore
      : 1;

    if (improvement < OVERRIDE_MIN_IMPROVEMENT) {
      return _rejectSuggestion(
        raw,
        `not better enough: improvement=${(improvement * 100).toFixed(0)}%` +
        ` < ${OVERRIDE_MIN_IMPROVEMENT * 100}%` +
        ` (locked=route[${_stability.lockedRouteIndex}] saving=${_stability.lastScore}s)`,
      );
    }
    // %20+ iyileşme → override — cooldown bypass
    if (import.meta.env.DEV) {
      console.debug(
        `[TrafficSuggestion] override: route[${raw.bestRouteIndex}]` +
        ` saving=${raw.savingSeconds}s` +
        ` improvement=${(improvement * 100).toFixed(0)}%`,
      );
    }
    return _acceptSuggestion(raw, nowMs);
  }

  // 3. Cooldown — yeni öneri için erken mi?
  const elapsed = nowMs - _stability.lastSuggestionMs;
  if (_stability.lastSuggestionMs > 0 && elapsed < COOLDOWN_MS) {
    return _rejectSuggestion(
      raw,
      `cooldown: ${Math.round((COOLDOWN_MS - elapsed) / 1_000)}s remaining`,
    );
  }

  // 4. Kabul
  return _acceptSuggestion(raw, nowMs);
}

/* ── Ana çok-rotalı hesap ────────────────────────────────────── */

function _computeMulti(
  routes:         RouteCandidate[],
  baseRouteIndex: number,
): SuggestionResult {
  const nowMs = Date.now();

  if (routes.length === 0) return { ...EMPTY_RESULT, computedAtMs: nowMs };

  const now       = new Date();
  const hour      = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  // Tüm rota adaylarını değerlendir
  const evaluations = routes.map((r, i) => _evaluateRoute(r, i, hour, isWeekend));

  // Base rota
  const safeBase = Math.max(0, Math.min(baseRouteIndex, evaluations.length - 1));
  const baseEval = evaluations[safeBase]!;

  // delayVsBaseSec ve score hesapla
  for (const ev of evaluations) {
    ev.delayVsBaseSec = Math.round(ev.totalTimeSec - baseEval.totalTimeSec);
    // score = kazanç × confidence × freshness  (kazanç negatifse = daha hızlı)
    const saving = -ev.delayVsBaseSec; // negatif delay = pozitif saving
    ev.score = saving * ev.avgConfidence * ev.overallFreshness;
  }

  if (import.meta.env.DEV) {
    console.debug(`[TrafficSuggestion] base=route[${safeBase}] totalTime=${baseEval.totalTimeSec}s`);
    evaluations.forEach((ev) =>
      console.debug(
        `  route[${ev.routeIndex}]` +
        ` totalTime=${ev.totalTimeSec}s` +
        ` delay=${ev.delayVsBaseSec > 0 ? '+' : ''}${ev.delayVsBaseSec}s` +
        ` score=${ev.score.toFixed(1)}`,
      ),
    );
  }

  // En iyi rotayı seç: en yüksek score (base hariç değil — base de kazanabilir)
  let bestEval = evaluations[safeBase]!;
  for (const ev of evaluations) {
    if (ev.score > bestEval.score) bestEval = ev;
  }

  const savingSeconds  = Math.round(-bestEval.delayVsBaseSec); // saving = pozitif
  const bestIsNotBase  = bestEval.routeIndex !== safeBase;

  // Eşik kontrolleri
  const hasSuggestion = (
    bestIsNotBase &&
    savingSeconds          >= MIN_SUGGESTION_GAIN_SEC &&
    bestEval.avgConfidence >= MIN_CONFIDENCE &&
    bestEval.segmentCoverage >= MIN_SEGMENT_COVERAGE
  );

  const percentSlower = baseEval.totalTimeSec > 0
    ? Math.round((savingSeconds / baseEval.totalTimeSec) * 100)
    : 0;

  const reason = hasSuggestion
    ? _buildReason(savingSeconds, bestEval, baseEval)
    : '';

  let alternative: RouteAlternative | null = null;
  if (hasSuggestion) {
    _suggestionSeq++;
    alternative = {
      id:               `sug-${nowMs}-${_suggestionSeq}`,
      label:            `Rota ${bestEval.routeIndex + 1}`,
      estimatedSeconds: bestEval.totalTimeSec,
      savingSeconds,
      computedAtMs:     nowMs,
    };
  }

  return {
    hasSuggestion,
    bestRouteIndex:   bestEval.routeIndex,
    savingSeconds:    hasSuggestion ? savingSeconds : 0,
    totalTimeGainSec: hasSuggestion ? savingSeconds : 0,
    percentSlower,
    reason,
    confidence:       Math.round(bestEval.avgConfidence * 100) / 100,
    alternative,
    computedAtMs:     nowMs,
    routeEvaluations: import.meta.env.DEV ? evaluations : [],
  };
}

/* ── Throttle + listener ─────────────────────────────────────── */

function _shouldCheck(): boolean {
  const nowMs = Date.now();
  if ((nowMs - _lastCheckMs) / 1_000 < THROTTLE_SEC) return false;
  _lastCheckMs = nowMs;
  return true;
}

function _notify(): void {
  _listeners.forEach((fn) => fn(_lastResult));
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Çok rotalı anlık hesap — throttle uygulanmaz.
 * Test, preview ve NavigationHUD için kullanılır.
 *
 * @param routes         Karşılaştırılacak rota adayları (min 1)
 * @param baseRouteIndex Referans rota indeksi (aktif navigasyon rotası)
 */
export function computeSuggestion(
  routes:         RouteCandidate[],
  baseRouteIndex: number,
): SuggestionResult {
  return _computeMulti(routes, baseRouteIndex);
}

/**
 * Throttled öneri kontrolü.
 * trafficEngine._recalculate() sonunda çağrılır.
 * 10 s geçmemişse hesap yapmadan döner.
 *
 * trafficEngine tek rota geçerse: [{ segments, baseEtaSec }], 0
 * ADAS sistemi birden fazla rota geçerse: tüm adaylar + base index
 */
export function triggerSuggestionCheck(
  routes:         RouteCandidate[],
  baseRouteIndex: number,
): void {
  if (!_running) return;
  if (!_shouldCheck()) return;

  const nowMs = Date.now();
  const raw   = _computeMulti(routes, baseRouteIndex);
  _lastResult = _decideWithStability(raw, routes, baseRouteIndex, nowMs);
  _notify();
}

/**
 * Engine başlat — idempotent.
 */
export function startSuggestionEngine(): void {
  if (_running) return;
  _running     = true;
  _lastCheckMs = 0;
  _lastResult  = { ...EMPTY_RESULT };
  _stability.lastSuggestionMs = 0;
  _stability.lockedRouteIndex = -1;
  _stability.lastScore        = 0;
  _consecutiveCycles.clear();
}

/**
 * Engine durdur ve temizle.
 */
export function stopSuggestionEngine(): void {
  _running = false;
  _listeners.clear();
  _lastResult    = { ...EMPTY_RESULT };
  _suggestionSeq = 0;
  _stability.lastSuggestionMs = 0;
  _stability.lockedRouteIndex = -1;
  _stability.lastScore        = 0;
  _consecutiveCycles.clear();
}

/** Son hesaplanan öneriyi döner — snapshot. */
export function getLastSuggestion(): SuggestionResult {
  return _lastResult;
}

/**
 * Öneri değiştiğinde reaktif callback.
 * Unsubscribe fonksiyonu döner.
 */
export function onSuggestionResult(fn: (r: SuggestionResult) => void): () => void {
  _listeners.add(fn);
  fn(_lastResult);
  return () => { _listeners.delete(fn); };
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopSuggestionEngine());
}
