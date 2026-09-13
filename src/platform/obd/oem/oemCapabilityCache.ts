/**
 * oemCapabilityCache — OEM DISCOVERY FAZ 1 · KALICILIK DİKİŞİ (persistence seam).
 *
 * ── YENİ DEPO AÇILMADI ────────────────────────────────────────────────────
 * OEM yetenek kanıtı, MEVCUT `discovery/discoveredDataRepository`nin AYNI kaydına
 * (araç parmak izi → kind·identifier·ecuAddress) yazılır. İkinci bir kalıcı yetenek
 * deposu açmak "her kavramın tek yazılabilir sahibi vardır" kuralını bozardı: aynı
 * DID iki dosyada iki farklı durumla durabilirdi.
 *
 * Bu dosya YALNIZ ÇEVİRİCİDİR: `OemCapabilityEvidence` ↔ `DiscoveredDataRecord`.
 * Karar mantığı `oemCapabilityEvidence.ts`te, depolama `discoveredDataRepository`de KALIR.
 *
 * ── KAPSAM KAPISI (pazarlıksız) ───────────────────────────────────────────
 * Okuma sırasında kaydın protokol sınıfı ve ECU adresi İSTENEN kapsamla karşılaştırılır.
 * Uyuşmuyorsa kayıt YOK SAYILIR (`null`) — protokol değişmiş bir hatta eski kanıtı
 * körlemesine kullanmak, tam olarak sahada `CAN ERROR` fırtınasına yol açan hatadır.
 * Tanınmayan/eksik durum metni de `null`a düşer (fail-closed, sessiz "destekleniyor" yok).
 */

import {
  getRecord, loadRecords, upsertDiscoveredRecord,
  type DiscoveredDataRecord,
} from '../discovery/discoveredDataRepository';
import type { DiscoveryStatus } from '../discovery/discoveryState';
import type { PollClass } from '../discovery/pollingAdmissionGate';
import { isCapabilityOutcome, type CapabilityOutcome } from '../capabilityOutcome';
import type {
  OemCapabilityEvidence, OemCapabilityScope, OemCapabilityState, OemDecoderStatus,
} from './oemCapabilityEvidence';
import { isSameOemScope } from './oemCapabilityEvidence';
import type { OemSignalDef, OemSignalId } from './oemSignalCatalog';

/* ── Metin ↔ enum (fail-closed çözümleme) ────────────────────────────────── */

const STATES: ReadonlySet<string> = new Set<OemCapabilityState>([
  'UNKNOWN', 'PROBING', 'SUPPORTED', 'UNSUPPORTED', 'TEMPORARILY_UNAVAILABLE', 'ERROR',
]);
const DECODER_STATUSES: ReadonlySet<string> = new Set<OemDecoderStatus>([
  'NO_DECODER', 'OK', 'IMPLAUSIBLE', 'PARSE_ERROR', 'NOT_ATTEMPTED',
]);

function parseState(raw: unknown): OemCapabilityState | null {
  return typeof raw === 'string' && STATES.has(raw) ? (raw as OemCapabilityState) : null;
}
function parseDecoderStatus(raw: unknown): OemDecoderStatus {
  return typeof raw === 'string' && DECODER_STATUSES.has(raw) ? (raw as OemDecoderStatus) : 'NOT_ATTEMPTED';
}
function parseOutcome(raw: unknown): CapabilityOutcome | null {
  return isCapabilityOutcome(raw) ? raw : null;
}

/* ── OEM durumu → ORTAK keşif durumu (mevcut sözlük) ─────────────────────── */

/**
 * Paylaşılan kayıt `DiscoveryStatus` taşır. OEM durumu ona ÇEVRİLİR — iki sözlük
 * yan yana yaşamaz, OEM durumu paylaşılan kayıtta çelişkili bir değer bırakmaz.
 * `VERIFIED` BURADAN ASLA ÇIKMAZ: canlıya ekleme kararı `discoveryValidator`ın
 * 10-koşul kapısındadır, OEM katmanı onu atlayamaz.
 */
export function oemStateToDiscoveryStatus(state: OemCapabilityState, decoder: OemDecoderStatus): DiscoveryStatus {
  switch (state) {
    case 'SUPPORTED':               return decoder === 'OK' ? 'DECODER_KNOWN' : 'DISCOVERED_UNKNOWN';
    case 'UNSUPPORTED':             return 'UNSUPPORTED';
    case 'ERROR':                   return 'SUSPICIOUS';
    case 'TEMPORARILY_UNAVAILABLE': return 'CANDIDATE';
    case 'PROBING':                 return 'CANDIDATE';
    case 'UNKNOWN':                 return 'CANDIDATE';
  }
}

/** Güven skoru — ÖLÇÜLEN duruma bağlı, uydurulmaz. */
function oemConfidence(state: OemCapabilityState, decoder: OemDecoderStatus): number {
  if (state !== 'SUPPORTED') return 0;
  return decoder === 'OK' ? 0.6 : 0.3;
}

/* ── Okuma ────────────────────────────────────────────────────────────────── */

/** Kayıt → kanıt. Kapsam uyuşmazlığı/tanınmayan durum → `null` (kanıt YOK sayılır). */
export function recordToOemEvidence(
  record: DiscoveredDataRecord | null,
  signalId: OemSignalId,
  scope: OemCapabilityScope,
): OemCapabilityEvidence | null {
  if (record === null) return null;
  if (record.oemSignalId !== signalId) return null;

  const recordScope: OemCapabilityScope = {
    vehicleFingerprint: record.vehicleFingerprint,
    protocolClass: record.protocolClass,
    ecuAddress: record.ecuAddress,
  };
  if (!isSameOemScope(recordScope, scope)) return null;   // protokol/ECU/araç değişti → otorite değil

  const state = parseState(record.oemState);
  if (state === null) return null;                        // eski/bozuk kayıt → kanıt sayılmaz

  return {
    signalId,
    scope: recordScope,
    state,
    lastOutcome: parseOutcome(record.oemLastOutcome),
    lastNrc: typeof record.oemLastNrc === 'number' ? record.oemLastNrc : null,
    lastPositiveAt: typeof record.oemLastPositiveAt === 'number' ? record.oemLastPositiveAt : null,
    timeoutCount: typeof record.oemTimeoutCount === 'number' ? record.oemTimeoutCount : 0,
    observedAt: record.lastSeenAt,
    decoderStatus: parseDecoderStatus(record.oemDecoderStatus),
    probeCount: record.successfulReadCount + record.failureCount,
  };
}

/** Tek sinyalin kalıcı kanıtı — yoksa/kapsam dışıysa `null`. */
export function readOemEvidence(
  def: OemSignalDef,
  scope: OemCapabilityScope,
): OemCapabilityEvidence | null {
  if (def.identifier === 'UNKNOWN') return null;          // sorgulanamayan sinyalin kaydı olamaz
  const record = getRecord(scope.vehicleFingerprint, 'did', def.identifier.toUpperCase(), scope.ecuAddress);
  return recordToOemEvidence(record, def.signalId, scope);
}

/** Bu araçta OEM kaynaklı TÜM kayıtlar (LAB anlık görüntüsü için; kapsam süzgeci UYGULANMAZ). */
export function listOemRecords(vehicleFingerprint: string): readonly DiscoveredDataRecord[] {
  return loadRecords(vehicleFingerprint).filter((r) => r.discoverySource === 'oem_catalog');
}

/* ── Yazma ────────────────────────────────────────────────────────────────── */

export interface OemEvidencePersistInput {
  readonly def: OemSignalDef;
  readonly evidence: OemCapabilityEvidence;
  readonly rawRequestSample: string;
  readonly rawResponseSample: string;
  readonly latencyMs: number;
  readonly recommendedPollClass: PollClass;
  /** Hangi ECU kimliği kullanıldı (`decoderId` alanına yazılır; çözücü yoksa `null`). */
  readonly decoderId: string | null;
  readonly vinHash: string | null;
}

/**
 * Kanıtı kalıcı kayda yazar. Kayıt anahtarı MEVCUT şemadır (kind·identifier·ecuAddress) —
 * OEM alanları yalnız o kaydı ZENGİNLEŞTİRİR, paralel bir satır AÇMAZ.
 */
export function persistOemEvidence(input: OemEvidencePersistInput): DiscoveredDataRecord | null {
  const { def, evidence } = input;
  if (def.identifier === 'UNKNOWN') return null;          // kanıtsız kimlik kalıcılaştırılmaz
  if (def.service === 'UNKNOWN') return null;

  return upsertDiscoveredRecord(evidence.scope.vehicleFingerprint, {
    kind: 'did',
    identifier: def.identifier.toUpperCase(),
    ecuAddress: evidence.scope.ecuAddress,
    service: def.service,
    protocolClass: evidence.scope.protocolClass,
    vinHash: input.vinHash,
    rawRequestSample: input.rawRequestSample,
    rawResponseSample: input.rawResponseSample,
    decoderId: input.decoderId,
    validationStatus: oemStateToDiscoveryStatus(evidence.state, evidence.decoderStatus),
    confidence: oemConfidence(evidence.state, evidence.decoderStatus),
    latencyMs: input.latencyMs,
    success: evidence.state === 'SUPPORTED',
    recommendedPollClass: input.recommendedPollClass,
    discoverySource: 'oem_catalog',
    oemSignalId: def.signalId,
    oemState: evidence.state,
    oemDecoderStatus: evidence.decoderStatus,
    oemLastOutcome: evidence.lastOutcome,
    oemLastNrc: evidence.lastNrc,
    oemLastPositiveAt: evidence.lastPositiveAt,
    oemTimeoutCount: evidence.timeoutCount,
  });
}
