import type { UsageMap, MarkovMatrix, MarkovPrediction, TimeContext } from './smartTypes';
import { MARKOV_KEY, MARKOV_MAX_ROWS, MARKOV_MIN_COUNT, MARKOV_BLEND, TIME_BIAS } from './smartConstants';
import { timedScore } from './smartUsageUtils';

/* ═══════════════════════════════════════════════════════════════════
   MARKOV CHAIN — Intent Prediction Engine
   ═══════════════════════════════════════════════════════════════════
 *
 * Mimari:
 *   Sparse geçiş matrisi P[fromApp][toApp] = gözlemlenen geçiş sayısı.
 *   Tahmin: P(toApp | fromApp, timeCtx) normalize edilerek 0–1 olasılık.
 *   Zaman bağlamı (time-slot) mevcut TIME_BIAS tablosunu kullanır —
 *   ayrı bir zaman-boyutlu matris yerine, tahmin aşamasında çarpanla uygulanır.
 *
 * Bellek analizi:
 *   100 row × ortalama 5 hedef × ~40 byte/entry ≈ 20 KB localStorage
 *   200-entry cap → maksimum 40 KB. localStorage limiti (5 MB) çok altında.
 *
 * Performans: trackLaunch O(1), prediction O(k) ─ k≤200, <0.5 ms.
 *
 * Zero-Leak: Herhangi bir listener/timer yok — saf veri yapısı.
 *
 * Blending: finalScore = (1-MARKOV_BLEND)×heuristic + MARKOV_BLEND×markov
 *   Markov verisi yoksa MARKOV_BLEND = 0 (tamamen heuristik).
 */

let _markovCache: MarkovMatrix | null = null;
let _markovSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastLaunchedApp = '';

function _loadMarkov(): MarkovMatrix {
  try {
    const raw = localStorage.getItem(MARKOV_KEY);
    return raw ? (JSON.parse(raw) as MarkovMatrix) : {};
  } catch { return {}; }
}

function _getCachedMarkov(): MarkovMatrix {
  if (!_markovCache) _markovCache = _loadMarkov();
  return _markovCache;
}

/** Throttled write — en fazla 10s'de bir localStorage'a yazar (CLAUDE.md: Write Throttling) */
function _saveMarkovThrottled(): void {
  if (_markovSaveTimer) return;
  _markovSaveTimer = setTimeout(() => {
    _markovSaveTimer = null;
    if (!_markovCache) return;
    try { localStorage.setItem(MARKOV_KEY, JSON.stringify(_markovCache)); }
    catch { /* quota full — sessizce geç */ }
  }, 10_000);
}

/** Markov matrisini güncelle: fromApp → toApp geçişini kaydet */
function _updateMarkov(fromApp: string, toApp: string): void {
  const matrix = _getCachedMarkov();

  if (!matrix[fromApp]) {
    // Satır sayısı sınırı — en az kullanılan kaynağı çıkar
    const rows = Object.keys(matrix);
    if (rows.length >= MARKOV_MAX_ROWS) {
      const leastUsed = rows
        .map((k) => ({ k, total: Object.values(matrix[k]).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => a.total - b.total)[0];
      if (leastUsed) delete matrix[leastUsed.k];
    }
    matrix[fromApp] = {};
  }

  matrix[fromApp][toApp] = (matrix[fromApp][toApp] ?? 0) + 1;
  _markovCache = matrix;
  _saveMarkovThrottled();
}

/**
 * Markov olasılık skoru: P(toApp | fromApp) × zaman bağlamı çarpanı
 * fromApp için hiç geçiş kaydı yoksa 0 döner.
 */
function _markovScore(toApp: string, fromApp: string, timeCtx: TimeContext): number {
  if (!fromApp) return 0;
  const matrix = _getCachedMarkov();
  const row    = matrix[fromApp];
  if (!row) return 0;

  const rawTotal = Object.values(row).reduce((s, v) => s + v, 0);
  if (rawTotal < MARKOV_MIN_COUNT) return 0;

  const rawCount = row[toApp] ?? 0;
  if (rawCount === 0) return 0;

  // Normalize: P(toApp | fromApp) = count / total
  const baseProb = rawCount / rawTotal;

  // Zaman bağlamı çarpanı: TIME_BIAS kullan — ayrı matris gerektirmez
  const timeBias = TIME_BIAS[timeCtx][toApp] ?? 0;
  // Çarpan: 1.0–1.4 arası (bias etkisini yumuşat)
  const timeMul  = 1.0 + Math.min(0.4, timeBias);

  return Math.min(1, baseProb * timeMul);
}

export function getLastLaunchedApp(): string { return _lastLaunchedApp; }
export function setLastLaunchedApp(appId: string): void { _lastLaunchedApp = appId; }
export function updateMarkov(fromApp: string, toApp: string): void { _updateMarkov(fromApp, toApp); }

/**
 * Top-3 Markov tahmini — dockIds ve quickActions'a girdi sağlar.
 * Mevcut bağlam: son açılan uygulama + zaman dilimi.
 */
export function computeMarkovPredictions(
  fromApp:  string,
  timeCtx:  TimeContext,
): MarkovPrediction[] {
  if (!fromApp) return [];
  const matrix = _getCachedMarkov();
  const row    = matrix[fromApp];
  if (!row) return [];

  const rawTotal = Object.values(row).reduce((s, v) => s + v, 0);
  if (rawTotal < MARKOV_MIN_COUNT) return [];

  const timeBias = TIME_BIAS[timeCtx];
  const ctxLabel = `${timeCtx}:after_${fromApp}`;

  return Object.entries(row)
    .filter(([, cnt]) => cnt >= MARKOV_MIN_COUNT)
    .map(([toApp, cnt]) => {
      const baseProb = cnt / rawTotal;
      const timeMul  = 1.0 + Math.min(0.4, timeBias[toApp] ?? 0);
      return { appId: toApp, probability: Math.min(1, baseProb * timeMul), context: ctxLabel };
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}

/**
 * Blended score: Markov verisi varsa (1-BLEND)×heuristic + BLEND×markov.
 * Yoksa saf heuristic — geriye dönük uyumluluk korunur.
 */
export function blendedScore(id: string, map: UsageMap, timeCtx: TimeContext): number {
  const h = timedScore(id, map, timeCtx);
  const m = _markovScore(id, _lastLaunchedApp, timeCtx);
  if (m === 0) return h;  // Markov verisi yok → saf heuristic
  return (1 - MARKOV_BLEND) * h + MARKOV_BLEND * m;
}

/** HMR cleanup ve test teardown için tüm Markov state'ini sıfırla. */
export function clearMarkovState(): void {
  _markovCache = null;
  if (_markovSaveTimer) { clearTimeout(_markovSaveTimer); _markovSaveTimer = null; }
  _lastLaunchedApp = '';
}
