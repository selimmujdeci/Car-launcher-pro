/**
 * learningIdentityAlignment.test.ts — P0-VDK-F6E-1.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN İKİ MİMARİ BORÇ ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ① **PROTOKOL SIZINTISI.** `edgeKey` = `vehicleId|ecuId|service|subFunction` —
 *    protokol İÇERMEZ. Aynı ECU'nun aynı servisi CAN'de ve KWP'de AYNI kenara
 *    yazılıyordu; `decideReuse` yalnız `transport.genericBridge`i
 *    karşılaştırdığı için **CAN'de öğrenilmiş `ABSENT`, KWP taramasında
 *    atlama gerekçesi olabiliyordu.** Üstelik `mergeCapabilityObservation`
 *    `protocol: o.protocol ?? prev.protocol` ile protokolü sessizce eziyor,
 *    iki hattın farklı gerçeğini **ÇELİŞKİ** sanıp `ABSENT_QUORUM` sayacını
 *    ilerletiyordu.
 * ② **REUSE OTORİTESİ KOPYASI.** Kapsam öğrenmesi güveni
 *    `scope.persistenceAllowed`tan ÇIKARIYORDU — o "diske yazabilir miyiz"
 *    sorusudur. Kanonik cevap F4-C `isFingerprintReusable`tır ve o değer
 *    `resolveGapLedgerScope`a girip **çıktıda taşınmıyordu**.
 */
import { describe, it, expect } from 'vitest';

import {
  decideReuse, mergeCapabilityObservation, edgeKey, isProductTrusted,
  CAPABILITY_FRESH_MS, ABSENT_QUORUM,
  type CapabilityEdge, type CapabilityObservationInput,
  type CapabilityProvenance, type TransportConstraint, type ReuseContext,
} from '../platform/obd/capability/capabilityGraph';
import { resolveGapLedgerScope } from '../platform/obd/gapLedgerScope';
import {
  learnableCoveragePresence, learnedCoverageSkips, learningEcuId,
  type CoverageLearningRow,
} from '../platform/obd/capability/coverageLearning';
import { planEcuDtcCoverage } from '../platform/obd/dtcCoveragePlan';
import { GENERIC_UDS_19_SUBS } from '../platform/obd/genericPduTransport';
import {
  builtinServiceDefs, extraReadOnlyServiceDefs,
} from '../platform/obd/cddl/legacyAdapter';
import { buildDiagnosticCompleteness } from '../platform/obd/ecuCompleteness';
import type { ServicePresence } from '../platform/obd/ecuCapabilityModel';
import {
  MAX_ATTEMPTS_PER_TRIPLE, MAX_ATTEMPTS_PER_GAP,
} from '../platform/obd/healing/resolutionPolicy';

const NOW = 1_700_000_000_000;
const CAN = '6';
const KWP = '5';
const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: null, adapterHash: null };

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function obs(over: Partial<CapabilityObservationInput> = {}): CapabilityObservationInput {
  return {
    vehicleId: 'veh-A', ecuId: learningEcuId('11:7E8'),
    service: '19', subFunction: '02',
    presence: 'ABSENT', provenance: 'live', protocol: CAN,
    transport: TRANSPORT, evidenceRef: 'e1', nrc: 0x11, atMs: NOW, ...over,
  };
}

/** Kenarı GERÇEK F4-C birleştiricisiyle üretir — kopya politika YOK. */
const edgeOf = (over: Partial<CapabilityObservationInput> = {}): CapabilityEdge =>
  mergeCapabilityObservation(null, obs(over));

const CTX = (over: Partial<ReuseContext> = {}): ReuseContext => ({
  nowMs: NOW, fingerprintReusable: true, transport: TRANSPORT, ...over,
});

/* ══════════════════════════════════════════════════════════════════════════
   1) ROOT CAUSE KANITI — sorunun VAR olduğu koddan gösterilir
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-1 · root cause kanıtı', () => {
  it('🔒 KANIT: edgeKey protokol İÇERMEZ (sızıntının yapısal kaynağı)', () => {
    const can = edgeOf({ protocol: CAN });
    const kwp = edgeOf({ protocol: KWP });
    /* İki AYRI protokol ölçümü AYNI anahtara düşüyor. */
    expect(edgeKey(can)).toBe(edgeKey(kwp));
    expect(edgeKey(can)).not.toContain(CAN);
    expect(edgeKey(can)).not.toContain(KWP);
  });

  it('🔒 KANIT: kanonik güç ile kalıcılık izni AYNI SORU DEĞİLDİR', () => {
    /* Kanonik parmak izi GÜÇLÜ ama referans kalıcı biçimde değil →
       `persistenceAllowed=false` iken `fingerprintReusable=true`. */
    const scope = resolveGapLedgerScope({
      vehicleRef: 'V1', fingerprintReusable: true,
      provenance: 'live', traceMode: 'live',
    });
    expect(scope.persistenceAllowed).toBe(false);      // diske yazamayız
    expect(scope.fingerprintReusable).toBe(true);      // ama kimlik GÜÇLÜ
    /* Eski kod `persistenceAllowed`ı güç sanıyordu → farklı karar üretirdi. */
    expect(scope.persistenceAllowed).not.toBe(scope.fingerprintReusable);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) PROTOKOL İZOLASYONU
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-1 · protokol izolasyonu', () => {
  it('🔒 KİLİT (1): CAN ABSENT → CAN’de güvenli reuse MÜMKÜN', () => {
    expect(decideReuse(edgeOf({ protocol: CAN }), CTX({ protocol: CAN })))
      .toBe('REUSE');
  });

  it('🔒 KİLİT (2): CAN ABSENT → KWP’de SKIP YOK', () => {
    expect(decideReuse(edgeOf({ protocol: CAN }), CTX({ protocol: KWP })))
      .toBe('PROTOCOL_CHANGED');
    expect(learnedCoverageSkips([edgeOf({ protocol: CAN })], '11:7E8',
      CTX({ protocol: KWP })).size).toBe(0);
  });

  it('🔒 KİLİT (3): KWP ABSENT → CAN’de SKIP YOK', () => {
    expect(decideReuse(edgeOf({ protocol: KWP }), CTX({ protocol: CAN })))
      .toBe('PROTOCOL_CHANGED');
    expect(learnedCoverageSkips([edgeOf({ protocol: KWP })], '11:7E8',
      CTX({ protocol: CAN })).size).toBe(0);
  });

  it('🔒 KİLİT (4): AYNI protokol + aynı ECU/servis mevcut davranışı KORUR', () => {
    expect(learnedCoverageSkips([edgeOf({ protocol: CAN })], '11:7E8',
      CTX({ protocol: CAN })).get('19|02')).toBe('ABSENT');
  });

  it('🔒 KİLİT (6): protokolsüz (ESKİ) kayıt FAIL-CLOSED — reuse ÜRETMEZ', () => {
    expect(decideReuse(edgeOf({ protocol: null }), CTX({ protocol: CAN })))
      .toBe('PROTOCOL_CHANGED');
    /* Bağlam protokolü ölçemediyse de fail-closed. */
    expect(decideReuse(edgeOf({ protocol: CAN }), CTX({ protocol: null })))
      .toBe('PROTOCOL_CHANGED');
  });

  it('🔒 KİLİT: protokol BİLDİRİLMEZSE davranış BİREBİR eskisi gibi (regresyon yok)', () => {
    /* `protocol` alanı `undefined` → kapı UYGULANMAZ; F4-B keşif yolu bundan
       etkilenmez. `null` ile `undefined` AYRIDIR. */
    expect(decideReuse(edgeOf({ protocol: CAN }), CTX())).toBe('REUSE');
    expect(decideReuse(edgeOf({ protocol: null }), CTX())).toBe('REUSE');
  });

  it('🔒 KİLİT (5): protokol değişimi ÇELİŞKİYİ gizlice TEMİZLEMEZ', () => {
    /* Aynı protokolde PRESENT→ABSENT gerçek bir çelişkidir ve kota ister. */
    const canPresent = mergeCapabilityObservation(null,
      obs({ protocol: CAN, presence: 'PRESENT', nrc: null }));
    const sameProto = mergeCapabilityObservation(canPresent,
      obs({ protocol: CAN, presence: 'ABSENT', nrc: 0x11 }));
    expect(sameProto.conflict?.kind).toBe('PRESENT_TO_ABSENT');
    expect(sameProto.presence).toBe('PRESENT');          // kota dolmadan dönmez

    /* FARKLI protokolde ise bu bir çelişki DEĞİLDİR — iki ayrı hattın iki ayrı
       gerçeği. Sahte çelişki üretilmez, sahte kota ilerlemez… */
    const crossProto = mergeCapabilityObservation(canPresent,
      obs({ protocol: KWP, presence: 'ABSENT', nrc: 0x11 }));
    expect(crossProto.conflict).toBeNull();
    expect(crossProto.protocol).toBe(KWP);
    expect(crossProto.presence).toBe('ABSENT');
    expect(crossProto.consecutiveSame).toBe(1);          // BAŞTAN başlar
    /* …ama geçmiş SESSİZCE SİLİNMEZ: doğum ve kanıt izi korunur. */
    expect(crossProto.firstSeenMs).toBe(canPresent.firstSeenMs);
    expect(crossProto.evidenceRefs.length).toBeGreaterThan(0);
  });

  it('🔒 KİLİT: çapraz protokol ABSENT_QUORUM sayacını İLERLETMEZ', () => {
    let e = mergeCapabilityObservation(null,
      obs({ protocol: CAN, presence: 'PRESENT', nrc: null }));
    /* KWP'den iki ABSENT gelse bile CAN kaydının kotasını yiyemez. */
    for (let i = 0; i < ABSENT_QUORUM + 1; i++) {
      e = mergeCapabilityObservation(e, obs({ protocol: KWP, presence: 'ABSENT', nrc: 0x11 }));
    }
    /* Kayıt artık KWP'nin kendi geçmişidir; CAN'de reuse ÜRETMEZ. */
    expect(decideReuse(e, CTX({ protocol: CAN }))).toBe('PROTOCOL_CHANGED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) REUSE OTORİTESİ HİZALAMASI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-1 · kanonik reuse otoritesi', () => {
  it('🔒 KİLİT (10): kanonik reusable=false → coverage reuse YOK', () => {
    expect(learnedCoverageSkips([edgeOf()], '11:7E8',
      CTX({ protocol: CAN, fingerprintReusable: false })).size).toBe(0);
    expect(decideReuse(edgeOf(), CTX({ protocol: CAN, fingerprintReusable: false })))
      .toBe('WEAK_FINGERPRINT');
  });

  it('🔒 KİLİT (11): kanonik reusable=true + tüm kapılar doğru → reuse MÜMKÜN', () => {
    expect(learnedCoverageSkips([edgeOf()], '11:7E8',
      CTX({ protocol: CAN, fingerprintReusable: true })).get('19|02')).toBe('ABSENT');
  });

  it('🔒 KİLİT (12): kapsam için İKİNCİ trust hesabı KALMADI', () => {
    /* Kapsam kimliği artık kanonik değeri AYNEN taşır — türetme yok. */
    for (const reusable of [true, false]) {
      const scope = resolveGapLedgerScope({
        vehicleRef: 'fp_' + 'a'.repeat(24), fingerprintReusable: reusable,
        provenance: 'live', traceMode: 'live',
      });
      expect(scope.fingerprintReusable).toBe(reusable);
    }
  });

  it('kanonik güç REPLAY kapsamında da AYNEN taşınır (türetilmez)', () => {
    const scope = resolveGapLedgerScope({
      vehicleRef: 'fp_' + 'a'.repeat(24), fingerprintReusable: true,
      provenance: 'replay', traceMode: 'replay',
    });
    expect(scope.state).toBe('EPHEMERAL_REPLAY');
    expect(scope.persistenceAllowed).toBe(false);
    expect(scope.fingerprintReusable).toBe(true);   // güç ≠ kalıcılık izni
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) KORUNAN F6-E SINIRLARI (regresyon kalkanı)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E-1 · F6-E sınırları korunur', () => {
  const row = (over: Partial<CoverageLearningRow> = {}): CoverageLearningRow => ({
    service: '19', subFunction: '02', outcome: 'COMPLETE',
    measuredOutcome: 'ok', nrc: null, gapRoot: null, requestCount: 1, ...over,
  });

  it('🔒 KİLİT (7): araç A → B sızıntısı YOK', () => {
    expect(learnedCoverageSkips([edgeOf({ vehicleId: 'veh-B' })], '11:7E8',
      CTX({ protocol: CAN })).size).toBe(1);   // çağıran zaten aracın kenarlarını verir
    /* Kimlik anahtarı aracı AYIRIR. */
    expect(edgeKey(edgeOf({ vehicleId: 'veh-A' })))
      .not.toBe(edgeKey(edgeOf({ vehicleId: 'veh-B' })));
  });

  it('🔒 KİLİT (8): ECU A → B sızıntısı YOK', () => {
    expect(learnedCoverageSkips([edgeOf()], '11:7E9', CTX({ protocol: CAN })).size)
      .toBe(0);
  });

  it('🔒 KİLİT (9): service/subFunction ayrımı KORUNUR', () => {
    const skips = learnedCoverageSkips(
      [edgeOf({ subFunction: '02' })], '11:7E8', CTX({ protocol: CAN }));
    expect(skips.has('19|02')).toBe(true);
    expect(skips.has('19|0A')).toBe(false);
  });

  it('🔒 KİLİT (13): BAYAT kayıt sorguyu ENGELLEMEZ', () => {
    expect(learnedCoverageSkips([edgeOf()], '11:7E8',
      CTX({ protocol: CAN, nowMs: NOW + CAPABILITY_FRESH_MS + 1 })).size).toBe(0);
  });

  it('🔒 KİLİT (14): TAŞIMA değişmiş kayıt sorguyu ENGELLEMEZ', () => {
    expect(learnedCoverageSkips([edgeOf()], '11:7E8', CTX({
      protocol: CAN,
      transport: { genericBridge: false, routePolicy: null, adapterHash: null },
    })).size).toBe(0);
  });

  it('🔒 KİLİT (15): replay/synthetic/imported reuse ÜRETMEZ', () => {
    for (const p of ['replay', 'synthetic', 'imported'] as CapabilityProvenance[]) {
      expect(isProductTrusted(p)).toBe(false);
      expect(learnedCoverageSkips([edgeOf({ provenance: p })], '11:7E8',
        CTX({ protocol: CAN })).size).toBe(0);
      expect(learnableCoveragePresence(row(), p))
        .toEqual({ learn: false, rejection: 'NOT_PRODUCT_TRUSTED' });
    }
  });

  it('🔒 KİLİT (16): öğrenilmiş PRESENT sorgu KALDIRMAZ', () => {
    expect(learnedCoverageSkips([edgeOf({ presence: 'PRESENT', nrc: null })],
      '11:7E8', CTX({ protocol: CAN })).size).toBe(0);
  });

  it('🔒 KİLİT (17): ABSENT yalnız NRC 0x11 ile ÖĞRENİLİR', () => {
    const learnable = (nrc: number | null) => learnableCoveragePresence(
      row({ outcome: 'UNSUPPORTED_MEASURED', measuredOutcome: 'unsupported', nrc }),
      'live');
    expect(learnable(0x11)).toEqual({ learn: true, presence: 'ABSENT' });
    for (const nrc of [0x12, 0x31, null]) {
      expect(learnable(nrc)).toEqual({ learn: false, rejection: 'ABSENT_WITHOUT_NRC11' });
    }
  });

  it('🔒 KİLİT (18): 0 DTC + eksik CORE hâlâ "clean" DEĞİL', () => {
    expect(buildDiagnosticCompleteness([{
      ecuKey: '11:7E8', coreVerdict: 'PARTIAL', deepVerdict: 'COMPLETE',
      corePlannedUnits: 6, coreTerminalUnits: 5,
      deepPlannedUnits: 2, deepTerminalUnits: 2,
      roleUnknown: false, productTrusted: true, requestCount: 6, rows: [],
    }]).verdict).not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT (19): healing bütçe/deneme sabitleri DEĞİŞMEDİ', () => {
    expect(MAX_ATTEMPTS_PER_TRIPLE).toBe(2);
    expect(MAX_ATTEMPTS_PER_GAP).toBe(4);
  });

  it('🔒 KİLİT (20): deterministik — aynı girdi aynı karar ve aynı plan', () => {
    const a = decideReuse(edgeOf(), CTX({ protocol: CAN }));
    const b = decideReuse(edgeOf(), CTX({ protocol: CAN }));
    expect(a).toBe(b);
    const planInput = (m: ReadonlyMap<string, ServicePresence>) => ({
      protocolFamily: 'can' as const, addressable: true,
      advancedBridge: true, legacyUdsBridge: true, standardBridge: true,
      readOnlyUdsSubFunctions: GENERIC_UDS_19_SUBS,
      serviceDefIds: new Set([...builtinServiceDefs(), ...extraReadOnlyServiceDefs()]
        .map((d) => d.id)),
      measuredPresence: m,
    });
    const skips = learnedCoverageSkips([edgeOf()], '11:7E8', CTX({ protocol: CAN }));
    expect(JSON.stringify(planEcuDtcCoverage(planInput(skips))))
      .toBe(JSON.stringify(planEcuDtcCoverage(planInput(skips))));
  });

  it('plan etkisi: AYNI protokolde atlar, FARKLI protokolde ATLAMAZ', () => {
    const planInput = (m: ReadonlyMap<string, ServicePresence>) => ({
      protocolFamily: 'can' as const, addressable: true,
      advancedBridge: true, legacyUdsBridge: true, standardBridge: true,
      readOnlyUdsSubFunctions: GENERIC_UDS_19_SUBS,
      serviceDefIds: new Set([...builtinServiceDefs(), ...extraReadOnlyServiceDefs()]
        .map((d) => d.id)),
      measuredPresence: m,
    });
    const same = learnedCoverageSkips([edgeOf({ protocol: CAN })], '11:7E8',
      CTX({ protocol: CAN }));
    expect(planEcuDtcCoverage(planInput(same))
      .find((x) => x.cls === 'UDS_DTC_BY_STATUS')!.decision).toBe('SKIP');

    const cross = learnedCoverageSkips([edgeOf({ protocol: KWP })], '11:7E8',
      CTX({ protocol: CAN }));
    expect(planEcuDtcCoverage(planInput(cross))
      .find((x) => x.cls === 'UDS_DTC_BY_STATUS')!.decision).toBe('QUERY');
  });
});
