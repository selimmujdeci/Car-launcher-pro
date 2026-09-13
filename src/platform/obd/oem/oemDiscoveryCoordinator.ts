/**
 * oemDiscoveryCoordinator — OEM DISCOVERY FAZ 1 · SALT-OKUMA KEŞİF KOORDİNATÖRÜ.
 *
 * ── SORUMLULUĞU YALNIZ SIRALAMAK ──────────────────────────────────────────
 * Her gerçek iş MEVCUT modülünde kalır:
 *   katalog   → oemSignalCatalog / oemSignalRegistry  (anlam · kimlik · makullük)
 *   adres     → oem/oemProfileMatch                    (ECU adresi tek otoritede)
 *   güvenlik  → discovery/discoverySafetyPolicy        (hareket · sağlık · bütçe)
 *   sınıflama → discovery/readOnlyDidScanner + capabilityOutcome (ham yanıt → anlam)
 *   kanıt     → oemCapabilityEvidence                  (6 durumlu yetenek modeli)
 *   kalıcılık → oemCapabilityCache → discoveredDataRepository (TEK depo)
 *   iz        → discovery/discoveryEvidence            (bounded tek satır)
 *
 * ── PAZARLIKSIZ SINIRLAR ──────────────────────────────────────────────────
 *  · KÖR TARAMA YOK: yalnız katalogda KİMLİĞİ KANITLANMIŞ sinyaller sorgulanır.
 *    Bugün katalogdaki her kimlik `'UNKNOWN'` olduğu için bu koordinatör gerçek
 *    araçta TEK BAYT göndermez — bu bir eksiklik değil, sözleşmenin çalıştığının kanıtıdır.
 *  · YAZMA/AKTÜATÖR/SecurityAccess YOK: servis her adayda YENİDEN doğrulanır
 *    (`isReadOnlyServiceAllowed`) — allowlist dışı aday native'e HİÇ gitmez.
 *  · YENİ TIMER/THREAD/SCHEDULER YOK: bu modül `setInterval` KURMAZ. Tur, çağıran
 *    (mevcut keşif tetikleyicisi) tarafından başlatılır; içeride yalnız sıralı
 *    `await` ve mevcut DoS-önleme gecikmesi vardır.
 *  · STANDART OBD'Yİ YAVAŞLATMAZ: her sorgudan önce güvenlik kapısı + bounded bütçe
 *    kontrol edilir; bütçe biterse tur DURUR (çekirdek RPM/hız trafiği aç kalmaz).
 */

import { canStartDeepScan, isReadOnlyServiceAllowed, KwpCommandBudget,
  DEFAULT_KWP_DISCOVERY_BUDGET, DEFAULT_CAN_DISCOVERY_BUDGET,
  type DiscoveryHealthSnapshot, type DiscoveryGateReason } from '../discovery/discoverySafetyPolicy';
import { classifyReadObdDidResult, type ReadObdDidResult } from '../discovery/readOnlyDidScanner';
import { DISCOVERY_INTER_DID_DELAY_MS } from '../didDiscoveryService';
import { emitDiscoveryEvidence } from '../discovery/discoveryEvidence';
import { recommendPollClass } from '../discovery/pollingAdmissionGate';
import type { DidCandidate } from '../discovery/didCandidateProvider';
import type { ProtocolClass } from '../protocolProfile';
import type { EcuRole } from '../ecuRoleModel';
import type { CapabilityOutcome } from '../capabilityOutcome';
import {
  oemSignalMatchesScope, oemSignalToDidCandidate, compileOemSignal, isOemSignalProbeable,
  type OemSignalDef, type OemSignalEcuBinding,
} from './oemSignalCatalog';
import { OEM_SIGNAL_CATALOG } from './oemSignalRegistry';
import type { OemProtocolClass } from './oemEcuProfile';
import {
  mergeOemCapability, shouldReprobeOemSignal, decodeOemResponse,
  type OemCapabilityEvidence, type OemCapabilityScope, type OemDecodeResult,
} from './oemCapabilityEvidence';
import { readOemEvidence, persistOemEvidence } from './oemCapabilityCache';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) BAĞLAM
 * ════════════════════════════════════════════════════════════════════════ */

export interface OemDiscoveryContext {
  /** `discoveryFingerprint.getVehicleFingerprint` çıktısı (VIN hash) — ham VIN ASLA. */
  readonly vehicleFingerprint: string;
  readonly protocolClass: ProtocolClass;
  /** VIN'in ilk 3 hanesi; okunamadıysa `null` (marka filtreli sinyal o zaman EŞLEŞMEZ). */
  readonly wmi: string | null;
  readonly vinHash: string | null;
  /**
   * ECU rolü → adres bağlaması. Adres otoritesi `oemProfileMatch.matchOemProfile`tir;
   * burada YALNIZ ÇÖZÜLMÜŞ hâli taşınır. Rol için kayıt yoksa o sinyal sorgulanmaz
   * (fail-closed — adres uydurulmaz).
   */
  readonly ecuByRole: ReadonlyMap<Exclude<EcuRole, 'unknown'>, OemSignalEcuBinding>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) PLAN (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

export type OemProbeSkipReason =
  | 'scope_mismatch'        // marka/protokol bu sinyale uymuyor
  | 'identifier_unknown'    // hex kimlik kanıtlanmadı → sorgulanamaz
  | 'no_ecu_binding'        // rol için doğrulanmış ECU adresi yok
  | 'evidence_sufficient'   // taze kanıt var (SUPPORTED/UNSUPPORTED) → tekrar sorma
  | 'capped';               // tur başına aday tavanı doldu

export const OEM_PROBE_SKIP_LABEL: Readonly<Record<OemProbeSkipReason, string>> = {
  scope_mismatch:      'Kapsam dışı (marka/protokol)',
  identifier_unknown:  'Kimlik BİLİNMİYOR — sorgulanamaz',
  no_ecu_binding:      'Doğrulanmış ECU adresi yok',
  evidence_sufficient: 'Taze kanıt var — tekrar sorulmadı',
  capped:              'Tur aday tavanı doldu',
};

export interface OemProbePlanEntry {
  readonly def: OemSignalDef;
  readonly ecu: OemSignalEcuBinding;
  readonly candidate: DidCandidate;
  readonly scope: OemCapabilityScope;
  readonly previous: OemCapabilityEvidence | null;
}

export interface OemProbeSkip {
  readonly signalId: string;
  readonly reason: OemProbeSkipReason;
}

export interface OemProbePlan {
  readonly probes: readonly OemProbePlanEntry[];
  readonly skipped: readonly OemProbeSkip[];
}

/** Tur başına azami sorgu — bounded (DoS gibi davranmasın). */
export const DEFAULT_MAX_OEM_PROBES_PER_RUN = 8;

export interface OemProbePlanInput {
  readonly context: OemDiscoveryContext;
  readonly nowMs: number;
  readonly catalog?: readonly OemSignalDef[];
  readonly readEvidence?: (def: OemSignalDef, scope: OemCapabilityScope) => OemCapabilityEvidence | null;
  readonly maxProbes?: number;
}

/** `ProtocolClass` → katalog protokol sınıfı; `unknown` eşleşmez (fail-closed). */
function toOemProtocolClass(p: ProtocolClass): OemProtocolClass | null {
  return p === 'unknown' ? null : p;
}

/**
 * Sorgulanacak sinyalleri seçer. SAF: I/O yalnız enjekte edilen `readEvidence` ile olur
 * (varsayılanı kalıcı depodan okur).
 */
export function planOemProbes(input: OemProbePlanInput): OemProbePlan {
  const { context, nowMs } = input;
  const catalog = input.catalog ?? OEM_SIGNAL_CATALOG;
  const readEv = input.readEvidence ?? readOemEvidence;
  const cap = input.maxProbes ?? DEFAULT_MAX_OEM_PROBES_PER_RUN;
  const protocolClass = toOemProtocolClass(context.protocolClass);

  const probes: OemProbePlanEntry[] = [];
  const skipped: OemProbeSkip[] = [];

  for (const def of catalog) {
    if (probes.length >= cap) { skipped.push({ signalId: def.signalId, reason: 'capped' }); continue; }

    if (!oemSignalMatchesScope(def, { wmi: context.wmi, protocolClass })) {
      skipped.push({ signalId: def.signalId, reason: 'scope_mismatch' }); continue;
    }
    if (!isOemSignalProbeable(def)) {
      skipped.push({ signalId: def.signalId, reason: 'identifier_unknown' }); continue;
    }
    const ecu = context.ecuByRole.get(def.ecuRole);
    if (ecu === undefined) {
      skipped.push({ signalId: def.signalId, reason: 'no_ecu_binding' }); continue;
    }

    const scope: OemCapabilityScope = {
      vehicleFingerprint: context.vehicleFingerprint,
      protocolClass: context.protocolClass,
      ecuAddress: ecu.rx,
    };
    const previous = readEv(def, scope);
    if (!shouldReprobeOemSignal(previous, scope, nowMs)) {
      skipped.push({ signalId: def.signalId, reason: 'evidence_sufficient' }); continue;
    }

    const candidate = oemSignalToDidCandidate(def, ecu);
    if (candidate === null) {
      skipped.push({ signalId: def.signalId, reason: 'identifier_unknown' }); continue;
    }
    probes.push({ def, ecu, candidate, scope, previous });
  }

  return { probes, skipped };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) TUR (I/O sınırı — yalnız enjekte edilen native primitif)
 * ════════════════════════════════════════════════════════════════════════ */

export interface OemDiscoveryDeps {
  /** MEVCUT native primitif (`CarLauncher.readObdDid`) — yeni transport açılmaz. */
  readonly readObdDid: (opts: { tx: string; rx: string; did: string; service: '22' | '21' })
    => Promise<ReadObdDidResult>;
  readonly getHealthSnapshot: () => DiscoveryHealthSnapshot;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly interDelayMs?: number;
  readonly persist?: (input: Parameters<typeof persistOemEvidence>[0]) => unknown;
  /** Bütçe enjekte edilebilir (test); verilmezse protokole göre mevcut varsayılan kurulur. */
  readonly budget?: KwpCommandBudget;
}

export type OemRunStopReason =
  | 'completed' | 'cancelled' | 'unsafe' | 'budget_exhausted' | 'no_probes';

export interface OemProbeResult {
  readonly signalId: string;
  readonly identifier: string;
  readonly ecuAddress: string;
  readonly outcome: CapabilityOutcome;
  readonly evidence: OemCapabilityEvidence;
  readonly decode: OemDecodeResult;
  readonly latencyMs: number;
}

export interface OemDiscoveryRunResult {
  readonly results: readonly OemProbeResult[];
  readonly stopReason: OemRunStopReason;
  /** Güvenlik kapısı kapandıysa gerekçesi (LAB dürüstlüğü). */
  readonly gateReason: DiscoveryGateReason | null;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function makeBudget(protocolClass: ProtocolClass, now: () => number): KwpCommandBudget {
  const cfg = protocolClass === 'kwp' || protocolClass === 'iso9141'
    ? DEFAULT_KWP_DISCOVERY_BUDGET
    : DEFAULT_CAN_DISCOVERY_BUDGET;
  return new KwpCommandBudget(cfg.maxCommands, cfg.windowMs, now);
}

/**
 * Planı SIRAYLA yürütür. Her adaydan ÖNCE güvenlik kapısı YENİDEN sorulur (tur sırasında
 * araç hareket edebilir / oturum kopabilir) ve bütçe tüketilir. `AbortSignal` her adımda saygı görür.
 */
export async function runOemDiscovery(
  plan: OemProbePlan,
  context: OemDiscoveryContext,
  deps: OemDiscoveryDeps,
  opts: { readonly signal?: AbortSignal } = {},
): Promise<OemDiscoveryRunResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const interDelay = deps.interDelayMs ?? DISCOVERY_INTER_DID_DELAY_MS;
  const persist = deps.persist ?? persistOemEvidence;
  const budget = deps.budget ?? makeBudget(context.protocolClass, now);

  const results: OemProbeResult[] = [];
  if (plan.probes.length === 0) {
    return { results, stopReason: 'no_probes', gateReason: null };
  }

  for (let i = 0; i < plan.probes.length; i++) {
    if (opts.signal?.aborted) return { results, stopReason: 'cancelled', gateReason: null };

    const gate = canStartDeepScan(deps.getHealthSnapshot());
    if (!gate.allowed) {
      emitDiscoveryEvidence({
        type: 'PID_DID_DISCOVERY_PAUSED',
        vehicleFingerprint: context.vehicleFingerprint,
        protocol: context.protocolClass,
        sessionHealth: gate.reason,
      });
      return { results, stopReason: 'unsafe', gateReason: gate.reason };
    }

    if (!budget.tryConsume()) {
      return { results, stopReason: 'budget_exhausted', gateReason: null };
    }

    const entry = plan.probes[i]!;
    const { def, candidate, scope } = entry;

    // Savunma derinliği: allowlist dışı servis native'e ASLA gitmez (katalog zaten filtreler).
    if (!isReadOnlyServiceAllowed(candidate.service)) continue;

    const t0 = now();
    let raw: ReadObdDidResult | null = null;
    let outcome: CapabilityOutcome;
    try {
      raw = await deps.readObdDid({
        tx: candidate.tx, rx: candidate.rx, did: candidate.did, service: candidate.service,
      });
      outcome = classifyReadObdDidResult(raw);
    } catch {
      // Bağlantı koptu / native reject — ARAÇ HAKKINDA KANIT DEĞİL (zero-trust).
      outcome = 'timeout';
    }
    const latencyMs = now() - t0;

    const compiled = compileOemSignal(def, entry.ecu);
    const decode = outcome === 'working'
      ? decodeOemResponse(compiled, raw?.data ?? null)
      : { value: null, status: 'NOT_ATTEMPTED' as const };

    const evidence = mergeOemCapability(entry.previous, {
      signalId: def.signalId,
      scope,
      outcome,
      nrc: raw?.nrc ?? null,
      decoderStatus: decode.status,
      nowMs: now(),
    });

    persist({
      def,
      evidence,
      rawRequestSample: `${candidate.service}${candidate.did}`,
      rawResponseSample: raw?.data ?? '',
      latencyMs,
      recommendedPollClass: recommendPollClass({ status: 'DECODER_KNOWN', protocolClass: context.protocolClass }),
      decoderId: compiled === null ? null : def.signalId,
      vinHash: context.vinHash,
    });

    emitDiscoveryEvidence({
      type: outcome === 'working' ? 'PID_DID_DISCOVERY_RESPONSE' : 'PID_DID_DISCOVERY_REJECTED',
      vehicleFingerprint: context.vehicleFingerprint,
      protocol: context.protocolClass,
      ecuAddress: candidate.rx,
      request: `${candidate.service}${candidate.did}`,
      responseClass: outcome,
      latencyMs,
      responseLength: raw?.data ? raw.data.replace(/[^0-9A-Fa-f]/g, '').length / 2 : null,
      negativeResponseCode: raw?.nrc ?? null,
      validationStatus: evidence.state,
    });

    results.push({
      signalId: def.signalId,
      identifier: candidate.did,
      ecuAddress: candidate.rx,
      outcome,
      evidence,
      decode,
      latencyMs,
    });

    if (i < plan.probes.length - 1 && !opts.signal?.aborted) await sleep(interDelay);
  }

  return { results, stopReason: 'completed', gateReason: null };
}

/** Planla + yürüt — tek çağrılık kolaylık sarmalayıcısı (yeni otorite değil). */
export async function discoverOemSignals(
  context: OemDiscoveryContext,
  deps: OemDiscoveryDeps,
  opts: { readonly signal?: AbortSignal; readonly catalog?: readonly OemSignalDef[]; readonly maxProbes?: number } = {},
): Promise<OemDiscoveryRunResult & { readonly plan: OemProbePlan }> {
  const now = deps.now ?? Date.now;
  const plan = planOemProbes({
    context, nowMs: now(), catalog: opts.catalog, maxProbes: opts.maxProbes,
  });
  const run = await runOemDiscovery(plan, context, deps, { signal: opts.signal });
  return { ...run, plan };
}
