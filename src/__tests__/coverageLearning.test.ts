/**
 * coverageLearning.test.ts — P0-VDK-F6E · PROVENANCE-AWARE COVERAGE LEARNING.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN KÖK NEDEN ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F4-C öğrenmesinin ÜRETİMDEKİ TEK yazıcısı `discovery/serviceDiscoveryRuntime`
 * idi. Ürünün **ANA tanı yolu** (Mode 03/07/0A · UDS 0x19-xx · KWP 0x18/0x13)
 * her taramada onlarca güvenilir ölçüm üretiyor ve **hiçbiri öğrenilmiyordu**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYANIN KİLİTLEDİĞİ PAZARLIKSIZ SINIR ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Öğrenme **HÜKÜM YAZMAZ.** `COMPLETE` · `clean` · "DTC yok" · destructive ·
 * oturum/taşıma override bu yoldan ÇIKAMAZ. Öğrenme yalnız bir sonraki
 * taramanın **ne ölçmesi gerektiğini** iyileştirir.
 */
import { describe, it, expect } from 'vitest';

import {
  learnableCoveragePresence, learnedCoverageSkips, learningEcuId,
  mergeMeasuredAndLearned, planCoverageLearningWrites,
  COVERAGE_LEARNING_REJECTION_LABEL,
  type CoverageLearningEndpoint, type CoverageLearningRow,
} from '../platform/obd/capability/coverageLearning';
import {
  CAPABILITY_FRESH_MS, mergeCapabilityObservation, isProductTrusted,
  type CapabilityEdge, type CapabilityProvenance, type TransportConstraint,
} from '../platform/obd/capability/capabilityGraph';
import { planEcuDtcCoverage } from '../platform/obd/dtcCoveragePlan';
import { GENERIC_UDS_19_SUBS } from '../platform/obd/genericPduTransport';
import {
  builtinServiceDefs, extraReadOnlyServiceDefs,
} from '../platform/obd/cddl/legacyAdapter';
import { ecuCoverageKey, buildDiagnosticCompleteness } from '../platform/obd/ecuCompleteness';
import { endpointKey } from '../platform/obd/ecu/ecuEndpointModel';
import type { ServicePresence } from '../platform/obd/ecuCapabilityModel';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';

const NOW = 1_700_000_000_000;
const TRANSPORT: TransportConstraint =
  { genericBridge: true, routePolicy: null, adapterHash: null };

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function row(over: Partial<CoverageLearningRow> = {}): CoverageLearningRow {
  return {
    service: '19', subFunction: '02',
    outcome: 'COMPLETE', measuredOutcome: 'ok', nrc: null,
    gapRoot: null, requestCount: 1, ...over,
  };
}

function endpoint(over: Partial<CoverageLearningEndpoint> = {}): CoverageLearningEndpoint {
  return {
    ecuKey: '11:7E8', protocol: '6', provenance: 'live', atMs: NOW,
    evidenceRef: 'corr-1', rows: [row()], ...over,
  };
}

/** Gerçek F4-C birleştiricisiyle bir kenar üretir (kopya politika YOK). */
function edge(over: Partial<CapabilityEdge> = {}): CapabilityEdge {
  const base = mergeCapabilityObservation(null, {
    vehicleId: 'veh-A', ecuId: learningEcuId('11:7E8'),
    service: '19', subFunction: '02',
    presence: 'ABSENT', provenance: 'live', protocol: '6',
    transport: TRANSPORT, evidenceRef: 'e1', nrc: 0x11, atMs: NOW,
  });
  return { ...base, ...over };
}

const REUSE_CTX = (over: Record<string, unknown> = {}) => ({
  nowMs: NOW, fingerprintReusable: true, transport: TRANSPORT, ...over,
} as Parameters<typeof learnedCoverageSkips>[2]);

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖĞRENİLEBİLİR — yalnız gerçekten ölçülmüş terminal sonuç
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E · ne öğrenilebilir', () => {
  it('🔒 KİLİT (1): gerçek PRESENT öğrenilebilir', () => {
    const v = learnableCoveragePresence(
      row({ outcome: 'COMPLETE', measuredOutcome: 'ok' }), 'live');
    expect(v).toEqual({ learn: true, presence: 'PRESENT' });
  });

  it('🔒 KİLİT (2): ölçülmüş ABSENT:11 öğrenilebilir', () => {
    const v = learnableCoveragePresence(
      row({ outcome: 'UNSUPPORTED_MEASURED', measuredOutcome: 'unsupported', nrc: 0x11 }),
      'live');
    expect(v).toEqual({ learn: true, presence: 'ABSENT' });
  });

  it('🔒 KİLİT: NRC 0x11 DIŞINDA yokluk ÖĞRENİLEMEZ (0x12 · 0x31)', () => {
    /* `normalizeAdvancedOutcome` 0x11/0x12/0x31'i tek `unsupported`a indirger;
       ham NRC olmadan "servis yok" öğrenmek F4-B kuralını çiğnerdi. */
    for (const nrc of [0x12, 0x31, null]) {
      const v = learnableCoveragePresence(
        row({ outcome: 'UNSUPPORTED_MEASURED', measuredOutcome: 'unsupported', nrc }),
        'live');
      expect(v).toEqual({ learn: false, rejection: 'ABSENT_WITHOUT_NRC11' });
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ÖĞRENİLEMEZ — fail-closed sözlüğün tamamı
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E · ne ÖĞRENİLEMEZ', () => {
  it('🔒 KİLİT (3): UNKNOWN öğrenilemez', () => {
    expect(learnableCoveragePresence(
      row({ outcome: 'UNKNOWN', measuredOutcome: 'no_response' }), 'live'))
      .toEqual({ learn: false, rejection: 'NOT_TERMINAL' });
  });

  it('🔒 KİLİT (4): PARSER_BOUND öğrenilemez', () => {
    expect(learnableCoveragePresence(
      row({ outcome: 'UNKNOWN', measuredOutcome: 'malformed', gapRoot: 'PARSER_BOUND' }),
      'live')).toEqual({ learn: false, rejection: 'PARSER_BOUND' });
  });

  it('🔒 KİLİT (5): TRANSPORT_BOUND "desteklenmiyor" bilgisine DÖNÜŞEMEZ', () => {
    const v = learnableCoveragePresence(
      row({ outcome: 'UNKNOWN', measuredOutcome: 'transport_error',
        gapRoot: 'TRANSPORT_BOUND' }), 'live');
    expect(v).toEqual({ learn: false, rejection: 'TRANSPORT_BOUND' });
    expect(COVERAGE_LEARNING_REJECTION_LABEL.TRANSPORT_BOUND)
      .toContain('araç desteklemiyor');
  });

  it('🔒 KİLİT (6): SESSION_CONDITIONED kesin capability bilgisi OLAMAZ', () => {
    expect(learnableCoveragePresence(
      row({ outcome: 'UNKNOWN', measuredOutcome: 'security_required',
        gapRoot: 'SESSION_CONDITIONED' }), 'live'))
      .toEqual({ learn: false, rejection: 'SESSION_CONDITIONED' });
  });

  it('🔒 KİLİT (7): replay/synthetic/imported ÖĞRENİLEMEZ', () => {
    for (const p of ['replay', 'synthetic', 'imported'] as CapabilityProvenance[]) {
      /* Sonuç ne kadar "terminal" görünürse görünsün köken kapısı ÖNCE gelir. */
      expect(learnableCoveragePresence(row(), p))
        .toEqual({ learn: false, rejection: 'NOT_PRODUCT_TRUSTED' });
      expect(isProductTrusted(p)).toBe(false);
    }
  });

  it('🔒 KİLİT: NOT_MEASURED_THIS_RUN (0 istek) öğrenilemez', () => {
    expect(learnableCoveragePresence(
      row({ outcome: 'DEFERRED', measuredOutcome: null, requestCount: 0 }), 'live'))
      .toEqual({ learn: false, rejection: 'NOT_MEASURED' });
  });

  it('🔒 KİLİT: ürün sınırı (19-04 · BLOCKED) ve plan dışı öğrenilemez', () => {
    expect(learnableCoveragePresence(
      row({ service: '19', subFunction: '04', outcome: 'BLOCKED',
        measuredOutcome: null, requestCount: 0, gapRoot: 'TRANSPORT_BOUND' }), 'live'))
      .toEqual({ learn: false, rejection: 'PRODUCT_LIMIT' });
    expect(learnableCoveragePresence(
      row({ outcome: 'NOT_APPLICABLE', measuredOutcome: null, requestCount: 0 }), 'live'))
      .toEqual({ learn: false, rejection: 'OUT_OF_PLAN' });
  });

  it('🔒 KİLİT (13): lifecycle RESOLVED bu modele HİÇ GİRMEZ', () => {
    /* Girdi tipinde lifecycle/RESOLVED alanı YOKTUR — öğrenme çözücü
       durumundan truth çıkaramaz, yalnız ÖLÇÜLEN sonuca bakar. */
    expect(Object.keys(row()).some((k) => /lifecycle|resolved/i.test(k))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) KİMLİK / İZOLASYON
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E · kimlik ve izolasyon', () => {
  it('🔒 KİLİT: öğrenme ECU kimliği MEVCUT keşif kimliğiyle AYNI (fragmentasyon yok)', () => {
    /* Üretimde F4-B kenarları `endpoint.<endpointKey>` ile yazılır. Kapsam
       öğrenmesi başka bir kimlik kullansaydı aynı fiziksel ECU iki ayrı
       kenar altında öğrenilir ve ikisi de yarım kalırdı. */
    expect(endpointKey('7E8', 11)).toBe(ecuCoverageKey({ rxHeader: '7E8', addressBits: 11 }));
    expect(learningEcuId('11:7E8')).toBe(`endpoint.${endpointKey('7E8', 11)}`);
  });

  it('🔒 KİLİT (8): araç kimliği YOKSA HİÇBİR ŞEY öğrenilmez', () => {
    expect(planCoverageLearningWrites([endpoint()],
      { vehicleRef: null, transport: TRANSPORT })).toHaveLength(0);
    expect(planCoverageLearningWrites([endpoint()],
      { vehicleRef: '', transport: TRANSPORT })).toHaveLength(0);
  });

  it('🔒 KİLİT (8): araç A öğrenimi araç B’ye SIZMAZ', () => {
    const a = planCoverageLearningWrites([endpoint()],
      { vehicleRef: 'veh-A', transport: TRANSPORT })[0]!;
    const b = planCoverageLearningWrites([endpoint()],
      { vehicleRef: 'veh-B', transport: TRANSPORT })[0]!;
    expect(a.vehicleId).toBe('veh-A');
    expect(b.vehicleId).toBe('veh-B');
    /* Okuma tarafı da araç bazlıdır: B'nin kenar listesinde A yoktur. */
    expect(learnedCoverageSkips([edge({ vehicleId: 'veh-A' })], '11:7E8', REUSE_CTX()).size)
      .toBe(1);   // çağıran zaten aracın kenarlarını verir
  });

  it('🔒 KİLİT (9): ECU A öğrenimi ECU B’ye SIZMAZ', () => {
    const skips = learnedCoverageSkips([edge()], '11:7E9', REUSE_CTX());
    expect(skips.size).toBe(0);                       // 7E8 kenarı 7E9'a uygulanmaz
    expect(learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX()).size).toBe(1);
  });

  it('🔒 KİLİT (10): service/subFunction ayrımı KORUNUR', () => {
    const writes = planCoverageLearningWrites([endpoint({
      rows: [
        row({ service: '19', subFunction: '02' }),
        row({ service: '19', subFunction: '0A' }),
        row({ service: '03', subFunction: null }),
      ],
    })], { vehicleRef: 'veh-A', transport: TRANSPORT });
    expect(writes).toHaveLength(3);
    const keys = writes.map((w) => `${w.service}|${w.subFunction ?? ''}`);
    expect(new Set(keys).size).toBe(3);
    /* Okuma tarafında da 19-02 atlatması 19-0A'yı atlatmaz. */
    const skips = learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX());
    expect(skips.has('19|02')).toBe(true);
    expect(skips.has('19|0A')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) TAZELİK — MEVCUT F4-C otoritesi
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E · tazelik ve güven sınırı', () => {
  it('🔒 KİLİT (11+12): BAYAT öğrenme atlatma ÜRETMEZ → gerçek ölçüm geri gelir', () => {
    const stale = REUSE_CTX({ nowMs: NOW + CAPABILITY_FRESH_MS + 1 });
    expect(learnedCoverageSkips([edge()], '11:7E8', stale).size).toBe(0);
    /* Taze olan atlatır — yani kilit vacuous değil. */
    expect(learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX()).size).toBe(1);
  });

  it('🔒 KİLİT: ÇELİŞKİLİ / CANLI OLMAYAN / ZAYIF PARMAK İZİ atlatma ÜRETMEZ', () => {
    expect(learnedCoverageSkips(
      [edge({ conflict: { kind: 'PRESENT_TO_ABSENT', previous: 'PRESENT',
        observed: 'ABSENT', atMs: NOW, consecutive: 1 } })],
      '11:7E8', REUSE_CTX()).size).toBe(0);
    expect(learnedCoverageSkips([edge({ productTrusted: false })], '11:7E8',
      REUSE_CTX()).size).toBe(0);
    expect(learnedCoverageSkips([edge()], '11:7E8',
      REUSE_CTX({ fingerprintReusable: false })).size).toBe(0);
  });

  it('🔒 KİLİT: TAŞIMA koşulu değiştiyse öğrenme atlatmaz (adaptör ≠ araç)', () => {
    expect(learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX({
      transport: { genericBridge: false, routePolicy: null, adapterHash: null },
    })).size).toBe(0);
  });

  it('🔒 KİLİT: öğrenilmiş PRESENT hiçbir sorguyu KALDIRMAZ', () => {
    /* Yalnız yokluk atlatır; "var" bilgisi ölçümün yerine GEÇMEZ. */
    expect(learnedCoverageSkips(
      [edge({ presence: 'PRESENT' })], '11:7E8', REUSE_CTX()).size).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) PLAN ETKİSİ — ürün değeri ölçülebilir
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E · tarama planına etkisi', () => {
  const planInput = (measuredPresence: ReadonlyMap<string, ServicePresence>) => ({
    protocolFamily: 'can' as const, addressable: true,
    advancedBridge: true, legacyUdsBridge: true, standardBridge: true,
    readOnlyUdsSubFunctions: GENERIC_UDS_19_SUBS,
    serviceDefIds: new Set([...builtinServiceDefs(), ...extraReadOnlyServiceDefs()]
      .map((d) => d.id)),
    measuredPresence,
  });

  it('🔒 KİLİT (18): öğrenme BOŞKEN plan BİREBİR eskisi gibi', () => {
    const steps = planEcuDtcCoverage(planInput(new Map()));
    expect(steps.find((x) => x.cls === 'UDS_DTC_BY_STATUS')!.decision).toBe('QUERY');
  });

  it('öğrenilmiş ABSENT sonraki taramada o sınıfı ATLATIR (ürün değeri)', () => {
    const learned = learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX());
    const steps = planEcuDtcCoverage(planInput(learned));
    const s = steps.find((x) => x.cls === 'UDS_DTC_BY_STATUS')!;
    expect(s.decision).toBe('SKIP');
    expect(s.skipReason).toBe('SERVICE_ABSENT_MEASURED');
    /* Başka sınıflar ETKİLENMEZ. */
    expect(steps.find((x) => x.cls === 'UDS_SUPPORTED_DTC')!.decision).toBe('QUERY');
    expect(steps.find((x) => x.cls === 'STANDARD_STORED')!.decision).toBe('QUERY');
  });

  it('🔒 KİLİT (12): BAYAT öğrenme sorguyu ENGELLEMEZ', () => {
    const stale = learnedCoverageSkips([edge()], '11:7E8',
      REUSE_CTX({ nowMs: NOW + CAPABILITY_FRESH_MS + 1 }));
    expect(planEcuDtcCoverage(planInput(stale))
      .find((x) => x.cls === 'UDS_DTC_BY_STATUS')!.decision).toBe('QUERY');
  });

  it('🔒 KİLİT: BU TURUN ÖLÇÜMÜ öğrenmeyi EZER', () => {
    const learned = new Map<string, ServicePresence>([['19|02', 'ABSENT']]);
    const measured = new Map<string, ServicePresence>([['19|02', 'PRESENT']]);
    expect(mergeMeasuredAndLearned(measured, learned).get('19|02')).toBe('PRESENT');
  });

  it('🔒 KİLİT (17): deterministik — aynı girdi aynı plan ve aynı yazım', () => {
    const ctx = { vehicleRef: 'veh-A', transport: TRANSPORT };
    expect(JSON.stringify(planCoverageLearningWrites([endpoint()], ctx)))
      .toBe(JSON.stringify(planCoverageLearningWrites([endpoint()], ctx)));
    const a = planEcuDtcCoverage(planInput(learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX())));
    const b = planEcuDtcCoverage(planInput(learnedCoverageSkips([edge()], '11:7E8', REUSE_CTX())));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) FAIL-CLOSED — öğrenme HÜKÜM yazamaz
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6E · öğrenme hüküm ÜRETEMEZ', () => {
  it('🔒 KİLİT (14): 0 DTC + eksik CORE hâlâ "clean" DEĞİL', () => {
    const d = buildDiagnosticCompleteness([{
      ecuKey: '11:7E8', coreVerdict: 'PARTIAL', deepVerdict: 'COMPLETE',
      corePlannedUnits: 6, coreTerminalUnits: 5,
      deepPlannedUnits: 2, deepTerminalUnits: 2,
      roleUnknown: false, productTrusted: true, requestCount: 6, rows: [],
    }]);
    expect(d.verdict).not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: öğrenme çıktısı YALNIZ ServicePresence — hüküm sözlüğü YOK', () => {
    const writes = planCoverageLearningWrites([endpoint({
      rows: [row(), row({ outcome: 'UNSUPPORTED_MEASURED',
        measuredOutcome: 'unsupported', nrc: 0x11, subFunction: '0A' })],
    })], { vehicleRef: 'veh-A', transport: TRANSPORT });
    for (const w of writes) {
      expect(['PRESENT', 'ABSENT']).toContain(w.presence);
    }
    const json = JSON.stringify(writes);
    for (const forbidden of ['COMPLETE', 'clean', 'RESOLVED', 'CORE_COMPLETE']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('🔒 KİLİT (16): öğrenme DESTRUCTIVE hiçbir servis üretemez', () => {
    const destructive = new Set(DESTRUCTIVE_SERVICES);
    const writes = planCoverageLearningWrites([endpoint({
      rows: ['03', '07', '0A', '19', '18', '13'].map((svc) => row({ service: svc })),
    })], { vehicleRef: 'veh-A', transport: TRANSPORT });
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(destructive.has(w.service)).toBe(false);
  });

  it('🔒 KİLİT (15): öğrenme bütçe/deneme sayacı alanı TAŞIMAZ', () => {
    const w = planCoverageLearningWrites([endpoint()],
      { vehicleRef: 'veh-A', transport: TRANSPORT })[0]!;
    expect(Object.keys(w).some((k) => /attempt|budget|request|probe/i.test(k)))
      .toBe(false);
  });

  it('🔒 KİLİT: öğrenme oturum/taşıma override ÜRETMEZ', () => {
    /* Yazılan gözlem yalnız ölçülen taşıma KOŞULUNU taşır (F4-C bunu
       `TRANSPORT_CHANGED` kapısında kullanır) — bir override DEĞİL. */
    const w = planCoverageLearningWrites([endpoint()],
      { vehicleRef: 'veh-A', transport: TRANSPORT })[0]!;
    expect(w.transport).toEqual(TRANSPORT);
    expect(Object.keys(w)).not.toContain('session');
  });
});
