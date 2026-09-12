/**
 * gapLedgerVehicleScope.test — P0-VDK-F5F · ARAÇ KAPSAMLI SİCİL + AÇILIŞ HİDRASYONU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * Araç A'nın boşlukları Araç B'ye **ASLA** görünmemeli; uygulama yeniden
 * başladıktan sonra **doğru araç sicili** otomatik ve fail-closed biçimde
 * yüklenmelidir. Yalnız depo anahtarına parmak izi eklemek PASS DEĞİLDİR:
 * açılış → kimlik → hidrasyon → keşif/Self-Healing zincirinde araç
 * izolasyonu KANITLANMALIDIR.
 *
 * Bu dosyanın kilitlediği en pahalı beş hata:
 *  a. kimlik hazır olmadan "muhtemelen aynı araçtır" diye sicil yüklemek,
 *  b. zayıf parmak iziyle kalıcı bölüm açmak (iki aracı aynı sanmak),
 *  c. araç takasında eski aracın çözüm durumlarını yeni araca taşımak,
 *  d. oturum mührü (epoch) değişimini araç değişimi sanmak,
 *  e. kapsamsız eski depoyu kanıtsız bir araca devretmek.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
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
  beginTransaction, transitionTransaction, _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import {
  runServiceDiscovery, getProbeRecords, detachProbeLedgerForVehicleSwitch,
  _resetServiceDiscoveryForTest,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  recordGap, getGapRegistry, getGapEntry, markGapResolved,
  activateGapLedgerVehicle, beginGapLedgerBoot, getGapLedgerScope,
  getGapLedgerStorageKey, getGapLedgerSwitchCount,
  getGapLedgerRestoreAttempted, getGapLedgerBootAt, getGapLedgerBlockedWrites,
  getGapLedgerHealth, getGapLedgerRestoredCount, hasLegacyUnscopedGapLedger,
  persistGapLedger, loadGapLedger,
  _resetGapRegistryForTest, _simulateRestartForTest, _writeRawGapLedgerForTest,
  _clearLegacyUnscopedForTest,
} from '../platform/obd/gapRegistry';
import {
  GAP_LEDGER_KEY_PREFIX, LEGACY_UNSCOPED_GAP_LEDGER_KEY,
  LEGACY_UNSCOPED_POLICY, gapLedgerKeyFor, isPersistableVehicleRef,
  isSameGapLedgerScope, resolveGapLedgerScope,
} from '../platform/obd/gapLedgerScope';
import { MAX_ENTRIES_PER_FAMILY } from '../platform/obd/gapRetentionPolicy';
import { buildGapEvidence, type GapObservation }
  from '../platform/obd/gapEvidence';
import {
  buildCapabilityFingerprint, isFingerprintReusable,
} from '../platform/obd/capability/capabilityFingerprint';
import type { TransportConstraint }
  from '../platform/obd/capability/capabilityGraph';
import {
  loadCapabilityStore, recordCapabilityObservation,
  _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import {
  collectResolvableGaps, getGapStates, runGapResolution,
  detachGapResolverForVehicleSwitch, _resetGapResolverForTest,
} from '../platform/obd/healing/gapResolverRuntime';
import { _resetSessionHealingForTest }
  from '../platform/obd/healing/sessionHealing';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';
import { readGapResolverSnapshot }
  from '../platform/devtools/gapResolverSources';
import { buildResolverCards } from '../platform/devtools/gapResolverModel';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

let sent: Record<string, unknown>[] = [];
const T0 = 1_000_000;

/** İki GERÇEK araç kimliği — MEVCUT F4-C parmak izinden üretilir. */
const FP_A = buildCapabilityFingerprint(
  { protocol: '6', supportedPidBitmap: 'BE1FA813', vin: 'VF1AAAA00A0000001' },
  [{ txHeader: '7E0', rxHeader: '7E8', protocol: '6',
    responseSignature: '59:02', calibrationDid: 'F189',
    calibrationValueHash: 'h1' }],
);
const FP_B = buildCapabilityFingerprint(
  { protocol: '6', supportedPidBitmap: '98188013', vin: 'WVW00000000000002' },
  [{ txHeader: '7E2', rxHeader: '7EA', protocol: '6',
    responseSignature: '59:0A', calibrationDid: 'F189',
    calibrationValueHash: 'h2' }],
);
const A = FP_A.id;
const B = FP_B.id;

function bridge(reply: (o: Record<string, unknown>) => Record<string, unknown>): void {
  (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu =
    vi.fn(async (o: Record<string, unknown>) => { sent.push(o); return reply(o); });
}

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

const ECU = (): EcuVariant => ({
  id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
  addressing: 'physical', kwpTarget: null, session: 'default',
  serviceRefs: ['uds_read_dtc_information', 'uds_report_supported_dtc'],
  patternRefs: [], comParamRefs: [],
  provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
} as unknown as EcuVariant);

function liveTxn() {
  const t = beginTransaction({ purpose: 'multi_ecu_scan' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  t.protocol = '6';
  return t;
}

/** Aracı bağla — üretim yolunun (`productionDiscovery`) yaptığının aynısı. */
function connect(
  ref: string | null, over: Record<string, unknown> = {},
): ReturnType<typeof activateGapLedgerVehicle> {
  const act = activateGapLedgerVehicle({
    vehicleRef: ref, fingerprintReusable: true,
    provenance: 'live', traceMode: 'live', nowMs: T0,
    ...over,
  } as Parameters<typeof activateGapLedgerVehicle>[0]);
  if (act.switched) {
    detachGapResolverForVehicleSwitch();
    detachProbeLedgerForVehicleSwitch();
  }
  return act;
}

const obs = (over: Partial<GapObservation> = {}): GapObservation => ({
  ecuKey: 'ECM@7E0', txHeader: '7E0', rxHeader: '7E8',
  service: '19', subFunction: '02', requestIdentity: '1902FF',
  outcome: 'NEGATIVE', nrc: 0x12, classification: 'PRESENT_BUT_CONDITIONED',
  sessionOpened: null, sessionCommand: null,
  transportKind: 'elm327_classic', protocol: '6',
  traceCorrelationId: 'corr-1', atMs: T0, ...over,
});

const ev = (over: Partial<GapObservation> = {}) =>
  buildGapEvidence({ observation: obs(over), transactionId: 'txn-1', provenance: 'live' });

/** Aktif kapsama canlı kanıtlı bir boşluk yazar. */
function seed(over: Partial<GapObservation> = {}, atMs = T0): void {
  recordGap({
    signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
    context: `discovery:19${over.subFunction ?? '02'}`,
    atMs, evidence: ev(over),
  });
}

async function discover(over: Record<string, unknown> = {}): Promise<void> {
  await runServiceDiscovery({
    defs: DEFS(), ecu: ECU(), protocolClass: 'can', protocol: '6',
    txn: liveTxn(), ecuKey: 'ECM@7E0', nowMs: T0, probeSubFunctions: false,
    vehicleId: A, ecuId: 'E1', fingerprintReusable: true,
    provenance: 'live', transport: TRANSPORT,
    ...over,
  } as Parameters<typeof runServiceDiscovery>[0]);
}

function cleanPartitions(): void {
  for (const k of [gapLedgerKeyFor(A), gapLedgerKeyFor(B),
    LEGACY_UNSCOPED_GAP_LEDGER_KEY]) {
    if (k !== null) { try { safeRemoveRaw(k); } catch { /* yok say */ } }
  }
}

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  cleanPartitions();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetGapRegistryForTest();
  cleanPartitions();
  _clearLegacyUnscopedForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) KİMLİK OTORİTESİ — YENİSİ KURULMADI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · araç kimliği otoritesi', () => {
  it('kimlik ve gücü MEVCUT F4-C parmak izinden gelir', () => {
    expect(isFingerprintReusable(FP_A)).toBe(true);
    expect(isFingerprintReusable(FP_B)).toBe(true);
    expect(A).not.toBe(B);
    /* Bölüm anahtarı da AYNI kimlikten türer — ikinci kimlik sistemi YOK. */
    expect(gapLedgerKeyFor(A)).toBe(`${GAP_LEDGER_KEY_PREFIX}:${A}`);
  });

  it('parmak izi biçiminde OLMAYAN kimlik kalıcı bölüm AÇAMAZ (gizlilik kapısı)', () => {
    expect(isPersistableVehicleRef('VF1AAAA00A0000001')).toBe(false);  // ham VIN
    expect(isPersistableVehicleRef('AA:BB:CC:DD:EE:FF')).toBe(false);  // MAC
    expect(isPersistableVehicleRef('V1')).toBe(false);
    expect(isPersistableVehicleRef(A)).toBe(true);
    expect(gapLedgerKeyFor('VF1AAAA00A0000001')).toBeNull();
  });

  it('parmak izi ham VIN sızdırmaz (mevcut kanıt yardımcısı)', () => {
    expect(JSON.stringify(FP_A)).not.toContain('VF1AAAA00A0000001');
    expect(A).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) AÇILIŞ — KİMLİK YOKKEN HİDRASYON YASAK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · açılış hidrasyonu', () => {
  it('açılış adımı HİÇBİR sicil yüklemez ama ÖLÇÜM üretir', () => {
    const scope = beginGapLedgerBoot(T0);
    expect(scope.state).toBe('UNIDENTIFIED');
    expect(scope.storageKey).toBeNull();
    expect(scope.persistenceAllowed).toBe(false);
    expect(getGapLedgerBootAt()).toBe(T0);
    /* "Denendi mi" sorusu artık gerçek bir cevap buluyor. */
    expect(getGapLedgerRestoreAttempted()).toBe(false);
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('kimlik YOKKEN kayıt diske YAZILMAZ (kalıcılık engelli)', () => {
    beginGapLedgerBoot(T0);
    seed();
    expect(getGapRegistry()).toHaveLength(1);        // bellekte VAR
    expect(getGapLedgerStorageKey()).toBeNull();
    expect(getGapLedgerBlockedWrites()).toBeGreaterThan(0);
    expect(persistGapLedger(T0)).toBe(false);
  });

  it('açılışta BAŞKA aracın sicili yüklenmez (kimlik yok → boş)', () => {
    connect(A);
    seed();
    expect(getGapRegistry()).toHaveLength(1);

    /* Uygulama yeniden başladı ve HENÜZ araç bağlanmadı. */
    _simulateRestartForTest();
    beginGapLedgerBoot(T0 + 1);
    expect(getGapRegistry()).toHaveLength(0);
    expect(getGapLedgerScope().state).toBe('UNIDENTIFIED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ZAYIF / BİLİNMEYEN KİMLİK — FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · zayıf kimlik politikası', () => {
  it('parmak izi YETERSİZSE kalıcılık ENGELLİ (bellek içi sicil)', () => {
    const act = connect(A, { fingerprintReusable: false });
    expect(act.scope.state).toBe('EPHEMERAL_WEAK_IDENTITY');
    expect(act.scope.persistenceAllowed).toBe(false);
    expect(act.scope.blockedReason).toContain('YETMİYOR');
    seed();
    expect(getGapRegistry()).toHaveLength(1);
    expect(safeGetRaw(`${GAP_LEDGER_KEY_PREFIX}:${A}`)).toBeNull();
  });

  it('ZAYIF kimlik BAŞKA aracın sicilini YÜKLEMEZ', () => {
    connect(A);
    seed();
    expect(getGapRegistry()).toHaveLength(1);

    /* Aynı araç ama bu kez kimlik zayıf ölçüldü → eski sicil GERİ GELMEZ. */
    _simulateRestartForTest();
    connect(A, { fingerprintReusable: false });
    expect(getGapRegistry()).toHaveLength(0);
    expect(getGapLedgerScope().state).toBe('EPHEMERAL_WEAK_IDENTITY');
  });

  it('kimlik BİLİNMİYORSA hiçbir bölüm açılmaz', () => {
    const act = connect(null);
    expect(act.scope.state).toBe('UNIDENTIFIED');
    expect(act.scope.storageKey).toBeNull();
  });

  it('"muhtemelen aynı araç" diye eski sicil YÜKLENMEZ — saf karar', () => {
    const weak = resolveGapLedgerScope({
      vehicleRef: A, fingerprintReusable: false,
      provenance: 'live', traceMode: 'live',
    });
    expect(weak.storageKey).toBeNull();
    expect(weak.persistenceAllowed).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ARAÇ TAKASI — asıl PASS ölçütü
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · araç takası', () => {
  it('A → persist → B → A GÖRÜNMEZ → A tekrar → A geri gelir', () => {
    /* ── Araç A ── */
    connect(A);
    seed({ nrc: 0x22 });
    markGapResolved({
      key: getGapRegistry()[0].key, evidenceRef: 'corrA',
      classification: 'PRESENT', provenance: 'live',
      resolvedAtMs: T0 + 1, detail: 'A kapandı',
    });
    expect(getGapRegistry()).toHaveLength(1);
    const keyA = getGapLedgerStorageKey();
    expect(keyA).toBe(`${GAP_LEDGER_KEY_PREFIX}:${A}`);

    /* ── Araç B bağlandı ── */
    const swap = connect(B);
    expect(swap.switched).toBe(true);
    expect(swap.detachedRef).toBe(A);
    expect(getGapLedgerSwitchCount()).toBe(1);
    /* A'nın boşluğu B'de GÖRÜNMEZ. */
    expect(getGapRegistry()).toHaveLength(0);
    expect(getGapLedgerStorageKey()).toBe(`${GAP_LEDGER_KEY_PREFIX}:${B}`);

    /* B kendi boşluğunu yazar — A'nın bölümüne DEĞİL. */
    seed({ nrc: 0x31 });
    const rawA = JSON.parse(safeGetRaw(keyA!) ?? '{}') as { entries: unknown[] };
    expect(rawA.entries).toHaveLength(1);
    const entA = (rawA.entries as { evidence: { observedNrc: number } }[])[0];
    expect(entA.evidence.observedNrc).toBe(0x22);   // B'nin 0x31'i BURAYA yazılmadı

    /* ── A tekrar bağlandı ── */
    connect(A);
    expect(getGapLedgerSwitchCount()).toBe(2);
    const back = getGapRegistry();
    expect(back).toHaveLength(1);
    expect(back[0].evidence!.observedNrc).toBe(0x22);
    /* DOĞUM ve KAPANIŞ kanıtı korunmuş. */
    expect(back[0].resolutionState).toBe('RESOLVED');
    expect(back[0].resolution!.evidenceRef).toBe('corrA');
  });

  it('araç takasında ÇÖZÜM DURUMLARI ve YOKLAMA DEFTERİ ayrılır', async () => {
    connect(A);
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await discover();
    await runGapResolution({
      ecu: ECU(), defs: DEFS(), txn: liveTxn(),
      protocolClass: 'can', protocol: '6', provenance: 'live',
      transport: TRANSPORT, targetVerified: true,
      vehicleId: A, ecuId: 'E1', fingerprintReusable: true, nowMs: T0 + 10,
    } as Parameters<typeof runGapResolution>[0]);
    expect(getGapStates().length).toBeGreaterThan(0);
    expect(getProbeRecords().length).toBeGreaterThan(0);

    connect(B);
    /* Eski aracın çözüm durumu ve yoklama kanıtı YENİ araca TAŞINMAZ. */
    expect(getGapStates()).toHaveLength(0);
    expect(getProbeRecords()).toHaveLength(0);
    expect(collectResolvableGaps(T0 + 20)).toHaveLength(0);
  });

  it('A bozuksa B ETKİLENMEZ (bölümler fiziksel olarak ayrı)', () => {
    connect(B);
    seed({ nrc: 0x31 });
    expect(getGapRegistry()).toHaveLength(1);

    /* A'nın bölümünü bozalım. */
    safeSetRaw(`${GAP_LEDGER_KEY_PREFIX}:${A}`, 'bozuk', undefined, true);

    connect(A);
    expect(getGapLedgerHealth()).toBe('CORRUPT');
    expect(getGapRegistry()).toHaveLength(0);

    /* B geri gelince kendi sicili SAĞLAM. */
    connect(B);
    expect(getGapLedgerHealth()).toBe('OK');
    expect(getGapRegistry()).toHaveLength(1);
    expect(getGapRegistry()[0].evidence!.observedNrc).toBe(0x31);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) YENİDEN BAĞLANMA / OTURUM MÜHRÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · reconnect ve epoch', () => {
  it('AYNI araca yeniden bağlanmak sicili DEĞİŞTİRMEZ (takas SAYILMAZ)', () => {
    connect(A);
    seed();
    const before = getGapRegistry()[0].key;

    const again = connect(A);
    expect(again.switched).toBe(false);
    expect(getGapLedgerSwitchCount()).toBe(0);
    expect(getGapRegistry()).toHaveLength(1);
    expect(getGapRegistry()[0].key).toBe(before);
  });

  it('OTURUM MÜHRÜ (epoch) değişimi bölüm değiştirmez', () => {
    connect(A);
    seed();
    /* Yeni bir işlem = yeni `sessionEpoch`; araç AYNI. */
    const t1 = liveTxn(); const t2 = liveTxn();
    expect(t1.transactionId).not.toBe(t2.transactionId);

    connect(A, { nowMs: T0 + 5_000 });
    expect(getGapLedgerSwitchCount()).toBe(0);
    expect(getGapRegistry()).toHaveLength(1);
    expect(getGapLedgerStorageKey()).toBe(`${GAP_LEDGER_KEY_PREFIX}:${A}`);
  });

  it('kapsam eşitliği epoch DEĞİL kimlik üzerinden ölçülür', () => {
    const s1 = resolveGapLedgerScope({
      vehicleRef: A, fingerprintReusable: true,
      provenance: 'live', traceMode: 'live',
    });
    const s2 = resolveGapLedgerScope({
      vehicleRef: A, fingerprintReusable: true,
      provenance: 'live', traceMode: 'live',
    });
    expect(isSameGapLedgerScope(s1, s2)).toBe(true);
    const sB = resolveGapLedgerScope({
      vehicleRef: B, fingerprintReusable: true,
      provenance: 'live', traceMode: 'live',
    });
    expect(isSameGapLedgerScope(s1, sB)).toBe(false);
  });

  it('restart sonrası AYNI araç kendi geçmişini geri alır', () => {
    connect(A);
    seed();

    /* GERÇEK yeniden başlatma sırası: süreç durumu gider → açılış adımı
       (kimlik YOK, hidrasyon ERTELENİR) → araç bağlanır → kendi bölümü gelir. */
    _simulateRestartForTest();
    beginGapLedgerBoot(T0 + 1);
    expect(getGapRegistry()).toHaveLength(0);          // kimlik yokken BOŞ
    expect(getGapLedgerRestoreAttempted()).toBe(false);

    connect(A);
    expect(getGapLedgerRestoreAttempted()).toBe(true);
    expect(getGapLedgerRestoredCount()).toBe(1);
    expect(getGapRegistry()).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) SELF-HEALING İZOLASYONU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · Self-Healing yalnız aktif aracı görür', () => {
  it('yetenek kenarları da ARACA bağlıdır (çapraz araç sızıntısı YOK)', () => {
    const edge = (vehicleId: string, presence: string, atMs: number) => ({
      vehicleId, ecuId: 'E1', service: '19', subFunction: null,
      presence, provenance: 'live', protocol: '6', transport: TRANSPORT,
      evidenceRef: 'c', nrc: null, atMs,
    });
    recordCapabilityObservation(
      edge(A, 'PRESENT', T0) as never, false);
    recordCapabilityObservation(
      edge(A, 'ABSENT', T0 + 10) as never, false);

    connect(B);
    /* Araç A'nın çelişkili kenarı B'de HİÇ görünmez. */
    expect(collectResolvableGaps(T0 + 20)
      .some((g) => g.origin === 'CAPABILITY_CONFLICT')).toBe(false);

    connect(A);
    expect(collectResolvableGaps(T0 + 20)
      .some((g) => g.origin === 'CAPABILITY_CONFLICT')).toBe(true);
  });

  it('aktif araç YOKSA yetenek kökenli boşluk TOPLANMAZ (fail-closed)', () => {
    recordCapabilityObservation({
      vehicleId: A, ecuId: 'E1', service: '19', subFunction: null,
      presence: 'PRESENT', provenance: 'live', protocol: '6',
      transport: TRANSPORT, evidenceRef: 'c', nrc: null, atMs: T0,
    } as never, false);
    recordCapabilityObservation({
      vehicleId: A, ecuId: 'E1', service: '19', subFunction: null,
      presence: 'ABSENT', provenance: 'live', protocol: '6',
      transport: TRANSPORT, evidenceRef: 'c', nrc: null, atMs: T0 + 10,
    } as never, false);

    beginGapLedgerBoot(T0);
    expect(collectResolvableGaps(T0 + 20)).toHaveLength(0);
  });

  it('eski aracın OTURUM kanıtı yeni araca TAŞINMAZ', () => {
    connect(A);
    seed({ nrc: 0x22, sessionOpened: true, sessionCommand: '1003' });
    expect(collectResolvableGaps(T0 + 1)[0].sessionConditioned).toBe(true);

    connect(B);
    expect(collectResolvableGaps(T0 + 1)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) SAKLAMA / KOTA — BÖLÜM BAŞINA
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · kota bölüm başına çalışır', () => {
  it('A\'nın flapping ECU\'su B\'nin kapasitesini YİYEMEZ', () => {
    connect(A);
    for (let i = 0; i < 40; i++) seed({ nrc: 0x20 + i }, T0 + i);
    const aRows = getGapRegistry().length;
    expect(aRows).toBeLessThanOrEqual(MAX_ENTRIES_PER_FAMILY);

    connect(B);
    /* B temiz bir sicille başlar — A'nın gürültüsü slot yemedi. */
    expect(getGapRegistry()).toHaveLength(0);
    for (let i = 0; i < 3; i++) seed({ nrc: 0x40 + i }, T0 + i);
    expect(getGapRegistry()).toHaveLength(3);

    connect(A);
    expect(getGapRegistry()).toHaveLength(aRows);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) REPLAY / SENTETİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · replay ürün bölümünü kirletemez', () => {
  it('replay kökeni ürün bölümü AÇMAZ (kimlik güçlü olsa bile)', () => {
    const act = connect(A, { provenance: 'replay' });
    expect(act.scope.state).toBe('EPHEMERAL_REPLAY');
    expect(act.scope.storageKey).toBeNull();
    seed();
    expect(safeGetRaw(`${GAP_LEDGER_KEY_PREFIX}:${A}`)).toBeNull();
  });

  it('iz replay MODU açıkken de ürün bölümü açılmaz (ikinci kapı)', () => {
    const act = connect(A, { traceMode: 'replay' });
    expect(act.scope.state).toBe('EPHEMERAL_REPLAY');
    expect(act.scope.persistenceAllowed).toBe(false);
  });

  it('replay koşusu GERÇEK aracın mevcut sicilini BOZMAZ', () => {
    connect(A);
    seed({ nrc: 0x22 });
    const raw = safeGetRaw(`${GAP_LEDGER_KEY_PREFIX}:${A}`);

    connect(A, { provenance: 'replay' });
    seed({ nrc: 0x99 });
    expect(safeGetRaw(`${GAP_LEDGER_KEY_PREFIX}:${A}`)).toBe(raw);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9) ESKİ KAPSAMSIZ DEPO
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · kapsamsız eski depo', () => {
  it('kanıtsız eski depo HİÇBİR araca taşınmaz', () => {
    safeSetRaw(LEGACY_UNSCOPED_GAP_LEDGER_KEY, JSON.stringify({
      schemaVersion: 1, savedAt: T0, entryCount: 1,
      entries: [{
        key: 'legacy', signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
        context: 'discovery:1902', count: 1, firstSeenMs: T0, lastSeenMs: T0,
        runId: null, evidence: ev(), evidenceState: 'MEASURED',
        resolutionState: 'OPEN', resolution: null,
      }],
      droppedCount: 0, evictedCount: 0,
    }), undefined, true);

    expect(hasLegacyUnscopedGapLedger()).toBe(true);
    connect(A);
    expect(getGapRegistry()).toHaveLength(0);          // taşınmadı
    expect(LEGACY_UNSCOPED_POLICY).toBe('IGNORE_NO_OWNERSHIP_PROOF');
    /* Eski depo EZİLMEZ de — kanıtsız silme de bir karardır. */
    expect(safeGetRaw(LEGACY_UNSCOPED_GAP_LEDGER_KEY)).not.toBeNull();
  });

  it('araç bölümü kapsamsız anahtarla ÇAKIŞMAZ', () => {
    connect(A);
    seed();
    expect(getGapLedgerStorageKey()).not.toBe(LEGACY_UNSCOPED_GAP_LEDGER_KEY);
    expect(safeGetRaw(LEGACY_UNSCOPED_GAP_LEDGER_KEY)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   10) GİZLİLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · gizlilik', () => {
  it('bölüm anahtarında ham VIN/MAC YOKTUR', () => {
    connect(A);
    const key = getGapLedgerStorageKey()!;
    expect(key).not.toContain('VF1AAAA00A0000001');
    expect(key).not.toContain(':AA:');
    expect(key).toBe(`${GAP_LEDGER_KEY_PREFIX}:${A}`);
    expect(key.split(':')[1]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('kalıcı dosyada ham yanıt/VIN yok', async () => {
    connect(A);
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();
    persistGapLedger(T0, true);
    const raw = safeGetRaw(getGapLedgerStorageKey()!) ?? '';
    expect(raw).not.toContain('7F1912');
    expect(raw).not.toContain('VF1AAAA');
    expect(raw.toLowerCase()).not.toContain('vin');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   11) LAB
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · CAROS LAB araç kapsamı yüzeyi', () => {
  it('LAB okuması yazım/ölçüm/bağlama TETİKLEMEZ', () => {
    connect(A);
    seed();
    const before = safeGetRaw(getGapLedgerStorageKey()!);
    const switchesBefore = getGapLedgerSwitchCount();

    readGapResolverSnapshot();
    buildResolverCards(readGapResolverSnapshot());

    expect(safeGetRaw(getGapLedgerStorageKey()!)).toBe(before);
    expect(getGapLedgerSwitchCount()).toBe(switchesBefore);
    expect(sent).toHaveLength(0);
  });

  it('aktif araç kartı kimlik · bölüm · kalıcılık gösterir (ham VIN YOK)', () => {
    connect(A);
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    expect(card.fields.find((f) => f.id === 'vref')!.value).toBe(A);
    expect(card.fields.find((f) => f.id === 'vpart')!.value)
      .toBe(`${GAP_LEDGER_KEY_PREFIX}:${A}`);
    expect(card.fields.find((f) => f.id === 'vpersist')!.value).toBe('İZİNLİ');
    expect(JSON.stringify(card)).not.toContain('VF1AAAA00A0000001');
  });

  it('KİMLİK YOK ile gerçek 0 AYRI gösterilir', () => {
    beginGapLedgerBoot(T0);
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    expect(card.fields.find((f) => f.id === 'vstate')!.klass).toBe('UNAVAILABLE');
    expect(card.fields.find((f) => f.id === 'vref')!.klass).toBe('UNAVAILABLE');
    expect(card.fields.find((f) => f.id === 'vrestore')!.klass).toBe('UNAVAILABLE');
    expect(card.fields.find((f) => f.id === 'vboot')!.klass).toBe('OBSERVED');
  });

  it('zayıf kimlikte kalıcılık ENGELLİ ve GEREKÇESİ görünür', () => {
    connect(A, { fingerprintReusable: false });
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    const f = card.fields.find((x) => x.id === 'vpersist')!;
    expect(f.klass).toBe('UNAVAILABLE');
    /* Gerekçe `note` alanındadır — `KAYNAK YOK` değeri sessiz kalmaz. */
    expect(f.note).toContain('ENGELLİ');
    expect(f.note).toContain('YETMİYOR');
  });

  it('araç takası ve ayrılan bölüm LAB\'da görünür', () => {
    connect(A);
    connect(B);
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    expect(card.fields.find((f) => f.id === 'vswitch')!.value).toBe('1');
    expect(card.fields.find((f) => f.id === 'vdetach')!.value).toBe(A);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   12) ŞEMA / BOZUK DEPO — bölüm bazlı
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5F · bölüm sağlığı', () => {
  it('bozuk bölüm FAIL-CLOSED boş başlar ve sağlığı GÖRÜNÜR', () => {
    connect(A);
    _writeRawGapLedgerForTest('{{bozuk');
    expect(loadGapLedger()).toBe('CORRUPT');
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('bilinmeyen şema sürümü bölümde de REDDEDİLİR', () => {
    connect(A);
    _writeRawGapLedgerForTest(JSON.stringify({
      schemaVersion: 99, savedAt: T0, entryCount: 0, entries: [],
      droppedCount: 0, evictedCount: 0,
    }));
    expect(loadGapLedger()).toBe('SCHEMA_MISMATCH');
  });

  it('kapanış kanıtı araç değişiminde de KORUNUR', () => {
    connect(A);
    seed();
    const k = getGapRegistry()[0].key;
    markGapResolved({
      key: k, evidenceRef: 'cA', classification: 'PRESENT',
      provenance: 'live', resolvedAtMs: T0 + 1, detail: 'kapandı',
    });
    connect(B);
    connect(A);
    const e = getGapEntry(k)!;
    expect(e.resolution!.evidenceRef).toBe('cA');
    expect(e.evidence!.observedNrc).toBe(0x12);
  });
});
