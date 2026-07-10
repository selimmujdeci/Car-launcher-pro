/**
 * vehicleLearningDecay — Öğrenme Kanıtı Decay / Prune / Duplicate Bastırma (P2-3).
 *
 * AMAÇ: P2-2 Evidence Store üzerine ZAMAN-BAZLI decay + stale-prune + duplicate suppression
 * ekler → eski ve tekrar doğrulanmayan kanıtın güveni zamanla düşer; tek-seferlik/yanlış
 * sinyaller bilgi tabanını şişirmez.
 *
 * KATMAN: SALT-OKUNUR / YARDIMCI. Evidence Store'u DEĞİŞTİRMEZ (decay READ-time hesaplanır,
 * diske yazılmaz). P2-1 confidence FORMÜLÜ değişmez — decay yalnız onun çıktısını zamanla
 * ağırlıklandırır. Girdi kayıtlarını MUTASYONA UĞRATMAZ. FAIL-SOFT.
 *
 * SINIRLAR (CLAUDE.md): Cloud/SQL/LLM/Native YOK · hot-path YOK (yalnız discovery/learning
 * cold-path/idle) · yeni bağımlılık YOK · ağ YOK · O(1) duplicate lookup · bounded cache ·
 * zero-leak dispose. Discovery/Fingerprint/Auto Learning/VKB/Manufacturer Intelligence/
 * Diagnostic/PID-DID registry DEĞİŞMEZ.
 *
 * SAAT SIÇRAMASI KORUMASI (CLAUDE.md): elapsed = max(0, now - ref) → sistem saati geriye
 * giderse negatif süre/decay ÜRETİLMEZ (mutlak saate kör güvenilmez).
 */

import { type LearningEvidence, type EvidenceStatus } from './vehicleLearningEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler (açık, deterministik, test edilebilir)
 * ════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;

/** Yarı-ömür (gün) — status'e göre: strong yavaş, weak hızlı decay. Taban 90 gün. */
const HALF_LIFE_DAYS: Record<EvidenceStatus, number> = {
  weak:      45,   // hızlı
  candidate: 90,   // taban
  strong:    180,  // yavaş
};

/** Prune eşikleri. */
export const PRUNE_CONFIDENCE_FLOOR = 0.20;
export const PRUNE_STALE_DAYS = 180;

/** Duplicate suppression penceresi (ms) — aynı gözlem bu pencerede tekrar sayılmaz. */
export const DUPLICATE_WINDOW_MS = 60_000;
/** Duplicate kimlik cache tavanı (bounded, FIFO). */
export const DUPLICATE_CACHE_MAX = 2048;

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** Saat-sıçrama-güvenli geçen gün: negatif olmaz. */
function _elapsedDays(now: number, ref: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(ref)) return 0;
  return Math.max(0, now - ref) / DAY_MS;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Decay (SALT-OKUNUR, deterministik)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıtın decay uygulanmış confidence'ı — üstel yarı-ömür. lastSeen'den bu yana geçen süre
 * (saat-sıçrama-güvenli) ile P2-1 confidence'ı ağırlıklandırır. [0,1] clamp; 0 altına inmez.
 * Yeni kanıt (elapsed=0) → decay yok. FAIL-SOFT (bozuk alan → güvenli değer).
 */
export function calculateDecayedConfidence(ev: LearningEvidence, now: number): number {
  try {
    const base = clamp01(ev?.confidence ?? 0);
    const status: EvidenceStatus = (ev?.status as EvidenceStatus) in HALF_LIFE_DAYS ? ev.status : 'candidate';
    const halfLife = HALF_LIFE_DAYS[status] ?? 90;
    const days = _elapsedDays(now, ev?.lastSeen ?? now);
    const factor = Math.pow(0.5, days / halfLife); // (0,1], days=0 → 1
    return clamp01(base * factor);
  } catch {
    return clamp01(ev?.confidence ?? 0);
  }
}

/**
 * Kanıtın decay uygulanmış KOPYASINI döndürür (yalnız `confidence` düşer; firstSeen/lastSeen/
 * observationCount ve diğer alanlar KORUNUR). Girdiyi MUTASYONA UĞRATMAZ.
 */
export function applyDecay(ev: LearningEvidence, now: number): LearningEvidence {
  return { ...ev, confidence: calculateDecayedConfidence(ev, now) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Prune (audit-dostu: fiziksel silme değil, aday işaretleme)
 * ════════════════════════════════════════════════════════════════════════ */

export type PrunableEvidence = LearningEvidence & { pruneCandidate: true; decayedConfidence: number };

/**
 * Prune adayı mı: decay'li confidence < 0.20 VE lastSeen'den ≥180 gün VE status weak/candidate.
 * Strong ASLA prune adayı olmaz. FAIL-SOFT.
 */
export function isPruneCandidate(ev: LearningEvidence, now: number): boolean {
  try {
    if (!ev || (ev.status !== 'weak' && ev.status !== 'candidate')) return false; // strong korunur
    const decayed = calculateDecayedConfidence(ev, now);
    if (decayed >= PRUNE_CONFIDENCE_FLOOR) return false;
    return _elapsedDays(now, ev.lastSeen ?? now) >= PRUNE_STALE_DAYS;
  } catch {
    return false; // şüphede prune ETME (güvenli taraf)
  }
}

/**
 * Listeden prune ADAYLARINI üretir (fiziksel silmez — audit için işaretler). Girdi mutate
 * edilmez. Boş/bozuk liste → []. Her aday `pruneCandidate:true` + `decayedConfidence` ile.
 */
export function pruneCandidates(evidenceList: readonly LearningEvidence[] | null | undefined, now: number): PrunableEvidence[] {
  const out: PrunableEvidence[] = [];
  for (const ev of evidenceList ?? []) {
    try {
      if (isPruneCandidate(ev, now)) {
        out.push({ ...ev, pruneCandidate: true, decayedConfidence: calculateDecayedConfidence(ev, now) });
      }
    } catch { /* tek kayıt hatası diğerlerini etkilemez */ }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Duplicate suppression (bounded, RAM-only, O(1))
 * ════════════════════════════════════════════════════════════════════════ */

export interface ObservationInput {
  evidenceId:      string;
  fingerprintHash: string;
  ecuAddress:      string;
  rawResponse:     string;
  /** Gözlem zaman damgası (ms) — pencere kovası için. */
  timestamp:       number;
}

/** FNV-1a 32-bit (yerel, bağımlılıksız) → 8-hane hex. */
function _fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function _norm(s: string): string {
  return (s ?? '').toString().trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Gözlem KİMLİĞİ — evidenceId | fingerprintHash | ECU | rawResponse-hash | zaman-kovası.
 * Farklı araç / farklı ECU / farklı response → farklı kimlik (ayrı sayılır). Aynı gözlem aynı
 * pencerede → aynı kimlik (duplicate). SAF/deterministik.
 */
export function createObservationIdentity(input: ObservationInput, windowMs = DUPLICATE_WINDOW_MS): string {
  const bucket = Number.isFinite(input?.timestamp) ? Math.floor(input.timestamp / Math.max(1, windowMs)) : 0;
  const resp = _fnv1a(_norm(input?.rawResponse ?? ''));
  return `${input?.evidenceId ?? ''}|${(input?.fingerprintHash ?? '').trim()}|${_norm(input?.ecuAddress ?? '')}|${resp}|${bucket}`;
}

/**
 * Bounded (FIFO) duplicate gözlem cache'i — RAM-only (yeniden başlatmada sıfırlanır; kalıcı
 * cache GEREKMEZ). O(1) lookup (Set insertion-order → en eski FIFO evict).
 */
export class DuplicateObservationCache {
  private readonly _seen = new Set<string>();
  private readonly maxSize: number;
  private readonly windowMs: number;

  constructor(maxSize = DUPLICATE_CACHE_MAX, windowMs = DUPLICATE_WINDOW_MS) {
    this.maxSize = maxSize;
    this.windowMs = windowMs;
  }

  /**
   * Bu gözlem SAYILMALI mı: kimlik cache'te yoksa true (ekler); varsa false (duplicate).
   * FAIL-SOFT: hata → true (kaybetmemek için say). Bounded: taşınca en eski FIFO düşer.
   */
  shouldCount(input: ObservationInput): boolean {
    try {
      const id = createObservationIdentity(input, this.windowMs);
      if (this._seen.has(id)) return false;
      this._seen.add(id);
      if (this._seen.size > this.maxSize) {
        const oldest = this._seen.values().next().value; // insertion-order → en eski
        if (oldest !== undefined) this._seen.delete(oldest);
      }
      return true;
    } catch {
      return true;
    }
  }

  reset(): void { this._seen.clear(); }
  dispose(): void { this._seen.clear(); }
  get size(): number { return this._seen.size; }
}

/* ── Uygulama geneli tekil cache + flat API (spec) ─────────────────────────── */

/** Tekil duplicate cache (RAM-only; wiring YOK). */
export const duplicateObservationCache = new DuplicateObservationCache();

/** Bu gözlem sayılmalı mı (tekil cache). */
export function shouldCountObservation(input: ObservationInput): boolean {
  return duplicateObservationCache.shouldCount(input);
}
/** Tekil duplicate cache'i sıfırlar. */
export function resetDuplicateCache(): void {
  duplicateObservationCache.reset();
}
/** Zero-leak temizlik (tekil cache). */
export function dispose(): void {
  duplicateObservationCache.dispose();
}
