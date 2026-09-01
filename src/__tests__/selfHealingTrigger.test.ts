/**
 * selfHealingTrigger.test — P0-VDK-F5B · ÜRETİM TETİĞİ + BÜTÇE SAHİPLİĞİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * Self-Healing gerçek ürün akışından otomatik tetiklenir; ancak YALNIZ mevcut
 * bütçe · işlem · oturum · güvenlik otoriteleri izin verdiğinde çalışır.
 * Normal tanıyı aç bırakmaz, trigger storm yaratmaz, destructive işlem
 * üretemez ve yalnız CANLI ölçüm gerçek boşluğu kapatabilir.
 *
 * Bu dosyanın kilitlediği en pahalı dört hata:
 *  a. iyileştirmenin kullanıcının gördüğü taramanın bütçesini yemesi,
 *  b. her tarama bitişinde yeni tur başlatıp araca trafik bindirmesi (storm),
 *  c. LAB ekranının açılmasının ölçüm tetiklemesi,
 *  d. bağlantı/oturum/işlem yokken hatta bayt çıkması.
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
  beginTransaction, transitionTransaction, cancelTransaction, completeTransaction,
  consumeRequest, _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import { _resetServiceDiscoveryForTest }
  from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { recordGap, _resetGapRegistryForTest } from '../platform/obd/gapRegistry';
import {
  loadCapabilityStore, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import type { TransportConstraint } from '../platform/obd/capability/capabilityGraph';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import { _resetGapResolverForTest, getGapStates }
  from '../platform/obd/healing/gapResolverRuntime';

import {
  HEALING_BUDGET_SHARE, HEALING_MAX_REQUESTS, HEALING_MIN_RESERVE_REQUESTS,
  HEALING_MIN_RESERVE_TIME_MS, MAX_HEALING_RUNS_PER_EPOCH,
  evaluateHealingTrigger, healingTargetFromProvenEcu, maybeRunSelfHealing,
  getHealingTriggerEvidence, getLastHealingTrigger, healingTriggerEverEvaluated,
  getHealingRunsForEpoch,
  _resetHealingTriggerForTest,
  type HealingTriggerInput,
} from '../platform/obd/healing/selfHealingTrigger';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

let sent: Record<string, unknown>[] = [];
const T0 = 1_000_000;
/** Test ortamında `getObdSessionEpoch()` bu değeri döner — sahteleştirilmez. */
const TEST_EPOCH = 0;

function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
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

/**
 * Canlı, bütçesi bol bir tam-tarama işlemi (üretimdeki sahibi işlem).
 *
 * ⚠️ İşlem saati ENJEKTE edilir (`_setTransactionClockForTest`): üretimde hem
 * `txn.startedAt` hem `ctx.nowMs` AYNI `Date.now()` kaynağından gelir. Testte
 * yalnız birini sahteleştirmek süre bütçesini yanlışlıkla "dolmuş" gösterirdi.
 */
function liveScanTxn() {
  const t = beginTransaction({ purpose: 'multi_ecu_scan' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  /* ⚠️ `sessionEpoch` ELLE DEĞİŞTİRİLMEZ: mühür `getObdSessionEpoch()`ten gelir
     ve işlem canlılığı onu CANLI epoch ile karşılaştırır. Sahte bir mühür
     yazmak işlemi kendi kendine STALE_EPOCH yapardı. */
  return t;
}

function ctx(over: Record<string, unknown> = {}) {
  return {
    trigger: 'AFTER_FULL_VEHICLE_SCAN' as const,
    admission: 'READY' as const,
    ecu: ECU(),
    defs: DEFS(),
    protocolClass: 'can' as const,
    protocol: '6',
    leaseAllows: null,
    ecuAddressProven: true,
    higherPriorityWorkPending: false,
    provenance: 'live' as const,
    transport: TRANSPORT,
    targetVerified: true,
    vehicleId: 'V1',
    ecuId: 'E1',
    fingerprintReusable: false,
    nowMs: T0 + 1_000,
    ...over,
  } as Parameters<typeof maybeRunSelfHealing>[1];
}

const IN = (over: Partial<HealingTriggerInput> = {}): HealingTriggerInput => ({
  trigger: 'AFTER_FULL_VEHICLE_SCAN',
  admission: 'READY',
  transactionLive: true,
  cancelled: false,
  staleEpoch: false,
  remainingRequests: 100,
  remainingTimeMs: 200_000,
  leaseAllows: null,
  ecuAddressProven: true,
  safeDefsAvailable: true,
  higherPriorityWorkPending: false,
  runsThisEpoch: 0,
  resolvableGaps: 3,
  ...over,
});

function seedGap(service = '19', sub = '02'): void {
  recordGap({
    signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
    context: `discovery:${service}${sub}`, atMs: T0,
  });
}

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetHealingTriggerForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _setTransactionClockForTest(() => T0);
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetHealingTriggerForTest();
  _resetCapabilityStoreForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ÜRETİM TETİĞİ GERÇEKTEN ÇALIŞIYOR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · uygun koşulda resolver GERÇEKTEN çağrılıyor', () => {
  it('tarama sonrası uygun koşulda ölçüm hatta çıkar', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const txn = liveScanTxn();

    const out = await maybeRunSelfHealing(txn, ctx());

    expect(out.decision.admission).toBe('RUN');
    expect(out.result).not.toBeNull();
    expect(sent.length).toBeGreaterThan(0);
    expect(getGapStates()[0].lifecycle).toBe('RESOLVED');
  });

  it('karar HER durumda kanıt defterine yazılır (sessiz "denenmedi" yok)', async () => {
    expect(healingTriggerEverEvaluated()).toBe(false);
    await maybeRunSelfHealing(liveScanTxn(), ctx({ admission: 'TRANSPORT_DOWN' }));
    expect(healingTriggerEverEvaluated()).toBe(true);
    expect(getLastHealingTrigger()?.decision).toBe('BLOCKED');
  });

  it('ölçüm AYNI işlemin bütçesinden harcanır (ikinci bütçe yok)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const txn = liveScanTxn();
    const before = txn.requestsUsed;

    await maybeRunSelfHealing(txn, ctx());

    expect(txn.requestsUsed).toBeGreaterThan(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) SIFIR PDU KOŞULLARI — hepsi ayrı ayrı
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · engelli koşullarda SIFIR PDU', () => {
  const zeroPdu = async (over: Record<string, unknown>, txnOver?: 'cancel' | 'complete' | 'null') => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    let txn: ReturnType<typeof liveScanTxn> | null = liveScanTxn();
    if (txnOver === 'cancel') cancelTransaction(txn, 'test');
    if (txnOver === 'complete') completeTransaction(txn);
    if (txnOver === 'null') txn = null;
    const out = await maybeRunSelfHealing(txn, ctx(over));
    expect(sent).toHaveLength(0);
    expect(out.result).toBeNull();
    return out;
  };

  it('bağlantı yok (admisyon TRANSPORT_DOWN) → 0 PDU', async () => {
    const o = await zeroPdu({ admission: 'TRANSPORT_DOWN' });
    expect(o.decision.admission).toBe('BLOCKED');
  });

  it('admisyon UNKNOWN → 0 PDU (fail-closed)', async () => {
    expect((await zeroPdu({ admission: 'UNKNOWN' })).decision.admission).toBe('BLOCKED');
  });

  it('işlem iptal edildi → 0 PDU', async () => {
    expect((await zeroPdu({}, 'cancel')).decision.admission).toBe('BLOCKED');
  });

  it('işlem terminal (tamamlandı) → 0 PDU', async () => {
    expect((await zeroPdu({}, 'complete')).decision.admission).toBe('BLOCKED');
  });

  it('işlem hiç yok → 0 PDU', async () => {
    expect((await zeroPdu({}, 'null')).decision.admission).toBe('BLOCKED');
  });

  it('oturum kirası reddediyor → 0 PDU', async () => {
    expect((await zeroPdu({ leaseAllows: false })).decision.admission).toBe('BLOCKED');
  });

  it('hedef ECU kanıtlı değil → 0 PDU (adres uydurulmaz)', async () => {
    expect((await zeroPdu({ ecu: null, ecuAddressProven: false })).decision.admission)
      .toBe('BLOCKED');
  });

  it('güvenli CDDL tanımı yok → 0 PDU (kör tarama yok)', async () => {
    expect((await zeroPdu({ defs: [] })).decision.admission).toBe('BLOCKED');
  });

  it('bayat epoch (mühür ölçülemedi) → 0 PDU', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const txn = liveScanTxn();
    txn.sessionEpoch = -1;
    const out = await maybeRunSelfHealing(txn, ctx());
    expect(sent).toHaveLength(0);
    expect(out.decision.admission).toBe('BLOCKED');
    expect(out.decision.reason).toContain('bayat epoch');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) BÜTÇE SAHİPLİĞİ ve ÖNCELİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · bütçe sahipliği: normal tanı aç bırakılmaz', () => {
  it('kalan istek rezervin ALTINDA → DEFERRED, 0 PDU', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const txn = liveScanTxn();
    /* Bütçeyi rezervin altına indir. */
    while (txn.requestBudget - txn.requestsUsed >= HEALING_MIN_RESERVE_REQUESTS) {
      if (!consumeRequest(txn)) break;
    }
    const out = await maybeRunSelfHealing(txn, ctx());
    expect(out.decision.admission).toBe('DEFERRED');
    expect(sent).toHaveLength(0);
  });

  it('kalan süre rezervin altında → DEFERRED', () => {
    const d = evaluateHealingTrigger(IN({ remainingTimeMs: HEALING_MIN_RESERVE_TIME_MS - 1 }));
    expect(d.admission).toBe('DEFERRED');
    expect(d.allocatedRequests).toBe(0);
  });

  it('pay kalanın oranıdır ve mutlak tavanı aşmaz', () => {
    /* Pay = min(mutlak tavan, floor(kalan × oran)); ayrıca pay tek bir boşluğun
       ölçümünü karşılamıyorsa tur HİÇ başlamaz (atomik ölçüm kuralı). */
    for (const rem of [40, 160, 400]) {
      const d = evaluateHealingTrigger(IN({ remainingRequests: rem }));
      expect(d.allocatedRequests).toBe(
        Math.min(HEALING_MAX_REQUESTS, Math.floor(rem * HEALING_BUDGET_SHARE)));
    }
    /* Büyük kalanlarda mutlak tavan BAĞLAYICIDIR (oran serbest bırakmaz). */
    expect(evaluateHealingTrigger(IN({ remainingRequests: 400 })).allocatedRequests)
      .toBe(HEALING_MAX_REQUESTS);
    /* Pay tek ölçümü karşılamıyorsa ERTELENİR — yarım ölçüm YAPILMAZ. */
    const tiny = evaluateHealingTrigger(IN({ remainingRequests: 28 }));
    expect(tiny.admission).toBe('DEFERRED');
    expect(tiny.allocatedRequests).toBe(0);
  });

  it('pay HİÇBİR ZAMAN kalan bütçenin tamamı olamaz', () => {
    for (const rem of [40, 50, 100, 160, 400]) {
      const d = evaluateHealingTrigger(IN({ remainingRequests: rem }));
      expect(d.allocatedRequests).toBeLessThan(rem);
    }
  });

  it('kullanılan istek ayrılan payı AŞMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    for (let i = 0; i < 12; i++) seedGap('19', String(i).padStart(2, '0'));
    const txn = liveScanTxn();
    const out = await maybeRunSelfHealing(txn, ctx());
    expect(out.decision.admission).toBe('RUN');
    expect(out.result!.requestsSpent).toBeLessThanOrEqual(out.decision.allocatedRequests);
  });

  it('daha yüksek öncelikli tanı işi varsa DEFERRED (0 PDU)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const out = await maybeRunSelfHealing(
      liveScanTxn(), ctx({ higherPriorityWorkPending: true }));
    expect(out.decision.admission).toBe('DEFERRED');
    expect(sent).toHaveLength(0);
  });

  it('çözülebilir boşluk yoksa DEFERRED — bu bir ÖLÇÜMDÜR', () => {
    const d = evaluateHealingTrigger(IN({ resolvableGaps: 0 }));
    expect(d.admission).toBe('DEFERRED');
    expect(d.reason).toContain('ÖLÇÜMDÜR');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ANTİ-STORM
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · trigger storm YOK', () => {
  it('aynı OBD oturumunda ikinci tetik ölçüm YAPMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const txn = liveScanTxn();

    const first = await maybeRunSelfHealing(txn, ctx());
    expect(first.decision.admission).toBe('RUN');
    const afterFirst = sent.length;

    const second = await maybeRunSelfHealing(txn, ctx());
    expect(second.decision.admission).toBe('DEFERRED');
    expect(second.result).toBeNull();
    expect(sent.length).toBe(afterFirst);
  });

  it('art arda beş tetik toplam istek sayısını ARTIRMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const txn = liveScanTxn();
    await maybeRunSelfHealing(txn, ctx());
    const baseline = sent.length;
    for (let i = 0; i < 5; i++) await maybeRunSelfHealing(txn, ctx());
    expect(sent.length).toBe(baseline);
  });

  it('tur tavanı sabiti küçük ve açık', () => {
    expect(MAX_HEALING_RUNS_PER_EPOCH).toBe(1);
    expect(evaluateHealingTrigger(IN({ runsThisEpoch: MAX_HEALING_RUNS_PER_EPOCH })).admission)
      .toBe('DEFERRED');
  });

  it('tur sayacı OTURUM MÜHRÜNE göre tutulur (yeni bağlantı = yeni bağlam)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    await maybeRunSelfHealing(liveScanTxn(), ctx());

    /* Koşulan tur YALNIZ kendi mührüne yazılır; başka bir oturum mührü için
       sayaç `0`dır → yeniden bağlanma sonrası iyileştirme tekrar çalışabilir.
       (Mühür sahteleştirilmez; defterin epoch-anahtarlı olduğu kilitlenir.) */
    expect(getHealingRunsForEpoch(TEST_EPOCH)).toBe(1);
    expect(getHealingRunsForEpoch(TEST_EPOCH + 1)).toBe(0);
    expect(evaluateHealingTrigger(IN({ runsThisEpoch: 0 })).admission).toBe('RUN');
  });

  it('ölçüm düşse bile aynı epoch\'ta ikinci tur başlamaz (fail-closed sayaç)', async () => {
    bridge(() => { throw new Error('köprü patladı'); });
    seedGap();
    const txn = liveScanTxn();
    await maybeRunSelfHealing(txn, ctx());
    const out2 = await maybeRunSelfHealing(txn, ctx());
    expect(out2.decision.admission).toBe('DEFERRED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) GÜVENLİK — üretim tetiği güvenliği GEVŞETEMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · güvenlik zinciri gevşemiyor', () => {
  it('destructive servis boşluğu üretim tetiğinden de 0 PDU üretir', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'AA' }));
    for (const svc of DESTRUCTIVE_SERVICES) {
      recordGap({ signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
        context: `discovery:${svc}`, atMs: T0 });
    }
    const out = await maybeRunSelfHealing(liveScanTxn(), ctx());
    /* Karar RUN olabilir (boşluk var) ama hedefe uyan güvenli tanım YOK →
       hiçbir yoklama hatta çıkmaz. */
    expect(sent).toHaveLength(0);
    expect(out.result?.measured ?? 0).toBe(0);
  });

  it('hedef seçici rolü ÖLÇÜLMEMİŞ ECU\'yu reddeder (rol uydurulmaz)', () => {
    expect(healingTargetFromProvenEcu({
      txHeader: '7E0', rxHeader: '7E8', addressBits: 11,
      role: 'unknown', label: 'ECU', probeOutcome: 'responded',
    }, ['uds_read_dtc_information'])).toBeNull();
  });

  it('hedef seçici CEVAP VERMEMİŞ ECU\'yu reddeder', () => {
    expect(healingTargetFromProvenEcu({
      txHeader: '7E0', rxHeader: '7E8', addressBits: 11,
      role: 'engine', label: 'ECM', probeOutcome: 'no_response',
    }, ['uds_read_dtc_information'])).toBeNull();
  });

  it('hedef seçici tx adresi ÖLÇÜLMEMİŞ ECU\'yu reddeder', () => {
    expect(healingTargetFromProvenEcu({
      txHeader: '', rxHeader: '7E8', addressBits: 11,
      role: 'engine', label: 'ECM', probeOutcome: 'responded',
    }, ['uds_read_dtc_information'])).toBeNull();
  });

  it('KWP hedef baytı DOĞRULANMADIYSA UNKNOWN kalır (yanlış modül uyandırılmaz)', () => {
    const t = healingTargetFromProvenEcu({
      txHeader: '10', rxHeader: '486B10', addressBits: 8,
      role: 'engine', label: 'ECM', probeOutcome: 'responded',
      kwpTargetVerified: false,
    }, ['kwp_read_dtc_13']);
    expect(t?.kwpTarget).toBe('UNKNOWN');
  });

  it('ölçülmüş ECU geçerli hedef üretir', () => {
    const t = healingTargetFromProvenEcu({
      txHeader: '7E0', rxHeader: '7E8', addressBits: 11,
      role: 'engine', label: 'ECM', probeOutcome: 'responded',
      discoverySource: 'functional_0100',
    }, ['uds_read_dtc_information']);
    expect(t).not.toBeNull();
    expect(t?.txHeader).toBe('7E0');
    expect(t?.addressing).toBe('physical');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) ÖĞRENME KURALLARI KORUNUYOR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · öğrenme kuralları bozulmuyor', () => {
  it('replay kaynağı üretim tetiğinden de RESOLVED üretemez', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const out = await maybeRunSelfHealing(liveScanTxn(), ctx({ provenance: 'replay' }));
    expect(out.decision.admission).toBe('RUN');
    expect(out.result?.resolved).toBe(0);
    expect(getGapStates()[0].lifecycle).not.toBe('RESOLVED');
  });

  it('synthetic kaynağı da RESOLVED üretemez', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const out = await maybeRunSelfHealing(liveScanTxn(), ctx({ provenance: 'synthetic' }));
    expect(out.result?.resolved).toBe(0);
  });

  it('UNKNOWN/timeout ölçümü ABSENT/RESOLVED üretemez', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    seedGap();
    const out = await maybeRunSelfHealing(liveScanTxn(), ctx());
    expect(out.result?.resolved).toBe(0);
    expect(getGapStates()[0].lifecycle).not.toBe('RESOLVED');
  });

  it('CANLI başarı RESOLVED üretebilir', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    const out = await maybeRunSelfHealing(liveScanTxn(), ctx());
    expect(out.result?.resolved).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) KANIT DEFTERİ (LAB girdisi)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B · tetik kanıtı', () => {
  it('hiç tetiklenmediyse defter BOŞ (0 değil, kayıt yok)', () => {
    expect(getHealingTriggerEvidence()).toHaveLength(0);
    expect(getLastHealingTrigger()).toBeNull();
    expect(healingTriggerEverEvaluated()).toBe(false);
  });

  it('çalışan tur ayrılan/kullanılan bütçeyi ve sonucu taşır', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedGap();
    await maybeRunSelfHealing(liveScanTxn(), ctx());
    const e = getLastHealingTrigger()!;
    expect(e.decision).toBe('RUN');
    expect(e.allocatedRequests).toBeGreaterThan(0);
    expect(e.usedRequests).not.toBeNull();
    expect(e.resolvedGaps).toBe(1);
    expect(e.sessionEpoch).toBe(TEST_EPOCH);
    expect(e.atMs).toBe(T0 + 1_000);
  });

  it('ertelenen turda kullanılan istek NULL kalır (sahte 0 yok)', async () => {
    await maybeRunSelfHealing(liveScanTxn(), ctx({ higherPriorityWorkPending: true }));
    const e = getLastHealingTrigger()!;
    expect(e.decision).toBe('DEFERRED');
    expect(e.usedRequests).toBeNull();
    expect(e.resolvedGaps).toBeNull();
  });

  it('defter tavanlıdır (sızıntı yok)', async () => {
    for (let i = 0; i < 40; i++) {
      await maybeRunSelfHealing(liveScanTxn(), ctx({ admission: 'TRANSPORT_DOWN' }));
    }
    expect(getHealingTriggerEvidence().length).toBeLessThanOrEqual(20);
  });
});
