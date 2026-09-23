/**
 * didLearningStore — öğrenilen DID bilgisinin KALICI kaydı (ECU kimliği başına).
 *
 * ANAHTAR = ECU KİMLİĞİ (yanıt adresi + parça no F187 + yazılım F195), VIN DEĞİL:
 * aynı ECU'yu taşıyan başka bir araç aynı DID anlamlarını kullanır (filo paylaşımının
 * temeli). Parça/yazılım okunamazsa anahtar yalnız adres + VIN-hash'e düşer (araç
 * özelinde kalır — başka araca GENELLENMEZ).
 *
 * TERFİ KURALI (tek yer — `mergeSessionMatch`):
 *  · Birebir eşitlik (exactEquality) tek oturumda → PROVEN.
 *  · Ölçekli uyum → AYNI referans + AYNI (k,o) ile ≥2 FARKLI oturumda SESSION_PROVEN → PROVEN.
 *  · PROVEN bir DID sonradan BAŞKA bir referansa SESSION_PROVEN olursa → AMBIGUOUS
 *    (kanıt geri çekilir; yanlış ad gösterilmez).
 *
 * Mağaza ikinci bir DID otoritesi DEĞİLDİR: yalnız öğrenme kanıtını tutar; gösterim
 * `profiles/index.ts` → `manufacturerPidService` hattından geçer.
 */
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../../utils/safeStorage';
import type { DidBehaviorClass } from './didClassifier';
import type { MatchResult } from './semanticMatcher';
import { REFERENCE_DEFS, type ReferenceKey } from './referenceCatalog';
import type { VehicleDidDef, VehicleEcuDef } from '../vehicleDidProfile';

export const DID_LEARN_SCHEMA = 1;
const PREFIX = 'obd:didLearn:v1:';
const INDEX_KEY = 'obd:didLearn:v1:index';

export type LearnedStatus = 'UNKNOWN' | 'CANDIDATE' | 'PROVEN' | 'AMBIGUOUS';

export interface ProvenSession {
  readonly sessionId: string;
  readonly ref: ReferenceKey;
  readonly k: number;
  readonly o: number;
  readonly signed: boolean;
  readonly exact: boolean;
  readonly at: number;
}

export interface LearnedDid {
  did: string;
  bytes: number;
  cls: DidBehaviorClass;
  status: LearnedStatus;
  /** Son oturumun en iyi eşleşmesi (tanı için). */
  lastMatch: Pick<MatchResult, 'ref' | 'k' | 'o' | 'signed' | 'r' | 'n' | 'rms' | 'status' | 'exactEquality'> | null;
  provenSessions: ProvenSession[];
  /** PROVEN iken kullanılan anlam. */
  proven: { ref: ReferenceKey; k: number; o: number; signed: boolean } | null;
  ambiguousWith?: ReferenceKey;
  lastRawHex: string;
  updatedAt: number;
}

export interface EcuLearningRecord {
  schema: number;
  ecuKey: string;
  tx: string;
  rx: string;
  partNo: string | null;
  software: string | null;
  enumeration: {
    method: 'mask_chain' | 'none';
    maskBases: string[];
    at: number;
  } | null;
  dids: Record<string, LearnedDid>;
  sessions: number;
  updatedAt: number;
}

export function makeEcuKey(rx: string, partNo: string | null, software: string | null, vinHash: string | null): string {
  const p = (partNo ?? '').trim();
  if (p) return `${rx}|${p}|${(software ?? '').trim()}`;
  return `${rx}|vin:${vinHash ?? 'unknown'}`;
}

export function emptyRecord(ecuKey: string, tx: string, rx: string, partNo: string | null, software: string | null): EcuLearningRecord {
  return { schema: DID_LEARN_SCHEMA, ecuKey, tx, rx, partNo, software, enumeration: null, dids: {}, sessions: 0, updatedAt: Date.now() };
}

/* ── Kalıcılık ──────────────────────────────────────────────────────────── */

function readIndex(): string[] {
  try { const raw = safeGetRaw(INDEX_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

export function listLearnedEcuKeys(): string[] {
  return readIndex();
}

export function loadRecord(ecuKey: string): EcuLearningRecord | null {
  try {
    const raw = safeGetRaw(PREFIX + ecuKey);
    if (!raw) return null;
    const r = JSON.parse(raw) as EcuLearningRecord;
    return r && r.schema === DID_LEARN_SCHEMA && r.ecuKey === ecuKey ? r : null;
  } catch { return null; }
}

export function saveRecord(r: EcuLearningRecord): void {
  try {
    r.updatedAt = Date.now();
    safeSetRaw(PREFIX + r.ecuKey, JSON.stringify(r));
    const idx = readIndex();
    if (!idx.includes(r.ecuKey)) safeSetRaw(INDEX_KEY, JSON.stringify([...idx, r.ecuKey]));
  } catch { /* kalıcılık fail-soft — öğrenme bir lüks, OBD akışı bir zorunluluk */ }
}

export function deleteRecord(ecuKey: string): void {
  try {
    safeRemoveRaw(PREFIX + ecuKey);
    safeSetRaw(INDEX_KEY, JSON.stringify(readIndex().filter((k) => k !== ecuKey)));
  } catch { /* fail-soft */ }
}

/* ── Terfi mantığı (SAF) ────────────────────────────────────────────────── */

const MAX_PROVEN_SESSIONS = 6;
const sameScale = (a: { ref: ReferenceKey; k: number; o: number; signed: boolean }, b: { ref: ReferenceKey; k: number; o: number; signed: boolean }): boolean =>
  a.ref === b.ref && a.signed === b.signed && Math.abs(a.k - b.k) <= Math.abs(a.k) * 1e-6 && Math.abs(a.o - b.o) < 1e-6;

/**
 * Bir oturumun sınıf + eşleşme sonucunu kayda işler ve durumu yeniden hesaplar.
 * Kaydı yerinde değiştirir ve döndürür (çağıran kaydeder).
 */
export function mergeSessionMatch(
  rec: EcuLearningRecord, did: string, bytes: number, cls: DidBehaviorClass,
  match: MatchResult | null, sessionId: string, rawHex: string, now = Date.now(),
): LearnedDid {
  const prev = rec.dids[did];
  const cur: LearnedDid = prev ?? {
    did, bytes, cls, status: 'UNKNOWN', lastMatch: null, provenSessions: [], proven: null, lastRawHex: rawHex, updatedAt: now,
  };
  cur.bytes = bytes;
  if (cls !== 'UNKNOWN') cur.cls = cls;
  cur.lastRawHex = rawHex;
  cur.updatedAt = now;
  cur.lastMatch = match ? {
    ref: match.ref, k: match.k, o: match.o, signed: match.signed, r: match.r, n: match.n,
    rms: match.rms, status: match.status, exactEquality: match.exactEquality,
  } : cur.lastMatch;

  if (match && match.status === 'SESSION_PROVEN') {
    const ps: ProvenSession = {
      sessionId, ref: match.ref, k: match.k, o: match.o, signed: match.signed, exact: match.exactEquality, at: now,
    };
    cur.provenSessions = [...cur.provenSessions.filter((p) => p.sessionId !== sessionId), ps].slice(-MAX_PROVEN_SESSIONS);
  }

  // Durum yeniden hesap — kanıtlar birbirini desteklemeli.
  const sessions = cur.provenSessions;
  const refs = new Set(sessions.map((p) => p.ref));
  if (refs.size > 1) {
    cur.status = 'AMBIGUOUS';
    cur.proven = null;
    const lastRef = sessions[sessions.length - 1]!.ref;
    cur.ambiguousWith = [...refs].find((r) => r !== lastRef);
  } else if (sessions.length > 0) {
    const last = sessions[sessions.length - 1]!;
    const agreeing = sessions.filter((p) => sameScale(p, last));
    const distinctSessions = new Set(agreeing.map((p) => p.sessionId)).size;
    if (agreeing.some((p) => p.exact) || distinctSessions >= 2) {
      cur.status = 'PROVEN';
      cur.proven = { ref: last.ref, k: last.k, o: last.o, signed: last.signed };
      delete cur.ambiguousWith;
    } else {
      cur.status = 'CANDIDATE';
      cur.proven = null;
    }
  } else if (match && match.status === 'AMBIGUOUS') {
    cur.status = 'AMBIGUOUS';
    cur.ambiguousWith = match.ambiguousWith;
  } else if (match && match.status === 'CANDIDATE') {
    cur.status = cur.status === 'PROVEN' ? 'PROVEN' : 'CANDIDATE';
  }
  rec.dids[did] = cur;
  return cur;
}

/* ── Profil üretimi (gösterim yolu mevcut manufacturerPidService) ──────── */

/**
 * PROVEN DID'leri `VehicleDidProfile` parçasına çevirir. İşaretli (signed) yorum
 * mevcut `linear` çözücüde yok → işaretli kanıtlar profile ALINMAZ (dürüst: gösterilemiyorsa
 * yanlış gösterilmez).
 */
export function provenProfileFragment(rec: EcuLearningRecord): { ecus: VehicleEcuDef[]; dids: VehicleDidDef[] } {
  const ecuId = `learned-${rec.rx}`;
  const dids: VehicleDidDef[] = [];
  for (const d of Object.values(rec.dids)) {
    if (d.status !== 'PROVEN' || !d.proven || d.proven.signed) continue;
    const ref = REFERENCE_DEFS[d.proven.ref];
    dids.push({
      did: d.did, service: '22', ecu: ecuId,
      name: `${ref.label} (öğrenildi · DID ${d.did})`,
      unit: ref.unit, bytes: d.bytes, min: ref.min, max: ref.max, category: ref.category,
      decode: { fn: 'linear', a: d.proven.k, b: d.proven.o },
    });
  }
  if (dids.length === 0) return { ecus: [], dids: [] };
  return { ecus: [{ id: ecuId, name: `Öğrenilen (${rec.rx})`, tx: rec.tx, rx: rec.rx }], dids };
}

/* ── Dışa/içe aktarma (cihazlar arası taşıma; bulut sonraki adım) ───────── */

export function exportLearning(keys: readonly string[] = listLearnedEcuKeys()): string {
  const records = keys.map(loadRecord).filter((r): r is EcuLearningRecord => r !== null);
  return JSON.stringify({ kind: 'caros-did-learning', schema: DID_LEARN_SCHEMA, exportedAt: new Date().toISOString(), records }, null, 2);
}

export function importLearning(json: string): { imported: number; errors: string[] } {
  const errors: string[] = [];
  let imported = 0;
  try {
    const obj = JSON.parse(json) as { kind?: string; schema?: number; records?: unknown[] };
    if (obj.kind !== 'caros-did-learning' || obj.schema !== DID_LEARN_SCHEMA || !Array.isArray(obj.records)) {
      return { imported: 0, errors: ['geçersiz ya da farklı sürüm dosya'] };
    }
    for (const r of obj.records as EcuLearningRecord[]) {
      if (!r || typeof r.ecuKey !== 'string' || r.schema !== DID_LEARN_SCHEMA || typeof r.dids !== 'object') { errors.push('bozuk kayıt atlandı'); continue; }
      saveRecord(r);
      imported++;
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'okunamadı');
  }
  return { imported, errors };
}
