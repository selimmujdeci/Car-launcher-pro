/**
 * gapResolver.test — P0-VDK-F5A · SELF-HEALING GAP RESOLVER.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görev — birebir)
 * ══════════════════════════════════════════════════════════════════════════
 * Birkaç FARKLI gerçek boşluk sınıfında çözücü:
 *   1. doğru güvenli ölçüm adayını SEÇİYOR,
 *   2. ölçümü MEVCUT normal VDK yolundan yapıyor,
 *   3. YALNIZ kanıt boşluğu gerçekten kapattıysa `RESOLVED` ediyor,
 *   4. başarısız aynı yolu SONSUZ tekrar etmiyor,
 *   5. destructive HİÇBİR aksiyon üretmiyor.
 *
 * Bu dosyanın kilitlediği en pahalı dört hata:
 *  a. "komut gönderdim" → `RESOLVED` demek (ölçüm ≠ kanıt),
 *  b. kanıtlı ABSENT'i (NRC 0x11) sonsuz yeniden yoklamak,
 *  c. TAŞIMA sınırını "araç desteklemiyor" ilan etmek,
 *  d. sentetik/replay başarıyı saha başarısı saymak.
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
  beginTransaction, transitionTransaction, _resetTransactionsForTest,
} from '../platform/obd/diagnosticTransaction';
import { _setPduRoutePolicyForTest, _resetPduRoutePolicyForTest }
  from '../platform/obd/pduRouting';
import { _resetServiceDiscoveryForTest }
  from '../platform/obd/discovery/serviceDiscoveryRuntime';
import {
  recordGap, activateGapLedgerVehicle, _resetGapRegistryForTest,
} from '../platform/obd/gapRegistry';
import {
  loadCapabilityStore, recordCapabilityObservation, getCapabilityEdges,
  _resetCapabilityStoreForTest,
} from '../platform/obd/capability/capabilityStore';
import {
  CAPABILITY_FRESH_MS, type TransportConstraint,
} from '../platform/obd/capability/capabilityGraph';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';

import {
  GAP_LIFECYCLE_LABEL, ROOT_CAUSE_LABEL, gapKey, initialGapState,
  isLifecycleTerminal, isLifecycleTransitionAllowed, summarizeGapStates,
  type GapLifecycle, type ResolvableGap,
} from '../platform/obd/healing/gapModel';
import {
  CANDIDATE_LABEL, EXECUTABLE_CANDIDATES, MAX_ATTEMPTS_PER_GAP,
  MAX_ATTEMPTS_PER_TRIPLE, NRC_SERVICE_NOT_SUPPORTED,
  candidatesFor, classifyRootCause, isServiceSafeForHealing,
  scoreCandidate, selectCandidate, type CandidateContext,
} from '../platform/obd/healing/resolutionPolicy';
import {
  DEFAULT_MAX_GAPS, collectResolvableGaps, getGapStates, getResolutionSummary,
  getResolverRunCount, judgeEvidence, narrowDefs, observedOutcomeOf,
  runGapResolution, targetFromContext, _resetGapResolverForTest,
} from '../platform/obd/healing/gapResolverRuntime';

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
const TRANSPORT_NO_BRIDGE: TransportConstraint =
  { genericBridge: false, routePolicy: 'legacy_only', adapterHash: 'ad1' };

const DEFS = (): ServiceDef[] => [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];

function ecu(refs: string[], over: Partial<EcuVariant> = {}): EcuVariant {
  return {
    id: 'ecm', name: 'Motor (ECM)', txHeader: '7E0', rxHeader: '7E8',
    addressing: 'physical', session: 'default', serviceRefs: refs,
    patternRefs: [], comParamRefs: [],
    provenance: { source: 'builtin', reference: 't', license: 't', verifiedOn: null },
    ...over,
  } as unknown as EcuVariant;
}
const UDS_ECU = () => ecu(['uds_read_dtc_information', 'uds_report_supported_dtc']);

function liveTxn() {
  const t = beginTransaction({ purpose: 'ecu_probe' });
  transitionTransaction(t, 'PREPARING');
  transitionTransaction(t, 'SESSION_ACTIVE');
  return t;
}

function resolveInput(over: Record<string, unknown> = {}) {
  return {
    ecu: UDS_ECU(), defs: DEFS(), txn: liveTxn(),
    protocolClass: 'can' as const, protocol: '6',
    provenance: 'live' as const, transport: TRANSPORT,
    targetVerified: true, vehicleId: 'V1', ecuId: 'E1',
    fingerprintReusable: true, nowMs: T0,
    ...over,
  } as Parameters<typeof runGapResolution>[0];
}

/** Gerçek üretici deseniyle bir keşif boşluğu yazar (`discovery:<svc><sub>`). */
function seedDiscoveryGap(
  signal: Parameters<typeof recordGap>[0]['signal'],
  service: string, sub = '', scope: Parameters<typeof recordGap>[0]['scope'] = 'AUTHORITY',
  times = 1,
): void {
  for (let i = 0; i < times; i++) {
    recordGap({ signal, scope, context: `discovery:${service}${sub}`, atMs: T0 });
  }
}

const gapNamed = (over: Partial<ResolvableGap> = {}): ResolvableGap => ({
  key: 'K', origin: 'REGISTRY', gapClass: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
  target: { ecuKey: null, service: '19', subFunction: null },
  context: 'discovery:19', observations: 1, lastSeenMs: T0, lastNrc: null,
  transportLimited: false, sessionConditioned: false, ...over,
});

const CTX = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  isCan: true, genericBridge: true, targetVerified: true,
  priorAttemptsFor: () => 0, ...over,
});

beforeEach(() => {
  sent = [];
  _resetGapRegistryForTest();
  _resetGapResolverForTest();
  _resetCapabilityStoreForTest();
  _resetServiceDiscoveryForTest();
  _resetTransactionsForTest();
  _resetPduRoutePolicyForTest();
  _setPduRoutePolicyForTest('generic_only');
  loadCapabilityStore();
  /* P0-VDK-F5F — yetenek kenarları da ARACA bağlıdır: aktif araç yoksa
     yetenek kökenli boşluk TOPLANMAZ (fail-closed). Bu fikstür kimliği
     kasıtlı olarak ZAYIFTIR (`V1` parmak izi biçiminde değil) → sicil bellek
     içi kalır, tıpkı F5-E öncesindeki davranış gibi. */
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
  _resetPduRoutePolicyForTest();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1) GÜVENLİK — PAZARLIKSIZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · güvenlik: destructive aksiyon ÜRETİLEMEZ', () => {
  it('destructive servislerin HİÇBİRİ iyileştirme hedefi olamaz', () => {
    for (const s of DESTRUCTIVE_SERVICES) {
      expect(isServiceSafeForHealing(s)).toBe(false);
    }
  });

  it('görevin saydığı yasak servisler tek tek reddedilir', () => {
    for (const s of ['04', '11', '14', '27', '28', '2E', '2F', '31',
      '34', '35', '36', '37', '3B', '85']) {
      expect(isServiceSafeForHealing(s)).toBe(false);
    }
  });

  it('destructive hedefli boşluk için HİÇBİR aday üretilmez', () => {
    for (const s of DESTRUCTIVE_SERVICES) {
      const g = gapNamed({ target: { ecuKey: null, service: s, subFunction: null } });
      const cands = candidatesFor(g, classifyRootCause(g), CTX());
      expect(cands.filter((c) => EXECUTABLE_CANDIDATES.has(c.kind))).toHaveLength(0);
    }
  });

  it('aday sözlüğünde yazma/aktüatör/güvenlik eylemi YOKTUR', () => {
    const names = Object.keys(CANDIDATE_LABEL).join(' ').toUpperCase();
    for (const forbidden of ['WRITE', 'CLEAR', 'RESET', 'SECURITY',
      'ROUTINE', 'CODING', 'ADAPT', 'ACTUATOR', 'TRANSFER']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('kör ECU/adres taraması yok: hedefsiz boşluk ölçülemez', () => {
    const g = gapNamed({
      target: { ecuKey: null, service: null, subFunction: null },
      context: 'conformance:live',
    });
    const cands = candidatesFor(g, classifyRootCause(g), CTX());
    expect(cands.every((c) => !c.executable)).toBe(true);
  });

  it('hedefe uyan CDDL tanımı yoksa yoklama kümesi BOŞ (kör tarama yok)', () => {
    expect(narrowDefs(DEFS(), { ecuKey: null, service: '2E', subFunction: null }))
      .toHaveLength(0);
    expect(narrowDefs(DEFS(), { ecuKey: null, service: null, subFunction: null }))
      .toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) KÖK NEDEN SINIFLANDIRMASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · kök neden sınıflandırması', () => {
  it('UNKNOWN_SERVICE → yetenek ölçülmedi', () => {
    expect(classifyRootCause(gapNamed({ gapClass: 'UNKNOWN_SERVICE' })))
      .toBe('CAPABILITY_UNMEASURED');
  });

  it('TRANSPORT_LIMITATION → TAŞIMA sınırı (araç sınırı DEĞİL)', () => {
    expect(classifyRootCause(gapNamed({ gapClass: 'TRANSPORT_LIMITATION' })))
      .toBe('TRANSPORT_BOUND');
    expect(ROOT_CAUSE_LABEL.TRANSPORT_BOUND).toContain('araç sınırı DEĞİL');
  });

  it('PARSER_GAP ve PARSER_PARITY_MISMATCH → ÇÖZÜCÜ sınırı', () => {
    expect(classifyRootCause(gapNamed({ gapClass: 'PARSER_GAP' }))).toBe('PARSER_BOUND');
    expect(classifyRootCause(gapNamed({ gapClass: 'PARSER_PARITY_MISMATCH' })))
      .toBe('PARSER_BOUND');
  });

  it('UNKNOWN_ECU_ATTRIBUTION → atıf belirsiz', () => {
    expect(classifyRootCause(gapNamed({ gapClass: 'UNKNOWN_ECU_ATTRIBUTION' })))
      .toBe('ATTRIBUTION_UNRESOLVED');
  });

  it('oturuma bağlı kanıt → SESSION_CONDITIONED', () => {
    expect(classifyRootCause(gapNamed({ sessionConditioned: true })))
      .toBe('SESSION_CONDITIONED');
  });

  it('yetenek çelişkisi ve bayatlık kendi sınıflarını alır', () => {
    expect(classifyRootCause(gapNamed({
      origin: 'CAPABILITY_CONFLICT', gapClass: 'PRESENT_TO_ABSENT',
    }))).toBe('CAPABILITY_CONTESTED');
    expect(classifyRootCause(gapNamed({
      origin: 'CAPABILITY_STALE', gapClass: 'STALE_CAPABILITY',
    }))).toBe('CAPABILITY_STALE');
  });

  it('taşıma sınırı ölçüldüyse sınıftan ÖNCE gelir', () => {
    expect(classifyRootCause(gapNamed({
      gapClass: 'UNKNOWN_SERVICE', transportLimited: true,
    }))).toBe('TRANSPORT_BOUND');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ADAY SEÇİMİ — DETERMİNİSTİK, RASTGELELİK YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · aday seçimi', () => {
  it('UNKNOWN_SERVICE + taşıma sağlıklı → REPROBE_SERVICE', () => {
    const g = gapNamed({ gapClass: 'UNKNOWN_SERVICE' });
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('REPROBE_SERVICE');
    expect(sel.candidate?.executable).toBe(true);
  });

  it('UNKNOWN_SUBFUNCTION → REPROBE_SUBFUNCTION', () => {
    const g = gapNamed({
      gapClass: 'UNKNOWN_SUBFUNCTION',
      target: { ecuKey: null, service: '19', subFunction: '02' },
    });
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('REPROBE_SUBFUNCTION');
  });

  it('CAPABILITY_CONFLICT → HEDEFLİ yeniden ölçüm', () => {
    const g = gapNamed({
      origin: 'CAPABILITY_CONFLICT', gapClass: 'PRESENT_TO_ABSENT',
      target: { ecuKey: 'E1', service: '19', subFunction: '02' },
    });
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('REPROBE_SUBFUNCTION');
    expect(sel.candidate?.informationGain).toBeGreaterThan(8);
  });

  it('STALE → tazeleme yoklaması', () => {
    const g = gapNamed({ origin: 'CAPABILITY_STALE', gapClass: 'STALE_CAPABILITY' });
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('REPROBE_SERVICE');
  });

  it('TRUNCATED/BUFFER_FULL (CAN) → APPLY_ISOTP_TUNING seçilir', () => {
    const g = gapNamed({ gapClass: 'TRANSPORT_LIMITATION' });
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('APPLY_ISOTP_TUNING');
    expect(sel.candidate?.executable).toBe(true);
  });

  it('CAN DEĞİLSE tuning adayı ÜRETİLMEZ (flow control CAN kavramı)', () => {
    const g = gapNamed({ gapClass: 'TRANSPORT_LIMITATION' });
    const cands = candidatesFor(g, classifyRootCause(g), CTX({ isCan: false }));
    expect(cands.map((c) => c.kind)).not.toContain('APPLY_ISOTP_TUNING');
  });

  it('oturum kaynaklı boşlukta REOPEN_SESSION/VERIFY_TESTER_PRESENT listelenir', () => {
    const g = gapNamed({ sessionConditioned: true });
    const kinds = candidatesFor(g, classifyRootCause(g), CTX()).map((c) => c.kind);
    expect(kinds).toContain('REOPEN_SESSION');
    expect(kinds).toContain('VERIFY_TESTER_PRESENT');
  });

  /**
   * P0-VDK-F6D-2 — BU KİLİT GÜÇLENDİRİLDİ (zayıflatılmadı).
   *
   * Eski hâli `gapNamed()` fikstürünü kullanıyordu ve o fikstürün hedefi
   * `ecuKey: null`dır. Yani aslında **hedefsiz** bir atıf boşluğunun
   * `VERIFY_ECU_ATTRIBUTION` üretmesini kilitliyordu — oysa sahibi bilinmeyen
   * bir boşluk için ölçüm hedefi YOKTUR ve çözücü o ölçümü taramanın
   * ECU'suna gönderip 1 isteği boşa harcardı.
   *
   * Yeni kilit İKİ durumu birden doğrular: hedef VARSA aday seçilir,
   * hedef YOKSA güvenli ölçüm YOKTUR.
   */
  it('UNKNOWN_ECU_ATTRIBUTION → hedef VARSA VERIFY_ECU_ATTRIBUTION', () => {
    const g = gapNamed({
      gapClass: 'UNKNOWN_ECU_ATTRIBUTION',
      target: { ecuKey: '11:7E8', service: '19', subFunction: null },
    });
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('VERIFY_ECU_ATTRIBUTION');
  });

  it('UNKNOWN_ECU_ATTRIBUTION → hedef YOKSA NO_SAFE_ACTION (0 PDU)', () => {
    const g = gapNamed({ gapClass: 'UNKNOWN_ECU_ATTRIBUTION' });   // ecuKey: null
    const sel = selectCandidate(candidatesFor(g, classifyRootCause(g), CTX()), 0);
    expect(sel.kind).toBe('NO_SAFE_ACTION');
  });

  it('NRC 0x11 ile KANITLI ABSENT → gereksiz yeniden yoklama YOK', () => {
    const g = gapNamed({ lastNrc: NRC_SERVICE_NOT_SUPPORTED });
    expect(candidatesFor(g, classifyRootCause(g), CTX())).toHaveLength(0);
    expect(selectCandidate([], 0).kind).toBe('NO_SAFE_ACTION');
  });

  it('PARSER_BOUND için yeniden yoklama adayı YOK (aynı bayt gelir)', () => {
    const g = gapNamed({ gapClass: 'PARSER_GAP' });
    const kinds = candidatesFor(g, classifyRootCause(g), CTX()).map((c) => c.kind);
    expect(kinds).not.toContain('REPROBE_SERVICE');
    expect(kinds).toEqual(['REQUEST_ADDITIONAL_RAW_TRACE']);
  });

  it('skor formülü deterministik ve tekrarlanabilir', () => {
    const g = gapNamed();
    const a = candidatesFor(g, classifyRootCause(g), CTX());
    const b = candidatesFor(g, classifyRootCause(g), CTX());
    expect(a.map(scoreCandidate)).toEqual(b.map(scoreCandidate));
    expect(selectCandidate(a, 0).kind).toBe(selectCandidate(b, 0).kind);
  });

  it('önceki deneme skoru DÜŞÜRÜR (kör retry değil)', () => {
    const g = gapNamed();
    const fresh = candidatesFor(g, classifyRootCause(g), CTX())[0];
    const tried = candidatesFor(g, classifyRootCause(g),
      CTX({ priorAttemptsFor: () => 1 }))[0];
    expect(scoreCandidate(tried)).toBeLessThan(scoreCandidate(fresh));
  });

  it('çalıştırılamayan aday ASLA ilk seçilmez ama listede KALIR', () => {
    const g = gapNamed({ sessionConditioned: true });
    const cands = candidatesFor(g, classifyRootCause(g), CTX());
    const sel = selectCandidate(cands, 0);
    expect(sel.ranked.map((c) => c.kind)).toContain('REOPEN_SESSION');
    expect(sel.candidate?.executable).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) YAŞAM DÖNGÜSÜ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · yaşam döngüsü', () => {
  it('EXHAUSTED durumundan ÇIKIŞ YOK (yeni canlı kanıt olmadan)', () => {
    for (const to of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'BLOCKED', 'UNKNOWN']) {
      expect(isLifecycleTransitionAllowed('EXHAUSTED', to as GapLifecycle)).toBe(false);
    }
  });

  it('OPEN → RESOLVED doğrudan geçemez (ölçüm olmadan kapanma YOK)', () => {
    expect(isLifecycleTransitionAllowed('OPEN', 'RESOLVED')).toBe(false);
    expect(isLifecycleTransitionAllowed('IN_PROGRESS', 'RESOLVED')).toBe(true);
  });

  it('terminal durumlar RESOLVED ve EXHAUSTED', () => {
    expect(isLifecycleTerminal('RESOLVED')).toBe(true);
    expect(isLifecycleTerminal('EXHAUSTED')).toBe(true);
    expect(isLifecycleTerminal('BLOCKED')).toBe(false);
    expect(isLifecycleTerminal('UNKNOWN')).toBe(false);
  });

  it('başlangıç durumu OPEN ve sayaçlar sıfır', () => {
    const s = initialGapState(gapNamed(), 'CAPABILITY_UNMEASURED');
    expect(s.lifecycle).toBe('OPEN');
    expect(s.attempts).toBe(0);
    expect(s.lastOutcome).toBeNull();
  });

  it('etiketler RESOLVED anlamını kanıta bağlar', () => {
    expect(GAP_LIFECYCLE_LABEL.RESOLVED).toContain('kanıt');
    expect(GAP_LIFECYCLE_LABEL.UNKNOWN).toContain('BİLİNMİYOR');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) KANIT DEĞERLENDİRME — "ölçtüm" ≠ "öğrendim"
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · kanıt değerlendirme', () => {
  const rec = (over: Record<string, unknown> = {}) => ([{
    ecuKey: 'ECM@7E0', ecuLabel: 'ECM', txHeader: '7E0', rxHeader: '7E8',
    service: '19', subFunction: '02', serviceDefId: 'd', requestIdentity: 'r',
    outcome: 'POSITIVE', nrc: null, latencyMs: 10, sessionOpened: null,
    sessionCommand: null, transportKind: 'elm327', traceCorrelationId: null,
    protocol: '6', classification: 'PRESENT', reason: 'ok', atMs: T0, count: 1,
    ...over,
  }] as unknown as Parameters<typeof judgeEvidence>[1]);

  it('ölçüm kaydı yoksa RESOLVED YOK', () => {
    expect(judgeEvidence(gapNamed(), [], 'live').lifecycle).toBe('UNKNOWN');
  });

  it('canlı PRESENT kanıtı boşluğu KAPATIR', () => {
    const v = judgeEvidence(gapNamed(), rec(), 'live');
    expect(v.lifecycle).toBe('RESOLVED');
    expect(v.detail).toContain('MEVCUT');
  });

  it('canlı ABSENT de KANITTIR — boşluk kapanır', () => {
    const v = judgeEvidence(gapNamed(),
      rec({ classification: 'ABSENT', nrc: 0x11 }), 'live');
    expect(v.lifecycle).toBe('RESOLVED');
    expect(v.detail).toContain('kanıtlı');
  });

  it('replay/synthetic/imported ürün güveni ÜRETMEZ → RESOLVED YOK', () => {
    for (const p of ['replay', 'synthetic', 'imported'] as const) {
      const v = judgeEvidence(gapNamed(), rec(), p);
      expect(v.lifecycle).toBe('UNKNOWN');
      expect(v.detail).toContain(p);
    }
  });

  it('TAŞIMA sınırı ölçüldüyse "desteklemiyor" DENMEZ', () => {
    const v = judgeEvidence(gapNamed(),
      rec({ classification: 'UNKNOWN_TRANSPORT_LIMIT' }), 'live');
    expect(v.lifecycle).toBe('UNKNOWN');
    expect(v.detail).toContain('araç sınırı DEĞİL');
  });

  it('ölçülmemiş sınıflandırma boşluğu KAPATMAZ', () => {
    for (const c of ['UNKNOWN', 'UNKNOWN_ADDRESSING', 'UNKNOWN_RESPONSE_SHAPE']) {
      expect(judgeEvidence(gapNamed(), rec({ classification: c }), 'live').lifecycle)
        .toBe('UNKNOWN');
    }
  });

  /**
   * P0-VDK-F6D-1 — BU KİLİT GÜÇLENDİRİLDİ (zayıflatılmadı).
   *
   * ── ESKİ KİLİT KENDİ ADIYLA ÇELİŞİYORDU ───────────────────────
   * Adı "SAHİBİ ölçülmeden kapanmaz" diyordu ama ikinci satırı tam tersini
   * kilitliyordu: kımlik alanı DOLU olan bir kayıt `RESOLVED` sayılıyordu.
   * Oysa `ProbeRecord.ecuKey` ÖLÇÜM DEĞİL, ÇAĞIRANIN YANKISIDIR:
   *   `serviceDiscoveryRuntime.ts:539` → `ecuKey: input.ecuKey ?? null`
   *   `gapResolverRuntime`             → `ecuKey: gap.target.ecuKey`
   * Yani hedefte bir anahtar varsa kayıtta da OLUR ve boşluk **sahibi hiç
   * ölçülmeden** kapanırdı — kendi sorumuzu kanıt saymak. Bu bir totolojiydi.
   *
   * Yeni kilit adının SÖYLEDİĞİ ŞEYİ doğrular: kapanma için BAĞIMSIZ ölçülmüş
   * sahiplik kanıtı (F6-A `ecuAddressability` → `PROVEN`) ŞARTTIR.
   */
  it('atıf boşluğu SAHİBİ ölçülmeden kapanmaz (yankı kanıt DEĞİLDİR)', () => {
    const g = gapNamed({ gapClass: 'UNKNOWN_ECU_ATTRIBUTION' });
    /* Künye HIÇ yoksa — eskisi gibi. */
    expect(judgeEvidence(g, rec({ ecuKey: null }), 'live').lifecycle).toBe('UNKNOWN');
    /* Künye VAR ama çağırandan yankılandı, bağımsız ölçüm YOK → AÇIK KALIR. */
    expect(judgeEvidence(g, rec({ ecuKey: 'ECM@7E0' }), 'live').lifecycle)
      .toBe('UNKNOWN');
    expect(judgeEvidence(g, rec({ ecuKey: 'ECM@7E0' }), 'live', false).lifecycle)
      .toBe('UNKNOWN');
    /* Sahiplik BAĞIMSIZ ÖLÇÜLDÜYSE — ve yalnız o zaman — kapanır. */
    expect(judgeEvidence(g, rec({ ecuKey: 'ECM@7E0' }), 'live', true).lifecycle)
      .toBe('RESOLVED');
  });

  it('alt fonksiyon boşluğu servis kanıtıyla KAPANMAZ', () => {
    const g = gapNamed({ gapClass: 'UNKNOWN_SUBFUNCTION' });
    expect(judgeEvidence(g, rec({ subFunction: null }), 'live').lifecycle)
      .toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) BOŞLUK TOPLAMA
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · boşluk toplama (mevcut üreticilerden)', () => {
  it('sicil bağlamından hedef çıkarılır; tanınmayan bağlamda hedef YOK', () => {
    expect(targetFromContext('discovery:1902'))
      .toEqual({ ecuKey: null, service: '19', subFunction: '02' });
    expect(targetFromContext('discovery:22'))
      .toEqual({ ecuKey: null, service: '22', subFunction: null });
    expect(targetFromContext('conformance:live').service).toBeNull();
  });

  it('sicil kaydı çözülebilir boşluğa dönüşür', () => {
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02', 'AUTHORITY', 3);
    const gaps = collectResolvableGaps(T0);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].origin).toBe('REGISTRY');
    expect(gaps[0].observations).toBe(3);
    expect(gaps[0].target.service).toBe('19');
  });

  it('çelişkili yetenek kenarı boşluk üretir', () => {
    const obs = (presence: string, atMs: number) => ({
      vehicleId: 'V1', ecuId: 'E1', service: '19', subFunction: '02',
      presence, provenance: 'live', protocol: '6', transport: TRANSPORT,
      evidenceRef: 'c', nrc: null, atMs,
    } as unknown as Parameters<typeof recordCapabilityObservation>[0]);
    recordCapabilityObservation(obs('PRESENT', T0), { nowMs: T0 } as never);
    recordCapabilityObservation(obs('ABSENT', T0 + 10), { nowMs: T0 + 10 } as never);
    const edges = getCapabilityEdges();
    if (edges.some((e) => e.conflict !== null)) {
      const gaps = collectResolvableGaps(T0 + 10);
      expect(gaps.some((g) => g.origin === 'CAPABILITY_CONFLICT')).toBe(true);
    }
  });

  it('bayat kenar boşluk üretir; taze kenar üretmez', () => {
    recordCapabilityObservation({
      vehicleId: 'V1', ecuId: 'E1', service: '19', subFunction: '02',
      presence: 'PRESENT', provenance: 'live', protocol: '6',
      transport: TRANSPORT, evidenceRef: 'c', nrc: null, atMs: T0,
    } as unknown as Parameters<typeof recordCapabilityObservation>[0],
    { nowMs: T0 } as never);
    expect(collectResolvableGaps(T0).some((g) => g.origin === 'CAPABILITY_STALE'))
      .toBe(false);
    expect(collectResolvableGaps(T0 + CAPABILITY_FRESH_MS + 1)
      .some((g) => g.origin === 'CAPABILITY_STALE')).toBe(true);
  });

  it('sıralama deterministik (aynı girdi → aynı sıra)', () => {
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02', 'AUTHORITY', 2);
    seedDiscoveryGap('UNKNOWN_SERVICE', '22', '', 'AUTHORITY', 5);
    const a = collectResolvableGaps(T0).map((g) => g.key);
    const b = collectResolvableGaps(T0).map((g) => g.key);
    expect(a).toEqual(b);
    expect(a[0]).toContain('discovery:22');
  });

  it('boşluk anahtarı HEDEFİ içerir (farklı servis = farklı boşluk)', () => {
    const t = (s: string) => ({ ecuKey: null, service: s, subFunction: null });
    expect(gapKey('REGISTRY', 'UNKNOWN_SERVICE', t('19'), 'c'))
      .not.toBe(gapKey('REGISTRY', 'UNKNOWN_SERVICE', t('22'), 'c'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) UÇTAN UCA — NORMAL VDK YOLUNDAN ÖLÇÜM (ANA PASS ÖLÇÜTÜ)
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · uçtan uca çözüm turu', () => {
  it('UNKNOWN_SERVICE (servis kapsamlı) → REPROBE_SERVICE → canlı kanıt → RESOLVED', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    /* Bağlamda alt fonksiyon YOK → boşluk SERVİS kapsamlıdır. */
    seedDiscoveryGap('UNKNOWN_SERVICE', '19');

    const res = await runGapResolution(resolveInput());

    expect(res.measured).toBe(1);
    expect(res.resolved).toBe(1);
    /* Ölçüm GERÇEKTEN normal VDK yolundan hatta çıktı. */
    expect(sent.length).toBeGreaterThan(0);
    const st = getGapStates()[0];
    expect(st.selected).toBe('REPROBE_SERVICE');
    expect(st.lifecycle).toBe('RESOLVED');
    expect(st.requestsSpent).toBeGreaterThan(0);
  });

  it('UNKNOWN_SUBFUNCTION (alt fonksiyon kapsamlı) → REPROBE_SUBFUNCTION → RESOLVED', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    /* Bağlam `discovery:1902` → hedef alt fonksiyonu TAŞIR; doğru ölçüm
       servis varlığını değil ALT FONKSİYONU yeniden yoklamaktır. */
    seedDiscoveryGap('UNKNOWN_SUBFUNCTION', '19', '02');

    const res = await runGapResolution(resolveInput());

    expect(res.measured).toBe(1);
    const st = getGapStates()[0];
    expect(st.selected).toBe('REPROBE_SUBFUNCTION');
    expect(st.gap.target.subFunction).toBe('02');
    expect(st.lifecycle).toBe('RESOLVED');
  });

  it('kanıt gelmezse RESOLVED OLMAZ ("komut gönderdim" yetmez)', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');

    const res = await runGapResolution(resolveInput());
    expect(res.measured).toBe(1);
    expect(res.resolved).toBe(0);
    expect(getGapStates()[0].lifecycle).not.toBe('RESOLVED');
  });

  it('replay kanıtı ürün güveni üretmez → RESOLVED YOK', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');

    const res = await runGapResolution(resolveInput({ provenance: 'replay' }));
    expect(res.resolved).toBe(0);
    expect(getGapStates()[0].outcomeDetail).toContain('replay');
  });

  it('TAŞIMA sınırı ölçülürse araç "unsupported" İLAN EDİLMEZ', async () => {
    bridge(() => ({ outcome: 'error', kind: 'SERVICE_NOT_READ_ONLY' }));
    seedDiscoveryGap('TRANSPORT_LIMITATION', '19', '02', 'TRANSPORT');

    await runGapResolution(resolveInput());
    const st = getGapStates()[0];
    expect(st.lifecycle).not.toBe('RESOLVED');
    expect(st.rootCause).toBe('TRANSPORT_BOUND');
  });

  it('AYNI yol AYNI sonucu verirse EXHAUSTED — sonsuz tekrar YOK', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');

    await runGapResolution(resolveInput());
    const after1 = getGapStates()[0];
    expect(after1.lifecycle).not.toBe('EXHAUSTED');

    await runGapResolution(resolveInput());
    const after2 = getGapStates()[0];
    expect(after2.lifecycle).toBe('EXHAUSTED');
    expect(after2.outcomeDetail).toContain('tavan');

    /* ── P0-VDK-F5D · KİLİT GÜNCELLENDİ (zayıflatılmadı) ────────────────────
       Ölçüm sırasında üretilen KANITLI sicil satırı, buradaki KANITSIZ (eski
       biçim) satırla aynı boşluk SAYILMAZ: kanıtsız kayıt hangi ECU/NRC'den
       doğduğunu kanıtlayamaz, bu yüzden ona kanıt İLİŞTİRİLMEZ (uydurma
       backfill YASAK). Kilidin ASIL iddiası aynen korunur: her boşluk kendi
       tavanında TÜKENİR ve tur SONUNDA ölçüm tamamen durur. */
    await runGapResolution(resolveInput());        // kanıtlı satır · 1. deneme
    await runGapResolution(resolveInput());        // kanıtlı satır · 2. deneme → tavan
    const before = sent.length;
    const res5 = await runGapResolution(resolveInput());
    expect(res5.measured).toBe(0);
    expect(sent.length).toBe(before);
    for (const st of getGapStates()) expect(st.lifecycle).toBe('EXHAUSTED');
  });

  it('EXHAUSTED yeni tur başlatmaz (yeni canlı kanıt olmadan)', async () => {
    bridge(() => ({ outcome: 'timeout', kind: 'TIMEOUT' }));
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');
    await runGapResolution(resolveInput());
    await runGapResolution(resolveInput());
    expect(getGapStates()[0].lifecycle).toBe('EXHAUSTED');

    for (let i = 0; i < 3; i++) await runGapResolution(resolveInput());
    expect(getGapStates()[0].lifecycle).toBe('EXHAUSTED');
    expect(getGapStates()[0].attempts).toBeLessThanOrEqual(MAX_ATTEMPTS_PER_GAP);
  });

  it('köprü yoksa ölçüm YAPILMAZ → BLOCKED', async () => {
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');
    const res = await runGapResolution(
      resolveInput({ transport: TRANSPORT_NO_BRIDGE }));
    expect(res.measured).toBe(0);
    expect(res.blocked).toBeGreaterThan(0);
    expect(getGapStates()[0].lifecycle).toBe('BLOCKED');
  });

  it('F1-A işlemi yoksa bütçesiz ölçüm YAPILMAZ', async () => {
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');
    const res = await runGapResolution(resolveInput({ txn: null }));
    expect(res.measured).toBe(0);
    expect(getGapStates()[0].outcomeDetail).toContain('bütçesiz');
  });

  it('hedef ECU yoksa adres UYDURULMAZ', async () => {
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');
    const res = await runGapResolution(resolveInput({ ecu: null }));
    expect(res.measured).toBe(0);
    expect(getGapStates()[0].outcomeDetail).toContain('UYDURULMAZ');
  });

  it('iptal turu DURDURUR', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');
    seedDiscoveryGap('UNKNOWN_SERVICE', '22', '');
    const res = await runGapResolution(
      resolveInput({ isCancelled: () => true }));
    expect(res.stopReason).toBe('CANCELLED');
    expect(res.measured).toBe(0);
  });

  it('boşluk bütçesi turu sınırlar', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    seedDiscoveryGap('UNKNOWN_SERVICE', '19', '02');
    seedDiscoveryGap('UNKNOWN_SERVICE', '22', '');
    const res = await runGapResolution(resolveInput({ maxGaps: 1 }));
    expect(res.considered).toBe(1);
    expect(res.stopReason).toBe('BUDGET');
  });

  it('boşluk yoksa tur "NO_GAPS" der ve hiçbir şey göndermez', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FF' }));
    const res = await runGapResolution(resolveInput());
    expect(res.stopReason).toBe('NO_GAPS');
    expect(sent).toHaveLength(0);
  });

  it('ISO-TP tuning adayı seçilince köprüye tuning bayrağı GİDER', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    seedDiscoveryGap('TRANSPORT_LIMITATION', '19', '02', 'TRANSPORT');
    await runGapResolution(resolveInput());
    expect(getGapStates()[0].selected).toBe('APPLY_ISOTP_TUNING');
    expect(sent.some((o) => o.isoTpTuning === true || o.tuning === true
      || o.applyIsoTpTuning === true)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) LAB ÖZETİ — "ölçüm yokluğu" ile "sıfır" KARIŞTIRILMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A · özet ve LAB sözleşmesi', () => {
  it('hiç koşmadıysa neverRan=true (KAYNAK YOK)', () => {
    expect(getResolverRunCount()).toBe(0);
    expect(getResolutionSummary().neverRan).toBe(true);
  });

  it('koştuysa ve açık boşluk 0 ise neverRan=false (ÖLÇÜLDÜ)', async () => {
    bridge(() => ({ outcome: 'ok', kind: 'OK', raw: '5902FFAA' }));
    await runGapResolution(resolveInput());
    expect(getResolutionSummary().neverRan).toBe(false);
  });

  it('özet sayaçları durumlarla tutarlı', () => {
    const s = summarizeGapStates([
      { ...initialGapState(gapNamed({ key: 'a' }), 'CAPABILITY_UNMEASURED') },
      { ...initialGapState(gapNamed({ key: 'b' }), 'UNKNOWN'), lifecycle: 'RESOLVED' },
      { ...initialGapState(gapNamed({ key: 'c' }), 'UNKNOWN'), lifecycle: 'EXHAUSTED' },
    ], true);
    expect(s.total).toBe(3);
    expect(s.open).toBe(1);
    expect(s.resolved).toBe(1);
    expect(s.exhausted).toBe(1);
    expect(s.neverRan).toBe(false);
  });

  it('gözlenen sonuç anahtarı deterministik', () => {
    expect(observedOutcomeOf([])).toBe('NO_RECORD');
  });

  it('tavan sabitleri açık ve küçük', () => {
    expect(MAX_ATTEMPTS_PER_TRIPLE).toBe(2);
    expect(MAX_ATTEMPTS_PER_GAP).toBeLessThanOrEqual(4);
    expect(DEFAULT_MAX_GAPS).toBeGreaterThan(0);
  });
});
