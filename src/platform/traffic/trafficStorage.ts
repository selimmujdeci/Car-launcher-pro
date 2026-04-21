/**
 * Traffic Intelligence — Debounced Persistent Storage
 *
 * Öğrenilmiş segment profillerini localStorage'a kalıcı olarak yazar.
 * CLAUDE.md gereği: yüksek frekanslı veri için write throttling zorunlu.
 *
 * Strateji:
 *  - Yazımlar 5s debounce ile birikim yapar (batch write)
 *  - Okumalarda stale detection: format version mismatch → sıfırla
 *  - localStorage quota hatası → sessizce devam, memory-only çalış
 *  - JSON parse hatası → corrupt data → sıfırla
 */

import type { LearnedSegmentProfile } from './trafficTypes';

/* ── Storage key + format sürümü ────────────────────────────── */

const STORAGE_KEY     = 'car-traffic-learned-v1';
const FORMAT_VERSION  = 1;
const WRITE_DEBOUNCE_MS = 5_000; // CLAUDE.md: min 5s throttle

/* ── Yazım kuyruğu ───────────────────────────────────────────── */

/** Pending yazım için timer handle */
let _writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Son commit edilen snapshot — gereksiz yeniden yazımı önler */
let _lastWrittenHash = '';

/* ── Serialize / Deserialize ─────────────────────────────────── */

interface StorageEnvelope {
  version:  number;
  profiles: Record<string, LearnedSegmentProfile>;
  savedMs:  number;
}

function _serialize(profiles: Map<string, LearnedSegmentProfile>): string {
  const obj: StorageEnvelope = {
    version:  FORMAT_VERSION,
    profiles: Object.fromEntries(profiles),
    savedMs:  Date.now(),
  };
  return JSON.stringify(obj);
}

function _deserialize(raw: string): Map<string, LearnedSegmentProfile> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      (parsed as StorageEnvelope).version !== FORMAT_VERSION
    ) {
      return null; // format uyumsuzluğu → sıfırla
    }

    const env = parsed as StorageEnvelope;
    if (typeof env.profiles !== 'object' || env.profiles === null) return null;

    const map = new Map<string, LearnedSegmentProfile>();
    for (const [id, prof] of Object.entries(env.profiles)) {
      // Minimal sanity check
      if (
        typeof prof.segmentId === 'string' &&
        typeof prof.totalSamples === 'number' &&
        typeof prof.speedSumKmh === 'number' &&
        typeof prof.delayFactor === 'number' &&
        typeof prof.lastUpdatedMs === 'number'
      ) {
        map.set(id, prof as LearnedSegmentProfile);
      }
    }
    return map;
  } catch {
    return null;
  }
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Kayıtlı profilleri yükler.
 * Bozuk veya uyumsuz veri varsa boş Map döner.
 */
export function loadLearnedProfiles(): Map<string, LearnedSegmentProfile> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const result = _deserialize(raw);
    return result ?? new Map();
  } catch {
    return new Map();
  }
}

/**
 * Profilleri debounced olarak yazar.
 * Çağrı yoğunluğundan bağımsız: en fazla her 5s'de bir disk'e gider.
 *
 * @param profiles - Yazılacak tam profil koleksiyonu
 */
export function scheduleProfileWrite(
  profiles: Map<string, LearnedSegmentProfile>,
): void {
  if (_writeTimer !== null) {
    clearTimeout(_writeTimer);
  }

  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    _commitWrite(profiles);
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Bekleyen yazımı iptal et.
 * stopTrafficIntelligence() sırasında çağrılır.
 */
export function cancelPendingWrite(): void {
  if (_writeTimer !== null) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
  }
}

/**
 * Bekleyen yazımı hemen flush et — app kapatma / visibility change için.
 */
export function flushProfileWrite(
  profiles: Map<string, LearnedSegmentProfile>,
): void {
  cancelPendingWrite();
  _commitWrite(profiles);
}

/* ── Internal ────────────────────────────────────────────────── */

function _commitWrite(profiles: Map<string, LearnedSegmentProfile>): void {
  try {
    const serialized = _serialize(profiles);
    if (serialized === _lastWrittenHash) return; // değişmemişse yazma
    localStorage.setItem(STORAGE_KEY, serialized);
    _lastWrittenHash = serialized;
  } catch (e) {
    // localStorage quota veya private browsing — sessizce devam
    if (import.meta.env.DEV) {
      console.warn('[TrafficStorage] write failed:', e);
    }
  }
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => cancelPendingWrite());
}
