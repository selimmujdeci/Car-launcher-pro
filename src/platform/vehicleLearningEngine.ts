/**
 * vehicleLearningEngine — Araç Öğrenme Motoru TEMELİ (P2-1, foundation-only).
 *
 * AMAÇ: Vehicle Knowledge Base (araç-başına öğrenilmiş PID/DID) ve Manufacturer Intelligence
 * çıktısını SALT-OKUNUR tüketip marka/protokol/ECU bazlı "öğrenme kanıtı" (Evidence) üretir.
 * "PID 7A · Renault · 12 araç · 34 gözlem · 8 ECU · confidence 0.91" türü kanıtın çekirdeği.
 *
 * BU PR (yalnız foundation): SAF, on-demand türetme.
 *   - KALICILIK YOK · BOOT WIRING YOK · SQL/Cloud/LLM/Native YOK · decay YOK.
 *   - Mevcut hiçbir katmanı (Discovery/Fingerprint/Auto Learning/VKB/Manufacturer Intelligence/
 *     Profile Builder/Diagnostic) DEĞİŞTİRMEZ — yalnız çıktılarını okur.
 *   - Girdi kayıtlarını MUTASYONA UĞRATMAZ · yeni bağımlılık/ağ YOK · hot-path'e girmez.
 *
 * KATMAN (Clean Architecture): saf `buildEvidenceFromRecords` view-model'dir (React/native yok);
 * `VehicleLearningEngine` yalnız ince on-demand okuyucu sarmalayıcı. FAIL-SOFT.
 */

import { normalizeEcuAddresses } from './vehicleFingerprintService';
import {
  resolveManufacturer,
  getManufacturerIntelligence,
  type ManufacturerKnowledge,
} from './manufacturerIntelligenceEngine';
import {
  vehicleKnowledgeBaseStore,
  type VehicleKnowledgeRecord,
} from './vehicleKnowledgeBase';
import { type DiscoveredSignal } from './autoLearningEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Evidence modeli
 * ════════════════════════════════════════════════════════════════════════ */

export type EvidenceStatus = 'weak' | 'candidate' | 'strong';

/** Tek bir öğrenme kanıtı — (marka × protokol × kaynak × pid/did × mode) birimi. */
export interface LearningEvidence {
  /** Deterministik kimlik: manufacturer|protocol|discoverySource|pidOrDid|mode. */
  evidenceId:              string;
  manufacturer:            string;
  profileHint:             string;
  protocol:                string;
  discoverySource:         'PID' | 'DID';
  pidOrDid:                string;
  mode:                    string;
  /** Bu sinyalin görüldüğü ECU adresleri (normalize + sıralı + tekil; araç-seviyesi). */
  ecuAddresses:            string[];
  /** Kanıtı destekleyen FARKLI araç fingerprint hash'leri (normalize + sıralı + tekil). */
  supportingVehicleHashes: string[];
  /** Farklı araç sayısı (= supportingVehicleHashes.length). */
  vehicleCount:            number;
  /** Toplam gözlem (tüm araçlardaki seenCount toplamı). */
  observationCount:        number;
  firstSeen:               number;
  lastSeen:                number;
  confidence:              number;
  status:                  EvidenceStatus;
  createdAt:               number;
  updatedAt:               number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Deterministik confidence / status (decay YOK — foundation)
 * ════════════════════════════════════════════════════════════════════════ */

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/**
 * İskelet confidence — deterministik: taban 0.3; her ek araç +0.2 (max 3 ek); ECU çeşitliliği
 * +0.05 (max 2); gözlem +0.02 (max 5 → tavan +0.1). Tek araç çok tekrar etse bile şişmez
 * (araç bonusu 0 → max 0.4). [0,1] clamp.
 */
export function evidenceConfidence(vehicleCount: number, observationCount: number, ecuCount: number): number {
  const v = Math.max(0, vehicleCount);
  return clamp01(
    0.3 +
    0.2 * Math.min(Math.max(v - 1, 0), 3) +
    0.05 * Math.min(Math.max(ecuCount, 0), 2) +
    0.02 * Math.min(Math.max(observationCount, 0), 5),
  );
}

/** İskelet status: tek araç weak · ≥3 araç veya (≥2 araç ve ≥2 ECU) strong · aksi candidate. */
export function evidenceStatus(vehicleCount: number, ecuCount: number): EvidenceStatus {
  if (vehicleCount <= 1) return 'weak';
  if (vehicleCount >= 3 || (vehicleCount >= 2 && ecuCount >= 2)) return 'strong';
  return 'candidate';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt kimliği + iç birikimci
 * ════════════════════════════════════════════════════════════════════════ */

function _normId(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

function _evidenceKey(p: {
  manufacturer: string; protocol: string; discoverySource: string; pidOrDid: string; mode: string;
}): string {
  return `${p.manufacturer}|${p.protocol}|${p.discoverySource}|${p.pidOrDid}|${p.mode}`;
}

interface _Acc {
  manufacturer:    string;
  profileHint:     string;
  protocol:        string;
  discoverySource: 'PID' | 'DID';
  pidOrDid:        string;
  mode:            string;
  vehicles:        Set<string>;   // duplicate suppression + distinct vehicleCount
  ecus:            Set<string>;
  observationCount: number;
  firstSeen:       number;
  lastSeen:        number;
}

export interface BuildEvidenceOptions {
  now?: number;
  /** MIE çıktısından manufacturer→profileHint zenginleştirme (kayıt profileHint boşsa). */
  manufacturerProfileHints?: Record<string, string>;
}

/**
 * VKB kayıtlarından öğrenme kanıtları üretir (SAF, salt-okunur). Girdiyi MUTASYONA UĞRATMAZ.
 * Boş liste → []; bozuk kayıt atlanır (fail-soft); ASLA throw etmez.
 *
 * Deterministik: aynı araç (fingerprintHash) aynı sinyali tekrar gösterse vehicleCount ARTMAZ
 * (Set), observationCount artar, firstSeen korunur, lastSeen güncellenir.
 */
export function buildEvidenceFromRecords(
  records: readonly VehicleKnowledgeRecord[] | null | undefined,
  opts: BuildEvidenceOptions = {},
): LearningEvidence[] {
  const now = opts.now ?? Date.now();
  const hints = opts.manufacturerProfileHints ?? {};
  const acc = new Map<string, _Acc>();

  for (const r of records ?? []) {
    try {
      if (!r || typeof r !== 'object' || typeof r.fingerprintHash !== 'string' || !r.fingerprintHash) continue;
      const { manufacturer, profileHint } = resolveManufacturer(r);
      const resolvedHint = profileHint || hints[manufacturer.toLowerCase()] || '';
      const protocol = (r.protocol ?? '').toUpperCase();
      const recEcus = normalizeEcuAddresses(r.discoveredEcus ?? []);
      const hash = r.fingerprintHash;

      const sources: Array<{ src: 'PID' | 'DID'; mode: string; map: Record<string, DiscoveredSignal> }> = [
        { src: 'PID', mode: '01', map: r.discoveredPids ?? {} },
        { src: 'DID', mode: '22', map: r.discoveredDids ?? {} },
      ];

      for (const { src, mode, map } of sources) {
        for (const rawId in map) {
          const sig = map[rawId];
          if (!sig) continue;
          const pidOrDid = _normId(rawId);
          if (!pidOrDid) continue;
          const key = _evidenceKey({ manufacturer, protocol, discoverySource: src, pidOrDid, mode });
          let a = acc.get(key);
          if (!a) {
            a = {
              manufacturer, profileHint: resolvedHint, protocol, discoverySource: src, pidOrDid, mode,
              vehicles: new Set(), ecus: new Set(),
              observationCount: 0, firstSeen: sig.firstSeen ?? now, lastSeen: sig.lastSeen ?? now,
            };
            acc.set(key, a);
          }
          if (!a.profileHint && resolvedHint) a.profileHint = resolvedHint;
          a.vehicles.add(hash);                              // distinct — tekrar araç saymaz
          for (const e of recEcus) a.ecus.add(e);
          a.observationCount += Math.max(0, sig.seenCount ?? 0);
          a.firstSeen = Math.min(a.firstSeen, sig.firstSeen ?? a.firstSeen);   // korunur
          a.lastSeen = Math.max(a.lastSeen, sig.lastSeen ?? a.lastSeen);       // güncellenir
        }
      }
    } catch {
      /* tek kayıt hatası diğerlerini etkilemez (fail-soft) */
    }
  }

  const out: LearningEvidence[] = [];
  for (const a of acc.values()) {
    const ecuAddresses = [...a.ecus].sort();
    const supportingVehicleHashes = [...a.vehicles].sort();
    const vehicleCount = supportingVehicleHashes.length;
    out.push({
      evidenceId:      _evidenceKey(a),
      manufacturer:    a.manufacturer,
      profileHint:     a.profileHint,
      protocol:        a.protocol,
      discoverySource: a.discoverySource,
      pidOrDid:        a.pidOrDid,
      mode:            a.mode,
      ecuAddresses,
      supportingVehicleHashes,
      vehicleCount,
      observationCount: a.observationCount,
      firstSeen:       a.firstSeen,
      lastSeen:        a.lastSeen,
      confidence:      evidenceConfidence(vehicleCount, a.observationCount, ecuAddresses.length),
      status:          evidenceStatus(vehicleCount, ecuAddresses.length),
      createdAt:       now,
      updatedAt:       now,
    });
  }
  return out.sort((x, y) =>
    y.confidence - x.confidence ||
    x.manufacturer.localeCompare(y.manufacturer) ||
    x.pidOrDid.localeCompare(y.pidOrDid));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Motor — on-demand (kalıcı depo/wiring YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleLearningEngine {
  private readonly _readRecords: () => VehicleKnowledgeRecord[];
  private readonly _readManufacturers: () => ManufacturerKnowledge[];
  private readonly _now: () => number;

  constructor(
    readRecords: () => VehicleKnowledgeRecord[] = () => vehicleKnowledgeBaseStore.list(),
    readManufacturers: () => ManufacturerKnowledge[] = () => getManufacturerIntelligence(),
    now: () => number = () => Date.now(),
  ) {
    this._readRecords = readRecords;
    this._readManufacturers = readManufacturers;
    this._now = now;
  }

  /** VKB + Manufacturer Intelligence'tan öğrenme kanıtlarını üretir (on-demand). FAIL-SOFT. */
  computeEvidence(): LearningEvidence[] {
    try {
      const hints: Record<string, string> = {};
      for (const m of this._readManufacturers()) {
        if (m && m.manufacturer && m.profileHint) hints[m.manufacturer.toLowerCase()] = m.profileHint;
      }
      return buildEvidenceFromRecords(this._readRecords(), { now: this._now(), manufacturerProfileHints: hints });
    } catch {
      return []; // fail-soft
    }
  }

  /** Yalnız 'strong' kanıtlar. */
  getStrong(): LearningEvidence[] {
    return this.computeEvidence().filter((e) => e.status === 'strong');
  }

  /** Yalnız 'candidate' kanıtlar. */
  getCandidates(): LearningEvidence[] {
    return this.computeEvidence().filter((e) => e.status === 'candidate');
  }

  /** Belirli bir markanın kanıtları. */
  getByManufacturer(name: string): LearningEvidence[] {
    const key = (name || '').trim().toLowerCase();
    return this.computeEvidence().filter((e) => e.manufacturer.toLowerCase() === key);
  }
}

/** Uygulama geneli tekil motor (on-demand — UI/mantık çağırınca üretir; wiring YOK). */
export const vehicleLearningEngine = new VehicleLearningEngine();
