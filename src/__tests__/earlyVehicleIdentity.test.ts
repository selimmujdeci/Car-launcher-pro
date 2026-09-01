/**
 * earlyVehicleIdentity.test — P0-VDK-F5H · ERKEN ARAÇ KİMLİĞİ / KALİBRASYON PARMAK İZİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev §20 — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 *  1. TAM ARAÇ TARAMASINDAN ÖNCE, salt-okunur ve kanıtlı ölçümle güçlü parmak
 *     izi üretilebiliyor.
 *  2. Parmak izi MEVCUT F4-C otoritesinden geliyor (ikinci kimlik sistemi yok).
 *  3. Doğru araç tanı bağlamı ERKEN aktive oluyor.
 *  4. Boşluk sicili + yetenek bölümü tam tarama BEKLENMEDEN hydrate ediliyor.
 *  5. Başarısız/zayıf kimlik BAŞKA aracın geçmişini YÜKLEMİYOR.
 *  6. Erken ↔ tam tarama çelişkisi FAIL-CLOSED.
 *  7. Ham kalibrasyon/VIN kalıcı kimliğe/depoya SIZMIYOR.
 *  8. Erken kimlik düşse bile normal OBD akışı ETKİLENMİYOR.
 *
 * ⚠️ "`22 xxxx` okundu" PASS DEĞİLDİR: bu dosya zincirin tamamını
 * (CONNECT → EARLY IDENTITY → FINGERPRINT → ACTIVATION → HYDRATION) ölçer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const epochRef = { value: 7 };

/* `safeStorage` native dalda Filesystem API'sine yazar; tezgâhta kalıcılığın
   GERÇEKTEN ölçülebilmesi için web dalı (localStorage) seçilir — mevcut
   `capabilityVehiclePartition.test` ile AYNI karar. */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    probeEcus:          vi.fn(),
    readDtcFromEcu:     vi.fn(),
    readUdsDtcs:        vi.fn(),
    readAdvancedDtcs:   vi.fn(),
    sendTesterPresent:  vi.fn(),
    sendDiagnosticPdu:  vi.fn(),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({
    connectionState: 'connected', transportConnected: true,
    dataFresh: true, source: 'real',
  }),
  getObdSessionHealth: () => ({
    transportReady: true, sessionReady: true, pollingActive: true,
    dataFresh: true, ready: true,
  }),
  getEcuRecoveryLadder: () => ({ inFlight: false, nativeReconnectInFlight: false }),
  getObdSessionEpoch: () => epochRef.value,
  getHandshakeDiagnostics: () => ({ protocolActive: '6', protocolTried: null }),
  onOBDData: () => () => { /* abonelik testte kullanılmaz */ },
}));

import { CarLauncher } from '../platform/nativePlugin';
import { buildTopology } from '../platform/obd/ecuDiscovery';
import type { DiscoveredEcu } from '../platform/obd/ecuDiscovery';
import { setActiveObdProtocol } from '../platform/obd/activeProtocol';
import {
  runEarlyVehicleIdentity, reconcileEarlyIdentityWithScan,
  getEarlyIdentityAnchor, getLastEarlyIdentity, earlyIdentityEverEvaluated,
  selectEarlyIdentityTarget, _resetEarlyVehicleIdentityForTest,
} from '../platform/obd/identity/earlyVehicleIdentity';
import {
  EARLY_IDENTITY_DID_ORDER, buildCalibrationEvidence, classifyDidProbe,
  deriveEarlyIdentityOutcome, evaluateEarlyIdentityAdmission,
  evidenceLeaksRawValue, mayTryNextDid, reconcileVehicleIdentity,
  type CalibrationReading,
} from '../platform/obd/identity/earlyIdentityModel';
import {
  buildCapabilityFingerprint, isFingerprintReusable,
} from '../platform/obd/capability/capabilityFingerprint';
import {
  _resetTransactionsForTest, _setTransactionClockForTest, DEFAULT_BUDGETS,
} from '../platform/obd/diagnosticTransaction';
import {
  _resetSchedulerForTest, _setSchedulerClockForTest,
} from '../platform/obd/diagnosticSessionScheduler';
import {
  getTraceEvents, setTraceProvenanceMode,
  _resetTraceForTest, _setTraceClocksForTest,
} from '../platform/obd/canonicalTrace';
import {
  recordGap, persistGapLedger, getGapRegistry, getGapLedgerScope,
  getGapLedgerStorageKey, _resetGapRegistryForTest, _simulateRestartForTest,
} from '../platform/obd/gapRegistry';
import { buildGapEvidence } from '../platform/obd/gapEvidence';
import {
  getCapabilityScope, getCapabilityStorageKey, persistCapabilityStore,
  recordCapabilityObservation, getCapabilityEdges,
  _resetCapabilityStoreForTest, _simulateCapabilityRestartForTest,
} from '../platform/obd/capability/capabilityStore';
import { _resetPartitionCatalogForTest } from '../platform/obd/vehiclePartitionCatalog';
import { _resetGapResolverForTest } from '../platform/obd/healing/gapResolverRuntime';
import { _resetServiceDiscoveryForTest } from '../platform/obd/discovery/serviceDiscoveryRuntime';
import { _resetPhysicalProbesForTest } from '../platform/obd/physicalEcuProbe';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import { readEarlyIdentitySnapshot } from '../platform/devtools/earlyIdentitySources';
import {
  buildEarlyIdentityCards, deriveEarlyIdentityVerdict,
} from '../platform/devtools/earlyIdentityLabModel';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

/* ══════════════════════════════════════════════════════════════════════════
   TEZGÂH — gerçek native yok, ölçülmüş yanıt var
   ══════════════════════════════════════════════════════════════════════════ */

interface PduCall {
  service: string; subFunction: string; payload: string;
  tx: string; rx: string; echoBytes: number;
}

/** Ham kimlik gövdeleri — TESTİN İÇİNDE kalır, üründe hiçbir yere yazılmaz. */
const SERIAL_A = '564D31323334353637';   // "VM1234567"
const SERIAL_B = '564D39393939393939';   // "VM9999999"

let calls: PduCall[] = [];
let responder: (c: PduCall) => Record<string, unknown>;

function ok(raw: string): Record<string, unknown> {
  return { outcome: 'ok', raw, kind: 'OK', gate: 'OK', latencyMs: 12,
    byteCount: raw.length / 2, frameCount: 1 };
}
function neg(nrc: number): Record<string, unknown> {
  return { outcome: 'negative_nrc', raw: '', kind: 'NEG_7F', gate: 'OK',
    nrc, latencyMs: 9 };
}
function silence(kind: 'no_response' | 'timeout' | 'malformed' | 'transport_error') {
  return { outcome: kind, raw: '', kind: 'NO_DATA', gate: 'OK', latencyMs: 40 };
}

/** Yalnız `F18C`ye cevap veren bir araç (INSTANCE kimliği). */
function vehicleRespondingWithSerial(serial: string) {
  return (c: PduCall): Record<string, unknown> =>
    c.service === '22' && c.payload === 'F18C' ? ok(serial) : neg(0x11);
}

const clock = { t: 10_000 };
const mono = { t: 0 };

/** Aktif kapsama CANLI kanıtlı bir boşluk yazar (mevcut sinyal sözlüğü). */
function seedGap(correlationId: string): void {
  recordGap({
    signal: 'CAPABILITY_GAP', scope: 'AUTHORITY', context: 'discovery:1902',
    atMs: clock.t,
    evidence: buildGapEvidence({
      observation: {
        ecuKey: 'ECM@7E0', txHeader: '7E0', rxHeader: '7E8',
        service: '19', subFunction: '02', requestIdentity: '1902FF',
        outcome: 'NEGATIVE', nrc: 0x12,
        classification: 'PRESENT_BUT_CONDITIONED',
        sessionOpened: null, sessionCommand: null,
        transportKind: 'elm327_classic', protocol: '6',
        traceCorrelationId: correlationId, atMs: clock.t,
      },
      transactionId: 'txn-seed', provenance: 'live',
    }),
  });
  /* `safeStorage` yazımı normalde geciktirilir (eMMC ömrü); test diskte
     GERÇEKTEN kalıcı olduğunu ölçtüğü için ANINDA yazım istenir. */
  persistGapLedger(clock.t, true);
}

function oneEcu(): readonly DiscoveredEcu[] {
  return buildTopology('7E8 06 41 00 BE 3F A8 13', 1_700_000_000_000, '6').ecus;
}

beforeEach(() => {
  calls = [];
  responder = vehicleRespondingWithSerial(SERIAL_A);
  epochRef.value = 7;
  clock.t = 10_000; mono.t = 0;

  _resetTransactionsForTest();
  _resetSchedulerForTest();
  _resetTraceForTest('trace-F5H');
  _resetEarlyVehicleIdentityForTest();
  _resetGapRegistryForTest();
  _resetCapabilityStoreForTest();
  _resetPartitionCatalogForTest();
  _resetGapResolverForTest();
  _resetServiceDiscoveryForTest();
  _resetPhysicalProbesForTest();
  try { localStorage.clear(); } catch { /* jsdom */ }

  _setTransactionClockForTest(() => clock.t);
  _setSchedulerClockForTest(() => clock.t);
  _setTraceClocksForTest(() => clock.t, () => { mono.t += 5; return mono.t; });
  setTraceProvenanceMode('live');
  setActiveObdProtocol('6');   // ISO 15765-4 CAN 11/500

  const fn = CarLauncher.sendDiagnosticPdu as unknown as ReturnType<typeof vi.fn>;
  fn.mockReset();
  fn.mockImplementation(async (o: PduCall) => {
    calls.push(o);
    return responder(o);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖLÇÜM — POZİTİF YOL
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5H · erken kimlik ölçümü', () => {
  it('pozitif kalibrasyon DID okur ve CALIBRATION eksenini ÖLÇER', async () => {
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(ev.outcome).toBe('EARLY_IDENTITY_MEASURED');
    expect(ev.calibrationMeasured).toBe(true);
    expect(ev.calibrationDid).toBe('F18C');
    expect(ev.measuredAxes).toContain('CALIBRATION');
    /* Tam tarama YAPILMADI → yanıt imzası ekseni ölçülmemiş OLMALI. */
    expect(ev.measuredAxes).not.toContain('RESPONSE_SIGNATURE');
    expect(ev.targetTx).toBe('7E0');
    expect(ev.targetRx).toBe('7E8');
  });

  it('parmak izi F4-C otoritesinden gelir — ikinci kimlik sistemi YOK', async () => {
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    const cal = buildCalibrationEvidence(EARLY_IDENTITY_DID_ORDER[0]!, SERIAL_A)!;

    const fp = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: null, vin: null },
      [{
        txHeader: '7E0', rxHeader: '7E8', protocol: '6',
        responseSignature: null,
        calibrationDid: cal.calibrationDid,
        calibrationValueHash: cal.calibrationValueHash,
      }],
    );
    expect(ev.vehicleRef).toBe(fp.id);
    expect(ev.reusable).toBe(isFingerprintReusable(fp));
    expect(ev.reusable).toBe(true);
  });

  it('en çok ÜÇ salt-okunur istek gönderir ve tavanı AŞMAZ', async () => {
    responder = (): Record<string, unknown> => neg(0x11);   // hepsi "DID yok"
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(ev.requestsUsed).toBeLessThanOrEqual(EARLY_IDENTITY_DID_ORDER.length);
    expect(calls.length).toBeLessThanOrEqual(EARLY_IDENTITY_DID_ORDER.length);
    expect(DEFAULT_BUDGETS.vehicle_identity.maxRequests)
      .toBeGreaterThanOrEqual(EARLY_IDENTITY_DID_ORDER.length);
  });

  it('yalnız SALT-OKUNUR 0x22 gönderir: 10 xx · 3E · 27 · destructive YOK', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.service).toBe('22');
      expect(c.subFunction === '' || c.subFunction === undefined).toBe(true);
    }
    const sids = new Set(calls.map((c) => c.service));
    expect(sids.has('10')).toBe(false);   // oturum komutu
    expect(sids.has('3E')).toBe(false);   // keepalive
    expect(sids.has('27')).toBe(false);   // SecurityAccess
    for (const d of DESTRUCTIVE_SERVICES) expect(sids.has(d)).toBe(false);
  });

  it('aynı oturum mühründe İKİNCİ kez ölçmez (idempotent)', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    const first = calls.length;
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    expect(calls.length).toBe(first);
  });

  it('hedef seçimi DETERMİNİSTİKTİR — keşif sırası kimliği DEĞİŞTİRMEZ', () => {
    const ecus = [...oneEcu()];
    const a = selectEarlyIdentityTarget(ecus);
    const b = selectEarlyIdentityTarget([...ecus].reverse());
    expect(a?.rxHeader).toBe(b?.rxHeader);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) FAIL-CLOSED MATRİSİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5H · fail-closed', () => {
  const cases: readonly ['no_response' | 'timeout' | 'malformed' | 'transport_error', string][] = [
    ['no_response', 'NO_RESPONSE'],
    ['timeout', 'TIMEOUT'],
    ['malformed', 'MALFORMED'],
    ['transport_error', 'TRANSPORT_ERROR'],
  ];

  for (const [kind, label] of cases) {
    it(`${label} → güçlü kimlik ÜRETİLMEZ ve bağlam AKTİVE EDİLMEZ`, async () => {
      responder = (): Record<string, unknown> => silence(kind);
      const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

      expect(ev.calibrationMeasured).toBe(false);
      expect(ev.vehicleRef).toBeNull();
      expect(ev.outcome).toBe('EARLY_IDENTITY_UNAVAILABLE');
      expect(ev.activation).toBe('NOT_ATTEMPTED');
      expect(getEarlyIdentityAnchor()).toBeNull();
      expect(getGapLedgerScope().state).toBe('UNIDENTIFIED');
    });
  }

  it('NRC (koşullu) → güçlü kimlik YOK', async () => {
    responder = (): Record<string, unknown> => neg(0x33);   // securityAccessDenied
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    expect(ev.calibrationMeasured).toBe(false);
    expect(ev.vehicleRef).toBeNull();
    expect(ev.activation).toBe('NOT_ATTEMPTED');
  });

  it('oturum ailesi NRC → DEFERRED, kör `10 xx` GÖNDERİLMEZ', async () => {
    responder = (): Record<string, unknown> => neg(0x7F);
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(ev.outcome).toBe('EARLY_IDENTITY_DEFERRED');
    expect(ev.sessionRequired).toBe(true);
    expect(ev.sessionOpened).toBe(false);
    expect(calls.every((c) => c.service === '22')).toBe(true);
  });

  it('oturum mührü ÖLÇÜLEMEDİ (-1) → hatta TEK BAYT çıkmaz', async () => {
    epochRef.value = -1;
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(ev.outcome).toBe('EARLY_IDENTITY_BLOCKED');
    expect(calls.length).toBe(0);
    expect(ev.activation).toBe('NOT_ATTEMPTED');
  });

  it('ölçülmüş ECU hedefi YOKSA istek gönderilmez', async () => {
    const ev = await runEarlyVehicleIdentity({ ecus: [], nowMs: clock.t });
    expect(ev.outcome).toBe('EARLY_IDENTITY_BLOCKED');
    expect(calls.length).toBe(0);
  });

  it('protokol CAN değilse 0x22 yolu AÇILMAZ (KWP LID uydurulmaz)', async () => {
    setActiveObdProtocol('5');   // KWP fast
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    expect(ev.outcome).toBe('EARLY_IDENTITY_BLOCKED');
    expect(calls.length).toBe(0);
  });

  it('bütçe YETMİYORSA kısmi kimlik İDDİA EDİLMEZ (saf karar)', () => {
    const d = evaluateEarlyIdentityAdmission({
      admission: 'READY', transactionLive: true, cancelled: false,
      staleEpoch: false, protocolKnown: true, protocolSupportsDid: true,
      genericBridgeAvailable: true, provenTargets: 1,
      didServiceDefAvailable: true, remainingRequests: 0,
    });
    expect(d.admission).toBe('DEFERRED');
    expect(d.allocatedRequests).toBe(0);
  });

  it('yalnız `7F .. 11` bir sonraki adaya geçirir — kimlik KARARLILIĞI kilidi', () => {
    expect(mayTryNextDid('NOT_SUPPORTED')).toBe(true);
    for (const v of ['MEASURED', 'EMPTY_VALUE', 'SESSION_REQUIRED', 'CONDITIONED',
      'NOT_CARRIED', 'UNSTABLE'] as const) {
      expect(mayTryNextDid(v)).toBe(false);
    }
  });

  it('geçici sessizlikte SONRAKİ DID denenmez (aynı araç ≠ iki kimlik)', async () => {
    responder = (c: PduCall): Record<string, unknown> =>
      c.payload === 'F18C' ? silence('timeout') : ok(SERIAL_A);
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(calls.length).toBe(1);            // F191/F187 DENENMEDİ
    expect(ev.calibrationMeasured).toBe(false);
  });

  it('sınıflandırma MEVCUT deriveServicePresence sözlüğünü kullanır', () => {
    expect(classifyDidProbe('POSITIVE', null, 8)).toBe('MEASURED');
    expect(classifyDidProbe('POSITIVE', null, 0)).toBe('EMPTY_VALUE');
    expect(classifyDidProbe('NEGATIVE', 0x11, 0)).toBe('NOT_SUPPORTED');
    expect(classifyDidProbe('NEGATIVE', 0x7E, 0)).toBe('SESSION_REQUIRED');
    expect(classifyDidProbe('NEGATIVE', 0x33, 0)).toBe('CONDITIONED');
    expect(classifyDidProbe('DENIED_BY_SAFETY_GATE', null, 0)).toBe('NOT_CARRIED');
    expect(classifyDidProbe('NOT_SUPPORTED_BY_TRANSPORT', null, 0)).toBe('NOT_CARRIED');
    expect(classifyDidProbe('NO_RESPONSE', null, 0)).toBe('UNSTABLE');
  });

  it('zayıf kimlik kalıcı bölüm AÇAMAZ (F4-C gücü tek otorite)', () => {
    const weak = buildCapabilityFingerprint(
      { protocol: '6', supportedPidBitmap: null, vin: null },
      [{ txHeader: '7E0', rxHeader: '7E8', protocol: '6',
        responseSignature: null, calibrationDid: null, calibrationValueHash: null }],
    );
    expect(isFingerprintReusable(weak)).toBe(false);
    expect(deriveEarlyIdentityOutcome([] as CalibrationReading[], true, false))
      .toBe('EARLY_IDENTITY_WEAK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ERKEN AKTİVASYON + BÖLÜM HYDRATE
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5H · erken aktivasyon ve bölüm hydrate', () => {
  it('güçlü kimlik → doğru araç bağlamı TAM TARAMA BEKLENMEDEN aktive olur', async () => {
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(ev.activation).toBe('ACTIVATED');
    expect(ev.scopeState).toBe('VEHICLE_SCOPED');
    expect(getGapLedgerScope().vehicleRef).toBe(ev.vehicleRef);
    expect(getCapabilityScope().vehicleRef).toBe(ev.vehicleRef);
    /* PARİTE: iki depo AYNI araca bakmak ZORUNDA. */
    expect(getGapLedgerStorageKey()).not.toBeNull();
    expect(getCapabilityStorageKey()).not.toBeNull();
  });

  it('AÇILIŞTAN SONRA aynı araç: tam tarama YAPILMADAN geçmiş hydrate olur', async () => {
    /* ── 1) Araç A ilk kez tanınır ve geçmiş üretilir ─────────────────── */
    const first = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    expect(first.vehicleRef).not.toBeNull();

    seedGap('corr-x');
    recordCapabilityObservation({
      vehicleId: first.vehicleRef!, ecuId: '7E8', service: '19', subFunction: '02',
      presence: 'PRESENT', provenance: 'live', nrc: null,
      transport: { genericBridge: true, routePolicy: null, adapterHash: null },
      observedAtMs: clock.t,
    });
    persistCapabilityStore(clock.t);
    expect(getGapRegistry().length).toBeGreaterThan(0);

    /* ── 2) UYGULAMA YENİDEN BAŞLAR (bellek gider, DİSK KALIR) ─────────
       ⚠️ `_resetGapRegistryForTest` KULLANILMAZ: o, kalıcı bölümü de SİLER ve
       "yeniden başlatma" değil "fabrika sıfırlama" taklididir. */
    _resetEarlyVehicleIdentityForTest();
    _simulateRestartForTest();
    _simulateCapabilityRestartForTest();
    _resetTransactionsForTest();
    _setTransactionClockForTest(() => clock.t);
    epochRef.value = 11;              // yeni bağlantı = yeni oturum mührü

    /* ── 3) AYNI ARAÇ bağlanır; TAM TARAMA BAŞLATILMAZ ────────────────── */
    const again = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(again.vehicleRef).toBe(first.vehicleRef);   // aynı araç → aynı kimlik
    expect(again.activation).toBe('ACTIVATED');
    expect(again.scopeState).toBe('VEHICLE_SCOPED');
    expect(again.hydratedGapEntries).toBeGreaterThan(0);
    expect(again.hydratedCapabilityEdges).toBeGreaterThan(0);
    expect(getCapabilityEdges().length).toBeGreaterThan(0);
  });

  it('BAŞKA araç bağlanınca önceki aracın geçmişi TAŞINMAZ', async () => {
    const a = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    seedGap('corr-a');
    expect(getGapRegistry().length).toBe(1);

    /* Araç B: BAŞKA seri numarası → BAŞKA kimlik. */
    _resetEarlyVehicleIdentityForTest();
    epochRef.value = 21;
    responder = vehicleRespondingWithSerial(SERIAL_B);
    const b = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(b.vehicleRef).not.toBe(a.vehicleRef);
    expect(getGapLedgerScope().vehicleRef).toBe(b.vehicleRef);
    /* Araç A'nın boşluğu araç B'ye TAŞINMADI. */
    expect(getGapRegistry().length).toBe(0);
  });

  it('yalnız oturum mührü değişmesi kimliği DEĞİŞTİRMEZ', async () => {
    const a = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    _resetEarlyVehicleIdentityForTest();
    epochRef.value = 99;               // yalnız mühür değişti, araç AYNI
    const b = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    expect(b.vehicleRef).toBe(a.vehicleRef);
  });

  it('replay/sentetik koşu ÜRÜN bölümünü AÇAMAZ', async () => {
    setTraceProvenanceMode('replay');
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    expect(ev.calibrationMeasured).toBe(true);
    expect(ev.scopeState).toBe('EPHEMERAL_REPLAY');
    expect(getGapLedgerStorageKey()).toBeNull();
    expect(getCapabilityStorageKey()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) GİZLİLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5H · gizlilik', () => {
  it('ham kalibrasyon değeri kanıt defterine ve kalıcı depoya SIZMAZ', async () => {
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    persistCapabilityStore(clock.t);

    expect(evidenceLeaksRawValue(ev, SERIAL_A)).toBe(false);
    expect(ev.rawCalibrationPersisted).toBe(false);

    let dump = '';
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        dump += `${k}=${localStorage.getItem(k) ?? ''}\n`;
      }
    } catch { /* jsdom */ }
    expect(dump.toUpperCase()).not.toContain(SERIAL_A);
    expect(dump.toUpperCase()).not.toContain('VM1234567');
  });

  it('kanonik iz kimlik yoklamasını taşır ama HAM GÖVDEYİ taşımaz', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });

    const probes = getTraceEvents().filter((e) => e.operation === 'vehicle_identity_probe');
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) {
      expect(p.rawResponse).toBeNull();
      expect(p.redactionState).toBe('REDACTED');
      expect(p.rawRequest).toMatch(/^22F1/);
    }
    expect(JSON.stringify(getTraceEvents()).toUpperCase()).not.toContain(SERIAL_A);
  });

  it('kimlik referansı kalıcı bölüm biçimindedir (ham VIN/MAC yapısal olarak GİREMEZ)', async () => {
    const ev = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    expect(ev.vehicleRef).toMatch(/^[0-9a-f]{16}$/);
  });

  it('karma DID kimliğini de içerir — iki DID aynı sayılamaz', () => {
    const a = buildCalibrationEvidence(EARLY_IDENTITY_DID_ORDER[0]!, SERIAL_A)!;
    const b = buildCalibrationEvidence(EARLY_IDENTITY_DID_ORDER[1]!, SERIAL_A)!;
    expect(a.calibrationValueHash).not.toBe(b.calibrationValueHash);
    expect(buildCalibrationEvidence(EARLY_IDENTITY_DID_ORDER[0]!, '')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) TAM TARAMA UZLAŞTIRMASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5H · erken ↔ tam tarama uzlaştırması', () => {
  const base = {
    earlyRef: 'aaaaaaaaaaaaaaaa', earlyDid: 'F18C',
    earlyValueHash: 'hash-a', earlyEcuRx: '7E8',
  } as const;

  it('aynı kimlik + doğrulanmış ortak kanıt → MATCH', () => {
    const r = reconcileVehicleIdentity({
      ...base, fullRef: base.earlyRef,
      reverifiedValueHash: 'hash-a', reverifiedEcuRx: '7E8',
    });
    expect(r.relation).toBe('MATCH');
    expect(r.adoptedRef).toBe(base.earlyRef);
    expect(r.persistenceFrozen).toBe(false);
  });

  it('farklı kimlik + AYNI ortak kanıt → EARLY_WEAKER_SAME_VEHICLE (bölüm KORUNUR)', () => {
    const r = reconcileVehicleIdentity({
      ...base, fullRef: 'bbbbbbbbbbbbbbbb',
      reverifiedValueHash: 'hash-a', reverifiedEcuRx: '7E8',
    });
    expect(r.relation).toBe('EARLY_WEAKER_SAME_VEHICLE');
    expect(r.adoptedRef).toBe(base.earlyRef);
    expect(r.persistenceFrozen).toBe(false);
  });

  it('ortak kanıt ÇELİŞİYOR → CONFLICT, kalıcılık DONAR, birleştirme YOK', () => {
    const r = reconcileVehicleIdentity({
      ...base, fullRef: 'bbbbbbbbbbbbbbbb',
      reverifiedValueHash: 'hash-b', reverifiedEcuRx: '7E8',
    });
    expect(r.relation).toBe('CONFLICT');
    expect(r.adoptedRef).toBeNull();
    expect(r.persistenceFrozen).toBe(true);
  });

  it('ortak kanıt ÖLÇÜLEMEDİ → UNVERIFIED_RELATION, hiçbir bölüm BİRLEŞTİRİLMEZ', () => {
    const r = reconcileVehicleIdentity({
      ...base, fullRef: 'bbbbbbbbbbbbbbbb',
      reverifiedValueHash: null, reverifiedEcuRx: null,
    });
    expect(r.relation).toBe('UNVERIFIED_RELATION');
    expect(r.persistenceFrozen).toBe(false);
  });

  it('BAŞKA ECU’da doğrulama ortak kanıt SAYILMAZ', () => {
    const r = reconcileVehicleIdentity({
      ...base, fullRef: 'bbbbbbbbbbbbbbbb',
      reverifiedValueHash: 'hash-a', reverifiedEcuRx: '7E9',
    });
    expect(r.relation).toBe('UNVERIFIED_RELATION');
  });

  it('bağlantı noktası YOKSA ilişki SORULMAZ (`null`) — "ilişki yok" DEĞİL', async () => {
    const rec = await reconcileEarlyIdentityWithScan(
      null, { ecus: [], protocol: '6', protocolClass: 'can', nowMs: clock.t },
      'ffffffffffffffff');
    expect(rec.relation).toBeNull();
    expect(rec.adoptedRef).toBeNull();
  });

  it('ÜRÜN YOLU: aynı araçta tam tarama erken bölümü KORUR', async () => {
    const early = await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    const { beginTransaction, prepareTransaction } =
      await import('../platform/obd/diagnosticTransaction');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan', protocol: '6' });
    await prepareTransaction(txn);

    const rec = await reconcileEarlyIdentityWithScan(txn, {
      ecus: [{ txHeader: '7E0', rxHeader: '7E8' }],
      protocol: '6', protocolClass: 'can', nowMs: clock.t,
    }, 'ffffffffffffffff');

    expect(rec.reverified).toBe(true);
    expect(rec.relation).toBe('EARLY_WEAKER_SAME_VEHICLE');
    expect(rec.adoptedRef).toBe(early.vehicleRef);
  });

  it('ÜRÜN YOLU: kalibrasyon değişirse ÇELİŞKİ ve kalıcılık DONAR', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    responder = vehicleRespondingWithSerial(SERIAL_B);   // aynı ECU, BAŞKA değer

    const { beginTransaction, prepareTransaction } =
      await import('../platform/obd/diagnosticTransaction');
    const txn = beginTransaction({ purpose: 'multi_ecu_scan', protocol: '6' });
    await prepareTransaction(txn);

    const rec = await reconcileEarlyIdentityWithScan(txn, {
      ecus: [{ txHeader: '7E0', rxHeader: '7E8' }],
      protocol: '6', protocolClass: 'can', nowMs: clock.t,
    }, 'ffffffffffffffff');

    expect(rec.relation).toBe('CONFLICT');
    expect(rec.persistenceFrozen).toBe(true);
    expect(rec.adoptedRef).toBeNull();
    /* Çelişkili bağlantı noktası bir daha KANIT olarak kullanılmaz. */
    expect(getEarlyIdentityAnchor()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) LAB — SALT OKUNUR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5H · CAROS LAB yüzeyi', () => {
  it('LAB okuması hiçbir ölçüm/PDU/aktivasyon TETİKLEMEZ', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    const before = calls.length;

    const snap = readEarlyIdentitySnapshot();
    const cards = buildEarlyIdentityCards(snap);
    const verdict = deriveEarlyIdentityVerdict(snap);

    expect(calls.length).toBe(before);
    expect(cards.length).toBeGreaterThan(0);
    expect(verdict.status).toBe('IDENTIFIED');
  });

  it('hiç ölçüm yokken KAYNAK YOK der — "başarısız" DEMEZ', () => {
    expect(earlyIdentityEverEvaluated()).toBe(false);
    const snap = readEarlyIdentitySnapshot();
    expect(deriveEarlyIdentityVerdict(snap).status).toBe('NEVER_EVALUATED');
    const fields = buildEarlyIdentityCards(snap).flatMap((c) => c.fields);
    expect(fields.some((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });

  it('LAB ham kalibrasyon değerini GÖSTERMEZ', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    const cards = buildEarlyIdentityCards(readEarlyIdentitySnapshot());
    expect(JSON.stringify(cards).toUpperCase()).not.toContain(SERIAL_A);
  });

  it('katalogda AVAILABLE bir araç aracı olarak kayıtlıdır', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'early-vehicle-identity');
    expect(tool).toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category).toBe('vehicle');
  });

  it('son kanıt defteri LAB için okunabilir kalır', async () => {
    await runEarlyVehicleIdentity({ ecus: oneEcu(), nowMs: clock.t });
    const last = getLastEarlyIdentity();
    expect(last).not.toBeNull();
    expect(last!.attempted).toBe(true);
    expect(last!.probes.length).toBeGreaterThan(0);
  });
});
