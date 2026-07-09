/**
 * manufacturerIntelligenceEngine — Üretici Zekâ Motoru TEMELİ (PR-29, foundation-only).
 *
 * AMAÇ: VehicleKnowledgeBase (PR-28) kayıtlarını okuyup öğrenilen PID/DID verilerini MARKA/
 * PROFİL bazında gruplar → üretici profili ADAYLARINA dönüştürür. "Bu PID Renault'ların
 * çoğunda görülüyor" gibi marka-seviyesi çıkarımın YEREL, deterministik çekirdeği.
 *
 * KATMAN (Clean Architecture): SALT-OKUNUR TÜRETME katmanı. VehicleKnowledgeBase kayıtlarını
 * OKUR, hiçbirini değiştirmez; sonuç türetilmiş ManufacturerKnowledge listesidir (on-demand;
 * yeni kalıcı depo YOK — bu PR yalnız çıkarım üretir).
 *
 * KESİN SINIRLAR (CLAUDE.md): Native OBD / poll / Discovery Pipeline-Queue / Auto Learning /
 * Fingerprint algoritması / VehicleKnowledgeBase davranışı / PID-DID Registry / SQL-Supabase
 * DEĞİŞMEZ. Cloud/AI/SQL/gerçek katalog yazımı YOK. TAMAMEN ADDITIVE + FAIL-SOFT: motor çökse
 * bile OBD/Discovery/Fingerprint/Auto Learning/KB akışları aynen sürer (hata sızmaz).
 */

import { normalizeEcuAddresses } from './vehicleFingerprintService';
import { profileHintFromVin } from './vehicleFingerprintBuilder';
import {
  vehicleKnowledgeBaseStore,
  VehicleKnowledgeBaseStore,
  type VehicleKnowledgeRecord,
} from './vehicleKnowledgeBase';
import { type DiscoveredSignal } from './autoLearningEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir sinyalin (PID/DID) marka-seviyesi güven durumu. */
export type CandidateStatus = 'weak' | 'candidate' | 'strong';

/** Marka bazında bir aday PID/DID. */
export interface CandidatePidDid {
  pidOrDid:        string;
  discoverySource: 'PID' | 'DID';
  /** OBD modu (PID→'01', DID→'22'; türetilmiş — VKB modu tutmaz). */
  mode:            string;
  /** Bu sinyalin görüldüğü araçların ECU adresleri (normalize + sıralı). */
  ecuAddresses:    string[];
  /** Tüm araçlardaki toplam görülme sayısı. */
  seenCount:       number;
  /** Bu sinyali gösteren FARKLI araç sayısı. */
  vehicleCount:    number;
  firstSeen:       number;
  lastSeen:        number;
  confidence:      number;
  status:          CandidateStatus;
}

/** Bir marka/profil için türetilmiş bilgi. */
export interface ManufacturerKnowledge {
  manufacturer:  string;
  profileHint:   string;
  /** Bu markaya ait FARKLI araç (fingerprint) sayısı. */
  vehicleCount:  number;
  ecuAddresses:  string[];
  observedPids:  CandidatePidDid[];
  observedDids:  CandidatePidDid[];
  firstSeen:     number;
  lastSeen:      number;
  confidence:    number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Deterministik güven / durum (AI YOK)
 * ════════════════════════════════════════════════════════════════════════ */

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/**
 * Aday güveni — deterministik: taban 0.3; her ek araç +0.2 (max 3 ek); ECU çeşitliliği
 * ve tekrar için küçük bonuslar. 1 araç → düşük; birden fazla araç/ECU → yüksek.
 */
export function candidateConfidence(vehicleCount: number, seenCount: number, ecuCount: number): number {
  const v = Math.max(0, vehicleCount);
  return clamp01(
    0.3 +
    0.2 * Math.min(Math.max(v - 1, 0), 3) +   // +0.2 / ek araç (max +0.6)
    0.05 * Math.min(Math.max(ecuCount, 0), 2) + // ECU çeşitliliği (max +0.1)
    0.02 * Math.min(Math.max(seenCount, 0), 5), // tekrar bonusu (max +0.1)
  );
}

/**
 * Aday durumu — deterministik:
 *  - tek araç → weak
 *  - ≥3 araç VEYA (≥2 araç ve ≥2 ECU) → strong (birden fazla ECU/araçta tutarlı)
 *  - aksi (≥2 araç) → candidate
 */
export function candidateStatus(vehicleCount: number, ecuCount: number): CandidateStatus {
  if (vehicleCount <= 1) return 'weak';
  if (vehicleCount >= 3 || (vehicleCount >= 2 && ecuCount >= 2)) return 'strong';
  return 'candidate';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Marka çözümleme + gruplama
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir kayıttan marka + grup anahtarı çözer (profileHint → VIN WMI → protocol fallback). */
export function resolveManufacturer(record: VehicleKnowledgeRecord): {
  manufacturer: string; profileHint: string; groupKey: string;
} {
  const hint = ((record.profileHint || '') || profileHintFromVin(record.vin || '')).trim();
  const protocol = (record.protocol || '').toUpperCase();
  if (hint) return { manufacturer: hint, profileHint: hint, groupKey: hint };
  // Marka bilinmiyor → protocol bazında ayrı grup (farklı markalar KARIŞMASIN).
  return { manufacturer: 'Unknown', profileHint: '', groupKey: `Unknown::${protocol}` };
}

/* ── Aday agregasyonu ─────────────────────────────────────────────────────── */

interface _Acc {
  seenCount:   number;
  vehicles:    Set<string>;
  ecus:        Set<string>;
  firstSeen:   number;
  lastSeen:    number;
}

function _aggregate(records: readonly VehicleKnowledgeRecord[], source: 'PID' | 'DID'): CandidatePidDid[] {
  const acc = new Map<string, _Acc>();
  for (const r of records) {
    const map: Record<string, DiscoveredSignal> = (source === 'PID' ? r.discoveredPids : r.discoveredDids) ?? {};
    const recEcus = normalizeEcuAddresses(r.discoveredEcus ?? []);
    const vehicleId = r.fingerprintHash || '';
    for (const id in map) {
      const stat = map[id];
      if (!stat) continue;
      let a = acc.get(id);
      if (!a) { a = { seenCount: 0, vehicles: new Set(), ecus: new Set(), firstSeen: stat.firstSeen, lastSeen: stat.lastSeen }; acc.set(id, a); }
      a.seenCount += stat.seenCount ?? 0;
      if (vehicleId) a.vehicles.add(vehicleId);
      for (const e of recEcus) a.ecus.add(e);
      a.firstSeen = Math.min(a.firstSeen, stat.firstSeen ?? a.firstSeen); // İLK görülme KORUNUR
      a.lastSeen = Math.max(a.lastSeen, stat.lastSeen ?? a.lastSeen);
    }
  }
  const out: CandidatePidDid[] = [];
  for (const [id, a] of acc) {
    const ecuAddresses = [...a.ecus].sort();
    const vehicleCount = a.vehicles.size;
    out.push({
      pidOrDid:        id,
      discoverySource: source,
      mode:            source === 'PID' ? '01' : '22',
      ecuAddresses,
      seenCount:       a.seenCount,
      vehicleCount,
      firstSeen:       a.firstSeen,
      lastSeen:        a.lastSeen,
      confidence:      candidateConfidence(vehicleCount, a.seenCount, ecuAddresses.length),
      status:          candidateStatus(vehicleCount, ecuAddresses.length),
    });
  }
  return out.sort((x, y) => y.confidence - x.confidence || x.pidOrDid.localeCompare(y.pidOrDid));
}

function _buildGroup(manufacturer: string, profileHint: string, records: readonly VehicleKnowledgeRecord[]): ManufacturerKnowledge {
  const vehicles = new Set<string>();
  const ecus = new Set<string>();
  let firstSeen = Number.POSITIVE_INFINITY;
  let lastSeen = 0;
  for (const r of records) {
    if (r.fingerprintHash) vehicles.add(r.fingerprintHash);
    for (const e of normalizeEcuAddresses(r.discoveredEcus ?? [])) ecus.add(e);
    if (Number.isFinite(r.firstSeen)) firstSeen = Math.min(firstSeen, r.firstSeen);
    if (Number.isFinite(r.lastSeen)) lastSeen = Math.max(lastSeen, r.lastSeen);
  }
  const observedPids = _aggregate(records, 'PID');
  const observedDids = _aggregate(records, 'DID');
  const vehicleCount = vehicles.size;

  // Grup güveni: aday güvenlerinin ve araç-sayısı tabanının en yükseği (deterministik).
  const baseline = clamp01(0.3 + 0.15 * Math.min(Math.max(vehicleCount - 1, 0), 4));
  const candMax = Math.max(0, ...observedPids.map((c) => c.confidence), ...observedDids.map((c) => c.confidence));
  const confidence = Math.max(baseline, candMax);

  return {
    manufacturer,
    profileHint,
    vehicleCount,
    ecuAddresses: [...ecus].sort(),
    observedPids,
    observedDids,
    firstSeen: Number.isFinite(firstSeen) ? firstSeen : 0,
    lastSeen,
    confidence,
  };
}

/**
 * VehicleKnowledgeBase kayıtlarından marka bazlı zekâyı türetir (SAF, salt-okunur). Girdiyi
 * MUTASYONA UĞRATMAZ. Boş liste → []; bozuk kayıtlar atlanır (fail-soft).
 */
export function buildManufacturerIntelligence(
  records: readonly VehicleKnowledgeRecord[],
): ManufacturerKnowledge[] {
  const groups = new Map<string, { manufacturer: string; profileHint: string; recs: VehicleKnowledgeRecord[] }>();
  for (const r of records ?? []) {
    try {
      if (!r || typeof r !== 'object' || typeof r.fingerprintHash !== 'string') continue; // bozuk → atla
      const { manufacturer, profileHint, groupKey } = resolveManufacturer(r);
      const g = groups.get(groupKey) ?? { manufacturer, profileHint, recs: [] };
      if (!g.profileHint && profileHint) g.profileHint = profileHint;
      g.recs.push(r);
      groups.set(groupKey, g);
    } catch {
      /* bozuk kayıt → atla, fail-soft (diğer kayıtları etkilemez) */
    }
  }
  const out: ManufacturerKnowledge[] = [];
  for (const g of groups.values()) {
    try { out.push(_buildGroup(g.manufacturer, g.profileHint, g.recs)); } catch { /* grup hatası fail-soft */ }
  }
  return out.sort((a, b) => b.vehicleCount - a.vehicleCount || a.manufacturer.localeCompare(b.manufacturer));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Motor — VehicleKnowledgeBase deposundan on-demand türetme (kalıcı depo YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export class ManufacturerIntelligenceEngine {
  private _snapshot: ManufacturerKnowledge[] = [];

  constructor(
    private readonly _readRecords: () => VehicleKnowledgeRecord[] =
      () => vehicleKnowledgeBaseStore.list(),
  ) {}

  /** VKB'den yeniden hesaplar ve iç anlık görüntüyü günceller. FAIL-SOFT. */
  refresh(): ManufacturerKnowledge[] {
    try {
      this._snapshot = buildManufacturerIntelligence(this._readRecords());
    } catch {
      this._snapshot = []; // fail-soft: son iyi durum yerine boş güvenli değer
    }
    return this.getManufacturers();
  }

  /** Son hesaplanan marka listesi (kopya). */
  getManufacturers(): ManufacturerKnowledge[] {
    return this._snapshot.map((m) => ({
      ...m,
      ecuAddresses: [...m.ecuAddresses],
      observedPids: m.observedPids.map((c) => ({ ...c, ecuAddresses: [...c.ecuAddresses] })),
      observedDids: m.observedDids.map((c) => ({ ...c, ecuAddresses: [...c.ecuAddresses] })),
    }));
  }

  /** Ada göre tek marka bilgisi (kopya) veya null. */
  getManufacturer(name: string): ManufacturerKnowledge | null {
    const key = (name || '').trim().toLowerCase();
    return this.getManufacturers().find((m) => m.manufacturer.toLowerCase() === key) ?? null;
  }
}

/** Uygulama geneli tekil motor (on-demand — UI/mantık çağırınca refresh eder). */
export const manufacturerIntelligenceEngine = new ManufacturerIntelligenceEngine();

/** Kısa yol: tekil VKB deposundan güncel marka zekâsını hesaplar. */
export function getManufacturerIntelligence(store: VehicleKnowledgeBaseStore = vehicleKnowledgeBaseStore): ManufacturerKnowledge[] {
  return buildManufacturerIntelligence(store.list());
}
