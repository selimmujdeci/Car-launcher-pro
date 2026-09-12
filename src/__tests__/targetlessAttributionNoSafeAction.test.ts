/**
 * targetlessAttributionNoSafeAction.test.ts — P0-VDK-F6D-2.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN KUSUR ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `resolutionPolicy.candidatesFor` içindeki hedef kapısı
 *   `const hasTarget = isServiceSafeForHealing(gap.target.service)`
 * YALNIZ **servisi** sınıyordu — **ECU'yu sınamıyordu.**
 *
 * Fonksiyonel (7DF) atıf boşluğunda servis bellidir (`03`) ama SAHİP bilinmez.
 * `hasTarget` yine `true` çıkıyor, `VERIFY_ECU_ATTRIBUTION` `executable` oluyor
 * ve çözücü ölçümü **taramanın hedef ECU'suna** (`input.ecu`) gönderiyordu —
 * yani boşluğun sahibi OLMAYAN bir ECU'ya. Sonuç: 1 istek harcanır, hiçbir
 * atıf kanıtı üretilmez, sorunun kendisi cevap sanılır.
 *
 * Bu dosya kapının GERÇEKTEN kapandığını ve **başka hiçbir boşluk türünü
 * yanlışlıkla BLOCKED yapmadığını** kilitler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDtcClass: vi.fn(), readDtcFromEcu: vi.fn(),
    readAdvancedDtcs: vi.fn(), sendTesterPresent: vi.fn(),
  },
}));

import { CarLauncher } from '../platform/nativePlugin';
import type { EcuVariant, ServiceDef } from '../platform/obd/cddl/schema';
import {
  builtinServiceDefs, extraReadOnlyServiceDefs,
} from '../platform/obd/cddl/legacyAdapter';
import {
  beginTransaction, transitionTransaction, _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import {
  _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest,
} from '../platform/obd/pduRouting';
import { _resetServiceDiscoveryForTest }
  from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  recordGap, activateGapLedgerVehicle, _resetGapRegistryForTest,
} from '../platform/obd/gapRegistry';
import {
  loadCapabilityStore, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import type { TransportConstraint } from '../platform/obd/capability/capabilityGraph';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import {
  candidatesFor, selectCandidate, assertCandidatesSafe,
  EXECUTABLE_CANDIDATES, MAX_ATTEMPTS_PER_TRIPLE, MAX_ATTEMPTS_PER_GAP,
  type CandidateContext,
} from '../platform/obd/healing/resolutionPolicy';
import type { ResolvableGap, RootCauseClass } from '../platform/obd/healing/gapModel';
import {
  runGapResolution, judgeEvidence, getGapStates, _resetGapResolverForTest,
} from '../platform/obd/healing/gapResolverRuntime';
import { buildGapEvidence } from '../platform/obd/gapEvidence';
import {
  recordEcuObservation, _resetEcuObservationsForTest,
} from '../platform/obd/ecuAddressability';
import { buildDiagnosticCompleteness } from '../platform/obd/ecuCompleteness';
import type { ProbeRecord } from '../platform/obd/discovery/serviceProbeModel';

const T0 = 1_000_000;
let sent: Record<string, unknown>[] = [];

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

function ecu(): EcuVariant {
  return {
    id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
    addressing: 'physical', session: 'default',
    serviceRefs: ['obd_stored_dtc', 'uds_read_dtc_information'],
    patternRefs: [], comParamRefs: [],
    provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
  } as unknown as EcuVariant;
}

function liveTxn() {
  const t = beginTransaction({ purpose: 'ecu_probe' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  return t;
}

function resolveInput(over: Record<string, unknown> = {}) {
  return {
    ecu: ecu(), defs: DEFS(), txn: liveTxn(),
    protocolClass: 'can' as const, protocol: '6',
    provenance: 'live' as const, transport: TRANSPORT,
    targetVerified: true, vehicleId: 'V1', ecuId: 'E1',
    fingerprintReusable: true, nowMs: T0,
    ...over,
  } as Parameters<typeof runGapResolution>[0];
}

/** Hattı açar ve GÖNDERİLEN her PDU'yu sayar (0 PDU kilidi için). */
function bridge(): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => {
      sent.push(o);
      return { raw: '4300', outcome: 'POSITIVE', kind: 'POSITIVE' };
    });
}

const CTX = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  isCan: true, genericBridge: true, targetVerified: true,
  priorAttemptsFor: () => 0, ...over,
});

const gapOf = (over: Partial<ResolvableGap> = {}): ResolvableGap => ({
  key: 'K', origin: 'REGISTRY', gapClass: 'UNKNOWN_ECU_ATTRIBUTION',
  scope: 'AUTHORITY',
  target: { ecuKey: null, service: '03', subFunction: null },
  context: 'dtc_attribution:functional:03', observations: 1, lastSeenMs: T0,
  lastNrc: null, transportLimited: false, sessionConditioned: false,
  evidence: null, evidenceState: 'UNAVAILABLE', registryKey: null, ...over,
});

/** HEDEFSİZ atıf boşluğunu gerçek üretici deseniyle sicile yazar. */
function seedTargetlessAttributionGap(): void {
  recordGap({
    signal: 'UNKNOWN_ECU_ATTRIBUTION', scope: 'AUTHORITY',
    context: 'dtc_attribution:functional:03', atMs: T0,
    evidence: buildGapEvidence({
      observation: {
        ecuKey: null, txHeader: null, rxHeader: null,
        service: '03', subFunction: null, requestIdentity: null,
        outcome: 'POSITIVE', nrc: null, classification: 'PRESENT',
        sessionOpened: null, sessionCommand: null,
        transportKind: null, protocol: '6',
        traceCorrelationId: 'corr-1', atMs: T0,
      },
      transactionId: 'txn-1', evidenceCorrelationId: 'corr-1',
      sessionEpoch: 7, provenance: 'live', vehicleFingerprintRef: 'V1',
    }),
  });
}

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  _resetEcuObservationsForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
  activateGapLedgerVehicle({
    vehicleRef: 'V1', fingerprintReusable: false,
    provenance: 'live', traceMode: 'live', nowMs: T0,
  });
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetCapabilityStoreForTest();
  _resetEcuObservationsForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) POLİTİKA KAPISI — hedefsiz atıf aday ÜRETMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-2 · hedefsiz atıf → NO_SAFE_ACTION', () => {
  it('🔒 KİLİT (1): ATTRIBUTION_UNRESOLVED + ecuKey:null → NO_SAFE_ACTION', () => {
    const cands = candidatesFor(gapOf(), 'ATTRIBUTION_UNRESOLVED', CTX());
    expect(selectCandidate(cands, 0).kind).toBe('NO_SAFE_ACTION');
  });

  it('🔒 KİLİT: hiçbir aday EXECUTABLE değil (hattan tek bayt çıkamaz)', () => {
    const cands = candidatesFor(gapOf(), 'ATTRIBUTION_UNRESOLVED', CTX());
    expect(cands.every((c) => !c.executable)).toBe(true);
    expect(cands.some((c) => EXECUTABLE_CANDIDATES.has(c.kind) && c.executable))
      .toBe(false);
  });

  it('🔒 KİLİT: gerekçe AÇIK — adres uydurulmadığı söylenir', () => {
    const cands = candidatesFor(gapOf(), 'ATTRIBUTION_UNRESOLVED', CTX());
    expect(cands[0]!.prerequisite).toContain('UYDURULMAZ');
    expect(cands[0]!.prerequisite).toContain('tarama ECU');
  });

  it('🔒 KİLİT: boş string ecuKey de HEDEF SAYILMAZ', () => {
    const cands = candidatesFor(
      gapOf({ target: { ecuKey: '', service: '03', subFunction: null } }),
      'ATTRIBUTION_UNRESOLVED', CTX());
    expect(selectCandidate(cands, 0).kind).toBe('NO_SAFE_ACTION');
  });

  it('🔒 KİLİT: ikinci kapı (assertCandidatesSafe) da sızıntıyı keser', () => {
    /* İleride biri `candidatesFor`a yeni bir executable atıf adayı eklerse
       bu kat sessizce geçmesini engeller. */
    const leaked = [{
      kind: 'VERIFY_ECU_ATTRIBUTION' as const, addresses: 'ATTRIBUTION_UNRESOLVED' as const,
      prerequisiteMet: true, prerequisite: 'x', expectedEvidence: 'y',
      requestCost: 1, timeCostMs: 1, risk: 'NONE' as const,
      informationGain: 8, priorAttempts: 0, executable: true,
    }];
    expect(assertCandidatesSafe(gapOf(), leaked)).toHaveLength(0);
    /* Hedef VARSA aynı aday geçer. */
    expect(assertCandidatesSafe(
      gapOf({ target: { ecuKey: '11:7E8', service: '03', subFunction: null } }),
      leaked)).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ÇÖZÜCÜ — 0 PDU, 0 bütçe, 0 deneme
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-2 · çözücü hedefsiz atıfta ölçüm YAPMAZ', () => {
  it('🔒 KİLİT (2+3+4): hattan TEK BAYT çıkmaz ve bütçe TÜKENMEZ', async () => {
    bridge();
    seedTargetlessAttributionGap();
    const res = await runGapResolution(resolveInput());

    expect(res.considered).toBe(1);
    expect(res.measured).toBe(0);            // ölçüm HİÇ yapılmadı
    expect(res.requestsSpent).toBe(0);       // bütçe tüketilmedi
    expect(res.resolved).toBe(0);
    expect(sent).toHaveLength(0);            // 0 PDU
    expect(vi.mocked(CarLauncher.readAdvancedDtcs!)).not.toHaveBeenCalled();
    expect(vi.mocked(CarLauncher.readDtcFromEcu)).not.toHaveBeenCalled();
  });

  it('🔒 KİLİT (5+6): deneme sayacı ARTMAZ, boşluk RESOLVED OLMAZ', async () => {
    bridge();
    seedTargetlessAttributionGap();
    await runGapResolution(resolveInput());
    const st = getGapStates().find((g) => g.gap.gapClass === 'UNKNOWN_ECU_ATTRIBUTION')!;
    expect(st).toBeDefined();
    expect(st.attempts).toBe(0);                       // yapay artış YOK
    expect(st.requestsSpent).toBe(0);
    expect(st.lifecycle).not.toBe('RESOLVED');
    expect(['OPEN', 'BLOCKED']).toContain(st.lifecycle);
    expect(st.selected).toBe('NO_SAFE_ACTION');
  });

  it('🔒 KİLİT: tekrar tekrar koşmak da trafik ÜRETMEZ (döngü yok)', async () => {
    bridge();
    seedTargetlessAttributionGap();
    for (let i = 0; i < 3; i++) await runGapResolution(resolveInput());
    expect(sent).toHaveLength(0);
    const st = getGapStates().find((g) => g.gap.gapClass === 'UNKNOWN_ECU_ATTRIBUTION')!;
    expect(st.attempts).toBe(0);
  });

  it('🔒 KİLİT (12): destructive HİÇBİR servis üretilmez', async () => {
    bridge();
    seedTargetlessAttributionGap();
    await runGapResolution(resolveInput());
    const services = sent.map((o) => String(o.service ?? ''));
    for (const d of DESTRUCTIVE_SERVICES) expect(services).not.toContain(d);
    expect(services).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) HEDEFLİ ATIF YOLU BOZULMADI (F6D-1 davranışı korunur)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-2 · hedefli atıf yolu KORUNUR', () => {
  const withTarget = () =>
    gapOf({ target: { ecuKey: '11:7E8', service: '03', subFunction: null } });

  it('🔒 KİLİT (7): ecuKey VARSA mevcut aday yolu aynen çalışır', () => {
    const cands = candidatesFor(withTarget(), 'ATTRIBUTION_UNRESOLVED', CTX());
    const kinds = cands.map((c) => c.kind);
    expect(kinds).toContain('VERIFY_ECU_ATTRIBUTION');
    expect(kinds).toContain('DISCOVER_VARIANT_EVIDENCE');
    expect(selectCandidate(cands, 0).kind).toBe('VERIFY_ECU_ATTRIBUTION');
    expect(cands.find((c) => c.kind === 'VERIFY_ECU_ATTRIBUTION')!.executable).toBe(true);
  });

  it('🔒 KİLİT (8): hedef VARSA bile BAĞIMSIZ F6-A kanıtı olmadan RESOLVED YOK', () => {
    const rec: ProbeRecord[] = [{
      service: '03', subFunction: null, ecuKey: '11:7E8',
      classification: 'PRESENT', outcome: 'POSITIVE', nrc: null,
      sessionOpened: null, atMs: T0,
    } as ProbeRecord];
    /* Yankılanan künye kanıt DEĞİLDİR (F6D-1 kilidi). */
    expect(judgeEvidence(withTarget(), rec, 'live', false).lifecycle).toBe('UNKNOWN');
    expect(judgeEvidence(withTarget(), rec, 'live').lifecycle).toBe('UNKNOWN');
    /* BAĞIMSIZ ölçüm varsa — ve yalnız o zaman — kapanır. */
    recordEcuObservation({
      atMs: T0, sessionEpoch: 7, protocol: '6',
      rxHeader: '7E8', txHeader: '7E0', addressBits: 11, label: 'Motor (ECM)',
      role: 'engine', roleEvidence: 'standard',
      discoverySource: 'physical_probe', probeOutcome: 'responded',
      txProvenance: 'standard', addressability: 'PROVEN',
      addressabilityReason: 'fiziksel istek cevaplandı',
      attempts: [], admission: 'READY', kwpTargetVerified: false,
      publishedToAuthority: null,
    });
    expect(judgeEvidence(withTarget(), rec, 'live', true).lifecycle).toBe('RESOLVED');
  });

  it('🔒 KİLİT (10): replay/sentetik kanıt canlı sayılmaz', () => {
    const rec: ProbeRecord[] = [{
      service: '03', subFunction: null, ecuKey: '11:7E8',
      classification: 'PRESENT', outcome: 'POSITIVE', nrc: null,
      sessionOpened: null, atMs: T0,
    } as ProbeRecord];
    for (const p of ['replay', 'synthetic', 'imported'] as const) {
      expect(judgeEvidence(withTarget(), rec, p, true).lifecycle).toBe('UNKNOWN');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) DİĞER BOŞLUK TÜRLERİ ETKİLENMEDİ (yanlış BLOCKED riski)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-2 · diğer kök nedenler DEĞİŞMEDİ', () => {
  /* KRİTİK: `discovery:<svc>` bağlamından gelen boşlukların `ecuKey`i
     MEŞRU olarak `null`dur (`targetFromContext` ECU üretmez). Global bir
     ecuKey şartı onları YANLIŞLIKLA bloklardı — kapı bu yüzden yalnız
     atıf sınıfındadır. */
  const cases: Array<[RootCauseClass, ResolvableGap['gapClass']]> = [
    ['CAPABILITY_UNMEASURED', 'UNKNOWN_SERVICE'],
    ['CAPABILITY_UNMEASURED', 'UNKNOWN_SUBFUNCTION'],
    ['SESSION_CONDITIONED', 'CAPABILITY_GAP'],
    ['TRANSPORT_BOUND', 'TRANSPORT_LIMITATION'],
  ];

  it('🔒 KİLİT (9): hedefsiz CAPABILITY/SESSION/TRANSPORT hâlâ aday ÜRETİR', () => {
    for (const [root, gapClass] of cases) {
      const g = gapOf({
        gapClass, context: 'discovery:19',
        target: { ecuKey: null, service: '19', subFunction: null },
        sessionConditioned: root === 'SESSION_CONDITIONED',
        transportLimited: root === 'TRANSPORT_BOUND',
      });
      const cands = candidatesFor(g, root, CTX({ sessionEvidenceAvailable: true }));
      expect(cands.length, `${root} aday üretmeli`).toBeGreaterThan(0);
      expect(selectCandidate(cands, 0).kind,
        `${root} NO_SAFE_ACTION'a düşmemeli`).not.toBe('NO_SAFE_ACTION');
    }
  });

  it('🔒 KİLİT (9): PARSER_BOUND davranışı aynen korunur (0 PDU, executable değil)', () => {
    const g = gapOf({ gapClass: 'PARSER_GAP', context: 'discovery:19' });
    const cands = candidatesFor(g, 'PARSER_BOUND', CTX());
    expect(cands.every((c) => !c.executable)).toBe(true);
  });

  it('🔒 KİLİT: kanıtlı ABSENT (NRC 0x11) hâlâ aday ÜRETMEZ', () => {
    const g = gapOf({ gapClass: 'UNKNOWN_SERVICE', lastNrc: 0x11 });
    expect(candidatesFor(g, 'CAPABILITY_UNMEASURED', CTX())).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KORUNAN İNVARYANTLAR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-2 · invaryantlar', () => {
  it('🔒 KİLİT: bütçe/anti-loop sabitleri DEĞİŞMEDİ', () => {
    expect(MAX_ATTEMPTS_PER_TRIPLE).toBe(2);
    expect(MAX_ATTEMPTS_PER_GAP).toBe(4);
  });

  it('🔒 KİLİT (11): 0 DTC + eksik CORE hâlâ "clean" değildir', () => {
    const d = buildDiagnosticCompleteness([{
      ecuKey: '11:7E8', coreVerdict: 'PARTIAL', deepVerdict: 'COMPLETE',
      corePlannedUnits: 6, coreTerminalUnits: 5,
      deepPlannedUnits: 2, deepTerminalUnits: 2,
      roleUnknown: false, productTrusted: true, requestCount: 6, rows: [],
    }]);
    expect(d.verdict).not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: aynı girdi → aynı karar (deterministik, rastgelelik YOK)', () => {
    const a = selectCandidate(candidatesFor(gapOf(), 'ATTRIBUTION_UNRESOLVED', CTX()), 0);
    const b = selectCandidate(candidatesFor(gapOf(), 'ATTRIBUTION_UNRESOLVED', CTX()), 0);
    expect(a.kind).toBe(b.kind);
    expect(a.reason).toBe(b.reason);
  });
});
