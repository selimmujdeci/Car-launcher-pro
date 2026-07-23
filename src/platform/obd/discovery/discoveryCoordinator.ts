/**
 * discoveryCoordinator — P0 Deep PID/DID Explorer Faz-1 · ANA ORKESTRATÖR.
 *
 * Tek sorumluluğu SIRALAMAKTIR — her gerçek iş kendi modülünde:
 *   safety   → discoverySafetyPolicy (hareket/sağlık/KWP bütçe kapıları)
 *   pid      → standardPidDiscovery (Mode 01 bitmap — extendedPidService'i sarar)
 *   adaylar  → didCandidateProvider (profil + auto-did cache + kalıcı depo geri-çağrısı)
 *   tarama   → readOnlyDidScanner (yalnız allowlist'li servis, tek tek, DoS-korumalı)
 *   durum    → discoveryState (capabilityOutcome → DiscoveryStatus)
 *   kapı     → discoveryValidator (10-koşul VERIFIED/auto-add kapısı)
 *   kalıcı   → discoveredDataRepository (fingerprint başına kalıcı kayıt)
 *   kanıt    → discoveryEvidence (bounded tek-satır log)
 *   köprü    → mevcut discoveryCaptureService (PASİF dashboard'a besleme — PARALEL DB YOK,
 *              yeni keşifler zaten var olan Discovery Dashboard'da GÖRÜNÜR).
 *
 * GÜVENLİK: her adaydan ÖNCE `canStartDeepScan` YENİDEN kontrol edilir (mid-scan güvenlik) —
 * tarama sırasında araç hareket edebilir/ECU susabilir. AbortSignal her adımda saygı görür.
 */

import { classifyProtocol, type ProtocolClass } from '../protocolProfile';
import { decodeCompiledDid } from '../vehicleDidProfile';
import {
  canStartDeepScan, KwpCommandBudget, DEFAULT_KWP_DISCOVERY_BUDGET, DEFAULT_CAN_DISCOVERY_BUDGET,
  type DiscoveryHealthSnapshot,
} from './discoverySafetyPolicy';
import { mergeDiscoveryStatus, type DiscoveryStatus } from './discoveryState';
import { evaluateAutoAddGate, classifyByteLength, type AutoAddGateInput } from './discoveryValidator';
import { emitDiscoveryEvidence } from './discoveryEvidence';
import { recommendPollClass, type PollClass } from './pollingAdmissionGate';
import {
  loadRecords, upsertDiscoveredRecord, getRecord, type DiscoveredDataRecord, type DiscoverySourceKind,
} from './discoveredDataRepository';
import { gatherDidCandidates, type DidCandidate, type AutoDiscoveredDidLike } from './didCandidateProvider';
import type { StandardPidDiscoveryResult } from './standardPidDiscovery';
import type { DidScanOutcome } from './readOnlyDidScanner';
import type { VehicleDidProfile } from '../vehicleDidProfile';

export type DiscoveryPhase =
  | 'idle' | 'running_standard_pid' | 'running_did_candidates'
  | 'completed' | 'cancelled' | 'paused_unsafe' | 'error';

export interface DiscoveryProgress {
  phase: DiscoveryPhase;
  scannedDidCount: number;
  totalDidCandidates: number;
  verifiedCount: number;
  unknownCount: number;
  suspiciousCount: number;
  rejectedCount: number;
}

export interface DiscoveryDidResultEntry {
  candidate: DidCandidate;
  status: DiscoveryStatus;
  outcome: DidScanOutcome['outcome'];
  dataHex: string | null;
}

export type DiscoveryStopReason = 'completed' | 'cancelled' | 'unsafe' | 'no_candidates';

export interface DiscoverySessionResult {
  standardPids: StandardPidDiscoveryResult[];
  didResults: DiscoveryDidResultEntry[];
  stopReason: DiscoveryStopReason;
}

export interface CoordinatorDeps {
  getHealthSnapshot: () => DiscoveryHealthSnapshot;
  /** ATDPN ile öğrenilen aktif protokol (obdService.getHandshakeDiagnostics türevi). */
  getActiveProtocol: () => string | null;
  getFingerprint: () => Promise<string | null>;
  getProfiles: () => readonly VehicleDidProfile[];
  getAutoDiscovered: () => readonly AutoDiscoveredDidLike[];
  runStandardPidDiscovery: (opts: { signal?: AbortSignal }) => Promise<StandardPidDiscoveryResult[]>;
  scanDidCandidates: (
    candidates: readonly DidCandidate[],
    opts: { signal?: AbortSignal },
  ) => Promise<DidScanOutcome[]>;
  /** PASİF dashboard'a besleme (discoveryCaptureService.capture ile UYUMLU imza). Opsiyonel. */
  captureObservation?: (input: {
    pidOrDid: string; discoverySource: 'PID' | 'DID'; ecuAddress?: string; protocol?: string;
    mode?: string; request?: string; rawResponse?: string; supported?: boolean;
    decodedValue?: number | string;
  }) => void;
  maxCandidates?: number;
  kwpMaxCommands?: number;
  kwpWindowMs?: number;
}

/** VERIFIED bir adayın ne sıklıkla YENİDEN sorgulanacağı — bu pencere içinde tekrar taranmaz. */
const VERIFIED_RESCAN_INTERVAL_MS = 6 * 3_600_000; // 6 saat

function emptyProgress(): DiscoveryProgress {
  return {
    phase: 'idle', scannedDidCount: 0, totalDidCandidates: 0,
    verifiedCount: 0, unknownCount: 0, suspiciousCount: 0, rejectedCount: 0,
  };
}

/** Bir DID sonucu için 10-koşul kapısı girdisini KANITTAN inşa eder (uydurma yok). */
function buildAutoAddGateInput(
  candidate: DidCandidate,
  scan: DidScanOutcome,
  priorRecord: DiscoveredDataRecord | null,
): AutoAddGateInput {
  const positiveEcuResponse = scan.outcome === 'working';
  const decoderRegistered = candidate.hasKnownDecoder && candidate.compiledDef !== null;
  let byteLengthMatches = false;
  let valueInPhysicalRange = false;
  if (decoderRegistered && candidate.compiledDef && scan.dataHex) {
    const clean = scan.dataHex.replace(/[^0-9A-Fa-f]/g, '');
    const actualBytes = Math.floor(clean.length / 2);
    byteLengthMatches = classifyByteLength(candidate.compiledDef.bytes, actualBytes) === 'ok';
    const decoded = decodeCompiledDid(candidate.compiledDef, scan.dataHex);
    valueInPhysicalRange = typeof decoded === 'number' ? Number.isFinite(decoded) : typeof decoded === 'string' && decoded.length > 0;
  }
  // Bağımsız örnek kararlılığı: bu oturumdaki okuma + ÖNCEKİ oturum(lar)dan en az 1 başarılı
  // okuma → en az 2 BAĞIMSIZ (farklı zamanlı) gözlem (ekstra native trafik YOK).
  const priorSuccess = priorRecord?.successfulReadCount ?? 0;
  const stableAcrossSamples = positiveEcuResponse && decoderRegistered && priorSuccess >= 1;

  return {
    positiveEcuResponse,
    // JS katmanında ham frame echo'su gözlenemez — native withEcuHeader atomik set/oku/restore
    // deseni (multiEcuScan ROUTER KİLİDİ ile aynı ilke) tx/rx doğruluğunu garanti eder; burada
    // yalnız rx'in TANIMLI olduğunu (varsayılan-oturum belirsizliği yok) doğrularız.
    requestEchoValid: candidate.rx !== '',
    byteLengthMatches,
    decoderRegistered,
    unitScaleKnown: decoderRegistered,
    valueInPhysicalRange,
    stableAcrossSamples,
    noCrossTalk: candidate.rx !== '',
    notStaleOrCached: true, // bu tarama turunda TAZE okundu (cache'ten DEĞİL)
    safetyGateAllowed: true, // bu noktaya yalnız canStartDeepScan+allowlist geçtiyse ulaşılır
  };
}

function statusToEventType(status: DiscoveryStatus): Parameters<typeof emitDiscoveryEvidence>[0]['type'] | null {
  switch (status) {
    case 'VERIFIED': return 'PID_DID_DISCOVERY_VERIFIED';
    case 'DISCOVERED_UNKNOWN': return 'PID_DID_DISCOVERY_UNKNOWN';
    case 'SUSPICIOUS': case 'REJECTED': case 'UNSUPPORTED': return 'PID_DID_DISCOVERY_REJECTED';
    default: return null;
  }
}

export class DiscoveryCoordinator {
  private _abort: AbortController | null = null;
  private _phase: DiscoveryPhase = 'idle';
  private _lastResult: DiscoverySessionResult | null = null;
  private _progress: DiscoveryProgress = emptyProgress();
  private readonly deps: CoordinatorDeps;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
  }

  status(): DiscoveryProgress {
    return { ...this._progress, phase: this._phase };
  }

  results(): DiscoverySessionResult | null {
    return this._lastResult;
  }

  /** Yalnız 10-koşul kapısını geçmiş (VERIFIED) DID sonuçları — canlıya UYGULANABİLİR küme. */
  applyVerified(): DiscoveryDidResultEntry[] {
    if (!this._lastResult) return [];
    return this._lastResult.didResults.filter((r) => r.status === 'VERIFIED');
  }

  cancel(): void {
    this._abort?.abort();
  }

  async start(): Promise<DiscoverySessionResult> {
    if (this._phase === 'running_standard_pid' || this._phase === 'running_did_candidates') {
      // Zaten çalışıyor — fail-closed idempotent: ikinci oturum ÇAKIŞTIRILMAZ.
      return this._lastResult ?? { standardPids: [], didResults: [], stopReason: 'cancelled' };
    }

    const initialGate = canStartDeepScan(this.deps.getHealthSnapshot());
    if (!initialGate.allowed) {
      this._phase = 'paused_unsafe';
      emitDiscoveryEvidence({
        type: 'PID_DID_DISCOVERY_PAUSED', validationStatus: initialGate.reason,
        connectionState: this.deps.getHealthSnapshot().connectionState,
      });
      const result: DiscoverySessionResult = { standardPids: [], didResults: [], stopReason: 'unsafe' };
      this._lastResult = result;
      return result;
    }

    this._abort = new AbortController();
    this._phase = 'running_standard_pid';
    this._progress = emptyProgress();
    emitDiscoveryEvidence({ type: 'PID_DID_DISCOVERY_START', connectionState: this.deps.getHealthSnapshot().connectionState });

    const standardPids = await this.deps.runStandardPidDiscovery({ signal: this._abort.signal });
    for (const p of standardPids) {
      this.deps.captureObservation?.({
        pidOrDid: p.pid, discoverySource: 'PID', mode: '01', supported: true,
      });
    }

    // Mid-scan güvenlik yeniden-kontrolü — PID keşfi sırasında durum değişmiş olabilir.
    const midGate = canStartDeepScan(this.deps.getHealthSnapshot());
    if (this._abort.signal.aborted || !midGate.allowed) {
      const stopReason: DiscoveryStopReason = this._abort.signal.aborted ? 'cancelled' : 'unsafe';
      this._phase = stopReason === 'cancelled' ? 'cancelled' : 'paused_unsafe';
      emitDiscoveryEvidence({ type: stopReason === 'cancelled' ? 'PID_DID_DISCOVERY_CANCELLED' : 'PID_DID_DISCOVERY_PAUSED' });
      const result: DiscoverySessionResult = { standardPids, didResults: [], stopReason };
      this._lastResult = result;
      return result;
    }

    this._phase = 'running_did_candidates';
    const activeProtocol = this.deps.getActiveProtocol();
    const protocolClass: ProtocolClass = classifyProtocol(activeProtocol);
    const fingerprint = await this.deps.getFingerprint();

    const candidates = gatherDidCandidates({
      protocolClass,
      profiles: this.deps.getProfiles(),
      autoDiscovered: this.deps.getAutoDiscovered(),
      repositoryRecords: fingerprint ? loadRecords(fingerprint) : [],
      maxCandidates: this.deps.maxCandidates,
    });

    this._progress = { ...this._progress, totalDidCandidates: candidates.length };

    if (candidates.length === 0) {
      this._phase = 'completed';
      const result: DiscoverySessionResult = { standardPids, didResults: [], stopReason: 'no_candidates' };
      this._lastResult = result;
      emitDiscoveryEvidence({ type: 'PID_DID_DISCOVERY_COMPLETE', validationStatus: 'no_candidates' });
      return result;
    }

    const isSlowSerial = protocolClass === 'kwp' || protocolClass === 'iso9141';
    const budgetCfg = isSlowSerial ? DEFAULT_KWP_DISCOVERY_BUDGET : DEFAULT_CAN_DISCOVERY_BUDGET;
    const budget = new KwpCommandBudget(
      this.deps.kwpMaxCommands ?? budgetCfg.maxCommands,
      this.deps.kwpWindowMs ?? budgetCfg.windowMs,
    );

    const didResults: DiscoveryDidResultEntry[] = [];
    let stopReason: DiscoveryStopReason = 'completed';

    for (const candidate of candidates) {
      if (this._abort.signal.aborted) { stopReason = 'cancelled'; break; }
      if (!canStartDeepScan(this.deps.getHealthSnapshot()).allowed) { stopReason = 'unsafe'; break; }

      const priorRecord = fingerprint ? getRecord(fingerprint, 'did', candidate.did, candidate.ecuId) : null;

      // §12 "Doğrulanmış sonuçlar tekrar gereksiz taranmaz": VERIFIED + TAZE (rescan penceresi
      // içinde) bir önceki karar varsa YENİ native komut GÖNDERİLMEZ — önceki sonuç taşınır.
      if (priorRecord && priorRecord.validationStatus === 'VERIFIED'
        && (Date.now() - priorRecord.lastSeenAt) < VERIFIED_RESCAN_INTERVAL_MS) {
        didResults.push({
          candidate, status: 'VERIFIED', outcome: 'working', dataHex: priorRecord.rawResponseSample || null,
        });
        this._progress = { ...this._progress, verifiedCount: this._progress.verifiedCount + 1 };
        continue;
      }

      if (!budget.tryConsume()) { stopReason = 'completed'; break; } // bütçe bitti — nazikçe dur

      emitDiscoveryEvidence({
        type: 'PID_DID_DISCOVERY_CANDIDATE', ecuAddress: candidate.tx || candidate.rx,
        request: `${candidate.service}${candidate.did}`, vehicleFingerprint: fingerprint,
      });

      const [scan] = await this.deps.scanDidCandidates([candidate], { signal: this._abort.signal });
      if (!scan) break;

      emitDiscoveryEvidence({
        type: 'PID_DID_DISCOVERY_RESPONSE', responseClass: scan.outcome,
        latencyMs: scan.latencyMs, responseLength: scan.dataHex ? scan.dataHex.replace(/[^0-9A-Fa-f]/g, '').length / 2 : 0,
        vehicleFingerprint: fingerprint,
      });

      let status = mergeDiscoveryStatus(
        priorRecord?.validationStatus ?? null, scan.outcome, candidate.hasKnownDecoder,
      );

      // VERIFIED'a geçiş YALNIZ 10-koşul kapısından — DECODER_KNOWN sonucu burada terfi denenir.
      if (status === 'DECODER_KNOWN') {
        const gate = evaluateAutoAddGate(buildAutoAddGateInput(candidate, scan, priorRecord));
        status = gate.eligible ? 'VERIFIED' : 'VALIDATING';
      }

      const pollClass: PollClass = recommendPollClass({ status, protocolClass });
      const discoverySource: DiscoverySourceKind = candidate.source === 'profile'
        ? 'profile_candidate' : candidate.source === 'auto_did_cache' ? 'auto_did_cache' : 'repository_recall';

      if (fingerprint) {
        upsertDiscoveredRecord(fingerprint, {
          kind: 'did', identifier: candidate.did, ecuAddress: candidate.ecuId, service: candidate.service,
          protocolClass, vinHash: fingerprint,
          rawRequestSample: `${candidate.service}${candidate.did}`, rawResponseSample: scan.dataHex ?? '',
          decoderId: candidate.hasKnownDecoder ? candidate.did : null,
          validationStatus: status, confidence: status === 'VERIFIED' ? 1 : status === 'DISCOVERED_UNKNOWN' ? 0.3 : 0.5,
          latencyMs: scan.latencyMs, success: scan.outcome === 'working', recommendedPollClass: pollClass,
          discoverySource,
        });
      }

      if (status === 'DISCOVERED_UNKNOWN' || (status === 'VERIFIED' && !candidate.hasKnownDecoder)) {
        this.deps.captureObservation?.({
          pidOrDid: candidate.did, discoverySource: 'DID', ecuAddress: candidate.ecuId,
          mode: candidate.service, request: `${candidate.service}${candidate.did}`,
          rawResponse: scan.dataHex ?? '', supported: scan.outcome === 'working',
        });
      }

      const evType = statusToEventType(status);
      if (evType) emitDiscoveryEvidence({ type: evType, validationStatus: status, vehicleFingerprint: fingerprint });

      didResults.push({ candidate, status, outcome: scan.outcome, dataHex: scan.dataHex });
      this._progress = {
        ...this._progress,
        scannedDidCount: this._progress.scannedDidCount + 1,
        verifiedCount: this._progress.verifiedCount + (status === 'VERIFIED' ? 1 : 0),
        unknownCount: this._progress.unknownCount + (status === 'DISCOVERED_UNKNOWN' ? 1 : 0),
        suspiciousCount: this._progress.suspiciousCount + (status === 'SUSPICIOUS' ? 1 : 0),
        rejectedCount: this._progress.rejectedCount + (status === 'REJECTED' || status === 'UNSUPPORTED' ? 1 : 0),
      };
    }

    this._phase = stopReason === 'cancelled' ? 'cancelled' : 'completed';
    const result: DiscoverySessionResult = { standardPids, didResults, stopReason };
    this._lastResult = result;
    emitDiscoveryEvidence({
      type: stopReason === 'cancelled' ? 'PID_DID_DISCOVERY_CANCELLED' : 'PID_DID_DISCOVERY_COMPLETE',
      vehicleFingerprint: fingerprint,
    });
    return result;
  }
}

/** DI ile örnek üretir — testler gerçek deps yerine sahte fonksiyonlar geçer. */
export function createDiscoveryCoordinator(deps: CoordinatorDeps): DiscoveryCoordinator {
  return new DiscoveryCoordinator(deps);
}

/** İçe aktarma/derinlemesine test için — üretim kodu çağırmaz. */
export const _internals = { buildAutoAddGateInput, statusToEventType };
export type { StandardPidDiscoveryResult, DidCandidate, DidScanOutcome };
