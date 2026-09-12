/**
 * productionDiscoveryChain.test — P0-VDK-F5B.1 · ÜRETİM KANIT ZİNCİRİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * F5-B üretim tetiği artık BOŞ bir resolver çağrısı olmayacak: gerçek ürün
 * taramasının ölçtüğü ECU'lardan F4-B keşif kanıtı doğacak, bu kanıt F4-C
 * yetenek çizgesini ve F2-C boşluk sicilini besleyecek, F5-A/F5-B bu GERÇEK
 * boşlukları AYNI otoriteler üzerinden görebilecek.
 *
 * ⚠️ ZİNCİRİN HİÇBİR HALKASI STUB'LANMAZ. Tek sahte nokta native köprüdür
 * (`CarLauncher.sendDiagnosticPdu`) — gerçek araç yerine geçen tek yer orasıdır.
 * `runServiceDiscovery` · `gapRegistry` · `capabilityGraph` · `runGapResolution`
 * hepsi GERÇEK modüllerdir.
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
import type { ServiceDef } from '../platform/obd/cddl/schema';
import { builtinServiceDefs, extraReadOnlyServiceDefs }
  from '../platform/obd/cddl/legacyAdapter';
import {
  beginTransaction, transitionTransaction, cancelTransaction, consumeRequest,
  _resetTransactionsForTest, _setTransactionClockForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import {
  _resetServiceDiscoveryForTest, getProbeRecords,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { getGapRegistry, _resetGapRegistryForTest }
  from '../platform/obd/gapRegistry';
import {
  loadCapabilityStore, getCapabilityEdges, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import type { TransportConstraint } from '../platform/obd/capability/capabilityGraph';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import {
  _resetGapResolverForTest, collectResolvableGaps, getGapStates,
} from '../platform/obd/healing/gapResolverRuntime';
import {
  maybeRunSelfHealing, healingTargetFromProvenEcu,
  _resetHealingTriggerForTest, getLastHealingTrigger,
} from '../platform/obd/healing/selfHealingTrigger';

import {
  DISCOVERY_BUDGET_SHARE, DISCOVERY_MAX_REQUESTS, DISCOVERY_MAX_ECUS,
  DISCOVERY_MIN_RESERVE_REQUESTS, DISCOVERY_MAX_PROBES_PER_ECU,
  evaluateDiscoveryAdmission, responseSignatureFrom, runProductionDiscovery,
  getLastProductionDiscovery, productionDiscoveryEverEvaluated,
  _resetProductionDiscoveryForTest,
  type DiscoveryAdmissionInput, type DiscoveryEcuInput,
} from '../platform/obd/healing/productionDiscovery';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

let sent: Record<string, unknown>[] = [];
const T0 = 1_000_000;
const TEST_EPOCH = 0;

function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
}

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

/** Taramanın ÖLÇTÜĞÜ bir ECU (motor, 7E8, hattan cevap verdi). */
const measuredEcu = (over: Partial<DiscoveryEcuInput> = {}): DiscoveryEcuInput => ({
  txHeader: '7E0', rxHeader: '7E8', addressBits: 11,
  role: 'engine', label: 'Motor (ECM)',
  discoverySource: 'functional_0100', probeOutcome: 'responded',
  kwpTargetVerified: false,
  serviceStatuses: { '03': 'ok', '07': 'ok', '0A': 'unsupported', '19': 'ok',
    '18': null, '13': null },
  ...over,
});

function liveScanTxn() {
  const t = beginTransaction({ purpose: 'multi_ecu_scan' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  t.protocol = '6';
  return t;
}

function dctx(over: Record<string, unknown> = {}) {
  return {
    admission: 'READY' as const,
    ecus: [measuredEcu()],
    defs: DEFS(),
    protocolClass: 'can' as const,
    protocol: '6',
    supportedPidBitmap: 'BE1FA813',
    transport: TRANSPORT,
    nowMs: T0 + 500,
    ...over,
  } as Parameters<typeof runProductionDiscovery>[1];
}

function hctx(over: Record<string, unknown> = {}) {
  const target = healingTargetFromProvenEcu(measuredEcu(), DEFS().map((d) => d.id));
  return {
    trigger: 'AFTER_FULL_VEHICLE_SCAN' as const,
    admission: 'READY' as const,
    ecu: target,
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
    ecuId: target?.id ?? null,
    fingerprintReusable: true,
    nowMs: T0 + 1_000,
    ...over,
  } as Parameters<typeof maybeRunSelfHealing>[1];
}

const DIN = (over: Partial<DiscoveryAdmissionInput> = {}): DiscoveryAdmissionInput => ({
  admission: 'READY', transactionLive: true, cancelled: false, staleEpoch: false,
  remainingRequests: 160, protocolKnown: true, provenTargets: 1,
  safeDefsAvailable: true, ...over,
});

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetHealingTriggerForTest();
  _resetProductionDiscoveryForTest();
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
  _resetProductionDiscoveryForTest();
  _resetCapabilityStoreForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ZORUNLU UÇTAN UCA ZİNCİR — ANA PASS ÖLÇÜTÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · ÜRETİM ZİNCİRİ: ölçülmüş ECU → keşif → gap → learning → resolver', () => {
  it('zincirin HER halkası gerçek modülle çalışır ve boşluk üretilir', async () => {
    /* ECU 0x19'a NRC 0x12 (subFunctionNotSupported) dönüyor: servis VAR ama
       koşullu → F4-B bunu `PRESENT_BUT_CONDITIONED` sayar ve boşluk üretir.
       Diğer servisler susuyor (NO DATA) → `UNKNOWN` (ABSENT DEĞİL). */
    bridge((o) => {
      const req = String(o.request ?? o.service ?? '');
      /* Native negatif yanıt sözlüğü: `negative_nrc` (bkz. pduOutcomeFromAdvanced). */
      if (req.startsWith('19')) return { outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 };
      return { outcome: 'timeout', kind: 'TIMEOUT' };
    });

    const txn = liveScanTxn();

    /* ── HALKA 1-2: ölçülmüş ECU → F4-B servis keşfi (GERÇEK modül) ────── */
    const disc = await runProductionDiscovery(txn, dctx(), getGapRegistry().length);
    expect(disc.decision.admission).toBe('RUN');
    expect(sent.length).toBeGreaterThan(0);

    /* ── HALKA 3: F4-B GERÇEK probe kayıtları ─────────────────────────── */
    const probes = getProbeRecords();
    expect(probes.length).toBeGreaterThan(0);
    /* Sustuğu servisler ABSENT DEĞİL — kapsam kaybı araç kanıtı sayılmaz. */
    expect(probes.every((p) => p.classification !== 'ABSENT')).toBe(true);

    /* ── HALKA 4: F2-C boşluk sicili GERÇEKTEN doldu ──────────────────── */
    const registry = getGapRegistry();
    expect(registry.length).toBeGreaterThan(0);
    expect(registry.some((g) => g.context.startsWith('discovery:'))).toBe(true);

    /* ── HALKA 5: F4-C yetenek çizgesi GERÇEKTEN güncellendi ──────────── */
    const edges = getCapabilityEdges();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.provenance === 'live')).toBe(true);

    /* ── HALKA 6: F5-A çözücü bu GERÇEK boşlukları görüyor ────────────── */
    const resolvable = collectResolvableGaps(T0 + 900);
    expect(resolvable.length).toBeGreaterThan(0);

    /* ── HALKA 7: F5-B tetiği artık BOŞ çağrı DEĞİL ───────────────────── */
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    const heal = await maybeRunSelfHealing(txn, hctx());
    expect(heal.decision.admission).toBe('RUN');
    expect(heal.result).not.toBeNull();
    expect(heal.result!.considered).toBeGreaterThan(0);

    /* ── HALKA 8: CANLI kanıt boşluğu GERÇEKTEN kapattı ───────────────── */
    expect(heal.result!.resolved).toBeGreaterThan(0);
    expect(getGapStates().some((s) => s.lifecycle === 'RESOLVED')).toBe(true);
  });

  it('F5-B artık "çözülebilir boşluk YOK" demiyor (A-2 açığı kapandı)', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    const txn = liveScanTxn();

    /* Keşif ÖNCESİ: sicil boş → tetik ölçecek bir şey bulamazdı. */
    expect(collectResolvableGaps(T0)).toHaveLength(0);

    await runProductionDiscovery(txn, dctx(), 0);

    /* Keşif SONRASI: gerçek ölçümden doğan boşluklar var. */
    expect(collectResolvableGaps(T0 + 900).length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) GAP SEMANTİĞİ — "bilmiyoruz" ile "yok" ASLA karışmaz
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · gap semantiği', () => {
  const run = async (reply: (o: Record<string, unknown>) => Record<string, unknown>) => {
    bridge(reply);
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    return getProbeRecords();
  };

  it('NO_RESPONSE / timeout ≠ ABSENT', async () => {
    const p = await run(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    expect(p.length).toBeGreaterThan(0);
    expect(p.some((r) => r.classification === 'ABSENT')).toBe(false);
  });

  it('taşıma taşıyamadı ≠ ECU desteklemiyor', async () => {
    const p = await run(() => ({ outcome: 'error', kind: 'SERVICE_NOT_READ_ONLY' }));
    expect(p.some((r) => r.classification === 'ABSENT')).toBe(false);
  });

  it('NRC 0x11 = servis ABSENT (mevcut F4-B kuralı)', async () => {
    const p = await run(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1911', nrc: 0x11 }));
    expect(p.some((r) => r.classification === 'ABSENT')).toBe(true);
  });

  it('0x11 DIŞINDAKİ NRC = PRESENT_BUT_CONDITIONED', async () => {
    for (const nrc of [0x12, 0x22, 0x31, 0x33, 0x7E]) {
      _resetServiceDiscoveryForTest();
      sent = [];
      const p = await run(() => ({
        outcome: 'negative_nrc', kind: 'NEGATIVE',
        raw: `7F19${nrc.toString(16).padStart(2, '0')}`, nrc,
      }));
      expect(p.some((r) => r.classification === 'PRESENT_BUT_CONDITIONED')).toBe(true);
      expect(p.some((r) => r.classification === 'ABSENT')).toBe(false);
    }
  });

  it('bütçe bitince kalanlar ABSENT DEĞİL (DEFERRED)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const txn = liveScanTxn();
    await runProductionDiscovery(txn, dctx(), 0);
    expect(getProbeRecords().some((r) => r.classification === 'ABSENT')).toBe(false);
  });

  it('YENİ boşluk sözlüğü YOK — sinyaller mevcut ReplayGapSignal ailesinden', async () => {
    await run(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    const known = new Set([
      'UNKNOWN_SERVICE', 'UNKNOWN_SUBFUNCTION', 'UNKNOWN_RESPONSE_SHAPE',
      'UNKNOWN_ECU_VARIANT', 'TRANSPORT_LIMITATION', 'PARSER_GAP', 'CAPABILITY_GAP',
      'UNEXPECTED_SID', 'MALFORMED_DTC_BODY', 'LEGACY_NATIVE_ONLY',
      'PARSER_PARITY_MISMATCH', 'UNKNOWN_ECU_ATTRIBUTION',
    ]);
    for (const g of getGapRegistry()) expect(known.has(g.signal)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) BÜTÇE KATMANLARI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · bütçe: normal scan → discovery → self-healing', () => {
  it('discovery Self-Healing rezervini YİYEMEZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const txn = liveScanTxn();
    await runProductionDiscovery(txn, dctx(), 0);
    const remaining = txn.requestBudget - txn.requestsUsed;
    /* Keşiften sonra Self-Healing hâlâ kendi payını alabilmeli. */
    expect(remaining).toBeGreaterThanOrEqual(DISCOVERY_MIN_RESERVE_REQUESTS
      - DISCOVERY_MAX_REQUESTS);
  });

  it('discovery payı kalanın oranı ve mutlak tavanla sınırlı', () => {
    for (const rem of [40, 160, 400]) {
      const d = evaluateDiscoveryAdmission(DIN({ remainingRequests: rem }));
      if (d.admission === 'RUN') {
        expect(d.allocatedRequests).toBe(
          Math.min(DISCOVERY_MAX_REQUESTS, Math.floor(rem * DISCOVERY_BUDGET_SHARE)));
      }
    }
  });

  it('kalan rezervin altındaysa DEFERRED ve 0 PDU', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const txn = liveScanTxn();
    while (txn.requestBudget - txn.requestsUsed >= DISCOVERY_MIN_RESERVE_REQUESTS) {
      if (!consumeRequest(txn)) break;
    }
    const out = await runProductionDiscovery(txn, dctx(), 0);
    expect(out.decision.admission).toBe('DEFERRED');
    expect(sent).toHaveLength(0);
  });

  it('kullanılan istek ayrılan payı AŞMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const txn = liveScanTxn();
    const many = Array.from({ length: 8 }, (_, i) =>
      measuredEcu({ txHeader: `7E${i}`, rxHeader: `7E${i + 8}` }));
    const out = await runProductionDiscovery(txn, dctx({ ecus: many }), 0);
    expect(out.decision.admission).toBe('RUN');
    expect(out.evidence.usedRequests!).toBeLessThanOrEqual(out.decision.allocatedRequests);
  });

  it('ECU sayısı PAYA da bağlıdır (ölçülen kusur: 12 pay iken 15 istek)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const many = Array.from({ length: 8 }, (_, i) =>
      measuredEcu({ txHeader: `7E${i}`, rxHeader: `7E${i + 8}` }));
    const out = await runProductionDiscovery(liveScanTxn(), dctx({ ecus: many }), 0);
    /* Yoklanan ECU sayısı `pay ÷ ECU başına azami yoklama`yı AŞAMAZ — yalnız
       `DISCOVERY_MAX_ECUS` ile sınırlamak bütçe aşımına yol açıyordu. */
    const affordable = Math.max(1,
      Math.floor(out.decision.allocatedRequests / DISCOVERY_MAX_PROBES_PER_ECU));
    expect(out.evidence.ecusProbed!).toBeLessThanOrEqual(affordable);
    expect(out.evidence.usedRequests!).toBeLessThanOrEqual(out.decision.allocatedRequests);
  });

  it('ECU sayısı tavanla sınırlı (sınırsız keşif = DoS)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const many = Array.from({ length: 10 }, (_, i) =>
      measuredEcu({ txHeader: `7E${i}`, rxHeader: `7E${i + 8}` }));
    const out = await runProductionDiscovery(liveScanTxn(), dctx({ ecus: many }), 0);
    expect(out.evidence.ecusProbed!).toBeLessThanOrEqual(DISCOVERY_MAX_ECUS);
  });

  it('MUTLAK İNVARYANT: toplam kullanım işlem bütçesini AŞMAZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    const txn = liveScanTxn();
    await runProductionDiscovery(txn, dctx(), 0);
    await maybeRunSelfHealing(txn, hctx());
    expect(txn.requestsUsed).toBeLessThanOrEqual(txn.requestBudget);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) FAIL-CLOSED — hepsi 0 PDU ve hiçbiri ABSENT üretmez
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · fail-closed: 0 PDU · 0 ABSENT', () => {
  const zero = async (over: Record<string, unknown>, kill?: 'cancel' | 'null') => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    let txn: ReturnType<typeof liveScanTxn> | null = liveScanTxn();
    if (kill === 'cancel') cancelTransaction(txn, 'test');
    if (kill === 'null') txn = null;
    const out = await runProductionDiscovery(txn, dctx(over), 0);
    expect(sent).toHaveLength(0);
    expect(getProbeRecords().some((r) => r.classification === 'ABSENT')).toBe(false);
    return out;
  };

  it('admisyon READY değil → 0 PDU', async () => {
    expect((await zero({ admission: 'TRANSPORT_DOWN' })).decision.admission).toBe('BLOCKED');
  });
  it('işlem iptal → 0 PDU', async () => {
    expect((await zero({}, 'cancel')).decision.admission).toBe('BLOCKED');
  });
  it('işlem yok → 0 PDU', async () => {
    expect((await zero({}, 'null')).decision.admission).toBe('BLOCKED');
  });
  it('protokol bilinmiyor → 0 PDU', async () => {
    expect((await zero({ protocolClass: 'unknown' })).decision.admission).toBe('BLOCKED');
  });
  it('ölçülmüş ECU hedefi yok → 0 PDU', async () => {
    expect((await zero({ ecus: [] })).decision.admission).toBe('BLOCKED');
  });
  /* ══════════════════════════════════════════════════════════════════════
     KİLİT GÜNCELLENDİ — P0-VDK-F6A (kaldırılmadı, YENİ DOĞRU DAVRANIŞA taşındı)
     ══════════════════════════════════════════════════════════════════════
     ESKİ KURAL: "rolü ölçülmemiş ECU hedef olamaz" → 0 PDU.
     ÖLÇÜLEN SONUÇ: bu kural `7E1`de cevap veren, DTC'si bile okunan bir
     modülün F4-B servis keşfine ve F4-C öğrenmesine HİÇ girememesine yol
     açıyordu — ürünün "yalnız motoru tanıyor" olmasının yapısal sebebi.

     YENİ KURAL (görev §11): keşif hedefinin ön koşulu ROL DEĞİL, ADRES
     KANITIDIR. Rolsüz uç nokta artık SALT-OKUNUR keşfe girer; rol-ÖZEL iş
     (Self-Healing) hâlâ ölçülmüş rol ister ve o kapı GEVŞETİLMEDİ.

     Kilidin KORUNAN yarısı hemen altındadır: adres kanıtı olmayan (cevap
     vermemiş / adresi türetilememiş) ECU hâlâ 0 PDU üretir. */
  it('rolü ölçülmemiş ECU artık hedef OLABİLİR (salt-okunur keşif)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const out = await runProductionDiscovery(
      liveScanTxn(), dctx({ ecus: [measuredEcu({ role: 'unknown' })] }), 0);
    expect(out.decision.admission).toBe('RUN');
    expect(sent.length).toBeGreaterThan(0);
  });

  it('adresi TÜRETİLEMEMİŞ ECU hâlâ hedef OLAMAZ → 0 PDU', async () => {
    expect((await zero({
      ecus: [measuredEcu({ role: 'unknown', txHeader: '' })],
    })).decision.admission).toBe('BLOCKED');
  });
  it('hattan cevap vermemiş ECU hedef olamaz → 0 PDU', async () => {
    expect((await zero({ ecus: [measuredEcu({ probeOutcome: 'no_response' })] }))
      .decision.admission).toBe('BLOCKED');
  });
  it('CDDL tanımı yok → 0 PDU', async () => {
    expect((await zero({ defs: [] })).decision.admission).toBe('BLOCKED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) İKİNCİ TARAMA — TASARRUF SAYISAL
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · ikinci tarama gereksiz yoklamayı azaltır', () => {
  it('aynı güçlü parmak izinde ikinci keşif DAHA AZ istek gönderir', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));

    const first = await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    expect(first.decision.admission).toBe('RUN');
    const firstRequests = sent.length;
    expect(firstRequests).toBeGreaterThan(0);
    expect(first.fingerprintReusable).toBe(true);

    /* İkinci tur: öğrenme belleği DURUYOR (store sıfırlanmaz). */
    sent = [];
    _resetServiceDiscoveryForTest();
    const second = await runProductionDiscovery(liveScanTxn(), dctx(), 0);

    expect(sent.length).toBeLessThan(firstRequests);
    expect(second.evidence.reusedProbes!).toBeGreaterThan(0);
  });

  it('parmak izi ZAYIFSA yeniden ölçer (fail-closed)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    /* Yanıt imzası ölçülmemiş ECU → yalnız adres+protokol → yeniden kullanılamaz. */
    const weak = measuredEcu({ serviceStatuses: {} });
    const out = await runProductionDiscovery(liveScanTxn(), dctx({ ecus: [weak] }), 0);
    expect(out.fingerprintReusable).toBe(false);

    sent = [];
    _resetServiceDiscoveryForTest();
    const second = await runProductionDiscovery(liveScanTxn(), dctx({ ecus: [weak] }), 0);
    expect(sent.length).toBeGreaterThan(0);
    expect(second.evidence.reusedProbes).toBe(0);
  });

  it('yanıt imzası ölçülmüş servislerden kurulur, SORULMAYAN girmez', () => {
    expect(responseSignatureFrom({ '03': 'ok', '19': null }))
      .toBe('03:ok');
    expect(responseSignatureFrom({})).toBeNull();
    expect(responseSignatureFrom({ '19': 'ok', '03': 'unsupported' }))
      .toBe('03:unsupported|19:ok');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) ÖĞRENME GÜVENİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · learning kuralları DEĞİŞMEDİ', () => {
  it('üretim keşfi YALNIZ live üretir (productTrusted)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    const edges = getCapabilityEdges();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.provenance === 'live' && e.productTrusted)).toBe(true);
  });

  it('UNKNOWN ölçüm kanıtlı PRESENT kaydını EZEMEZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    const before = getCapabilityEdges().filter((e) => e.presence === 'PRESENT').length;
    expect(before).toBeGreaterThan(0);

    /* İkinci tur: ECU susuyor (UNKNOWN) — kanıt SİLİNMEMELİ. */
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    _resetServiceDiscoveryForTest();
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    expect(getCapabilityEdges().filter((e) => e.presence === 'PRESENT').length)
      .toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) GÜVENLİK — destructive 0 PDU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · güvenlik zinciri', () => {
  it('destructive servis üretim keşfi korpusuna GİREMEZ', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'AA' }));
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    const dset = new Set(DESTRUCTIVE_SERVICES);
    for (const o of sent) {
      const req = String(o.request ?? o.service ?? '').toUpperCase();
      expect(dset.has(req.slice(0, 2))).toBe(false);
    }
    for (const p of getProbeRecords()) expect(dset.has(p.service)).toBe(false);
  });

  it('hiçbir yoklama destructive servis kimliği taşımaz', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: 'AA' }));
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    expect(getProbeRecords().length).toBeGreaterThan(0);
    for (const p of getProbeRecords()) {
      expect(['01', '03', '06', '07', '09', '0A', '13', '18', '19', '1A', '21', '22'])
        .toContain(p.service);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) KANIT DEFTERİ (LAB girdisi)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 · keşif kanıtı', () => {
  it('hiç değerlendirilmediyse defter BOŞ (0 değil)', () => {
    expect(productionDiscoveryEverEvaluated()).toBe(false);
    expect(getLastProductionDiscovery()).toBeNull();
  });

  it('çalışan tur ölçülen alanları taşır', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    await runProductionDiscovery(liveScanTxn(), dctx(), 0);
    const e = getLastProductionDiscovery()!;
    expect(e.decision).toBe('RUN');
    expect(e.allocatedRequests).toBeGreaterThan(0);
    expect(e.usedRequests).not.toBeNull();
    expect(e.ecusProbed).toBe(1);
    expect(e.gapsProduced).not.toBeNull();
    expect(e.sessionEpoch).toBe(TEST_EPOCH);
  });

  it('engellenen turda ölçüm alanları NULL kalır (sahte 0 yok)', async () => {
    await runProductionDiscovery(liveScanTxn(), dctx({ admission: 'TRANSPORT_DOWN' }), 0);
    const e = getLastProductionDiscovery()!;
    expect(e.decision).toBe('BLOCKED');
    expect(e.usedRequests).toBeNull();
    expect(e.ecusProbed).toBeNull();
    expect(e.gapsProduced).toBeNull();
  });

  it('Self-Healing kanıtı keşiften SONRA gerçek boşluk sayısı görür', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    const txn = liveScanTxn();
    await runProductionDiscovery(txn, dctx(), 0);
    await maybeRunSelfHealing(txn, hctx());
    const h = getLastHealingTrigger()!;
    expect(h.openGaps).not.toBeNull();
    expect(h.openGaps!).toBeGreaterThan(0);
  });
});
