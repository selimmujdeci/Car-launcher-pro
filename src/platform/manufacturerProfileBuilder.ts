/**
 * manufacturerProfileBuilder — Üretici Profil Üreticisi TEMELİ (PR-30, foundation-only).
 *
 * AMAÇ: ManufacturerIntelligenceEngine (PR-29) çıktısındaki STRONG aday PID/DID kayıtlarını,
 * gerçek üretici profillerine dönüştürülmeye HAZIR "Profile Candidate"lara çevirir. Aynı
 * adayları birleştirir, çakışmaları TESPİT EDER ve MANUEL ONAYA hazır hale getirir.
 *
 * KRİTİK: Bu builder HİÇBİR profile dosyasını/registry'yi DEĞİŞTİRMEZ, otomatik yazmaz.
 * Yalnız Candidate ÜRETİR (salt-okunur türetme). Çakışmalar OTOMATİK ÇÖZÜLMEZ — yalnız
 * requiresManualReview=true işaretlenir (insan karar verir).
 *
 * KESİN SINIRLAR (CLAUDE.md): renault/ford/toyota profilleri · manufacturer registry ·
 * Discovery · Fingerprint · VehicleKnowledge · Manufacturer Intelligence · PID/DID Registry ·
 * SQL/Supabase · Cloud · AI DEĞİŞMEZ. TAMAMEN ADDITIVE + FAIL-SOFT: builder çökse bile alt
 * katmanların hiçbiri etkilenmez.
 */

import { normalizeEcuAddress } from './vehicleFingerprintService';
import {
  type ManufacturerKnowledge,
  type CandidatePidDid,
  type CandidateStatus,
} from './manufacturerIntelligenceEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Manuel onaya hazır tek üretici profili adayı (tek ECU'ya indirgenmiş). */
export interface ProfileCandidate {
  manufacturer:         string;
  profileHint:          string;
  /** Transport protokolü — MIE çıktısı taşımaz → '' (bu katmanda bilinmez; gelecekte zenginleşir). */
  protocol:             string;
  ecuAddress:           string;
  pidOrDid:             string;
  mode:                 string;
  confidence:           number;
  vehicleCount:         number;
  seenCount:            number;
  firstSeen:            number;
  lastSeen:             number;
  candidateStatus:      CandidateStatus;
  /** Aynı sinyalin (üretici+kaynak+pid/did) tüm ECU varyantlarını gruplayan anahtar. */
  mergeGroup:           string;
  requiresManualReview: boolean;
  /** İnceleme nedenleri (çakışma türleri) — otomatik çözülmez, insana bilgi. */
  conflictReasons:      string[];
}

export interface ProfileCandidateOptions {
  /** Yalnız bu durum ve üstünü değerlendir (varsayılan: yalnız 'strong'). */
  minStatus?:                   CandidateStatus;
  /** Zaten katalogda/profilde olan sinyali işaretlemek için SALT-OKUNUR sorgu (opsiyonel). */
  isKnownSignal?:               (manufacturer: string, source: 'PID' | 'DID', pidOrDid: string) => boolean;
  /** Çelişkili confidence eşiği (birleşen kaynakların confidence farkı) — varsayılan 0.3. */
  confidenceConflictThreshold?: number;
}

const STATUS_RANK: Record<CandidateStatus, number> = { weak: 0, candidate: 1, strong: 2 };

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/* ── İç birleştirme birikimcisi ───────────────────────────────────────────── */
interface _Merge {
  manufacturer:  string;
  profileHint:   string;
  source:        'PID' | 'DID';
  pidOrDid:      string;
  ecuAddress:    string;
  mode:          string;
  status:        CandidateStatus;
  seenCount:     number;
  vehicleCount:  number;
  confidences:   number[]; // birleşen kaynak confidence'ları (çelişki tespiti için)
  firstSeen:     number;
  lastSeen:      number;
}

function _mergeKey(m: { manufacturer: string; source: string; pidOrDid: string; ecuAddress: string }): string {
  return `${m.manufacturer}|${m.source}|${m.pidOrDid}|${m.ecuAddress}`;
}

/** Aynı sinyalin (üretici+kaynak+pid/did) tüm ECU varyantları için ortak grup anahtarı. */
function _groupKey(m: { manufacturer: string; source: string; pidOrDid: string }): string {
  return `${m.manufacturer}|${m.source}|${m.pidOrDid}`;
}

/**
 * ManufacturerKnowledge listesinden manuel-onaya-hazır ProfileCandidate'lar üretir.
 * Aynı adayları BİRLEŞTİRİR (seenCount/vehicleCount toplanır, confidence maksimuma alınır),
 * çakışmaları TESPİT eder (multi-ECU, çelişkili confidence, zaten-katalogda). SAF + FAIL-SOFT:
 * girdiyi mutasyona uğratmaz, boş/bozuk girdi → []; asla throw sızmaz.
 */
export function buildProfileCandidates(
  manufacturers: readonly ManufacturerKnowledge[] | null | undefined,
  opts: ProfileCandidateOptions = {},
): ProfileCandidate[] {
  const minRank = STATUS_RANK[opts.minStatus ?? 'strong'];
  const confThreshold = opts.confidenceConflictThreshold ?? 0.3;
  const merges = new Map<string, _Merge>();

  try {
    for (const mk of manufacturers ?? []) {
      if (!mk || typeof mk !== 'object') continue; // bozuk → atla
      const manufacturer = mk.manufacturer ?? '';
      const profileHint = mk.profileHint ?? '';
      const all: CandidatePidDid[] = [...(mk.observedPids ?? []), ...(mk.observedDids ?? [])];
      for (const c of all) {
        try {
          if (!c || (STATUS_RANK[c.status] ?? -1) < minRank) continue; // yalnız strong (varsayılan)
          const ecus = (c.ecuAddresses && c.ecuAddresses.length > 0)
            ? c.ecuAddresses.map(normalizeEcuAddress).filter(Boolean)
            : [''];
          const uniqueEcus = [...new Set(ecus)];
          for (const ecuAddress of uniqueEcus) {
            const key = _mergeKey({ manufacturer, source: c.discoverySource, pidOrDid: c.pidOrDid, ecuAddress });
            const existing = merges.get(key);
            if (existing) {
              existing.seenCount += c.seenCount ?? 0;
              existing.vehicleCount += c.vehicleCount ?? 0;   // birleşen adaylar → toplanır
              existing.confidences.push(c.confidence ?? 0);
              existing.firstSeen = Math.min(existing.firstSeen, c.firstSeen ?? existing.firstSeen); // KORUNUR
              existing.lastSeen = Math.max(existing.lastSeen, c.lastSeen ?? existing.lastSeen);
              if ((STATUS_RANK[c.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0)) existing.status = c.status;
            } else {
              merges.set(key, {
                manufacturer, profileHint,
                source: c.discoverySource, pidOrDid: c.pidOrDid, ecuAddress, mode: c.mode ?? (c.discoverySource === 'DID' ? '22' : '01'),
                status: c.status, seenCount: c.seenCount ?? 0, vehicleCount: c.vehicleCount ?? 0,
                confidences: [c.confidence ?? 0], firstSeen: c.firstSeen ?? 0, lastSeen: c.lastSeen ?? 0,
              });
            }
          }
        } catch { /* tek aday hatası diğerlerini etkilemez */ }
      }
    }
  } catch {
    return []; // fail-soft: hiçbir şey döndürme yerine güvenli boş
  }

  // ── ECU çeşitliliğini grup bazında say (multi-ECU çakışması) ──
  const ecusPerGroup = new Map<string, Set<string>>();
  for (const m of merges.values()) {
    const g = _groupKey(m);
    const set = ecusPerGroup.get(g) ?? new Set<string>();
    set.add(m.ecuAddress);
    ecusPerGroup.set(g, set);
  }

  const out: ProfileCandidate[] = [];
  for (const m of merges.values()) {
    const conflictReasons: string[] = [];

    // Çelişkili confidence: birleşen kaynakların en yüksek-en düşük farkı eşiği aşıyorsa.
    if (m.confidences.length > 1) {
      const span = Math.max(...m.confidences) - Math.min(...m.confidences);
      if (span > confThreshold) conflictReasons.push('confidence-divergence');
    }
    // Aynı profile/sinyal farklı ECU: grup içinde >1 ECU (aynı DID/PID birden çok ECU'da → belirsiz).
    const groupEcus = ecusPerGroup.get(_groupKey(m));
    if (groupEcus && groupEcus.size > 1) conflictReasons.push('multi-ecu');
    // Zaten katalogda: aynı DID farklı decode / aynı PID farklı anlam riski (SALT-OKUNUR sorgu).
    try {
      if (opts.isKnownSignal?.(m.manufacturer, m.source, m.pidOrDid)) conflictReasons.push('already-cataloged');
    } catch { /* sorgu hatası çakışma üretmez */ }

    out.push({
      manufacturer:         m.manufacturer,
      profileHint:          m.profileHint,
      protocol:             '',
      ecuAddress:           m.ecuAddress,
      pidOrDid:             m.pidOrDid,
      mode:                 m.mode,
      confidence:           clamp01(Math.max(...m.confidences)), // birleşik confidence
      vehicleCount:         m.vehicleCount,
      seenCount:            m.seenCount,
      firstSeen:            m.firstSeen,
      lastSeen:             m.lastSeen,
      candidateStatus:      m.status,
      mergeGroup:           _groupKey(m),
      requiresManualReview: conflictReasons.length > 0,
      conflictReasons,
    });
  }

  return out.sort((a, b) =>
    a.manufacturer.localeCompare(b.manufacturer) ||
    a.pidOrDid.localeCompare(b.pidOrDid) ||
    a.ecuAddress.localeCompare(b.ecuAddress));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Motor — on-demand (kalıcı depo/otomatik yazma YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export class ManufacturerProfileBuilder {
  private _candidates: ProfileCandidate[] = [];
  private readonly _readManufacturers: () => ManufacturerKnowledge[];
  private readonly _opts: ProfileCandidateOptions;

  constructor(
    readManufacturers: () => ManufacturerKnowledge[],
    opts: ProfileCandidateOptions = {},
  ) {
    this._readManufacturers = readManufacturers;
    this._opts = opts;
  }

  /** MIE çıktısından adayları yeniden üretir. FAIL-SOFT. */
  build(): ProfileCandidate[] {
    try {
      this._candidates = buildProfileCandidates(this._readManufacturers(), this._opts);
    } catch {
      this._candidates = [];
    }
    return this.getCandidates();
  }

  /** Son üretilen adaylar (kopya). */
  getCandidates(): ProfileCandidate[] {
    return this._candidates.map((c) => ({ ...c, conflictReasons: [...c.conflictReasons] }));
  }

  /** Yalnız manuel onay bekleyen (çakışmalı) adaylar. */
  getManualReview(): ProfileCandidate[] {
    return this.getCandidates().filter((c) => c.requiresManualReview);
  }

  /** Çakışmasız (doğrudan onaya hazır) adaylar. */
  getClean(): ProfileCandidate[] {
    return this.getCandidates().filter((c) => !c.requiresManualReview);
  }
}
