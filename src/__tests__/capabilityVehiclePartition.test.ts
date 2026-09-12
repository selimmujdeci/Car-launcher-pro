/**
 * capabilityVehiclePartition.test — P0-VDK-F5G · FİZİKSEL ARAÇ BÖLÜMLENMESİ + BÖLÜM GC.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * Yetenek öğrenmesi FİZİKSEL olarak araca bağlı; Araç A'nın deposu bozulunca
 * Araç B etkilenmiyor; araç takası çapraz öğrenme üretmiyor; boşluk sicili ve
 * yetenek deposu **AYNI** kimlik kapsamını kullanıyor; zayıf/replay kimlik
 * ürün deposu açmıyor; bölüm sayısı deterministik GC ile sınırlı ve **aktif
 * araç hiçbir koşulda silinmiyor**.
 *
 * ⚠️ `getVehicleCapabilities(vehicleId)` süzgeci PASS DEĞİLDİR: bu dosya
 * dosyaların gerçekten ayrı olduğunu (bir dosyayı bozup diğerini okuyarak)
 * kanıtlar.
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

/**
 * `safeStorage` GERÇEK kalır; yalnız SİLME yolu kontrol edilebilir hâle gelir.
 * Amaç: `safeStorage` bir işlem (transaction) sunmadığı için yarım kalan bir
 * temizliğin FAIL-CLOSED göründüğünü kanıtlamak.
 */
const storageMock = vi.hoisted(() => ({ blockRemoval: false }));
vi.mock('../utils/safeStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/safeStorage')>();
  return {
    ...actual,
    safeRemoveRaw: (key: string): void => {
      if (storageMock.blockRemoval) return;
      actual.safeRemoveRaw(key);
    },
  };
});

import { CarLauncher } from '../platform/nativePlugin';
import {
  loadCapabilityStore, persistCapabilityStore, recordCapabilityObservation,
  getCapabilityEdges, getCapabilityEdge, getCapabilityHealth,
  getCapabilityStorageKey, getCapabilityScope, getCapabilityBlockedWrites,
  getCapabilityForeignSkipped, CAPABILITY_SCHEMA_VERSION,
  _resetCapabilityStoreForTest, _simulateCapabilityRestartForTest,
  _writeRawStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import type {
  CapabilityObservationInput, TransportConstraint,
} from '../platform/obd/capability/capabilityGraph';
import { CAPABILITY_FRESH_MS } from '../platform/obd/capability/capabilityGraph';
import { buildCapabilityFingerprint }
  from '../platform/obd/capability/capabilityFingerprint';
import {
  CAPABILITY_KEY_PREFIX, GAP_LEDGER_KEY_PREFIX, ECU_ROLE_KEY_PREFIX,
  LEGACY_UNSCOPED_CAPABILITY_KEY, capabilityKeyFor, vehiclePartitionKeys,
} from '../platform/obd/gapLedgerScope';
import {
  MAX_VEHICLE_PARTITIONS, comparePartitionGcOrder, isPartitionStale,
  partitionRetentionRank, planPartitionGc,
  type VehiclePartitionEntry,
} from '../platform/obd/vehiclePartitionPolicy';
import {
  getVehiclePartitions, getPartitionEvictedTotal,
  getPartitionPartialGcCount, loadPartitionCatalog, runPartitionGc,
  touchVehiclePartition, PARTITION_CATALOG_KEY,
  _resetPartitionCatalogForTest, _writeRawCatalogForTest,
} from '../platform/obd/vehiclePartitionCatalog';
import { activateVehicleDiagnosticContext }
  from '../platform/obd/vehicleDiagnosticContext';
import {
  recordGap, getGapRegistry, getGapLedgerScope, getGapLedgerStorageKey,
  _resetGapRegistryForTest,
} from '../platform/obd/gapRegistry';
import { buildGapEvidence } from '../platform/obd/gapEvidence';
import { _resetGapResolverForTest }
  from '../platform/obd/healing/gapResolverRuntime';
import { _resetServiceDiscoveryForTest }
  from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';
import { readGapResolverSnapshot }
  from '../platform/devtools/gapResolverSources';
import { buildResolverCards } from '../platform/devtools/gapResolverModel';

/* ══════════════════════════════════════════════════════════════════════════
   ORTAM
   ══════════════════════════════════════════════════════════════════════════ */

const T0 = 1_000_000;

/** Kimlikler MEVCUT F4-C parmak izinden — uydurma karma YOK. */
const fp = (vin: string, tx: string, sig: string) => buildCapabilityFingerprint(
  { protocol: '6', supportedPidBitmap: 'BE1FA813', vin },
  [{ txHeader: tx, rxHeader: '7E8', protocol: '6', responseSignature: sig,
    calibrationDid: 'F189', calibrationValueHash: `h${tx}` }],
).id;

const A = fp('VF1AAAA00A0000001', '7E0', '59:02');
const B = fp('WVW00000000000002', '7E2', '59:0A');
const C = fp('TMB00000000000003', '7E4', '59:06');

const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: 'generic_only', adapterHash: 'ad1' };

/** Aracı bağla — üretim yolunun (`productionDiscovery`) yaptığının aynısı. */
function connect(ref: string | null, over: Record<string, unknown> = {}) {
  return activateVehicleDiagnosticContext({
    vehicleRef: ref, fingerprintReusable: true,
    provenance: 'live', traceMode: 'live', nowMs: T0,
    ...over,
  } as Parameters<typeof activateVehicleDiagnosticContext>[0]);
}

const OBS = (
  vehicleId: string, over: Partial<CapabilityObservationInput> = {},
): CapabilityObservationInput => ({
  vehicleId, ecuId: 'E1', service: '19', subFunction: '02',
  presence: 'PRESENT', provenance: 'live', protocol: '6',
  transport: TRANSPORT, evidenceRef: 'c1', nrc: null, atMs: T0, ...over,
});

const gapEv = (nrc: number) => buildGapEvidence({
  observation: {
    ecuKey: 'ECM@7E0', txHeader: '7E0', rxHeader: '7E8',
    service: '19', subFunction: '02', requestIdentity: '1902FF',
    outcome: 'NEGATIVE', nrc, classification: 'PRESENT_BUT_CONDITIONED',
    sessionOpened: null, sessionCommand: null,
    transportKind: 'elm327_classic', protocol: '6',
    traceCorrelationId: 'corr-1', atMs: T0,
  },
  transactionId: 'txn-1', provenance: 'live',
});

const entry = (
  ref: string, over: Partial<VehiclePartitionEntry> = {},
): VehiclePartitionEntry => ({
  ref, createdAt: T0, lastUsedAt: T0, gapEntries: 1, unresolvedGaps: 0,
  capabilityEdges: 1, health: 'OK', ...over,
});

function wipe(): void {
  for (const ref of [A, B, C]) {
    for (const k of vehiclePartitionKeys(ref)) {
      try { safeRemoveRaw(k); } catch { /* yok say */ }
    }
  }
  for (const k of [LEGACY_UNSCOPED_CAPABILITY_KEY, PARTITION_CATALOG_KEY]) {
    try { safeRemoveRaw(k); } catch { /* yok say */ }
  }
}

beforeEach(() => {
  _resetCapabilityStoreForTest();
  _resetGapRegistryForTest();
  _resetPartitionCatalogForTest();
  _resetGapResolverForTest();
  _resetServiceDiscoveryForTest();
  wipe();
});
afterEach(() => {
  delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
  _resetCapabilityStoreForTest();
  _resetGapRegistryForTest();
  _resetPartitionCatalogForTest();
  _resetGapResolverForTest();
  _resetServiceDiscoveryForTest();
  wipe();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) FİZİKSEL BÖLÜM SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · fiziksel bölüm sözleşmesi', () => {
  it('anahtar MEVCUT parmak izi karmasından türer (ham VIN/MAC YOK)', () => {
    expect(capabilityKeyFor(A)).toBe(`${CAPABILITY_KEY_PREFIX}:${A}`);
    expect(capabilityKeyFor('VF1AAAA00A0000001')).toBeNull();
    expect(capabilityKeyFor('AA:BB:CC:DD:EE:FF')).toBeNull();
    expect(A).toMatch(/^[0-9a-f]{16}$/);
  });

  /* P0-VDK-F6A — KİLİT GÜNCELLENDİ (kaldırılmadı): araca üçüncü bir kalıcı
     bölüm eklendi (ECU rol öğrenmesi) ve bu kilidin AMACI tam olarak onu
     yakalamaktır — yeni bir bölüm türü `vehiclePartitionKeys`e eklenmezse
     çöp toplama aracın yarısını siler, geride SAHİPSİZ bir dosya kalırdı. */
  it('bir aracın TÜM bölümleri tek listede toplanır (yarım GC kalkanı)', () => {
    expect(vehiclePartitionKeys(A)).toEqual([
      `${CAPABILITY_KEY_PREFIX}:${A}`,
      `${GAP_LEDGER_KEY_PREFIX}:${A}`,
      `${ECU_ROLE_KEY_PREFIX}:${A}`,
    ]);
  });

  it('A ve B AYRI dosyalara yazar', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    connect(B);
    recordCapabilityObservation(OBS(B), true);

    const rawA = safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`);
    const rawB = safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${B}`);
    expect(rawA).not.toBeNull();
    expect(rawB).not.toBeNull();
    expect(rawA).not.toBe(rawB);
    expect(rawA!).toContain(A);
    expect(rawA!).not.toContain(B);
  });

  it('dosya SAHİBİNİ taşır ve yabancı kenar YAZILMAZ', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), false);
    recordCapabilityObservation(OBS(B, { ecuId: 'E9' }), false);   // yabancı
    expect(persistCapabilityStore(true, T0)).toBe(true);
    expect(getCapabilityForeignSkipped()).toBe(1);

    const env = JSON.parse(safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`)!) as
      { vehicleRef: string; edgeCount: number; edges: { vehicleId: string }[] };
    expect(env.vehicleRef).toBe(A);
    expect(env.edgeCount).toBe(1);
    expect(env.edges.every((e) => e.vehicleId === A)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ARAÇ TAKASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · araç takası', () => {
  it('A öğrenir → B\'de A kenarları GÖRÜNMEZ → A tekrar geri gelir', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    expect(getCapabilityEdges()).toHaveLength(1);

    connect(B);
    expect(getCapabilityEdges()).toHaveLength(0);
    expect(getCapabilityEdge(A, 'E1', '19', '02')).toBeNull();

    recordCapabilityObservation(OBS(B), true);
    expect(getCapabilityEdges()).toHaveLength(1);

    connect(A);
    expect(getCapabilityEdges()).toHaveLength(1);
    expect(getCapabilityEdge(A, 'E1', '19', '02')?.presence).toBe('PRESENT');
  });

  it('B\'nin yazımı A\'nın dosyasına GİTMEZ', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    const rawA = safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`);

    connect(B);
    recordCapabilityObservation(OBS(B, { ecuId: 'E2' }), true);
    expect(safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`)).toBe(rawA);
  });

  it('restart sonrası A kendi öğrenmesini geri alır', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);

    _simulateCapabilityRestartForTest();
    expect(getCapabilityEdges()).toHaveLength(0);

    connect(A);
    expect(getCapabilityHealth()).toBe('OK');
    expect(getCapabilityEdges()).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) BOZULMA İZOLASYONU — asıl PASS ölçütü
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · bozulma izolasyonu', () => {
  it('A deposu BOZUKSA B ETKİLENMEZ', () => {
    connect(B);
    recordCapabilityObservation(OBS(B), true);
    connect(A);
    recordCapabilityObservation(OBS(A), true);

    /* A'nın dosyası bozuldu (güç kesintisi) ve bu ANCAK bir sonraki
       başlatmada fark edilir — sıra gerçek hayattaki gibidir. */
    safeSetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`, '{bozuk', undefined, true);
    _simulateCapabilityRestartForTest();

    connect(A);
    expect(getCapabilityHealth()).toBe('CORRUPT');
    expect(getCapabilityEdges()).toHaveLength(0);

    connect(B);
    expect(getCapabilityHealth()).toBe('OK');
    expect(getCapabilityEdges()).toHaveLength(1);
    expect(getCapabilityEdge(B, 'E1', '19', '02')?.presence).toBe('PRESENT');
  });

  it('bilinmeyen şema bölümde de fail-closed REDDEDİLİR', () => {
    connect(A);
    _writeRawStoreForTest(JSON.stringify({
      schemaVersion: CAPABILITY_SCHEMA_VERSION + 50,
      vehicleRef: A, edgeCount: 0, savedAt: T0, edges: [],
    }));
    expect(loadCapabilityStore()).toBe('SCHEMA_MISMATCH');
    expect(getCapabilityEdges()).toHaveLength(0);
  });

  it('YARIM yazılmış bölüm (sayaç ≠ kenar) güvenilir SAYILMAZ', () => {
    connect(A);
    _writeRawStoreForTest(JSON.stringify({
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      vehicleRef: A, edgeCount: 7, savedAt: T0, edges: [],
    }));
    expect(loadCapabilityStore()).toBe('CORRUPT');
  });

  it('BAŞKA aracın kenarını taşıyan dosya BOZUK sayılır (sahiplik kilidi)', () => {
    connect(A);
    _writeRawStoreForTest(JSON.stringify({
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      vehicleRef: A, edgeCount: 1, savedAt: T0,
      edges: [{
        vehicleId: B, ecuId: 'E1', service: '19', subFunction: '02',
        presence: 'PRESENT', provenance: 'live', productTrusted: true,
        protocol: '6', transport: TRANSPORT, firstSeenMs: T0, lastSeenMs: T0,
        observationCount: 1, evidenceRefs: ['c'], lastNrc: null,
        consecutiveSame: 1, conflict: null,
      }],
    }));
    expect(loadCapabilityStore()).toBe('CORRUPT');
    expect(getCapabilityEdges()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) ZAYIF / REPLAY KİMLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · zayıf ve replay kimlik', () => {
  it('ZAYIF kimlik kalıcı yetenek bölümü AÇAMAZ (bellek içi öğrenme)', () => {
    connect(A, { fingerprintReusable: false });
    expect(getCapabilityScope().state).toBe('EPHEMERAL_WEAK_IDENTITY');
    expect(getCapabilityStorageKey()).toBeNull();

    recordCapabilityObservation(OBS(A), true);
    expect(getCapabilityEdges()).toHaveLength(1);            // bellekte VAR
    expect(safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`)).toBeNull();
    expect(getCapabilityBlockedWrites()).toBeGreaterThan(0);
  });

  it('ZAYIF kimlik BAŞKA aracın öğrenmesini YÜKLEMEZ', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    _simulateCapabilityRestartForTest();

    connect(A, { fingerprintReusable: false });
    expect(getCapabilityEdges()).toHaveLength(0);
  });

  it('REPLAY kökeni ürün bölümünü ne yükler ne kirletir', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    const rawA = safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`);

    connect(A, { provenance: 'replay' });
    expect(getCapabilityScope().state).toBe('EPHEMERAL_REPLAY');
    expect(getCapabilityEdges()).toHaveLength(0);
    recordCapabilityObservation(OBS(A, { presence: 'ABSENT' }), true);

    /* Gerçek aracın dosyası BAYT BAYT aynı. */
    expect(safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`)).toBe(rawA);
  });

  it('KAPSAMSIZ eski global depo hiçbir araca yüklenmez', () => {
    safeSetRaw(LEGACY_UNSCOPED_CAPABILITY_KEY, JSON.stringify({
      schemaVersion: 1,
      edges: [{
        vehicleId: A, ecuId: 'E1', service: '19', subFunction: '02',
        presence: 'PRESENT', provenance: 'live', productTrusted: true,
        protocol: '6', transport: TRANSPORT, firstSeenMs: T0, lastSeenMs: T0,
        observationCount: 1, evidenceRefs: ['c'], lastNrc: null,
        consecutiveSame: 1, conflict: null,
      }],
    }), undefined, true);

    connect(A);
    expect(getCapabilityEdges()).toHaveLength(0);
    /* Eski dosya EZİLMEDİ de — kanıtsız silme de bir karardır. */
    expect(safeGetRaw(LEGACY_UNSCOPED_CAPABILITY_KEY)).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) GAP ↔ CAPABILITY PARİTESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · sicil ↔ öğrenme paritesi', () => {
  it('iki depo HER ZAMAN aynı araca bakar', () => {
    connect(A);
    expect(getGapLedgerScope().vehicleRef).toBe(A);
    expect(getCapabilityScope().vehicleRef).toBe(A);
    expect(getGapLedgerStorageKey()).toBe(`${GAP_LEDGER_KEY_PREFIX}:${A}`);
    expect(getCapabilityStorageKey()).toBe(`${CAPABILITY_KEY_PREFIX}:${A}`);

    connect(B);
    expect(getGapLedgerScope().vehicleRef).toBe(B);
    expect(getCapabilityScope().vehicleRef).toBe(B);
  });

  it('tek çağrı iki depoyu ve iki defteri BİRLİKTE bağlar', () => {
    connect(A);
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: gapEv(0x22) });
    recordCapabilityObservation(OBS(A), true);

    const act = connect(B);
    expect(act.switched).toBe(true);
    expect(act.detachedRef).toBe(A);
    expect(getGapRegistry()).toHaveLength(0);
    expect(getCapabilityEdges()).toHaveLength(0);
  });

  it('AYNI araca yeniden bağlanmak takas SAYILMAZ (epoch ≠ kimlik)', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    const again = connect(A, { nowMs: T0 + 60_000 });
    expect(again.switched).toBe(false);
    expect(getCapabilityEdges()).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) ÖĞRENME SEMANTİĞİ DEĞİŞMEDİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · F4-C öğrenme kuralları AYNEN korunur', () => {
  it('UNKNOWN ölçülmüş PRESENT\'i EZMEZ', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), false);
    recordCapabilityObservation(OBS(A, { presence: 'UNKNOWN', atMs: T0 + 10 }), false);
    expect(getCapabilityEdge(A, 'E1', '19', '02')?.presence).toBe('PRESENT');
  });

  it('PRESENT→ABSENT kota dolana kadar PRESENT kalır ve ÇELİŞKİ üretir', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), false);
    recordCapabilityObservation(OBS(A, { presence: 'ABSENT', atMs: T0 + 10 }), false);
    const e = getCapabilityEdge(A, 'E1', '19', '02')!;
    expect(e.presence).toBe('PRESENT');
    expect(e.conflict).not.toBeNull();
  });

  it('replay kanıtı productTrusted ÜRETMEZ', () => {
    connect(A);
    recordCapabilityObservation(OBS(A, { provenance: 'replay' }), false);
    expect(getCapabilityEdge(A, 'E1', '19', '02')?.productTrusted).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) BÖLÜM KATALOĞU
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · bölüm kataloğu', () => {
  it('katalog yalnız METADATA tutar (ham kenar/boşluk YOK)', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    recordGap({ signal: 'CAPABILITY_GAP', scope: 'AUTHORITY',
      context: 'discovery:1902', atMs: T0, evidence: gapEv(0x22) });
    connect(B);          // A'yı yaz ve ayrıl
    connect(A);          // katalog tazelensin

    const raw = safeGetRaw(PARTITION_CATALOG_KEY) ?? '';
    expect(raw).toContain(A);
    expect(raw).not.toContain('7E8');            // ham kenar alanı yok
    expect(raw).not.toContain('PRESENT_BUT_CONDITIONED');
    expect(raw).not.toContain('VF1AAAA');
    const rows = getVehiclePartitions();
    expect(rows.some((r) => r.ref === A)).toBe(true);
  });

  it('bozuk katalog fail-closed boş başlar', () => {
    _writeRawCatalogForTest('{bozuk');
    expect(loadPartitionCatalog()).toBe('CORRUPT');
    expect(getVehiclePartitions()).toHaveLength(0);
  });

  it('YARIM katalog (sayaç ≠ satır) reddedilir', () => {
    _writeRawCatalogForTest(JSON.stringify({
      schemaVersion: 1, savedAt: T0, entryCount: 3,
      entries: [entry(A)], lastGcAt: null, evictedTotal: 0,
    }));
    expect(loadPartitionCatalog()).toBe('CORRUPT');
  });

  it('parmak izi biçiminde OLMAYAN referans katalogda yer ALMAZ', () => {
    touchVehiclePartition({
      ref: 'V1', nowMs: T0, gapEntries: 1, unresolvedGaps: 1,
      capabilityEdges: 1, health: 'OK',
    });
    expect(getVehiclePartitions()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) ÇÖP TOPLAMA
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · bölüm çöp toplama', () => {
  it('tavan aşılmadıkça hiçbir bölüm silinmez', () => {
    const plan = planPartitionGc([entry(A), entry(B)], A, T0);
    expect(plan.evict).toHaveLength(0);
    expect(plan.reason).toContain('tavan');
  });

  it('AKTİF araç HİÇBİR koşulda aday DEĞİLDİR', () => {
    const many = Array.from({ length: MAX_VEHICLE_PARTITIONS + 3 }, (_, i) =>
      entry(`${i}`.padStart(16, '0'), { lastUsedAt: T0 - i * 1000 }));
    /* Aktif araç EN DEĞERSİZ olan olsun. */
    const active = many[many.length - 1].ref;
    const plan = planPartitionGc(many, active, T0);
    expect(plan.evict).not.toContain(active);
    expect(plan.activeProtected).toBe(true);
    expect(plan.evict.length).toBe(many.length - MAX_VEHICLE_PARTITIONS);
  });

  it('KAPANMAMIŞ boşluğu olan araç, olmayandan ÖNCE silinmez', () => {
    const withGaps = entry(A, { unresolvedGaps: 3, lastUsedAt: T0 - 10_000_000 });
    const clean = entry(B, { unresolvedGaps: 0, lastUsedAt: T0 });
    expect(partitionRetentionRank(withGaps, T0))
      .toBeGreaterThan(partitionRetentionRank(clean, T0));
    expect(comparePartitionGcOrder(clean, withGaps, T0)).toBeLessThan(0);
  });

  it('BAYAT bölüm taze bölümden önce feda edilir', () => {
    const fresh = entry(A, { lastUsedAt: T0 });
    const stale = entry(B, { lastUsedAt: T0 - CAPABILITY_FRESH_MS - 1 });
    expect(isPartitionStale(stale, T0 + 1)).toBe(true);
    expect(comparePartitionGcOrder(stale, fresh, T0 + 1)).toBeLessThan(0);
  });

  it('seçim DETERMİNİSTİKTİR — aynı girdi aynı bölümü seçer', () => {
    const set = [entry(A, { lastUsedAt: T0 - 3 }), entry(B, { lastUsedAt: T0 - 2 }),
      entry(C, { lastUsedAt: T0 - 1 })];
    const p1 = planPartitionGc(set, null, T0, 2);
    const p2 = planPartitionGc(set, null, T0, 2);
    expect(p1.evict).toEqual(p2.evict);
    expect(p1.evict).toEqual([A]);
  });

  it('GC her iki bölüm dosyasını da siler ve katalogdan düşer', () => {
    for (const ref of [A, B, C]) {
      safeSetRaw(`${CAPABILITY_KEY_PREFIX}:${ref}`, '{}', undefined, true);
      safeSetRaw(`${GAP_LEDGER_KEY_PREFIX}:${ref}`, '{}', undefined, true);
      touchVehiclePartition({
        ref, nowMs: T0 - (ref === A ? 9_000 : 1), gapEntries: 0,
        unresolvedGaps: 0, capabilityEdges: 0, health: 'OK',
      });
    }
    const res = runPartitionGc(C, T0, 2);
    expect(res.removed).toHaveLength(1);
    expect(res.removed[0]).toBe(A);
    expect(safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`)).toBeNull();
    expect(safeGetRaw(`${GAP_LEDGER_KEY_PREFIX}:${A}`)).toBeNull();
    expect(getVehiclePartitions().some((e) => e.ref === A)).toBe(false);
    expect(getPartitionEvictedTotal()).toBe(1);
    /* AKTİF araç DURUYOR. */
    expect(safeGetRaw(`${GAP_LEDGER_KEY_PREFIX}:${C}`)).not.toBeNull();
  });

  it('silme başarısızsa YARIM TEMİZLİK olarak GÖRÜNÜR (sessiz başarı YOK)', () => {
    for (const ref of [A, B]) {
      touchVehiclePartition({
        ref, nowMs: ref === A ? T0 - 9_000 : T0, gapEntries: 0,
        unresolvedGaps: 0, capabilityEdges: 0, health: 'OK',
      });
    }
    safeSetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`, '{}', undefined, true);

    /* Silme YOLUNU etkisiz kıl: `safeStorage` bir işlem (transaction) sunmaz,
       bu yüzden "sildim" demek yetmez — silinmiş OLDUĞU ölçülür. */
    storageMock.blockRemoval = true;
    const res = runPartitionGc(B, T0, 1);
    storageMock.blockRemoval = false;

    expect(res.removed).toHaveLength(0);
    expect(res.partial).toEqual([A]);
    expect(getPartitionPartialGcCount()).toBeGreaterThan(0);
    expect(getVehiclePartitions().find((e) => e.ref === A)?.health)
      .toBe('PARTIAL_GC');
  });

  it('bağlama sırasında tavan aşılırsa GC KOŞAR ve aktif araç korunur', () => {
    for (let i = 0; i < MAX_VEHICLE_PARTITIONS + 2; i++) {
      const ref = `${i}`.padStart(16, '0');
      touchVehiclePartition({
        ref, nowMs: T0 - (MAX_VEHICLE_PARTITIONS + 2 - i) * 1000,
        gapEntries: 0, unresolvedGaps: 0, capabilityEdges: 0, health: 'OK',
      });
    }
    const act = connect(A);
    expect(act.gc).not.toBeNull();
    expect(act.gc!.plan.evict).not.toContain(A);
    expect(getVehiclePartitions().length).toBeLessThanOrEqual(MAX_VEHICLE_PARTITIONS);
    expect(getVehiclePartitions().some((e) => e.ref === A)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9) LAB
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5G · CAROS LAB bölüm yüzeyi', () => {
  it('LAB okuması yazım/GC/bağlama TETİKLEMEZ', () => {
    connect(A);
    recordCapabilityObservation(OBS(A), true);
    const before = safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`);
    const catBefore = safeGetRaw(PARTITION_CATALOG_KEY);
    const evictedBefore = getPartitionEvictedTotal();

    readGapResolverSnapshot();
    buildResolverCards(readGapResolverSnapshot());

    expect(safeGetRaw(`${CAPABILITY_KEY_PREFIX}:${A}`)).toBe(before);
    expect(safeGetRaw(PARTITION_CATALOG_KEY)).toBe(catBefore);
    expect(getPartitionEvictedTotal()).toBe(evictedBefore);
  });

  it('parite SAĞLAMSA ekran bunu söyler; ham VIN GÖSTERİLMEZ', () => {
    connect(A);
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    const parity = card.fields.find((f) => f.id === 'vparity')!;
    expect(parity.klass).toBe('OBSERVED');
    expect(parity.value).toContain('PARİTE SAĞLAM');
    expect(card.fields.find((f) => f.id === 'cpart')!.value)
      .toBe(`${CAPABILITY_KEY_PREFIX}:${A}`);
    expect(JSON.stringify(card)).not.toContain('VF1AAAA');
  });

  it('KAYNAK YOK ile gerçek 0 AYRI gösterilir', () => {
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    expect(card.fields.find((f) => f.id === 'cpart')!.klass).toBe('UNAVAILABLE');
    expect(card.fields.find((f) => f.id === 'vparity')!.klass).toBe('UNAVAILABLE');
  });

  it('bölüm sayısı ve tavanı ekranda ÖLÇÜM olarak görünür', () => {
    connect(A);
    connect(B);
    const card = buildResolverCards(readGapResolverSnapshot())
      .find((c) => c.id === 'vehicle')!;
    const f = card.fields.find((x) => x.id === 'pcount')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toContain(`tavan ${MAX_VEHICLE_PARTITIONS}`);
  });
});
