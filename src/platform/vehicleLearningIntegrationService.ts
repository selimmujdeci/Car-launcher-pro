/**
 * vehicleLearningIntegrationService — Öğrenme Entegrasyon Katmanı (P2-5).
 *
 * AMAÇ: P2-1→P2-4 arasında kurulan öğrenme katmanlarını (Evidence Store · Decay · Pattern
 * Engine) uygulamanın kullanıcıya değer üreten mevcut ekran/tanı akışlarına SALT-OKUNUR
 * bağlar. Bu servis:
 *   - Evidence Store'dan kanıtları okur (P2-2)
 *   - decay uygular (P2-3)
 *   - pattern engine ile pattern üretir (P2-4)
 *   - Diagnostic Knowledge için ek bağlam hazırlar (safety/severity/driveSafe DEĞİŞTİRMEZ)
 *   - Discovery Dashboard rozetleri + Expert Mode özeti için view-model üretir
 *
 * KESİN SINIRLAR (CLAUDE.md): hiçbir registry/profile/store'a OTOMATİK YAZMAZ · hiçbir
 * güvenlik-kritik kararı tek başına değiştirmez · Cloud/SQL/LLM/Native/hot-path YOK ·
 * OBD 3Hz poll akışına dokunmaz · yeni bağımlılık YOK · bounded (≤512) · memoized · girdiyi
 * MUTASYONA UĞRATMAZ · FAIL-SOFT (çökse bile alt katmanlar etkilenmez) · zero-leak dispose.
 *
 * Evidence Store merge · decay formülü · pattern promotion kuralları DEĞİŞMEZ — yalnız okunur.
 */

import { vehicleLearningEvidenceStore } from './vehicleLearningEvidenceStore';
import { type LearningEvidence } from './vehicleLearningEngine';
import {
  calculateDecayedConfidence,
  isPruneCandidate,
  PRUNE_CONFIDENCE_FLOOR,
} from './vehicleLearningDecay';
import {
  buildClusters,
  buildPatterns,
  type LearningPattern,
  type PatternStatus,
  type ConflictReason,
} from './vehicleLearningPatternEngine';
import { getDeviceTier, type DeviceTier } from './deviceCapabilities';
import type { DiagnosticInsight } from './diagnosticKnowledgeEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler / model
 * ════════════════════════════════════════════════════════════════════════ */

const HOUR_MS = 3_600_000;
/** İşlenecek maksimum kanıt (bounded — CLAUDE.md). */
export const MAX_EVIDENCE = 512;

/** Discovery Dashboard / Expert rozetleri. */
export type LearningBadge = 'WEAK' | 'CANDIDATE' | 'STRONG' | 'MANUAL_REVIEW' | 'STALE' | 'CONFLICT';

/** Bir keşif kaydının (source+pidOrDid) öğrenme anotasyonu — salt-okunur, dashboard için. */
export interface LearningDiscoveryAnnotation {
  pidOrDid:            string;
  discoverySource:     'PID' | 'DID';
  /** Kanıt (evidence) statüsü (P2-1). */
  evidenceStatus:      LearningEvidence['status'];
  /** Pattern statüsü (P2-4) — pattern yoksa null (ör. BASIC_JS'te detay kapalı). */
  patternStatus:       PatternStatus | null;
  confidence:          number;   // ham (P2-1)
  decayedConfidence:   number;   // P2-3
  vehicleCount:        number;
  observationCount:    number;
  ecuCount:            number;
  firstSeen:           number;
  lastSeen:            number;
  stale:               boolean;
  requiresManualReview: boolean;
  conflictReasons:     ConflictReason[];
}

/** Diagnostic Insight'a EK bağlam (safety/severity/driveSafe'i DEĞİŞTİRMEZ). */
export interface DiagnosticLearningContext {
  learnedEvidenceCount:        number;
  learnedPatternCount:         number;
  strongestCandidateConfidence: number;
  learnedOnThisVehicle:        boolean;
  learnedOnManufacturer:       boolean;
  relatedStrongPids:           string[];
  relatedStrongDids:           string[];
  learningWarnings:            string[];
  requiresManualReview:        boolean;
}

/** Insight + opsiyonel öğrenme bağlamı (additive — mevcut alanlar korunur). */
export type EnrichedDiagnosticInsight = DiagnosticInsight & { learning?: DiagnosticLearningContext };

/** Expert Mode "Vehicle Learning" bölümü view-model'i. */
export interface ExpertLearningSummary {
  totalEvidence:        number;
  weakCount:            number;   // evidence.status (P2-1)
  candidateCount:       number;
  strongCount:          number;
  staleCount:           number;   // decayed<floor (P2-3)
  pruneCandidateCount:  number;   // isPruneCandidate (P2-3)
  manualReviewCount:    number;   // pattern-türevi (BASIC_JS'te 0)
  conflictCount:        number;   // pattern-türevi (BASIC_JS'te 0)
  patternCount:         number;
  strongPidCandidates:  string[];
  strongDidCandidates:  string[];
  manufacturerClusters: Array<{ manufacturer: string; count: number }>;
  lastLearnedAt:        number | null;
  /** BASIC_JS(low) → false: ağır pattern/conflict detayı kapalı. */
  patternDetailEnabled: boolean;
}

export interface DiagnosticLearningOptions {
  /** Şu anki aracın fingerprint hash'i (varsa) — learnedOnThisVehicle için. */
  currentVehicleHash?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _norm(s: string | undefined | null): string {
  return (s ?? '').toString().trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
}

/** FNV-1a 32-bit (yerel, bağımlılıksız). */
function _fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Kanıt listesinin ucuz imzası (memoization anahtarı) — bounded, O(n), fail-soft. */
function _evidenceSignature(list: readonly LearningEvidence[]): string {
  let acc = list.length >>> 0;
  let maxUpd = 0;
  for (const e of list) {
    if (!e || typeof e !== 'object') { acc = (Math.imul(acc, 31) + 1) >>> 0; continue; }
    acc = (Math.imul(acc, 31) + _fnv1a(e.evidenceId ?? '')) >>> 0;
    acc = (Math.imul(acc, 31) + ((e.observationCount | 0))) >>> 0;
    acc = (Math.imul(acc, 31) + ((e.lastSeen | 0))) >>> 0;
    if ((e.updatedAt ?? 0) > maxUpd) maxUpd = e.updatedAt;
  }
  return `${list.length}:${maxUpd}:${acc}`;
}

const STATUS_LABEL: Record<ConflictReason, string> = {
  CROSS_MANUFACTURER_MEANING: 'Aynı sinyal birden fazla markada farklı anlam taşıyor',
  CROSS_ECU_DID_INCONSISTENT: 'Aynı DID farklı ECU ailelerinde tutarsız',
  CROSS_PROTOCOL_INCONSISTENT: 'Aynı sinyal farklı protokollerde uyumsuz',
  CONFIDENCE_DIVERGENCE: 'Küme-arası güven ıraksaması',
  STALE_VS_FRESH_CONFLICT: 'Eski kanıt yeni kanıtla çelişiyor',
  MANUFACTURER_MISMATCH: 'Marka uyuşmazlığı',
  DECODE_MEANING_CONFLICT: 'Aynı sinyal için çelişkili çözümleme',
};

/* ══════════════════════════════════════════════════════════════════════════
 * Servis (on-demand, memoized, fail-soft, zero-leak)
 * ════════════════════════════════════════════════════════════════════════ */

interface _Computed {
  evidence:     LearningEvidence[];
  patterns:     LearningPattern[];
  byKey:        Map<string, LearningDiscoveryAnnotation>; // `${source}:${pidOrDid}`
  tier:         DeviceTier;
  now:          number;
}

/** Enjekte edilebilir pattern kurucu (varsayılan P2-4 buildPatterns; test için sayılabilir). */
export type PatternBuilder = (evidence: readonly LearningEvidence[], opts: { now: number; tier: DeviceTier }) => LearningPattern[];

export class VehicleLearningIntegrationService {
  private readonly _readEvidence: () => LearningEvidence[];
  private readonly _now: () => number;
  private readonly _tier: () => DeviceTier;
  private readonly _buildPatterns: PatternBuilder;
  private _memoKey: string | null = null;
  private _memo: _Computed | null = null;

  constructor(
    readEvidence: () => LearningEvidence[] = () => vehicleLearningEvidenceStore.list(),
    now: () => number = () => Date.now(),
    tier: () => DeviceTier = () => getDeviceTier(),
    patternBuilder: PatternBuilder = buildPatterns,
  ) {
    this._readEvidence = readEvidence;
    this._now = now;
    this._tier = tier;
    this._buildPatterns = patternBuilder;
  }

  /* ── Çekirdek hesap (memoized) ─────────────────────────────────────────── */

  private _compute(): _Computed {
    const now = this._now();
    let tier: DeviceTier = 'high';
    let rawList: LearningEvidence[] = [];
    try { tier = this._tier(); } catch { tier = 'high'; }
    try { rawList = this._readEvidence() ?? []; } catch { rawList = []; }
    if (!Array.isArray(rawList)) rawList = [];
    const evidence = rawList.length > MAX_EVIDENCE ? rawList.slice(0, MAX_EVIDENCE) : rawList.slice();

    // Memo anahtarı: imza + tier + saat-kovası (decay yavaş → saat granülaritesi yeterli).
    const key = `${_evidenceSignature(evidence)}|${tier}|${Math.floor(now / HOUR_MS)}`;
    if (this._memoKey === key && this._memo) return this._memo;

    let patterns: LearningPattern[] = [];
    try { patterns = this._buildPatterns(evidence, { now, tier }); } catch { patterns = []; }

    // (source:pidOrDid) → anotasyon. Evidence baz alınır; pattern detayı (varsa) eklenir.
    const byKey = new Map<string, LearningDiscoveryAnnotation>();
    const patternDetail = tier !== 'low';
    for (const e of evidence) {
      try {
        const pidOrDid = _norm(e.pidOrDid);
        if (!pidOrDid) continue;
        const source: 'PID' | 'DID' = e.discoverySource === 'DID' ? 'DID' : 'PID';
        const k = `${source}:${pidOrDid}`;
        const decayed = calculateDecayedConfidence(e, now);
        const stale = decayed < PRUNE_CONFIDENCE_FLOOR;
        const ann: LearningDiscoveryAnnotation = {
          pidOrDid, discoverySource: source,
          evidenceStatus: e.status, patternStatus: null,
          confidence: e.confidence, decayedConfidence: decayed,
          vehicleCount: e.vehicleCount, observationCount: e.observationCount,
          ecuCount: (e.ecuAddresses ?? []).length,
          firstSeen: e.firstSeen, lastSeen: e.lastSeen,
          stale, requiresManualReview: false, conflictReasons: [],
        };
        const prev = byKey.get(k);
        // Aynı sinyalin birden çok kanıtı: en yüksek decayed olanı temsilci al.
        if (!prev || decayed > prev.decayedConfidence) byKey.set(k, ann);
      } catch { /* fail-soft */ }
    }
    // Pattern detayını (statü/conflict/manual-review) yalnız mid/high'da anotasyona işle.
    if (patternDetail) {
      for (const p of patterns) {
        try {
          const rev = p.requiresManualReview || (p.conflictReasons?.length ?? 0) > 0;
          for (const pid of p.observedPids ?? []) {
            const ann = byKey.get(`PID:${_norm(pid)}`);
            if (ann) { ann.patternStatus = p.status; ann.requiresManualReview ||= rev; _mergeReasons(ann, p.conflictReasons); }
          }
          for (const did of p.observedDids ?? []) {
            const ann = byKey.get(`DID:${_norm(did)}`);
            if (ann) { ann.patternStatus = p.status; ann.requiresManualReview ||= rev; _mergeReasons(ann, p.conflictReasons); }
          }
        } catch { /* fail-soft */ }
      }
    }

    const computed: _Computed = { evidence, patterns, byKey, tier, now };
    this._memoKey = key;
    this._memo = computed;
    return computed;
  }

  /* ── Discovery Dashboard ───────────────────────────────────────────────── */

  /** (source, pidOrDid) için öğrenme anotasyonu — yoksa null. Salt-okunur kopya. */
  annotateDiscovery(discoverySource: 'PID' | 'DID', pidOrDid: string): LearningDiscoveryAnnotation | null {
    try {
      const c = this._compute();
      const ann = c.byKey.get(`${discoverySource}:${_norm(pidOrDid)}`);
      return ann ? { ...ann, conflictReasons: [...ann.conflictReasons] } : null;
    } catch { return null; }
  }

  /** Tüm anotasyonların `${source}:${pidOrDid}` → annotation haritası (dashboard toplu arama). */
  getAnnotationMap(): Map<string, LearningDiscoveryAnnotation> {
    try {
      const c = this._compute();
      const out = new Map<string, LearningDiscoveryAnnotation>();
      for (const [k, v] of c.byKey) out.set(k, { ...v, conflictReasons: [...v.conflictReasons] });
      return out;
    } catch { return new Map(); }
  }

  /* ── Expert Mode özeti ─────────────────────────────────────────────────── */

  getExpertSummary(): ExpertLearningSummary {
    const empty: ExpertLearningSummary = {
      totalEvidence: 0, weakCount: 0, candidateCount: 0, strongCount: 0,
      staleCount: 0, pruneCandidateCount: 0, manualReviewCount: 0, conflictCount: 0,
      patternCount: 0, strongPidCandidates: [], strongDidCandidates: [],
      manufacturerClusters: [], lastLearnedAt: null, patternDetailEnabled: true,
    };
    try {
      const c = this._compute();
      const patternDetail = c.tier !== 'low';
      let weak = 0, candidate = 0, strong = 0, stale = 0, prune = 0, lastLearnedAt = 0;
      for (const e of c.evidence) {
        try {
          if (!e || typeof e !== 'object') continue;
          if (e.status === 'weak') weak++;
          else if (e.status === 'candidate') candidate++;
          else if (e.status === 'strong') strong++;
          if (calculateDecayedConfidence(e, c.now) < PRUNE_CONFIDENCE_FLOOR) stale++;
          if (isPruneCandidate(e, c.now)) prune++;
          const t = Math.max(e.lastSeen ?? 0, e.updatedAt ?? 0);
          if (t > lastLearnedAt) lastLearnedAt = t;
        } catch { /* tek kayıt hatası diğerlerini etkilemez */ }
      }

      // Marka kümeleri (buildClusters — hafif grouping, tüm tier'larda).
      let clusters: Array<{ manufacturer: string; count: number }> = [];
      try {
        const cl = buildClusters(c.evidence);
        const byMfr = new Map<string, number>();
        for (const g of cl) byMfr.set(g.manufacturer, (byMfr.get(g.manufacturer) ?? 0) + 1);
        clusters = [...byMfr.entries()].map(([manufacturer, count]) => ({ manufacturer, count }))
          .sort((a, b) => b.count - a.count || a.manufacturer.localeCompare(b.manufacturer));
      } catch { clusters = []; }

      // Pattern-türevi sayımlar + güçlü adaylar (yalnız mid/high — ağır detay).
      let manualReview = 0, conflict = 0;
      const strongPids = new Set<string>();
      const strongDids = new Set<string>();
      if (patternDetail) {
        for (const p of c.patterns) {
          if (p.requiresManualReview) manualReview++;
          if ((p.conflictReasons?.length ?? 0) > 0) conflict++;
          if (p.status === 'strong') {
            for (const pid of p.observedPids ?? []) strongPids.add(_norm(pid));
            for (const did of p.observedDids ?? []) strongDids.add(_norm(did));
          }
        }
      } else {
        // BASIC_JS: güçlü adayları evidence.status'tan türet (hafif).
        for (const e of c.evidence) {
          if (e.status !== 'strong') continue;
          const id = _norm(e.pidOrDid);
          if (!id) continue;
          if (e.discoverySource === 'DID') strongDids.add(id); else strongPids.add(id);
        }
      }

      return {
        totalEvidence: c.evidence.length,
        weakCount: weak, candidateCount: candidate, strongCount: strong,
        staleCount: stale, pruneCandidateCount: prune,
        manualReviewCount: manualReview, conflictCount: conflict,
        patternCount: c.patterns.length,
        strongPidCandidates: [...strongPids].sort(),
        strongDidCandidates: [...strongDids].sort(),
        manufacturerClusters: clusters,
        lastLearnedAt: lastLearnedAt || null,
        patternDetailEnabled: patternDetail,
      };
    } catch { return empty; }
  }

  /* ── Diagnostic Knowledge bağlamı ──────────────────────────────────────── */

  /**
   * Bir Diagnostic Insight için öğrenme bağlamı üretir. Öğrenme verisi yoksa null döner
   * (insight aynen korunur). Safety/severity/driveSafe'i ETKİLEMEZ — yalnız ek bilgi.
   */
  buildDiagnosticLearningContext(
    insight: Pick<DiagnosticInsight, 'relatedPids' | 'relatedDids' | 'manufacturer' | 'discoveredOnVehicle'>,
    opts: DiagnosticLearningOptions = {},
  ): DiagnosticLearningContext | null {
    try {
      const c = this._compute();
      const relPids = new Set((insight?.relatedPids ?? []).map(_norm).filter(Boolean));
      const relDids = new Set((insight?.relatedDids ?? []).map(_norm).filter(Boolean));
      if (relPids.size === 0 && relDids.size === 0) return null;
      const mfr = _norm(insight?.manufacturer);
      const vhash = (opts.currentVehicleHash ?? '').trim();

      let evidenceCount = 0;
      let strongest = 0;
      let onVehicle = false;
      let onManufacturer = false;
      for (const e of c.evidence) {
        try {
          if (!e || typeof e !== 'object') continue;
          const id = _norm(e.pidOrDid);
          const isPid = e.discoverySource !== 'DID';
          const match = isPid ? relPids.has(id) : relDids.has(id);
          if (!match) continue;
          evidenceCount++;
          strongest = Math.max(strongest, calculateDecayedConfidence(e, c.now));
          if (vhash && (e.supportingVehicleHashes ?? []).includes(vhash)) onVehicle = true;
          if (mfr && _norm(e.manufacturer) === mfr) onManufacturer = true;
        } catch { /* fail-soft */ }
      }

      let patternCount = 0;
      let manualReview = false;
      const strongPids = new Set<string>();
      const strongDids = new Set<string>();
      const warnings: string[] = [];
      const seenReasons = new Set<ConflictReason>();
      for (const p of c.patterns) {
        const pPids = (p.observedPids ?? []).map(_norm);
        const pDids = (p.observedDids ?? []).map(_norm);
        const hit = pPids.some((x) => relPids.has(x)) || pDids.some((x) => relDids.has(x));
        if (!hit) continue;
        patternCount++;
        strongest = Math.max(strongest, Number.isFinite(p.confidence) ? p.confidence : 0);
        if (p.requiresManualReview) manualReview = true;
        if (p.status === 'strong') {
          for (const x of pPids) if (relPids.has(x)) strongPids.add(x);
          for (const x of pDids) if (relDids.has(x)) strongDids.add(x);
        }
        for (const r of p.conflictReasons ?? []) {
          if (!seenReasons.has(r)) { seenReasons.add(r); warnings.push(STATUS_LABEL[r] ?? String(r)); }
        }
      }

      // Öğrenme verisi hiç yoksa → null (insight aynen korunur).
      if (evidenceCount === 0 && patternCount === 0) return null;

      return {
        learnedEvidenceCount: evidenceCount,
        learnedPatternCount: patternCount,
        strongestCandidateConfidence: strongest,
        learnedOnThisVehicle: onVehicle || (vhash === '' && !!insight?.discoveredOnVehicle),
        learnedOnManufacturer: onManufacturer,
        relatedStrongPids: [...strongPids].sort(),
        relatedStrongDids: [...strongDids].sort(),
        learningWarnings: warnings,
        requiresManualReview: manualReview,
      };
    } catch { return null; }
  }

  /**
   * Insight'ı öğrenme bağlamıyla zenginleştirir. Öğrenme yoksa insight AYNEN döner. Girdiyi
   * MUTASYONA UĞRATMAZ; safety/severity/driveSafe/confidence DEĞİŞMEZ (yalnız `learning` eklenir).
   */
  enrichInsight(insight: DiagnosticInsight, opts: DiagnosticLearningOptions = {}): EnrichedDiagnosticInsight {
    if (!insight) return insight;
    const ctx = this.buildDiagnosticLearningContext(insight, opts);
    if (!ctx) return insight; // veri yok → aynen koru
    return { ...insight, learning: ctx };
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /** Memo'yu geçersiz kılar (bir sonraki çağrı taze hesaplar). */
  invalidate(): void { this._memoKey = null; this._memo = null; }

  /** Zero-leak temizlik. */
  dispose(): void { this.invalidate(); }
}

function _mergeReasons(ann: LearningDiscoveryAnnotation, reasons: readonly ConflictReason[] | undefined): void {
  for (const r of reasons ?? []) if (!ann.conflictReasons.includes(r)) ann.conflictReasons.push(r);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rozet türetimi (SAF — dashboard/expert)
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir anotasyondan öğrenme rozetleri (öncelik: CONFLICT/MANUAL_REVIEW > statü > STALE). */
export function learningBadgesFor(ann: LearningDiscoveryAnnotation | null | undefined): LearningBadge[] {
  if (!ann) return [];
  const out: LearningBadge[] = [];
  const status = ann.patternStatus ?? ann.evidenceStatus;
  if (status === 'strong') out.push('STRONG');
  else if (status === 'candidate') out.push('CANDIDATE');
  else if (status === 'weak') out.push('WEAK');
  // 'rejected' → statü rozeti gösterme (aday değil).
  if (ann.conflictReasons.length > 0) out.push('CONFLICT');
  if (ann.requiresManualReview) out.push('MANUAL_REVIEW');
  if (ann.stale) out.push('STALE');
  return out;
}

/** Uygulama geneli tekil servis (on-demand — UI/mantık çağırınca üretir; wiring YOK). */
export const vehicleLearningIntegrationService = new VehicleLearningIntegrationService();
