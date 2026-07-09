/**
 * diagnosticKnowledgeEngine — Tanı Bilgi Motoru TEMELİ (PR-31, foundation-only).
 *
 * AMAÇ: PR-17→PR-30 arası kurulan tüm katmanları (DTC Catalog · PID Registry · Vehicle
 * Knowledge Base · Manufacturer Intelligence · Manufacturer Profile Builder · Discovery)
 * İLK KEZ tek bir tanı katmanında birleştirir. Bir DTC geldiğinde, bu kaynakları ilişkilendirip
 * tek bir "Diagnostic Insight" üretir.
 *
 * ⚠️ LLM/AI YOK — TAMAMEN DETERMİNİSTİK. Öneriler sabit kurallardan türetilir (P0401→EGR→
 * MAP/MAF/DPF gibi). Hiçbir bulut/model çağrısı yapılmaz.
 *
 * KESİN SINIRLAR (CLAUDE.md): LLM/OpenAI/Claude/Gemini · Cloud/SQL/Supabase · Native · Poll ·
 * PID/DID Registry · Discovery Pipeline · Fingerprint · Vehicle Knowledge · Manufacturer
 * Intelligence · Manufacturer Profile Builder DEĞİŞMEZ — YALNIZ OKUNUR. TAMAMEN ADDITIVE +
 * FAIL-SOFT: motor çökse bile alt katmanların hiçbiri etkilenmez.
 */

import { resolveDtcRecord, type DtcRecord, type DTCSeverity } from './obd/dtcDataSource';
import { STANDARD_PID_MAP } from './obd/StandardPidRegistry';
import {
  vehicleKnowledgeBaseStore,
  VehicleKnowledgeBaseStore,
  type VehicleKnowledgeRecord,
} from './vehicleKnowledgeBase';
import {
  getManufacturerIntelligence,
  type ManufacturerKnowledge,
} from './manufacturerIntelligenceEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Diagnostic Insight
 * ════════════════════════════════════════════════════════════════════════ */

export interface DiagnosticInsight {
  dtc:                  string;
  description:          string;
  severity:             DTCSeverity;
  confidence:           number;
  manufacturer:         string;
  profileHint:          string;
  likelySystems:        string[];
  relatedPids:          string[];
  relatedDids:          string[];
  discoveredOnVehicle:  boolean;
  manufacturerSeenCount: number;
  vehicleSeenCount:     number;
  possibleCauses:       string[];
  recommendedChecks:    string[];
  driveSafe:            boolean;
  firstSeen:            number;
  lastSeen:             number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Deterministik korelasyon tabloları (DTC → sistem → PID)
 * ════════════════════════════════════════════════════════════════════════ */

/** Bilinen DTC kodları → olası sistemler (kesin eşleme; örn. P0401→EGR/MAP/MAF/DPF). */
const DTC_SYSTEMS: Readonly<Record<string, readonly string[]>> = {
  P0400: ['EGR'],
  P0401: ['EGR', 'MAP', 'MAF', 'DPF'],
  P0402: ['EGR', 'MAP'],
  P0403: ['EGR'],
  P0299: ['Turbo', 'MAP'],
  P0234: ['Turbo', 'MAP'],
  P0420: ['Katalizör', 'O2'],
  P0421: ['Katalizör', 'O2'],
  P0130: ['O2'],
  P0136: ['O2'],
  P0300: ['Ateşleme', 'Yakıt'],
  P0301: ['Ateşleme'],
  P0302: ['Ateşleme'],
  P0303: ['Ateşleme'],
  P0304: ['Ateşleme'],
  P0171: ['Yakıt', 'MAF'],
  P0172: ['Yakıt', 'MAF'],
  P0174: ['Yakıt', 'MAF'],
  P0175: ['Yakıt', 'MAF'],
  P0087: ['Yakıt'],
  P0128: ['Sıcaklık'],
  P0101: ['MAF'],
  P0106: ['MAP'],
};

/** Sistem → ilgili standart canlı PID'ler (öneri motoru — deterministik). */
const SYSTEM_PIDS: Readonly<Record<string, readonly string[]>> = {
  EGR:       ['2C', '2D', '0B', '10'],
  MAP:       ['0B'],
  MAF:       ['10'],
  DPF:       ['78', '7C'],
  Turbo:     ['70', '0B'],
  Katalizör: ['3C', '14', '15'],
  O2:        ['14', '15', '24', '34'],
  Yakıt:     ['06', '07', '0A', '23'],
  Ateşleme:  ['0C', '0E'],
  Sıcaklık:  ['05', '0F'],
  Motor:     ['0C', '04', '11'],
  Emisyon:   ['2C', '3C'],
};

/** Kod ailesi fallback (DTC_SYSTEMS'te yoksa) — kod öneki üzerinden olası sistemler. */
function _familySystems(code: string): string[] {
  const c = code.toUpperCase();
  if (/^P04/.test(c)) return ['Emisyon', 'EGR'];
  if (/^P03/.test(c)) return ['Ateşleme'];
  if (/^P02/.test(c)) return ['Yakıt'];
  if (/^P01/.test(c)) return ['Yakıt', 'MAF'];
  if (/^P00/.test(c)) return ['Yakıt', 'MAF'];
  return [];
}

/** Bir DTC için olası sistemleri deterministik olarak türetir (kesin map + kayıt sistemi + aile). */
export function likelySystemsFor(code: string, record?: DtcRecord | null): string[] {
  const set = new Set<string>();
  for (const s of DTC_SYSTEMS[code.toUpperCase()] ?? []) set.add(s);
  if (record?.system) set.add(record.system);
  if (set.size === 0) for (const s of _familySystems(code)) set.add(s);
  return [...set];
}

/** Sistem listesinden ilgili canlı PID'leri toplar (yalnız registry'de var olanlar önce). */
export function relatedPidsFor(systems: readonly string[], recordPids?: readonly string[]): string[] {
  const set = new Set<string>();
  for (const p of recordPids ?? []) set.add(p.toUpperCase());
  for (const s of systems) for (const p of SYSTEM_PIDS[s] ?? []) set.add(p.toUpperCase());
  // registry'de tanımlı olanlar önde (bilinen/çözülebilir), sonra diğerleri — hepsi korunur.
  return [...set].sort((a, b) => {
    const ka = STANDARD_PID_MAP.has(a) ? 0 : 1;
    const kb = STANDARD_PID_MAP.has(b) ? 0 : 1;
    return ka - kb || a.localeCompare(b);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Deterministik güven birleşimi
 * ════════════════════════════════════════════════════════════════════════ */

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function _severityWeight(sev: DTCSeverity | undefined): number {
  switch (sev) {
    case 'critical': return 0.9;
    case 'warning':  return 0.6;
    case 'info':     return 0.3;
    default:         return 0.4;
  }
}

/**
 * Final güven = DTC severity + Manufacturer confidence + Vehicle confidence + Discovery
 * confidence ağırlıklı birleşimi (deterministik, [0,1]).
 */
export function combineConfidence(input: {
  severity?:              DTCSeverity;
  manufacturerConfidence: number;
  vehicleConfidence:      number;
  discoveryConfidence:    number;
}): number {
  return clamp01(
    0.5 * _severityWeight(input.severity) +
    0.2 * clamp01(input.manufacturerConfidence) +
    0.2 * clamp01(input.vehicleConfidence) +
    0.1 * clamp01(input.discoveryConfidence),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Insight üretimi (SAF, deterministik)
 * ════════════════════════════════════════════════════════════════════════ */

export interface InsightSources {
  dtcRecord?:    DtcRecord | null;
  vehicle?:      VehicleKnowledgeRecord | null;
  manufacturer?: ManufacturerKnowledge | null;
  now?:          number;
}

function _sumSeen(map: Record<string, { seenCount: number }> | undefined, ids: readonly string[]): number {
  if (!map) return 0;
  let n = 0;
  for (const id of ids) n += map[id]?.seenCount ?? 0;
  return n;
}

/**
 * Tek bir DTC + bağlam kaynaklarından deterministik Diagnostic Insight üretir. SAF: girdileri
 * mutasyona uğratmaz; eksik kaynak güvenli boşa düşer (fail-soft). ASLA throw etmez.
 */
export function buildDiagnosticInsight(dtc: string, sources: InsightSources = {}): DiagnosticInsight {
  const code = (dtc || '').toUpperCase().trim();
  const rec = sources.dtcRecord ?? null;
  const vehicle = sources.vehicle ?? null;
  const manufacturer = sources.manufacturer ?? null;

  try {
    const severity: DTCSeverity = rec?.severity ?? 'info';
    const likelySystems = likelySystemsFor(code, rec);
    const relatedPids = relatedPidsFor(likelySystems, rec?.relatedPids);

    // İlgili DID'ler: bu araçta/üreticide gözlemlenen üretici-özel DID'ler (korelasyon).
    const relatedDids = [...new Set([
      ...Object.keys(vehicle?.discoveredDids ?? {}),
      ...(manufacturer?.observedDids ?? []).map((c) => c.pidOrDid),
    ])].map((s) => s.toUpperCase()).sort();

    // Araçta keşfedilmiş mi + görülme sayıları.
    const vehiclePidSeen = _sumSeen(vehicle?.discoveredPids, relatedPids);
    const vehicleDidSeen = _sumSeen(vehicle?.discoveredDids, relatedDids);
    const vehicleSeenCount = vehiclePidSeen + vehicleDidSeen;
    const discoveredOnVehicle = relatedPids.some((p) => vehicle?.discoveredPids?.[p]) ||
                                relatedDids.some((d) => vehicle?.discoveredDids?.[d]);

    // Üreticide görülme (aday listelerinden).
    const mfrPidMap: Record<string, { seenCount: number }> = {};
    for (const c of manufacturer?.observedPids ?? []) mfrPidMap[c.pidOrDid.toUpperCase()] = { seenCount: c.seenCount };
    const mfrDidMap: Record<string, { seenCount: number }> = {};
    for (const c of manufacturer?.observedDids ?? []) mfrDidMap[c.pidOrDid.toUpperCase()] = { seenCount: c.seenCount };
    const manufacturerSeenCount = _sumSeen(mfrPidMap, relatedPids) + _sumSeen(mfrDidMap, relatedDids);

    // İlk/son görülme — ilgili sinyaller araçta varsa onlardan, yoksa araç kaydından.
    let firstSeen = Number.POSITIVE_INFINITY;
    let lastSeen = 0;
    for (const p of relatedPids) {
      const s = vehicle?.discoveredPids?.[p];
      if (s) { firstSeen = Math.min(firstSeen, s.firstSeen); lastSeen = Math.max(lastSeen, s.lastSeen); }
    }
    if (!Number.isFinite(firstSeen) && vehicle) { firstSeen = vehicle.firstSeen; lastSeen = Math.max(lastSeen, vehicle.lastSeen); }

    // Güven birleşimi.
    const discoveryConfidence = Math.max(
      0,
      ...(manufacturer?.observedPids ?? []).filter((c) => relatedPids.includes(c.pidOrDid.toUpperCase())).map((c) => c.confidence),
    );
    const confidence = combineConfidence({
      severity,
      manufacturerConfidence: manufacturer?.confidence ?? 0,
      vehicleConfidence:      vehicle?.confidence ?? 0,
      discoveryConfidence,
    });

    // Deterministik öneriler (AI YOK).
    const recommendedChecks = _recommendedChecks(likelySystems, relatedPids, rec);

    // driveSafe: kritik veya 'unsafe' → sürüşe uygun değil.
    const driveSafe = rec?.driveSafe
      ? (rec.driveSafe === 'safe' || rec.driveSafe === 'caution')
      : severity !== 'critical';

    return {
      dtc:                  code,
      description:          rec?.description ?? `Bilinmeyen DTC (${code})`,
      severity,
      confidence,
      manufacturer:         manufacturer?.manufacturer ?? vehicle?.profileHint ?? '',
      profileHint:          manufacturer?.profileHint ?? vehicle?.profileHint ?? '',
      likelySystems,
      relatedPids,
      relatedDids,
      discoveredOnVehicle,
      manufacturerSeenCount,
      vehicleSeenCount,
      possibleCauses:       [...(rec?.possibleCauses ?? [])],
      recommendedChecks,
      driveSafe,
      firstSeen:            Number.isFinite(firstSeen) ? firstSeen : 0,
      lastSeen,
    };
  } catch {
    // FAIL-SOFT: her koşulda bir insight döndür (asla throw sızmaz).
    return {
      dtc: code, description: `Bilinmeyen DTC (${code})`, severity: 'info', confidence: 0,
      manufacturer: '', profileHint: '', likelySystems: [], relatedPids: [], relatedDids: [],
      discoveredOnVehicle: false, manufacturerSeenCount: 0, vehicleSeenCount: 0,
      possibleCauses: [], recommendedChecks: [], driveSafe: true, firstSeen: 0, lastSeen: 0,
    };
  }
}

/** Sistemler + ilgili PID'lerden deterministik "ne kontrol edilmeli" listesi. */
function _recommendedChecks(systems: readonly string[], relatedPids: readonly string[], rec?: DtcRecord | null): string[] {
  const out: string[] = [];
  for (const s of rec?.repairSuggestions ?? []) out.push(s);
  for (const s of systems) out.push(`${s} sistemini kontrol edin`);
  if (relatedPids.length > 0) {
    const named = relatedPids.map((p) => {
      const def = STANDARD_PID_MAP.get(p);
      return def ? `${p} (${def.name})` : p;
    });
    out.push(`İlgili canlı PID'leri izleyin: ${named.join(', ')}`);
  }
  return [...new Set(out)];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Motor — on-demand (kaynakları salt-okunur birleştirir)
 * ════════════════════════════════════════════════════════════════════════ */

export class DiagnosticKnowledgeEngine {
  private readonly _resolveDtc: (code: string) => DtcRecord | undefined;
  private readonly _readVehicle: () => VehicleKnowledgeRecord | null;
  private readonly _readManufacturers: () => ManufacturerKnowledge[];
  private readonly _now: () => number;

  constructor(
    resolveDtc: (code: string) => DtcRecord | undefined = resolveDtcRecord,
    readVehicle: () => VehicleKnowledgeRecord | null = () => vehicleKnowledgeBaseStore.list()[0] ?? null,
    readManufacturers: () => ManufacturerKnowledge[] = () => getManufacturerIntelligence(),
    now: () => number = () => Date.now(),
  ) {
    this._resolveDtc = resolveDtc;
    this._readVehicle = readVehicle;
    this._readManufacturers = readManufacturers;
    this._now = now;
  }

  /** Bir DTC için tüm kaynakları birleştirip tek Diagnostic Insight üretir. FAIL-SOFT. */
  diagnose(dtc: string): DiagnosticInsight {
    let vehicle: VehicleKnowledgeRecord | null = null;
    let manufacturer: ManufacturerKnowledge | null = null;
    let dtcRecord: DtcRecord | null = null;
    try { dtcRecord = this._resolveDtc(dtc) ?? null; } catch { dtcRecord = null; }
    try { vehicle = this._readVehicle(); } catch { vehicle = null; }
    try {
      const list = this._readManufacturers();
      const hint = (vehicle?.profileHint || '').toLowerCase();
      manufacturer = list.find((m) => m.manufacturer.toLowerCase() === hint) ??
                     list.find((m) => m.profileHint.toLowerCase() === hint && hint !== '') ?? null;
    } catch { manufacturer = null; }
    return buildDiagnosticInsight(dtc, { dtcRecord, vehicle, manufacturer, now: this._now() });
  }
}

/** Uygulama geneli tekil tanı motoru (on-demand — UI/mantık çağırınca üretir). */
export const diagnosticKnowledgeEngine = new DiagnosticKnowledgeEngine();

/** Kısa yol: tekil kaynaklardan bir DTC insight'ı üretir. */
export function diagnoseDtc(dtc: string, store: VehicleKnowledgeBaseStore = vehicleKnowledgeBaseStore): DiagnosticInsight {
  const engine = new DiagnosticKnowledgeEngine(resolveDtcRecord, () => store.list()[0] ?? null);
  return engine.diagnose(dtc);
}
