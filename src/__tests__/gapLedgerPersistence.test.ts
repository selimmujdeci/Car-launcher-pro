/**
 * gapLedgerPersistence.test — P0-VDK-F5E · KALICI BOŞLUK SİCİLİ + SAKLAMA POLİTİKASI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * Uygulama yeniden başladıktan sonra kanonik boşluğun DOĞUM ve KAPANIŞ kanıtı
 * kaybolmadan geri yüklenmeli; Self-Healing aynı boşluğu doğru ECU/servis/NRC
 * bağlamıyla yeniden görebilmeli; depo bozuksa sicil FAIL-CLOSED başlamalı ve
 * saklama politikası tek bir "flapping" ECU'nun sicili işgal etmesini
 * ENGELLEMELİDİR.
 *
 * Bu dosyanın kilitlediği en pahalı beş hata:
 *  a. bozuk/eksik depoyu kısmen "öğrendik" saymak,
 *  b. geri yüklenen kaydı YENİDEN ÖLÇÜLMÜŞ gibi göstermek,
 *  c. replay/sentetik bir boşluğu ürünün kalıcı siciline yazmak,
 *  d. yer darlığında AÇIK bir boşluğu atıp KAPANMIŞ bir kaydı tutmak,
 *  e. tek bir ECU'nun flapping'iyle 120 slotu doldurmak.
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
  runServiceDiscovery, getProbeRecords, _resetServiceDiscoveryForTest,
} from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  recordGap, getGapRegistry, getGapEntry, markGapResolved,
  summarizeGapEvidence, persistGapLedger, loadGapLedger, restoreGapLedger,
  getGapLedgerHealth, getGapLedgerRestoredCount, getGapRegistryDropped,
  getGapRegistryEvicted, getGapEvictionReasons, getGapLedgerNotPersisted,
  getGapLedgerLastSaveOk, getGapLedgerSavedAt, isGapLedgerLoaded,
  GAP_LEDGER_SCHEMA_VERSION, getGapLedgerStorageKey,
  activateGapLedgerVehicle, _clearLegacyUnscopedForTest,
  _resetGapRegistryForTest, _simulateRestartForTest, _writeRawGapLedgerForTest,
  type GapEntry,
} from '../platform/obd/gapRegistry';
import {
  MAX_GAP_ENTRIES, MAX_ENTRIES_PER_ECU, MAX_ENTRIES_PER_FAMILY,
  compareEvictionOrder, gapFamilyKey, gapRetentionRank, isGapEntryPersistable,
  isGapEntryStale, planGapInsert, projectGapEntryForPersist, weakestEntry,
} from '../platform/obd/gapRetentionPolicy';
import { buildGapEvidence, type GapObservation }
  from '../platform/obd/gapEvidence';
import { CAPABILITY_FRESH_MS, type TransportConstraint }
  from '../platform/obd/capability/capabilityGraph';
import {
  loadCapabilityStore, _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import {
  collectResolvableGaps, runGapResolution, _resetGapResolverForTest,
} from '../platform/obd/healing/gapResolverRuntime';
import { classifyRootCause } from '../platform/obd/healing/resolutionPolicy';
import { _resetSessionHealingForTest } from '../platform/obd/healing/sessionHealing';
import { safeGetRaw } from '../utils/safeStorage';
import { readGapResolverSnapshot }
  from '../platform/devtools/gapResolverSources';
import { buildResolverCards } from '../platform/devtools/gapResolverModel';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

let sent: Record<string, unknown>[] = [];
const T0 = 1_000_000;

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

async function discover(over: Record<string, unknown> = {}): Promise<void> {
  await runServiceDiscovery({
    defs: DEFS(), ecu: ECU(), protocolClass: 'can', protocol: '6',
    txn: liveTxn(), ecuKey: 'ECM@7E0', nowMs: T0, probeSubFunctions: false,
    vehicleId: 'V1', ecuId: 'E1', fingerprintReusable: false,
    provenance: 'live', transport: TRANSPORT,
    ...over,
  } as Parameters<typeof runServiceDiscovery>[0]);
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

const obs = (over: Partial<GapObservation> = {}): GapObservation => ({
  ecuKey: 'ECM@7E0', txHeader: '7E0', rxHeader: '7E8',
  service: '19', subFunction: '02', requestIdentity: '1902FF',
  outcome: 'NEGATIVE', nrc: 0x12, classification: 'PRESENT_BUT_CONDITIONED',
  sessionOpened: null, sessionCommand: null,
  transportKind: 'elm327_classic', protocol: '6',
  traceCorrelationId: 'corr-1', atMs: T0, ...over,
});

const ev = (over: Partial<GapObservation> = {}, provenance = 'live' as const) =>
  buildGapEvidence({ observation: obs(over), transactionId: 'txn-1', provenance });

/** Sicile canlı kanıtlı bir satır yazar (üretici deseninin taklidi değil, API'si). */
function seed(over: Partial<GapObservation> = {}, atMs = T0): void {
  recordGap({
    signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
    context: `discovery:19${over.subFunction ?? '02'}`,
    atMs, evidence: ev(over),
  });
}

/** Saf politika testleri için satır kurucusu (defter kullanmadan). */
const entry = (over: Partial<GapEntry> = {}): GapEntry => ({
  key: 'K', signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
  context: 'discovery:1902', count: 1, firstSeenMs: T0, lastSeenMs: T0,
  runId: null, evidence: ev(), evidenceState: 'MEASURED',
  resolutionState: 'OPEN', resolution: null, ...over,
} as GapEntry);

/**
 * P0-VDK-F5F — bu dosyanın TÜM kalıcılık iddiaları artık BAĞLI BİR ARAÇ
 * gerektirir: kimlik kanıtlanmadan sicil diske yazılmaz (yeni sözleşme).
 * Kimlik MEVCUT `fingerprintHash` biçimindedir (16 hex) — uydurma kimlik
 * kalıcı bölüm açamaz.
 */
const VEHICLE_A = 'a1b2c3d4e5f60718';

function activateA(nowMs = T0): void {
  activateGapLedgerVehicle({
    vehicleRef: VEHICLE_A, fingerprintReusable: true,
    provenance: 'live', traceMode: 'live', nowMs,
  });
}

/** Aktif bölümün depo anahtarı — sabit anahtar ARTIK YOK. */
const KEY = (): string => getGapLedgerStorageKey() ?? '';

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  _clearLegacyUnscopedForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
  activateA();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetSessionHealingForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) YAZ / OKU TURU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · yazma ve okuma turu', () => {
  it('kayıt yazılır, diskte şema zarfıyla durur', () => {
    seed();
    const raw = safeGetRaw(KEY());
    expect(raw).not.toBeNull();
    const env = JSON.parse(raw!) as Record<string, unknown>;
    expect(env.schemaVersion).toBe(GAP_LEDGER_SCHEMA_VERSION);
    expect(env.entryCount).toBe(1);
    expect(Array.isArray(env.entries)).toBe(true);
    expect(env.savedAt).toBe(T0);
    expect(getGapLedgerLastSaveOk()).toBe(true);
    expect(getGapLedgerSavedAt()).toBe(T0);
  });

  it('yeniden yükleme aynı satırı aynı kimlikle geri getirir', () => {
    seed();
    const before = getGapRegistry()[0];
    _simulateRestartForTest();
    expect(loadGapLedger()).toBe('OK');
    const after = getGapRegistry()[0];
    expect(after.key).toBe(before.key);
    expect(after.count).toBe(before.count);
    expect(after.evidence!.observedNrc).toBe(0x12);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) RESTART — asıl PASS ölçütü
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · yeniden başlatma', () => {
  it('DOĞUM kanıtı restart sonrası bayt bayt korunur', () => {
    seed();
    const born = getGapRegistry()[0];
    _simulateRestartForTest();
    restoreGapLedger(T0 + 5_000);

    const after = getGapEntry(born.key)!;
    expect(after.evidence).toEqual(born.evidence);
    expect(after.evidenceState).toBe('MEASURED');
    /* Geri yüklenen kayıt YENİDEN ÖLÇÜLMÜŞ gibi davranmaz. */
    expect(after.evidence!.observedAt).toBe(T0);
    expect(after.evidence!.provenance).toBe('live');
    expect(after.firstSeenMs).toBe(T0);
    expect(getGapLedgerRestoredCount()).toBe(1);
  });

  it('KAPANIŞ kanıtı restart sonrası korunur ve doğum kanıtından AYRI kalır', () => {
    seed();
    const k = getGapRegistry()[0].key;
    markGapResolved({
      key: k, evidenceRef: 'corr-9', classification: 'PRESENT',
      provenance: 'live', resolvedAtMs: T0 + 1, detail: 'canlı kanıt: PRESENT',
    });

    _simulateRestartForTest();
    restoreGapLedger(T0 + 5_000);

    const after = getGapEntry(k)!;
    expect(after.resolutionState).toBe('RESOLVED');
    expect(after.resolution!.evidenceRef).toBe('corr-9');
    expect(after.resolution!.classification).toBe('PRESENT');
    expect(after.resolution!.resolvedAtMs).toBe(T0 + 1);
    /* Doğum kanıtı EZİLMEDİ. */
    expect(after.evidence!.observedNrc).toBe(0x12);
    expect(after.evidence!.observedClassification).toBe('PRESENT_BUT_CONDITIONED');
  });

  it('aynı boşluk restart sonrası TEKRAR ölçülürse yeni satır AÇILMAZ (dedupe korunur)', () => {
    seed();
    _simulateRestartForTest();
    restoreGapLedger(T0 + 5_000);
    seed({}, T0 + 6_000);

    expect(getGapRegistry()).toHaveLength(1);
    expect(getGapRegistry()[0].count).toBe(2);
  });

  it('TEMBEL hidrasyon: açık bir yükleme çağrısı OLMADAN da geri gelir', () => {
    seed();
    _simulateRestartForTest();
    expect(isGapLedgerLoaded()).toBe(false);
    /* `capabilityStore` ile AYNI desen: ilk okuma/yazma deposunu yükler. */
    const rows = getGapRegistry();
    expect(isGapLedgerLoaded()).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].evidence!.observedNrc).toBe(0x12);
  });

  it('"boşluk yok" ile "depo okunamadı" AYRI görünür', () => {
    _simulateRestartForTest();
    expect(isGapLedgerLoaded()).toBe(false);
    expect(loadGapLedger()).toBe('EMPTY');
    expect(getGapRegistry()).toHaveLength(0);

    _writeRawGapLedgerForTest('{{ bozuk');
    expect(loadGapLedger()).toBe('CORRUPT');
    expect(getGapRegistry()).toHaveLength(0);
    /* İkisi de 0 satır gösterir ama SAĞLIK farklıdır. */
    expect(getGapLedgerHealth()).toBe('CORRUPT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · bozuk/uyumsuz depo fail-closed', () => {
  it('bozuk JSON tüm depoyu güvenilmez yapar', () => {
    _writeRawGapLedgerForTest('not json at all');
    expect(loadGapLedger()).toBe('CORRUPT');
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('bilinmeyen şema sürümü REDDEDİLİR (geriye dönük tahmin YOK)', () => {
    _writeRawGapLedgerForTest(JSON.stringify({
      schemaVersion: GAP_LEDGER_SCHEMA_VERSION + 1,
      savedAt: T0, entryCount: 1, entries: [entry()],
      droppedCount: 0, evictedCount: 0,
    }));
    expect(loadGapLedger()).toBe('SCHEMA_MISMATCH');
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('TEK şekilsiz kayıt TÜM depoyu güvenilmez yapar (kısmi öğrenme YOK)', () => {
    _writeRawGapLedgerForTest(JSON.stringify({
      schemaVersion: GAP_LEDGER_SCHEMA_VERSION,
      savedAt: T0, entryCount: 2,
      entries: [entry({ key: 'A' }), { key: 'B' /* eksik alanlar */ }],
      droppedCount: 0, evictedCount: 0,
    }));
    expect(loadGapLedger()).toBe('CORRUPT');
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('YARIM yazılmış depo (sayaç ≠ satır) güvenilir SAYILMAZ', () => {
    _writeRawGapLedgerForTest(JSON.stringify({
      schemaVersion: GAP_LEDGER_SCHEMA_VERSION,
      savedAt: T0, entryCount: 5, entries: [entry()],
      droppedCount: 0, evictedCount: 0,
    }));
    expect(loadGapLedger()).toBe('CORRUPT');
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('güvenilmez depoya YAZIM YAPILMAZ (arıza kalıcılaşmaz)', () => {
    _writeRawGapLedgerForTest('bozuk');
    loadGapLedger();
    expect(persistGapLedger(T0)).toBe(false);
    /* Bozuk içerik EZİLMEDİ — üstüne yazıp kanıtı yok etmedik. */
    expect(safeGetRaw(KEY())).toBe('bozuk');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) SAKLAMA POLİTİKASI — deterministik
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · saklama sırası (deterministik)', () => {
  it('ÇÖZÜLMEMİŞ boşluk, çözülmüş boşluktan ÖNCE ASLA düşmez', () => {
    const open = entry({ key: 'open', resolutionState: 'OPEN', count: 1 });
    const resolvedRich = entry({
      key: 'res', resolutionState: 'RESOLVED', count: 99,
      evidenceState: 'MEASURED',
    });
    expect(gapRetentionRank(open, T0)).toBeGreaterThan(gapRetentionRank(resolvedRich, T0));
    expect(weakestEntry([open, resolvedRich], T0)!.key).toBe('res');
  });

  it('kanıtı SAĞLAM satır, kanıtsız satırdan önce tutulur', () => {
    const strong = entry({ key: 'a', evidenceState: 'MEASURED' });
    const weak = entry({ key: 'b', evidence: null, evidenceState: 'UNAVAILABLE' });
    expect(weakestEntry([strong, weak], T0)!.key).toBe('b');
  });

  it('bayat satır taze satırdan önce feda edilir (MEVCUT eşik)', () => {
    const fresh = entry({ key: 'a', lastSeenMs: T0 });
    const stale = entry({ key: 'b', lastSeenMs: T0 - CAPABILITY_FRESH_MS - 1 });
    const now = T0 + 1;
    expect(isGapEntryStale(stale, now)).toBe(true);
    expect(isGapEntryStale(fresh, now)).toBe(false);
    expect(weakestEntry([fresh, stale], now)!.key).toBe('b');
  });

  it('damgasız kayıt BAYAT sayılmaz (ölçülmemiş zaman "eski" ilan edilmez)', () => {
    expect(isGapEntryStale(entry({ lastSeenMs: null }), T0)).toBe(false);
    expect(isGapEntryStale(entry(), null)).toBe(false);
  });

  it('sıralama deterministiktir — aynı girdi aynı kurbanı seçer', () => {
    const a = entry({ key: 'a' });
    const b = entry({ key: 'b' });
    expect(compareEvictionOrder(a, b, T0)).toBe(compareEvictionOrder(a, b, T0));
    expect(compareEvictionOrder(a, b, T0)).toBeLessThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KOTA — flapping kalkanı
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · kota', () => {
  it('tek bir sinyal × ECU × servis ailesi sicili işgal EDEMEZ', () => {
    /* Aynı ECU aynı serviste her turda FARKLI NRC döndürüyor (flapping). */
    for (let i = 0; i < 40; i++) {
      seed({ nrc: 0x20 + i }, T0 + i);
    }
    const rows = getGapRegistry();
    expect(rows.length).toBeLessThanOrEqual(MAX_ENTRIES_PER_FAMILY);
    expect(rows.length).toBeLessThan(MAX_GAP_ENTRIES);
    const fams = new Set(rows.map(gapFamilyKey));
    expect(fams.size).toBe(1);
    /* Kırpma SESSİZ DEĞİLDİR. */
    expect(getGapRegistryDropped() + getGapRegistryEvicted()).toBeGreaterThan(0);
    expect(Object.keys(getGapEvictionReasons())).toContain('FAMILY_QUOTA');
  });

  it('flapping BAŞKA ECU\'nun kanıtını dışarı İTEMEZ', () => {
    recordGap({
      signal: 'UNKNOWN_SERVICE', scope: 'AUTHORITY', context: 'discovery:22',
      atMs: T0, evidence: ev({ ecuKey: 'TCM@7E1', service: '22', nrc: null,
        classification: 'UNKNOWN' }),
    });
    for (let i = 0; i < 40; i++) seed({ nrc: 0x20 + i }, T0 + i);

    expect(getGapRegistry().some((r) => r.evidence?.ecuKey === 'TCM@7E1')).toBe(true);
  });

  it('tek ECU kotası sicilin tamamını almasını engeller', () => {
    const entries: GapEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES_PER_ECU; i++) {
      entries.push(entry({ key: `k${i}`, evidence: ev({ service: `S${i}` }) }));
    }
    const plan = planGapInsert(
      entries, entry({ key: 'new', evidence: ev({ service: 'ZZ' }) }), T0);
    expect(plan.reason).toBe('ECU_QUOTA');
  });

  it('genel tavan KÖR BÜYÜTÜLMEDİ', () => {
    expect(MAX_GAP_ENTRIES).toBe(120);
  });

  it('mevcut satırın sayacını artırmak KOTA TÜKETMEZ', () => {
    for (let i = 0; i < 20; i++) seed({}, T0 + i);
    expect(getGapRegistry()).toHaveLength(1);
    expect(getGapRegistry()[0].count).toBe(20);
    expect(getGapRegistryEvicted()).toBe(0);
  });

  it('gelen kayıt mevcut en değersiz satırdan zayıfsa İÇERİ ALINMAZ', () => {
    const strong: GapEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES_PER_FAMILY; i++) {
      strong.push(entry({ key: `s${i}`, count: 9, resolutionState: 'OPEN' }));
    }
    /* AYNI aileden (aynı ECU/servis) ama kapanmış ve tek gözlemli bir aday. */
    const weak = entry({ key: 'weak', count: 1, resolutionState: 'RESOLVED' });
    const plan = planGapInsert(strong, weak, T0);
    expect(plan.accept).toBe(false);
    expect(plan.evictKey).toBeNull();
    expect(plan.reason).toBe('FAMILY_QUOTA');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) REPLAY / SENTETİK — ürün kalıcılığı YALNIZ canlı kanıt
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · replay/sentetik ürün deposunu kirletmez', () => {
  it('replay kanıtlı boşluk diske YAZILMAZ ama sicilde GÖRÜNÜR', () => {
    recordGap({
      signal: 'CAPABILITY_GAP', scope: 'AUTHORITY', context: 'discovery:1902',
      atMs: T0, evidence: ev({}, 'replay' as never),
    });
    expect(getGapRegistry()).toHaveLength(1);

    const raw = safeGetRaw(KEY());
    const env = JSON.parse(raw!) as { entries: unknown[]; entryCount: number };
    expect(env.entries).toHaveLength(0);
    expect(env.entryCount).toBe(0);
    expect(getGapLedgerNotPersisted()).toBe(1);
  });

  it('restart sonrası replay boşluğu GERİ GELMEZ', () => {
    recordGap({
      signal: 'CAPABILITY_GAP', scope: 'AUTHORITY', context: 'discovery:1902',
      atMs: T0, evidence: ev({}, 'replay' as never),
    });
    _simulateRestartForTest();
    restoreGapLedger(T0 + 1);
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('kanıtsız (legacy) kayıt canlılığını KANITLAYAMAZ → yazılmaz', () => {
    recordGap({ signal: 'PARSER_GAP', scope: 'PARSER', context: 'conformance:live',
      atMs: T0 });
    expect(isGapEntryPersistable(getGapRegistry()[0])).toBe(false);
    _simulateRestartForTest();
    restoreGapLedger(T0 + 1);
    expect(getGapRegistry()).toHaveLength(0);
  });

  it('canlı kanıtlı kayıt yazılır (pozitif kontrol)', () => {
    seed();
    expect(isGapEntryPersistable(getGapRegistry()[0])).toBe(true);
    expect(summarizeGapEvidence().persistable).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) GİZLİLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · gizlilik', () => {
  it('diske yazılan zarf BEYAZ LİSTEDİR — bilinmeyen alan GEÇEMEZ', () => {
    const dirty = {
      ...entry(),
      evidence: {
        ...ev()!,
        rawResponse: '5902FFAA',
        vin: 'WVWZZZ1JZXW000001',
        adapterMac: 'AA:BB:CC:DD:EE:FF',
      },
    } as unknown as GapEntry;
    const clean = JSON.stringify(projectGapEntryForPersist(dirty));
    expect(clean).not.toContain('5902FFAA');
    expect(clean).not.toContain('WVWZZZ');
    expect(clean).not.toContain('AA:BB:CC');
  });

  it('gerçek üretim koşusundan sonra depoda ham yanıt/VIN yok', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1912', nrc: 0x12 }));
    await discover();
    persistGapLedger(T0, true);

    const raw = safeGetRaw(KEY()) ?? '';
    expect(raw).not.toContain('7F1912');
    expect(raw.toLowerCase()).not.toContain('vin');
    expect(raw.toLowerCase()).not.toContain('rawresponse');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) ÇÖZÜCÜ — restart sonrası aynı hedef
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · restart sonrası Self-Healing', () => {
  it('canlı boşluk → persist → runtime sıfırla → reload → aynı bağlam', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await discover();
    persistGapLedger(T0, true);

    /* Uygulama yeniden başladı: TÜM süreç ömürlü defterler gitti. */
    _simulateRestartForTest();
    _resetGapResolverForTest();
    _resetServiceDiscoveryForTest();
    expect(getProbeRecords()).toHaveLength(0);
    expect(restoreGapLedger(T0 + 10_000)).toBe('OK');

    const g = collectResolvableGaps(T0 + 10_000)
      .find((x) => x.target.service === '19');
    expect(g).toBeDefined();
    expect(g!.target.ecuKey).toBe('ECM@7E0');
    expect(g!.lastNrc).toBe(0x22);
    expect(g!.sessionConditioned).toBe(true);
    expect(classifyRootCause(g!)).toBe('SESSION_CONDITIONED');
  });

  it('KAPANMIŞ boşluk restart sonrası boşuna YENİDEN ÖLÇÜLMEZ', async () => {
    seed();
    const k = getGapRegistry()[0].key;
    markGapResolved({
      key: k, evidenceRef: 'c1', classification: 'PRESENT',
      provenance: 'live', resolvedAtMs: T0 + 1, detail: 'kapandı',
    });
    _simulateRestartForTest();
    _resetGapResolverForTest();
    restoreGapLedger(T0 + 2);

    expect(collectResolvableGaps(T0 + 2)).toHaveLength(0);
  });

  it('BAYAT kapanmış boşluk yeniden ölçülebilir — doğum kanıtı SİLİNMEZ', () => {
    seed();
    const k = getGapRegistry()[0].key;
    markGapResolved({
      key: k, evidenceRef: 'c1', classification: 'PRESENT',
      provenance: 'live', resolvedAtMs: T0 + 1, detail: 'kapandı',
    });
    const later = T0 + CAPABILITY_FRESH_MS + 1;
    const gaps = collectResolvableGaps(later);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].lastNrc).toBe(0x12);
    /* Eski doğum kanıtı ve kapanış kanıtı DURUYOR. */
    const e = getGapEntry(k)!;
    expect(e.evidence!.observedNrc).toBe(0x12);
    expect(e.resolution!.evidenceRef).toBe('c1');
  });

  it('çözülen boşluğun kapanışı KALICI olur (restart sonrası da kapalı)', async () => {
    bridge(() => ({ outcome: 'negative_nrc', kind: 'NEGATIVE', raw: '7F1922', nrc: 0x22 }));
    await discover();
    sent = [];
    bridge(() => ({
      outcome: 'ok', kind: 'OK', raw: '5902FFAA',
      sessionOpened: true, sessionCommand: '1003',
    }));
    const res = await runGapResolution(rctx());
    expect(res.resolved).toBeGreaterThan(0);

    _simulateRestartForTest();
    restoreGapLedger(T0 + 10_000);
    const closed = getGapRegistry().filter((r) => r.resolutionState === 'RESOLVED');
    expect(closed.length).toBeGreaterThan(0);
    expect(closed[0].resolution).not.toBeNull();
    expect(closed[0].evidence!.observedNrc).toBe(0x22);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9) LAB — salt-okunur
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5E · CAROS LAB kalıcılık yüzeyi', () => {
  it('LAB okuması YAZIM/ÇÖZÜM/YOKLAMA tetiklemez', () => {
    seed();
    const rawBefore = safeGetRaw(KEY());
    const savedBefore = getGapLedgerSavedAt();

    readGapResolverSnapshot();
    buildResolverCards(readGapResolverSnapshot());

    expect(safeGetRaw(KEY())).toBe(rawBefore);
    expect(getGapLedgerSavedAt()).toBe(savedBefore);
    expect(sent).toHaveLength(0);
  });

  it('kalıcılık kartı sağlık · şema · eviction gerekçelerini gösterir', () => {
    for (let i = 0; i < 40; i++) seed({ nrc: 0x20 + i }, T0 + i);
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'persistence')!;
    expect(card.fields.find((f) => f.id === 'psschema')!.value)
      .toBe(String(GAP_LEDGER_SCHEMA_VERSION));
    expect(card.fields.find((f) => f.id === 'psreasons')!.value)
      .toContain('aile kotası');
    expect(Number(card.fields.find((f) => f.id === 'psevicted')!.value))
      .toBeGreaterThanOrEqual(0);
  });

  it('BOZUK depo LAB\'da KAYNAK YOK olarak görünür (sessiz "temiz" YOK)', () => {
    _writeRawGapLedgerForTest('bozuk');
    _simulateRestartForTest();
    loadGapLedger();
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'persistence')!;
    const state = card.fields.find((f) => f.id === 'psstate')!;
    expect(state.klass).toBe('UNAVAILABLE');
    expect(state.note).toContain('FAIL-CLOSED');
  });

  it('HİÇ yazılmadı ile BAŞARISIZ yazım AYRI gösterilir', () => {
    _simulateRestartForTest();
    loadGapLedger();
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'persistence')!;
    const f = card.fields.find((x) => x.id === 'pssaveok')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('DEĞİLDİR');
  });
});
