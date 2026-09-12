/**
 * sessionHealing.test — P0-VDK-F5C · OTURUM-KOŞULLU SELF-HEALING.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * `SESSION_CONDITIONED` gerçek üretim boşluğu, MEVCUT F1-B oturum kanıtı
 * üzerinden güvenle yeniden ölçülebilmeli. **Oturumun açılması tek başına
 * başarı SAYILMAZ**; yalnız asıl salt-okunur ölçüm yeni CANLI kanıt üretirse
 * boşluk `RESOLVED` olabilir. Yeni oturum otoritesi ya da kör oturum yoklaması
 * OLUŞMAMALI.
 *
 * ⚠️ REPO GERÇEĞİ (testlerin dayandığı ölçüm): native, `SESSION_REQUIRED`
 * ailesinden NRC (`7E·7F·22·24`) alınca `openExtendedSession()`i AYNI atomik
 * kuyruk görevinde çağırır ve isteği tekrarlar. Bu yüzden "yeniden aç" TS'ten
 * ayrı bir `10 xx` DEĞİL, asıl yoklamanın normal yoldan tekrarıdır.
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
import { builtinServiceDefs, extraReadOnlyServiceDefs }
  from '../platform/obd/cddl/legacyAdapter';
import {
  beginTransaction, transitionTransaction, cancelTransaction,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import {
  _resetServiceDiscoveryForTest, getProbeRecords,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { _resetGapRegistryForTest, recordGap } from '../platform/obd/gapRegistry';
import {
  loadCapabilityStore, getCapabilityEdges, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import type { TransportConstraint } from '../platform/obd/capability/capabilityGraph';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import {
  openSessionLease, verifyTesterPresentOnce, registerTransactionOwner,
  _resetSchedulerForTest, _setSchedulerClockForTest, _isSchedulerTimerRunning,
} from '../platform/obd/diagnosticSessionScheduler';
import { applySessionEvidence } from '../platform/obd/diagnosticSessionLease';
import {
  _resetGapResolverForTest, collectResolvableGaps, getGapStates, runGapResolution,
} from '../platform/obd/healing/gapResolverRuntime';
import {
  candidatesFor, classifyRootCause, selectCandidate, EXECUTABLE_CANDIDATES,
  type CandidateContext,
} from '../platform/obd/healing/resolutionPolicy';

import {
  SESSION_FAMILY_NRCS, SESSION_CHAIN_COST,
  deriveSessionRequirement, evaluateSessionHealing, isSessionFamilyNrc,
  sessionOpenOutcomeFrom, getLastSessionHealing, getSessionHealingEvidence,
  sessionHealingEverEvaluated, _resetSessionHealingForTest,
  type SessionHealingInput,
} from '../platform/obd/healing/sessionHealing';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

let sent: Record<string, unknown>[] = [];
let tpSent: Record<string, unknown>[] = [];
const T0 = 1_000_000;

function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
}
function testerPresent(reply: () => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendTesterPresent =
    vi.fn(async (o: Record<string, unknown>) => { tpSent.push(o); return reply(); });
}

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };
const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

const ECU = (): EcuVariant => ({
  id: 'healing.7E8', name: 'Motor (ECM)', role: 'engine',
  addressing: 'physical', txHeader: '7E0', rxHeader: '7E8',
  kwpTarget: null, session: 'default',
  serviceRefs: ['uds_read_dtc_information', 'uds_report_supported_dtc'],
  provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
} as unknown as EcuVariant);

function liveTxn() {
  const t = beginTransaction({ purpose: 'multi_ecu_scan' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  t.protocol = '6';
  return t;
}

function rctx(over: Record<string, unknown> = {}) {
  return {
    ecu: ECU(), defs: DEFS(), txn: liveTxn(),
    protocolClass: 'can' as const, protocol: '6',
    provenance: 'live' as const, transport: TRANSPORT,
    targetVerified: true, vehicleId: 'V1', ecuId: 'E1',
    fingerprintReusable: false, nowMs: T0 + 100,
    ...over,
  } as Parameters<typeof runGapResolution>[0];
}

/** Ölçülmüş bir yoklama kaydı taklidi (F4-B sözleşmesi). */
const rec = (over: Record<string, unknown> = {}) => ({
  ecuKey: 'ECM@7E0', ecuLabel: 'ECM', txHeader: '7E0', rxHeader: '7E8',
  service: '19', subFunction: '02', serviceDefId: 'd', requestIdentity: 'r',
  outcome: 'NEGATIVE', nrc: 0x22, latencyMs: 10,
  sessionOpened: null, sessionCommand: null,
  transportKind: 'elm327', traceCorrelationId: null, protocol: '6',
  classification: 'PRESENT_BUT_CONDITIONED', reason: 'ok', atMs: T0, count: 1,
  ...over,
} as unknown as Parameters<typeof deriveSessionRequirement>[0]);

const SIN = (over: Partial<SessionHealingInput> = {}): SessionHealingInput => ({
  requirement: deriveSessionRequirement(rec())!,
  transactionLive: true, cancelled: false, staleEpoch: false,
  admissionReady: true, ecuTargetProven: true, safeDefsAvailable: true,
  allocatedRequests: 8, chainCost: SESSION_CHAIN_COST, ...over,
});

const CTX = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  isCan: true, genericBridge: true, targetVerified: true,
  priorAttemptsFor: () => 0, sessionEvidenceAvailable: true, ...over,
});

/** Oturum-koşullu bir üretim boşluğu üretir: `7F 19 22` → PRESENT_BUT_CONDITIONED. */
async function seedSessionConditionedGap(): Promise<void> {
  bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
  const { runServiceDiscovery } =
    await import('../platform/obd/discovery/serviceDiscoveryRuntime');
  await runServiceDiscovery({
    defs: DEFS(), ecu: ECU(), protocolClass: 'can', protocol: '6',
    txn: liveTxn(), ecuKey: 'ECM@7E0', nowMs: T0, probeSubFunctions: false,
    vehicleId: 'V1', ecuId: 'E1', fingerprintReusable: false,
    provenance: 'live', transport: TRANSPORT,
  } as Parameters<typeof runServiceDiscovery>[0]);
}

beforeEach(() => {
  sent = []; tpSent = [];
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _setTransactionClockForTest(() => T0);
  _setSchedulerClockForTest(() => T0);
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetSchedulerForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) OTURUM KANITI — UYDURMA YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · oturum ihtiyacı YALNIZ ölçülmüş kanıttan', () => {
  it('NRC ailesi native `classifyNrc` ile BİREBİR (7E·7F·22·24)', () => {
    expect([...SESSION_FAMILY_NRCS].sort()).toEqual([0x22, 0x24, 0x7E, 0x7F].sort());
    /* Güvenlik ve "servis yok" aileleri BİLEREK dışarıda. */
    for (const n of [0x11, 0x12, 0x31, 0x33]) expect(isSessionFamilyNrc(n)).toBe(false);
  });

  it('ölçülmüş oturum komutu EN GÜÇLÜ kanıttır', () => {
    const r = deriveSessionRequirement(
      rec({ sessionOpened: true, sessionCommand: '1003' }));
    expect(r.required).toBe(true);
    expect(r.source).toBe('MEASURED_SESSION_COMMAND');
    expect(r.command).toBe('1003');
  });

  it('oturum ailesi NRC kanıttır ama KOMUT bilinmez (uydurulmaz)', () => {
    const r = deriveSessionRequirement(rec({ nrc: 0x22 }));
    expect(r.required).toBe(true);
    expect(r.source).toBe('SESSION_FAMILY_NRC');
    expect(r.command).toBeNull();
  });

  it('kanıt YOKSA required=false (kör 10 xx yok)', () => {
    expect(deriveSessionRequirement(null).required).toBe(false);
    expect(deriveSessionRequirement(rec({ nrc: 0x11 })).required).toBe(false);
    expect(deriveSessionRequirement(rec({ nrc: 0x33 })).required).toBe(false);
    expect(deriveSessionRequirement(
      rec({ classification: 'PRESENT', nrc: null })).required).toBe(false);
  });

  it('kanıt yoksa karar BLOCKED ve gerekçesi görünür', () => {
    const d = evaluateSessionHealing(SIN({
      requirement: deriveSessionRequirement(null),
    }));
    expect(d.admission).toBe('BLOCKED');
    expect(d.reason).toContain('kör 10 xx');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ÇALIŞTIRILABİLİRLİK KOŞULLARI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · executable koşulları (hepsi fail-closed)', () => {
  const blocked = (over: Partial<SessionHealingInput>) =>
    evaluateSessionHealing(SIN(over)).admission;

  it('admisyon READY değil → BLOCKED', () => {
    expect(blocked({ admissionReady: false })).toBe('BLOCKED');
  });
  it('işlem iptal → BLOCKED', () => {
    expect(blocked({ cancelled: true })).toBe('BLOCKED');
  });
  it('bayat epoch → BLOCKED', () => {
    expect(blocked({ staleEpoch: true })).toBe('BLOCKED');
  });
  it('işlem canlı değil → BLOCKED', () => {
    expect(blocked({ transactionLive: false })).toBe('BLOCKED');
  });
  it('ECU hedefi kanıtsız → BLOCKED', () => {
    expect(blocked({ ecuTargetProven: false })).toBe('BLOCKED');
  });
  it('güvenli CDDL tanımı yok → BLOCKED', () => {
    expect(blocked({ safeDefsAvailable: false })).toBe('BLOCKED');
  });
  it('pay atomik zinciri karşılamıyor → DEFERRED (yarım zincir YOK)', () => {
    const d = evaluateSessionHealing(SIN({ allocatedRequests: SESSION_CHAIN_COST - 1 }));
    expect(d.admission).toBe('DEFERRED');
    expect(d.reason).toContain('yarım zincir');
  });
  it('hepsi sağlanınca RUN', () => {
    expect(evaluateSessionHealing(SIN()).admission).toBe('RUN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ADAY SEÇİMİ — kanıt varsa executable, yoksa BLOCKED
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · oturum adayları', () => {
  const gap = () => ({
    key: 'K', origin: 'REGISTRY' as const, gapClass: 'CAPABILITY_GAP' as const,
    scope: 'AUTHORITY' as const,
    target: { ecuKey: 'ECM@7E0', service: '19', subFunction: '02' },
    context: 'discovery:1902', observations: 1, lastSeenMs: T0, lastNrc: 0x22,
    transportLimited: false, sessionConditioned: true,
  });

  it('SESSION_CONDITIONED kök nedeni türetiliyor', () => {
    expect(classifyRootCause(gap())).toBe('SESSION_CONDITIONED');
  });

  it('kanıt VARSA REOPEN_SESSION seçilir ve executable olur', () => {
    const g = gap();
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('REOPEN_SESSION');
    expect(sel.candidate?.executable).toBe(true);
  });

  it('kanıt YOKSA aday listede kalır ama executable DEĞİL', () => {
    const g = gap();
    const cands = candidatesFor(g, classifyRootCause(g),
      CTX({ sessionEvidenceAvailable: false }));
    const reopen = cands.find((c) => c.kind === 'REOPEN_SESSION')!;
    expect(reopen).toBeDefined();
    expect(reopen.executable).toBe(false);
    expect(reopen.prerequisite).toContain('kör 10 xx gönderilmez');
  });

  it('oturum adayları artık çalıştırılabilir kümede', () => {
    expect(EXECUTABLE_CANDIDATES.has('REOPEN_SESSION')).toBe(true);
    expect(EXECUTABLE_CANDIDATES.has('VERIFY_TESTER_PRESENT')).toBe(true);
  });

  it('kapsam dışı adaylar HÂLÂ çalıştırılamaz (sırf listede diye açılmadı)', () => {
    expect(EXECUTABLE_CANDIDATES.has('INCREASE_TIMEOUT_WITHIN_SAFE_BUDGET')).toBe(false);
    expect(EXECUTABLE_CANDIDATES.has('REQUEST_ADDITIONAL_RAW_TRACE')).toBe(false);
    expect(EXECUTABLE_CANDIDATES.has('VERIFY_ISOTP_RESTORE')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) TESTER PRESENT — kör 3E yapısal olarak imkânsız
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · TesterPresent yalnız kanıtlı ACTIVE kirada', () => {
  const lease = () => {
    const t = liveTxn();
    registerTransactionOwner(t);
    return { t, l: openSessionLease(t,
      { txHeader: '7E0', rxHeader: '7E8', addressBits: 11, label: 'ECM' }, '6') };
  };

  it('oturum kanıtı YOKSA 3E GÖNDERİLMEZ (kör 3E yok)', async () => {
    testerPresent(() => ({ outcome: 'ok' }));
    const { l } = lease();
    expect(l.sessionEstablishedEvidence).toBeNull();
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '7E00' }));
    const out = await verifyTesterPresentOnce(l);
    expect(out).toBeNull();
    expect(sent.some((o) => String(o.service ?? o.request ?? '').startsWith('3E')))
      .toBe(false);
  });

  it('kanıt uygulandıktan sonra kira ACTIVE olur ve 3E gönderilir', async () => {
    testerPresent(() => ({ outcome: 'ok' }));
    const { l } = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, T0);
    expect(l.state).toBe('ACTIVE');
    expect(l.sessionEstablishedEvidence).toBe('1003');

    /* ⚠️ `3E00` native `sendTesterPresent`e DEĞİL, F3-A PDU sınırından genel
       köprüye gider (`vdkTesterPresentFn` → `vdkPduTransport().send`).
       `CarLauncher.sendTesterPresent` yalnız KAPI koşuludur. */
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '7E00' }));
    const out = await verifyTesterPresentOnce(l);
    expect(out).toBe('POSITIVE');
    expect(sent.some((o) => String(o.service ?? o.request ?? '').startsWith('3E')))
      .toBe(true);
  });

  it('terminal kirada 3E GÖNDERİLMEZ', async () => {
    testerPresent(() => ({ outcome: 'ok' }));
    const { l } = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, T0);
    l.state = 'CLOSED';
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '7E00' }));
    expect(await verifyTesterPresentOnce(l)).toBeNull();
    expect(sent.some((o) => String(o.service ?? o.request ?? '').startsWith('3E')))
      .toBe(false);
  });

  it('sahip işlem iptal edilmişse 3E GÖNDERİLMEZ', async () => {
    testerPresent(() => ({ outcome: 'ok' }));
    const { t, l } = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, T0);
    cancelTransaction(t, 'test');
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '7E00' }));
    expect(await verifyTesterPresentOnce(l)).toBeNull();
    expect(sent.some((o) => String(o.service ?? o.request ?? '').startsWith('3E')))
      .toBe(false);
  });

  it('tek atış İKİNCİ bir zamanlayıcı kurmaz', async () => {
    testerPresent(() => ({ outcome: 'ok' }));
    const { l } = lease();
    applySessionEvidence(l, { sessionOpened: true, sessionCommand: '1003' }, T0);
    const before = _isSchedulerTimerRunning();
    await verifyTesterPresentOnce(l);
    expect(_isSchedulerTimerRunning()).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) UÇTAN UCA — gerçek üretim boşluğu, gerçek modüller
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · uçtan uca oturum-koşullu iyileştirme', () => {
  it('7F xx 22 boşluğu SESSION_CONDITIONED olarak görülüyor (kanıt resolver\'a ULAŞIYOR)', async () => {
    await seedSessionConditionedGap();
    const gaps = collectResolvableGaps(T0 + 50);
    expect(gaps.length).toBeGreaterThan(0);
    const g = gaps.find((x) => x.target.service === '19')!;
    expect(g.lastNrc).toBe(0x22);
    expect(g.sessionConditioned).toBe(true);
    expect(classifyRootCause(g)).toBe('SESSION_CONDITIONED');
  });

  it('oturum açıldı VE asıl yoklama başarılı → CANLI kanıtla RESOLVED', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    /* İkinci ölçümde ECU oturum açtı ve POZİTİF yanıt verdi. */
    bridge(() => ({
      outcome: 'ok', kind: 'OK', raw: '5902FFAA',
      sessionOpened: true, sessionCommand: '1003',
    }));

    const res = await runGapResolution(rctx());
    expect(res.measured).toBeGreaterThan(0);
    expect(sent.length).toBeGreaterThan(0);
    expect(res.resolved).toBeGreaterThan(0);
    const st = getGapStates().find((s) => s.lifecycle === 'RESOLVED')!;
    expect(st.selected).toBe('REOPEN_SESSION');
  });

  it('OTURUM AÇILDI ama asıl yoklama BAŞARISIZ → RESOLVED DEĞİL', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    /* Oturum açıldı (kanıt var) ama ECU yine koşullu reddetti. */
    bridge(() => ({
      outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22,
      sessionOpened: true, sessionCommand: '1003',
    }));

    const res = await runGapResolution(rctx());
    expect(res.measured).toBeGreaterThan(0);
    expect(res.resolved).toBe(0);
    expect(getGapStates().some((s) => s.lifecycle === 'RESOLVED')).toBe(false);
  });

  it('oturum açılışı NEGATIF → capability ABSENT OLMAZ', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await runGapResolution(rctx());
    expect(getProbeRecords().some((r) => r.classification === 'ABSENT')).toBe(false);
    expect(getCapabilityEdges().some((e) => e.presence === 'ABSENT')).toBe(false);
  });

  it('no-response / timeout → temiz ya da ABSENT SAYILMAZ', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    const res = await runGapResolution(rctx());
    expect(res.resolved).toBe(0);
    expect(getProbeRecords().some((r) => r.classification === 'ABSENT')).toBe(false);
  });

  it('replay/synthetic kaynağı gerçek RESOLVED üretemez', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    bridge(() => ({
      outcome: 'ok', kind: 'OK', raw: '5902FFAA',
      sessionOpened: true, sessionCommand: '1003',
    }));
    for (const p of ['replay', 'synthetic', 'imported'] as const) {
      _resetGapResolverForTest();
      const res = await runGapResolution(rctx({ provenance: p }));
      expect(res.resolved).toBe(0);
    }
  });

  it('iptal / bayat epoch → SIFIR gönderim', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));

    const t1 = liveTxn(); cancelTransaction(t1, 'test');
    await runGapResolution(rctx({ txn: t1 }));
    expect(sent).toHaveLength(0);

    const t2 = liveTxn(); t2.sessionEpoch = -1;
    await runGapResolution(rctx({ txn: t2 }));
    expect(sent).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) ANTİ-DÖNGÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · sonsuz reopen döngüsü YOK', () => {
  it('aynı oturum sonucu tekrar edince EXHAUSTED', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    /* Oturum her turda açılıyor ama ECU aynı koşullu cevabı veriyor. */
    bridge(() => ({
      outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22,
      sessionOpened: true, sessionCommand: '1003',
    }));

    await runGapResolution(rctx());
    await runGapResolution(rctx());

    /* Tükenen boşluğun KENDİSİ kilitlenir. Seed birden çok tanım yokladığı için
       başka boşluklar hâlâ ölçülebilir — tavan boşluk BAŞINADIR, tur başına
       değil. Bu yüzden lock tek boşluk üzerinden kurulur. */
    const exhausted = getGapStates().filter((s) => s.lifecycle === 'EXHAUSTED');
    expect(exhausted.length).toBeGreaterThan(0);
    const key = exhausted[0].gap.key;
    const attemptsBefore = exhausted[0].attempts;

    await runGapResolution(rctx());
    const after = getGapStates().find((s) => s.gap.key === key)!;
    expect(after.lifecycle).toBe('EXHAUSTED');
    expect(after.attempts).toBe(attemptsBefore);   // yeni deneme YOK
    expect(after.lifecycle).not.toBe('RESOLVED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) GÜVENLİK — oturum yetki AÇMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · oturum destructive yetki AÇMAZ', () => {
  it('oturum açıkken bile destructive servis 0 PDU', async () => {
    for (const svc of DESTRUCTIVE_SERVICES) {
      recordGap({ signal: 'CAPABILITY_GAP', scope: 'SESSION',
        context: `discovery:${svc}`, atMs: T0 });
    }
    sent = [];
    bridge(() => ({
      outcome: 'ok', kind: 'OK', raw: 'AA',
      sessionOpened: true, sessionCommand: '1003',
    }));
    await runGapResolution(rctx());
    const dset = new Set(DESTRUCTIVE_SERVICES);
    for (const o of sent) {
      const req = String(o.request ?? o.service ?? '').toUpperCase();
      expect(dset.has(req.slice(0, 2))).toBe(false);
    }
  });

  it('SecurityAccess NRC (0x33) oturum ailesi SAYILMAZ', () => {
    expect(isSessionFamilyNrc(0x33)).toBe(false);
    expect(deriveSessionRequirement(rec({ nrc: 0x33 })).required).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) KANIT DEFTERİ (LAB girdisi)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C · oturum iyileştirme kanıtı', () => {
  it('hiç değerlendirilmediyse defter BOŞ', () => {
    expect(sessionHealingEverEvaluated()).toBe(false);
    expect(getLastSessionHealing()).toBeNull();
  });

  it('çalışan zincir ölçülen alanları taşır', async () => {
    await seedSessionConditionedGap();
    /* P0-VDK-F5D NOTU: oturum kanıtı ARTIK boşluğun KENDİ zarfındadır
       (`GapEntry.evidence`); defteri silmek zinciri KOPARMAZ — bunun kilidi
       `gapEvidence.test.ts` retention bölümündedir. Bu senaryo defteri
       bilerek KORUR: iki yolun (zarf + eski defter) PARİTE tanığıdır. */
    sent = [];
    bridge(() => ({
      outcome: 'ok', kind: 'OK', raw: '5902FFAA',
      sessionOpened: true, sessionCommand: '1003',
    }));
    await runGapResolution(rctx());
    const e = getLastSessionHealing()!;
    expect(e.decision).toBe('RUN');
    expect(e.sessionOpen).toBe('POSITIVE');
    expect(e.sessionCommand).toBe('1003');
    expect(e.leaseState).not.toBeNull();
    expect(e.probeClassification).not.toBeNull();
    expect(e.requestsUsed).not.toBeNull();
  });

  it('oturum açılış sonucu sınıfları AYRI kalır', () => {
    expect(sessionOpenOutcomeFrom(null)).toBe('UNKNOWN');
    expect(sessionOpenOutcomeFrom(rec({ sessionOpened: true }) as never)).toBe('POSITIVE');
    expect(sessionOpenOutcomeFrom(rec({ outcome: 'NO_RESPONSE' }) as never)).toBe('NO_RESPONSE');
    expect(sessionOpenOutcomeFrom(rec({ outcome: 'TIMEOUT' }) as never)).toBe('TIMEOUT');
    expect(sessionOpenOutcomeFrom(rec({ outcome: 'TRANSPORT_ERROR' }) as never))
      .toBe('TRANSPORT_ERROR');
  });

  it('defter tavanlıdır', async () => {
    for (let i = 0; i < 40; i++) {
      const { recordSessionHealingDenial } =
        await import('../platform/obd/healing/sessionHealing');
      recordSessionHealingDenial('K', { admission: 'BLOCKED', reason: 'x' },
        deriveSessionRequirement(null), T0);
    }
    expect(getSessionHealingEvidence().length).toBeLessThanOrEqual(20);
  });
});
