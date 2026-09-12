/**
 * discoveryProtocolReuseIsolation.test.ts — P0-VDK-F6E-2.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN KUSUR ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F6E-1 `decideReuse`a protokol kapısını ekledi, ama F4-B keşif yolu
 * (`serviceDiscoveryRuntime._learnedEdge`) `ReuseContext.protocol` alanını
 * **BİLDİRMİYORDU** → `ctx.protocol === undefined` → kapı **uygulanmıyordu**.
 *
 * Sonuç: `edgeKey` protokol içermediği için CAN'de öğrenilmiş bir kenar,
 * KWP keşfinde `REUSE` üretip yoklamayı **atlayabiliyordu** (ve tersi).
 *
 * Bu dosya kapının keşif yolunda GERÇEKTEN kapandığını **uçtan uca**
 * (`runServiceDiscovery` + gerçek depo + gerçek köprü sayacı) kanıtlar.
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
import {
  runServiceDiscovery, _resetServiceDiscoveryForTest,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  loadCapabilityStore, getCapabilityEdge, getCapabilityEdges,
  getSavedRequestCount, getReusedProbeCount, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import {
  CAPABILITY_FRESH_MS, decideReuse,
  type TransportConstraint,
} from '../platform/obd/capability/capabilityGraph';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import {
  MAX_ATTEMPTS_PER_TRIPLE, MAX_ATTEMPTS_PER_GAP,
} from '../platform/obd/healing/resolutionPolicy';
import { learnableCoveragePresence } from '../platform/obd/capability/coverageLearning';

const T0 = 1_000_000;
const CAN = '6';
const KWP = '5';
const VEH_A = 'veh-A';
const VEH_B = 'veh-B';
const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

let sent: Record<string, unknown>[] = [];

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

function ecu(refs: string[]): EcuVariant {
  return {
    id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
    addressing: 'physical', session: 'default', serviceRefs: refs,
    patternRefs: [], comParamRefs: [],
    provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
  } as unknown as EcuVariant;
}
const UDS_ECU = () => ecu(['uds_read_dtc_information', 'uds_report_supported_dtc']);

function liveTxn() {
  const t = beginTransaction({ purpose: 'ecu_probe' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  return t;
}

/** Hattı açar ve GÖNDERİLEN her PDU'yu sayar (istek sayısı kilidi için). */
function bridge(): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => {
      sent.push(o);
      return { outcome: 'ok', kind: 'OK', raw: 'FFAA' };
    });
}

async function run(over: Record<string, unknown> = {}) {
  return runServiceDiscovery({
    defs: DEFS(), ecu: UDS_ECU(), protocolClass: 'can', protocol: CAN,
    txn: liveTxn(), ecuKey: 'ECM@7E0', sessionEpoch: 7, nowMs: T0,
    probeSubFunctions: false,
    vehicleId: VEH_A, ecuId: 'E1', fingerprintReusable: true,
    provenance: 'live', transport: TRANSPORT,
    ...over,
  } as Parameters<typeof runServiceDiscovery>[0]);
}

/** İkinci koşu için ortamı tazeler (depo KORUNUR — öğrenme yaşamalı). */
function freshRun(): void {
  sent = [];
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
}

beforeEach(() => {
  sent = [];
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
  bridge();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ROOT CAUSE KANITI — kenar protokolü GERÇEKTEN ölçümden geliyor
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-2 · root cause kanıtı', () => {
  it('🔒 KANIT: F4-B kenarı `edge.protocol`u ÖLÇÜMDEN yazar', async () => {
    await run({ protocol: CAN });
    const e = getCapabilityEdge(VEH_A, 'E1', '19', '02');
    expect(e).not.toBeNull();
    expect(e!.protocol).toBe(CAN);
    /* Aynı kenar KWP bağlamında reuse ÜRETMEZ — kapı artık burada. */
    expect(decideReuse(e!, {
      nowMs: T0 + 1000, fingerprintReusable: true, transport: TRANSPORT,
      protocol: KWP,
    })).toBe('PROTOCOL_CHANGED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) PROTOKOL İZOLASYONU — UÇTAN UCA
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-2 · keşif reuse protokol izolasyonu', () => {
  it('🔒 KİLİT (1): CAN kenar + CAN keşif → REUSE MÜMKÜN (0 istek)', async () => {
    const first = await run({ protocol: CAN });
    expect(first.probesSent).toBe(2);
    const firstRequests = sent.length;
    expect(firstRequests).toBeGreaterThan(0);

    freshRun();
    const second = await run({ protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.probesSent).toBe(0);
    expect(second.reused).toBe(2);
    expect(sent).toHaveLength(0);
    expect(second.records.every((r) => r.reuseDecision === 'REUSE')).toBe(true);
  });

  it('🔒 KİLİT (2): CAN kenar + KWP keşif → REUSE YOK (yeniden ölçer)', async () => {
    await run({ protocol: CAN });
    freshRun();

    const second = await run({ protocol: KWP, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);          // gerçekten ÖLÇTÜ
    expect(sent.length).toBeGreaterThan(0);
    expect(second.records.every((r) => r.reusedFromLearning !== true)).toBe(true);
  });

  it('🔒 KİLİT (3): KWP kenar + CAN keşif → REUSE YOK', async () => {
    await run({ protocol: KWP, protocolClass: 'kwp' });
    freshRun();

    const second = await run({ protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (4): protokolsüz ESKİ kenar → REUSE YOK', async () => {
    /* Protokol bildirilmeden ölçülen kenarın `protocol`ü `null` olur. */
    await run({ protocol: null });
    const e = getCapabilityEdge(VEH_A, 'E1', '19', '02');
    expect(e!.protocol).toBeNull();

    freshRun();
    const second = await run({ protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (5): ŞU ANKİ protokol bilinmiyorsa FAIL-CLOSED → ölç', async () => {
    await run({ protocol: CAN });
    freshRun();

    const second = await run({ protocol: null, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT: `protocol` alanı HİÇ verilmezse de kapı BYPASS EDİLMEZ', async () => {
    /* Çağıran alanı atlarsa `input.protocol ?? null` → `null` → fail-closed.
       `undefined` geçirip kapıyı sessizce atlamak YASAK. */
    await run({ protocol: CAN });
    freshRun();
    const second = await run({ protocol: undefined, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (15): istek sayısı YALNIZ yanlış çapraz-protokol atlamayı kaldırır', async () => {
    /* Aynı protokolde tasarruf AYNEN korunur… */
    await run({ protocol: CAN });
    freshRun();
    await run({ protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000 });
    const sameProtocolRequests = sent.length;
    expect(sameProtocolRequests).toBe(0);

    /* …çapraz protokolde ise tam olarak atlanmaması gereken kadar ölçülür. */
    freshRun();
    const cross = await run({ protocol: KWP, txn: liveTxn(), nowMs: T0 + 2000 });
    expect(cross.probesSent).toBe(2);
    expect(cross.reused).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) MEVCUT DAVRANIŞ KORUNDU (regresyon kalkanı)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-2 · mevcut reuse davranışı korunur', () => {
  it('🔒 KİLİT (6): aynı protokol + aynı taşıma → tasarruf ÖLÇÜLÜR', async () => {
    await run({ protocol: CAN });
    freshRun();
    const second = await run({ protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(2);
    expect(getSavedRequestCount()).toBe(2);
    expect(getReusedProbeCount()).toBe(2);
  });

  it('🔒 KİLİT (7): taşıma değiştiyse yine TRANSPORT_CHANGED (protokol aynı)', async () => {
    await run({ protocol: CAN });
    /* Kenar İLK koşudan alınır: ikinci koşu onu yeni taşımayla YENİDEN
       öğrenir, dolayısıyla kararı sonradan sormak totoloji olurdu. */
    const learned = getCapabilityEdge(VEH_A, 'E1', '19', '02')!;
    expect(learned.transport.genericBridge).toBe(true);

    /* Protokol AYNI ama taşıma değişti → karar TAŞIMA gerekçesiyle verilir;
       protokol kapısı bu davranışı EZMEZ. */
    expect(decideReuse(learned, {
      nowMs: T0 + 1000, fingerprintReusable: true, protocol: CAN,
      transport: { genericBridge: false, routePolicy: null, adapterHash: null },
    })).toBe('TRANSPORT_CHANGED');

    freshRun();
    const second = await run({
      protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000,
      transport: { genericBridge: false, routePolicy: 'legacy_only', adapterHash: 'ad1' },
    });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (12): BAYAT kenar reuse ÜRETMEZ', async () => {
    await run({ protocol: CAN });
    freshRun();
    const second = await run({
      protocol: CAN, txn: liveTxn(), nowMs: T0 + CAPABILITY_FRESH_MS + 1 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (13): replay kanıtı güven KAZANMAZ', async () => {
    await run({ protocol: CAN, provenance: 'replay' });
    freshRun();
    const second = await run({
      protocol: CAN, txn: liveTxn(), nowMs: T0 + 1000, provenance: 'replay' });
    expect(second.reused).toBe(0);
  });

  it('🔒 KİLİT (9): araç A → B reuse YOK', async () => {
    await run({ protocol: CAN, vehicleId: VEH_A });
    freshRun();
    const second = await run({
      protocol: CAN, vehicleId: VEH_B, txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (10): ECU A → B reuse YOK', async () => {
    await run({ protocol: CAN, ecuId: 'E1' });
    freshRun();
    const second = await run({
      protocol: CAN, ecuId: 'E2', txn: liveTxn(), nowMs: T0 + 1000 });
    expect(second.reused).toBe(0);
    expect(second.probesSent).toBe(2);
  });

  it('🔒 KİLİT (11): service/subFunction ayrımı KORUNUR', async () => {
    await run({ protocol: CAN });
    const edges = getCapabilityEdges();
    const keys = edges.map((e) => `${e.service}|${e.subFunction ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);       // hiçbiri birleşmedi
    expect(keys.length).toBeGreaterThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ÇAPRAZ PROTOKOL SAYAÇLARI KİRLETMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-2 · çapraz protokol sayaçları bozmaz', () => {
  it('🔒 KİLİT (8): protokol uyuşmazlığı conflict/quorum ÜRETMEZ', async () => {
    await run({ protocol: CAN });
    const before = getCapabilityEdge(VEH_A, 'E1', '19', '02')!;
    expect(before.conflict).toBeNull();

    freshRun();
    await run({ protocol: KWP, txn: liveTxn(), nowMs: T0 + 1000 });

    const after = getCapabilityEdge(VEH_A, 'E1', '19', '02')!;
    /* İki AYRI hattın gerçeği ÇELİŞKİ değildir — sahte çelişki üretilmez. */
    expect(after.conflict).toBeNull();
    expect(after.protocol).toBe(KWP);
    expect(after.consecutiveSame).toBe(1);          // BAŞTAN başladı
    /* Geçmiş sessizce silinmez: doğum damgası KORUNUR. */
    expect(after.firstSeenMs).toBe(before.firstSeenMs);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KORUNAN İNVARYANTLAR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-2 · invaryantlar', () => {
  it('🔒 KİLİT (14): protokol karşılaştırması YALNIZ decideReuse’de', async () => {
    /* Keşif çalıştırıcısında ikinci bir protokol kıyaslaması OLMAMALI:
       kaynak dosyada `decideReuse` çağrısı dışında `protocol !==` yok. */
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      'src/platform/obd/discovery/serviceDiscoveryRuntime.ts', 'utf8');
    expect(src).not.toMatch(/protocol\s*!==\s*(?!undefined)/);
    expect(src).toContain('protocol: input.protocol ?? null');
  });

  it('🔒 KİLİT (16): destructive PDU = 0', async () => {
    await run({ protocol: CAN });
    freshRun();
    await run({ protocol: KWP, txn: liveTxn(), nowMs: T0 + 1000 });
    const services = sent.map((o) => String(o.service ?? ''));
    for (const d of DESTRUCTIVE_SERVICES) expect(services).not.toContain(d);
  });

  it('🔒 KİLİT (17): healing bütçe/deneme sabitleri DEĞİŞMEDİ', () => {
    expect(MAX_ATTEMPTS_PER_TRIPLE).toBe(2);
    expect(MAX_ATTEMPTS_PER_GAP).toBe(4);
  });

  it('🔒 KİLİT (18): coverage learning davranışı REGRESYON GÖSTERMEZ', () => {
    const base = {
      service: '19', subFunction: '02', measuredOutcome: 'ok',
      nrc: null, gapRoot: null, requestCount: 1,
    } as const;
    expect(learnableCoveragePresence({ ...base, outcome: 'COMPLETE' }, 'live'))
      .toEqual({ learn: true, presence: 'PRESENT' });
    expect(learnableCoveragePresence({
      ...base, outcome: 'UNSUPPORTED_MEASURED',
      measuredOutcome: 'unsupported', nrc: 0x11 }, 'live'))
      .toEqual({ learn: true, presence: 'ABSENT' });
    expect(learnableCoveragePresence({
      ...base, outcome: 'UNSUPPORTED_MEASURED',
      measuredOutcome: 'unsupported', nrc: 0x31 }, 'live'))
      .toEqual({ learn: false, rejection: 'ABSENT_WITHOUT_NRC11' });
    expect(learnableCoveragePresence({ ...base, outcome: 'COMPLETE' }, 'replay'))
      .toEqual({ learn: false, rejection: 'NOT_PRODUCT_TRUSTED' });
  });

  it('deterministik: aynı senaryo aynı sonucu verir', async () => {
    await run({ protocol: CAN });
    freshRun();
    const a = await run({ protocol: KWP, txn: liveTxn(), nowMs: T0 + 1000 });

    _resetCapabilityStoreForTest();
    loadCapabilityStore();
    freshRun();
    await run({ protocol: CAN });
    freshRun();
    const b = await run({ protocol: KWP, txn: liveTxn(), nowMs: T0 + 1000 });

    expect(a.reused).toBe(b.reused);
    expect(a.probesSent).toBe(b.probesSent);
  });
});
