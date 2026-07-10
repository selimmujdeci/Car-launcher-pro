/**
 * vehicleLearningPatternEngine — Öğrenme Kalıbı Kümeleme & Aday Yükseltme (P2-4).
 *
 * AMAÇ: P2-1 Evidence modeli, P2-2 kalıcı Evidence Store ve P2-3 decay/duplicate katmanı
 * üzerine OFFLINE pattern clustering + GÜVENLİ candidate promotion kurar. Sistem:
 *   - aynı marka/protokol/ECU ailesinde birlikte görülen PID/DID kalıplarını çıkarır
 *   - zayıf kanıtı yalnız YETERLİ kanıtla candidate/strong'a yükseltir (deterministik)
 *   - çelişkili/eski kanıtı OTOMATİK yükseltmez → ambiguity + manual-review işaretler
 *   - hiçbir registry/profile/store dosyasına YAZMAZ → yalnız profil ADAYI üretir
 *
 * KATMAN: SALT-OKUNUR / TÜRETİCİ. Girdi evidence kayıtlarını MUTASYONA UĞRATMAZ. Cloud/SQL/
 * LLM/Native YOK · hot-path YOK (yalnız on-demand/idle cold-path) · yeni bağımlılık YOK ·
 * ağ YOK · bounded memory (≤512 evidence) · O(n log n) · zero-leak dispose. FAIL-SOFT.
 *
 * SINIRLAR (CLAUDE.md): Discovery/Fingerprint/Auto Learning/VKB/Manufacturer Intelligence/
 * Profile Builder/Diagnostic Knowledge/Evidence Store/PID-DID registry DEĞİŞMEZ. P2-3 decay
 * FORMÜLÜ değişmez — yalnız çıktısı (decayed confidence) promotion kararında kullanılır.
 *
 * SAAT SIÇRAMASI KORUMASI: promotion decayed confidence üzerinden — P2-3 zaten saat-geri
 * güvenli (elapsed = max(0, now - ref)). Mutlak saate kör güvenilmez.
 */

import { normalizeEcuAddresses } from './vehicleFingerprintService';
import {
  evidenceConfidence,
  evidenceStatus,
  type LearningEvidence,
} from './vehicleLearningEngine';
import { calculateDecayedConfidence } from './vehicleLearningDecay';
import { getDeviceTier, type DeviceTier } from './deviceCapabilities';

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;

/** Aynı anda işlenecek maksimum kanıt (bounded memory — CLAUDE.md). */
export const MAX_EVIDENCE = 512;

/** Promotion eşikleri (açık, deterministik, test edilebilir). */
export const CANDIDATE_MIN_CONFIDENCE = 0.50;
export const STRONG_MIN_CONFIDENCE = 0.70;
export const REJECT_CONFIDENCE_FLOOR = 0.20;

/** Confidence divergence conflict eşiği — aynı sinyalin küme-arası güven farkı. */
export const CONFIDENCE_DIVERGENCE_THRESHOLD = 0.50;
/** Stale-vs-fresh conflict: bir kanıt bu kadar gün eskiyse "stale" sayılır. */
export const STALE_CONFLICT_DAYS = 180;

export type PatternStatus = 'weak' | 'candidate' | 'strong' | 'rejected';

/** Conflict tür kodları (deterministik, insan-okunur; otomatik ÇÖZÜLMEZ, yalnız işaretlenir). */
export type ConflictReason =
  | 'CROSS_MANUFACTURER_MEANING'   // aynı PID/DID farklı marka kümelerinde → anlam belirsiz
  | 'CROSS_ECU_DID_INCONSISTENT'   // aynı DID farklı ECU ailelerinde tutarsız
  | 'CROSS_PROTOCOL_INCONSISTENT'  // aynı sinyal farklı protokollerde uyumsuz
  | 'CONFIDENCE_DIVERGENCE'        // küme-arası güven ıraksaması
  | 'STALE_VS_FRESH_CONFLICT'      // eski kanıt ağırlığı yeni kanıtla çelişiyor
  | 'MANUFACTURER_MISMATCH'        // pattern içi marka uyuşmazlığı (defansif — hard)
  | 'DECODE_MEANING_CONFLICT';     // aynı sinyal için farklı decode/meaning (hard)

/** "Hard" conflict'ler pattern'i reddeder; diğerleri yalnız ambiguity/manual-review üretir. */
const HARD_CONFLICTS: ReadonlySet<ConflictReason> = new Set<ConflictReason>([
  'MANUFACTURER_MISMATCH',
  'DECODE_MEANING_CONFLICT',
]);

/** Deterministik küme: marka × protokol × normalize ECU ailesi. */
export interface LearningCluster {
  clusterId:    string;
  manufacturer: string;
  protocol:     string;
  ecuAddresses: string[];
  evidenceIds:  string[];
}

/** Küme içi co-occurrence kalıbı (birlikte görülen PID/DID kümesi + promotion kararı). */
export interface LearningPattern {
  patternId:               string;
  clusterId:               string;
  manufacturer:            string;
  protocol:                string;
  ecuAddresses:            string[];
  evidenceIds:             string[];
  observedPids:            string[];
  observedDids:            string[];
  supportingVehicleHashes: string[];
  vehicleCount:            number;
  observationCount:        number;
  observationWindows:      number;
  firstSeen:               number;
  lastSeen:                number;
  confidence:              number;      // decayed (P2-3) — promotion bunu kullanır
  status:                  PatternStatus;
  ambiguity:               boolean;
  conflictReasons:         ConflictReason[];
  requiresManualReview:    boolean;
}

export interface PatternEngineOptions {
  now?:  number;
  tier?: DeviceTier;  // 'low' = BASIC_JS: sadece basit grouping · 'mid'/'high' = bounded full
}

/* ══════════════════════════════════════════════════════════════════════════
 * Normalizasyon (deterministik)
 * ════════════════════════════════════════════════════════════════════════ */

function _normText(s: string | undefined | null): string {
  return (s ?? '').toString().trim().toUpperCase().replace(/\s+/g, '');
}

/** Marka normalize — boş/bilinmeyen → 'UNKNOWN' (yalnız aynı protokol+ECU imzasında gruplanır). */
function _normManufacturer(s: string | undefined | null): string {
  const n = _normText(s);
  return n || 'UNKNOWN';
}

/** Deterministik cluster kimliği: marka | protokol | sıralı-tekil ECU ailesi. */
function _clusterKey(manufacturer: string, protocol: string, ecuFamily: readonly string[]): string {
  return `${manufacturer}|${protocol}|${ecuFamily.join(',')}`;
}

/** Bir kanıtın küme kimliği + normalize alanları. FAIL-SOFT (bozuk → null). */
function _clusterIdentityOf(ev: LearningEvidence): {
  clusterId: string; manufacturer: string; protocol: string; ecuFamily: string[];
} | null {
  try {
    if (!ev || typeof ev !== 'object' || typeof ev.evidenceId !== 'string' || !ev.evidenceId) return null;
    const manufacturer = _normManufacturer(ev.manufacturer);
    const protocol = _normText(ev.protocol);
    const ecuFamily = normalizeEcuAddresses(ev.ecuAddresses ?? []);
    return { clusterId: _clusterKey(manufacturer, protocol, ecuFamily), manufacturer, protocol, ecuFamily };
  } catch {
    return null;
  }
}

/** ≤512 sınırına indir (bounded); girdi mutate edilmez. */
function _bounded(evidenceList: readonly LearningEvidence[] | null | undefined): LearningEvidence[] {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) return [];
  return evidenceList.length > MAX_EVIDENCE ? evidenceList.slice(0, MAX_EVIDENCE) : evidenceList.slice();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kümeleme (O(n))
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıtları marka × protokol × ECU ailesine göre kümeler. Farklı marka veya farklı protokol
 * ASLA aynı kümede karışmaz; Unknown marka yalnız aynı protokol+ECU imzasında gruplanır.
 * SALT-OKUNUR / SAF. Girdiyi mutate etmez; boş/bozuk → []. ASLA throw etmez.
 */
export function buildClusters(evidenceList: readonly LearningEvidence[] | null | undefined): LearningCluster[] {
  const bounded = _bounded(evidenceList);
  const map = new Map<string, LearningCluster>();
  for (const ev of bounded) {
    try {
      const id = _clusterIdentityOf(ev);
      if (!id) continue;
      let c = map.get(id.clusterId);
      if (!c) {
        c = {
          clusterId: id.clusterId,
          manufacturer: id.manufacturer,
          protocol: id.protocol,
          ecuAddresses: id.ecuFamily.slice(),
          evidenceIds: [],
        };
        map.set(id.clusterId, c);
      }
      if (!c.evidenceIds.includes(ev.evidenceId)) c.evidenceIds.push(ev.evidenceId);
    } catch { /* tek kayıt hatası diğerlerini etkilemez */ }
  }
  return [...map.values()].sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Pattern (co-occurrence) birikimci — küme başına bir kalıp
 * ════════════════════════════════════════════════════════════════════════ */

interface _PatAcc {
  clusterId:    string;
  manufacturer: string;
  protocol:     string;
  ecuFamily:    string[];
  evidenceIds:  string[];
  pids:         Set<string>;
  dids:         Set<string>;
  vehicles:     Set<string>;   // distinct fingerprint → vehicleCount şişmez
  windows:      Set<number>;   // firstSeen/lastSeen gün-kovaları → ayrı observation window sayısı
  observationCount: number;
  firstSeen:    number;
  lastSeen:     number;
}

function _dayBucket(ts: number): number {
  return Number.isFinite(ts) ? Math.floor(ts / DAY_MS) : 0;
}

/**
 * Kanıtlardan küme-başına co-occurrence kalıpları üretir. Aynı araçlarda birlikte görülen
 * PID/DID'ler tek kalıpta toplanır. Tek araçtaki tekrar confidence'ı şişirmez (distinct
 * fingerprint esas). Decayed confidence (P2-3) + deterministik promotion + conflict işaretleme
 * uygulanır. SALT-OKUNUR / SAF — girdiyi mutate etmez; boş/bozuk → []. ASLA throw etmez.
 *
 * DeviceTier: 'low' (BASIC_JS) yalnız basit grouping yapar → strong'a yükseltmez ve ağır
 * küme-arası conflict co-occurrence taraması ÇALIŞTIRMAZ (güvenli taraf). 'mid'/'high' bounded
 * tam analiz yapar.
 */
export function buildPatterns(
  evidenceList: readonly LearningEvidence[] | null | undefined,
  opts: PatternEngineOptions = {},
): LearningPattern[] {
  const now = Number.isFinite(opts.now) ? (opts.now as number) : Date.now();
  const tier: DeviceTier = opts.tier ?? 'high';
  const bounded = _bounded(evidenceList);
  const acc = new Map<string, _PatAcc>();

  for (const ev of bounded) {
    try {
      const id = _clusterIdentityOf(ev);
      if (!id) continue;
      let a = acc.get(id.clusterId);
      if (!a) {
        a = {
          clusterId: id.clusterId, manufacturer: id.manufacturer, protocol: id.protocol,
          ecuFamily: id.ecuFamily.slice(), evidenceIds: [],
          pids: new Set(), dids: new Set(), vehicles: new Set(), windows: new Set(),
          observationCount: 0,
          firstSeen: Number.isFinite(ev.firstSeen) ? ev.firstSeen : now,
          lastSeen: Number.isFinite(ev.lastSeen) ? ev.lastSeen : now,
        };
        acc.set(id.clusterId, a);
      }
      if (!a.evidenceIds.includes(ev.evidenceId)) a.evidenceIds.push(ev.evidenceId);

      const pidOrDid = _normText(ev.pidOrDid);
      if (pidOrDid) {
        if (ev.discoverySource === 'DID') a.dids.add(pidOrDid);
        else a.pids.add(pidOrDid); // PID (varsayılan)
      }
      for (const h of ev.supportingVehicleHashes ?? []) {
        const nh = (h ?? '').toString().trim();
        if (nh) a.vehicles.add(nh);
      }
      a.observationCount += Math.max(0, Number.isFinite(ev.observationCount) ? ev.observationCount : 0);
      if (Number.isFinite(ev.firstSeen)) {
        a.firstSeen = Math.min(a.firstSeen, ev.firstSeen);
        a.windows.add(_dayBucket(ev.firstSeen));
      }
      if (Number.isFinite(ev.lastSeen)) {
        a.lastSeen = Math.max(a.lastSeen, ev.lastSeen);
        a.windows.add(_dayBucket(ev.lastSeen));
      }
    } catch { /* fail-soft */ }
  }

  // Ham kalıpları (henüz conflict/promotion uygulanmamış) üret.
  const raw: LearningPattern[] = [];
  for (const a of acc.values()) {
    const observedPids = [...a.pids].sort();
    const observedDids = [...a.dids].sort();
    const supportingVehicleHashes = [...a.vehicles].sort();
    const vehicleCount = supportingVehicleHashes.length;
    const ecuCount = a.ecuFamily.length;
    const observationWindows = a.windows.size;

    const rawConf = evidenceConfidence(vehicleCount, a.observationCount, ecuCount);
    const prelim = evidenceStatus(vehicleCount, ecuCount); // half-life seçimi için
    const decayed = calculateDecayedConfidence(
      { confidence: rawConf, status: prelim, lastSeen: a.lastSeen } as LearningEvidence,
      now,
    );

    raw.push({
      patternId: `PAT|${a.clusterId}`,
      clusterId: a.clusterId,
      manufacturer: a.manufacturer,
      protocol: a.protocol,
      ecuAddresses: a.ecuFamily.slice(),
      evidenceIds: a.evidenceIds.slice(),
      observedPids,
      observedDids,
      supportingVehicleHashes,
      vehicleCount,
      observationCount: a.observationCount,
      observationWindows,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      confidence: decayed,
      status: 'weak',
      ambiguity: false,
      conflictReasons: [],
      requiresManualReview: false,
    });
  }

  // BASIC_JS (low): ağır küme-arası co-occurrence conflict taraması ÇALIŞMAZ (sadece grouping).
  // mid/high: bounded conflict tespiti → ambiguity/manual-review işaretle.
  const annotated = tier === 'low' ? raw : detectConflicts(raw, now);

  // Deterministik promotion (tier'e duyarlı: low strong'a çıkmaz).
  const decided = annotated.map((p) => promoteCandidate(p, tier));
  return decided.sort((x, y) =>
    y.confidence - x.confidence ||
    x.manufacturer.localeCompare(y.manufacturer) ||
    x.clusterId.localeCompare(y.clusterId));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Conflict tespiti (bounded, otomatik ÇÖZÜLMEZ — yalnız işaretlenir)
 * ════════════════════════════════════════════════════════════════════════ */

interface _SignalRef {
  patternIndex: number;
  manufacturer: string;
  protocol:     string;
  ecuKey:       string;
  confidence:   number;
  lastSeen:     number;
}

/**
 * Kalıplar arası conflict'leri işaretler (ambiguity + conflictReasons + requiresManualReview).
 * Otomatik ÇÖZMEZ. Yeni KOPYA döndürür (girdi mutate edilmez). Boş → []. FAIL-SOFT.
 *
 * Yakalanan türler: aynı PID/DID farklı marka (anlam belirsiz) · aynı DID farklı ECU ailesi ·
 * aynı sinyal farklı protokol · confidence ıraksaması · stale-vs-fresh ağırlık çelişkisi.
 */
export function detectConflicts(
  patterns: readonly LearningPattern[] | null | undefined,
  now: number = Date.now(),
): LearningPattern[] {
  const list = Array.isArray(patterns) ? patterns : [];
  // Derin-yeterli kopya: conflict alanlarını taze başlat (girdi korunur).
  const out: LearningPattern[] = list.map((p) => ({
    ...p,
    ecuAddresses: (p.ecuAddresses ?? []).slice(),
    conflictReasons: [],
    ambiguity: false,
    requiresManualReview: false,
  }));
  if (out.length < 2) return out;

  try {
    // sinyal (source:id) → onu içeren kalıplara referans
    const index = new Map<string, _SignalRef[]>();
    const add = (id: string, ref: _SignalRef): void => {
      const arr = index.get(id);
      if (arr) arr.push(ref); else index.set(id, [ref]);
    };
    out.forEach((p, i) => {
      const ref: _SignalRef = {
        patternIndex: i,
        manufacturer: p.manufacturer,
        protocol: p.protocol,
        ecuKey: (p.ecuAddresses ?? []).join(','),
        confidence: Number.isFinite(p.confidence) ? p.confidence : 0,
        lastSeen: Number.isFinite(p.lastSeen) ? p.lastSeen : now,
      };
      for (const pid of p.observedPids ?? []) add(`PID:${pid}`, ref);
      for (const did of p.observedDids ?? []) add(`DID:${did}`, ref);
    });

    const staleMs = STALE_CONFLICT_DAYS * DAY_MS;
    for (const [sig, refs] of index) {
      if (refs.length < 2) continue; // tek kalıpta → çelişki yok
      const isDid = sig.startsWith('DID:');
      const manufacturers = new Set(refs.map((r) => r.manufacturer));
      const protocols = new Set(refs.map((r) => r.protocol));
      const ecuKeys = new Set(refs.map((r) => r.ecuKey));
      const confs = refs.map((r) => r.confidence);
      const maxConf = Math.max(...confs);
      const minConf = Math.min(...confs);
      const hasStale = refs.some((r) => Math.max(0, now - r.lastSeen) >= staleMs);
      const hasFresh = refs.some((r) => Math.max(0, now - r.lastSeen) < staleMs);

      const reasons: ConflictReason[] = [];
      if (manufacturers.size > 1) reasons.push('CROSS_MANUFACTURER_MEANING');
      if (isDid && ecuKeys.size > 1) reasons.push('CROSS_ECU_DID_INCONSISTENT');
      if (protocols.size > 1) reasons.push('CROSS_PROTOCOL_INCONSISTENT');
      if (maxConf - minConf >= CONFIDENCE_DIVERGENCE_THRESHOLD) reasons.push('CONFIDENCE_DIVERGENCE');
      if (hasStale && hasFresh) reasons.push('STALE_VS_FRESH_CONFLICT');
      if (reasons.length === 0) continue;

      for (const r of refs) {
        const p = out[r.patternIndex];
        for (const reason of reasons) {
          if (!p.conflictReasons.includes(reason)) p.conflictReasons.push(reason);
        }
        p.ambiguity = true;
        p.requiresManualReview = true;
      }
    }
    for (const p of out) p.conflictReasons.sort();
  } catch {
    // fail-soft: hata → conflict işaretlemeden döndür (güvenli — promotion zaten muhafazakâr)
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Aday yükseltme (deterministik — YAZMAZ, yalnız status kararı üretir)
 * ════════════════════════════════════════════════════════════════════════ */

function _hasHardConflict(reasons: readonly ConflictReason[]): boolean {
  for (const r of reasons ?? []) if (HARD_CONFLICTS.has(r)) return true;
  return false;
}

/**
 * Bir kalıbın YENİ status'ünü deterministik koşullarla belirler (fiziksel yazma YOK). Yeni
 * KOPYA döndürür (girdi mutate edilmez). FAIL-SOFT.
 *
 * rejected: decayed<0.20 VEYA hard conflict (marka/protokol/decode uyuşmazlığı).
 * weak→candidate: vehicleCount≥2 · decayed≥0.50 · ambiguity yok · conflict yok.
 * candidate→strong: (vehicleCount≥3 VEYA vehicleCount≥2+ecuCount≥2) · decayed≥0.70 ·
 *   ≥2 observation window · conflict yok · requiresManualReview=false · tier≠low.
 * BASIC_JS (low) ASLA strong üretmez (ağır analiz yapılmadı → güvenli taraf, candidate tavan).
 */
export function promoteCandidate(pattern: LearningPattern, tier: DeviceTier = 'high'): LearningPattern {
  const p: LearningPattern = {
    ...pattern,
    ecuAddresses: (pattern?.ecuAddresses ?? []).slice(),
    conflictReasons: (pattern?.conflictReasons ?? []).slice(),
  };
  try {
    const conf = Number.isFinite(p.confidence) ? p.confidence : 0;
    const vc = Math.max(0, Number.isFinite(p.vehicleCount) ? p.vehicleCount : 0);
    const ecuCount = (p.ecuAddresses ?? []).length;
    const windows = Math.max(0, Number.isFinite(p.observationWindows) ? p.observationWindows : 0);
    const noConflict = (p.conflictReasons ?? []).length === 0;

    if (conf < REJECT_CONFIDENCE_FLOOR || _hasHardConflict(p.conflictReasons)) {
      p.status = 'rejected';
      return p;
    }

    const strongEligible =
      tier !== 'low' &&
      (vc >= 3 || (vc >= 2 && ecuCount >= 2)) &&
      conf >= STRONG_MIN_CONFIDENCE &&
      windows >= 2 &&
      noConflict &&
      !p.requiresManualReview;
    if (strongEligible) { p.status = 'strong'; return p; }

    const candidateEligible =
      vc >= 2 &&
      conf >= CANDIDATE_MIN_CONFIDENCE &&
      !p.ambiguity &&
      noConflict;
    p.status = candidateEligible ? 'candidate' : 'weak';
    return p;
  } catch {
    p.status = 'weak'; // şüphede yükseltme (güvenli taraf)
    return p;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Motor — on-demand (kalıcı depo/wiring YOK; bounded RAM cache)
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleLearningPatternEngine {
  private readonly _readEvidence: () => LearningEvidence[];
  private readonly _now: () => number;
  private readonly _tier: () => DeviceTier;
  private _cache: LearningPattern[] | null = null;

  constructor(
    readEvidence: () => LearningEvidence[] = () => [],
    now: () => number = () => Date.now(),
    tier: () => DeviceTier = () => getDeviceTier(),
  ) {
    this._readEvidence = readEvidence;
    this._now = now;
    this._tier = tier;
  }

  /** Kanıtlardan kalıpları üretir (on-demand, bounded cache). FAIL-SOFT. */
  computePatterns(): LearningPattern[] {
    try {
      if (this._cache) return this._cache;
      const patterns = buildPatterns(this._readEvidence(), { now: this._now(), tier: this._tier() });
      this._cache = patterns;
      return patterns;
    } catch {
      return [];
    }
  }

  /** Yalnız 'strong' adaylar. */
  getStrongCandidates(): LearningPattern[] {
    return this.computePatterns().filter((p) => p.status === 'strong');
  }

  /** Manuel inceleme gerektiren (conflict/ambiguity) adaylar. */
  getManualReviewCandidates(): LearningPattern[] {
    return this.computePatterns().filter((p) => p.requiresManualReview || p.ambiguity);
  }

  /** Cache'i boşaltır (bir sonraki compute taze üretir). */
  clear(): void { this._cache = null; }

  /** Zero-leak temizlik. */
  dispose(): void { this._cache = null; }
}

/** Uygulama geneli tekil motor (on-demand — UI/mantık çağırınca üretir; wiring YOK). */
export const vehicleLearningPatternEngine = new VehicleLearningPatternEngine();

/* ── Flat API (spec) ───────────────────────────────────────────────────────── */

/** Tekil motordan 'strong' adaylar. */
export function getStrongCandidates(): LearningPattern[] {
  return vehicleLearningPatternEngine.getStrongCandidates();
}
/** Tekil motordan manuel-inceleme adayları. */
export function getManualReviewCandidates(): LearningPattern[] {
  return vehicleLearningPatternEngine.getManualReviewCandidates();
}
/** Tekil motor cache'ini boşaltır. */
export function clear(): void { vehicleLearningPatternEngine.clear(); }
/** Zero-leak temizlik (tekil motor). */
export function dispose(): void { vehicleLearningPatternEngine.dispose(); }
