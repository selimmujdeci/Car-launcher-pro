/**
 * attributionClosureProof.test.ts — P0-VDK-F6D-1.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYANIN KANITLADIĞI ZİNCİR ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   ATTRIBUTION_UNRESOLVED
 *     → mevcut VERIFY_ECU_ATTRIBUTION adayı
 *     → GERÇEK ve BAĞIMSIZ ölçüm kanıtı (F6-A `ecuAddressability` PROVEN)
 *     → yalnız DOĞRU (uç nokta × DTC sınıfı) satırının güncellenmesi
 *     → mevcut completeness/verdict hattının YENİDEN hesaplanması
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN İKİ KUSUR ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ① **FAIL-OPEN:** `judgeEvidence` atıf boşluğunu `last.ecuKey !== null` ise
 *    `RESOLVED` sayıyordu. Ama `ProbeRecord.ecuKey` ÇAĞIRANDAN YANKILANIR
 *    (`serviceDiscoveryRuntime.ts:539` → `input.ecuKey ?? null`) ve çağıran onu
 *    `gap.target.ecuKey`den verir → boşluk **sahibi hiç ölçülmeden** kapanırdı.
 * ② **KOPUKLUK:** `UNKNOWN_ECU_ATTRIBUTION`ın TEK üreticisi
 *    (`functionalDtcGapSignals`) hiçbir `recordGap` çağıranına bağlı DEĞİLDİ.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  functionalAttributionContext, planCoverageGaps, planFunctionalAttributionGaps,
  coverageGapPriority, coverageOutcomeFromHealing,
  type CoverageGapEndpointInput, type CoverageGapRowInput,
  type FunctionalAttributionInput,
} from '../platform/obd/healing/dtcCoverageGapBridge';
import {
  coverageGapRoot, DTC_COVERAGE_CLASS_SPECS, rollupEcuDtcCoverage,
  type DtcCoverageOutcome, type DtcCoverageSkipReason,
} from '../platform/obd/dtcCoveragePlan';
import {
  classifyRootCause, candidatesFor, selectCandidate, EXECUTABLE_CANDIDATES,
} from '../platform/obd/healing/resolutionPolicy';
import {
  attributionProvenFor, judgeEvidence, targetFromContext,
} from '../platform/obd/healing/gapResolverRuntime';
import { gapKey, type ResolvableGap } from '../platform/obd/healing/gapModel';
import { gapEvidenceDiscriminator, gapRegistryKey } from '../platform/obd/gapEvidence';
import {
  recordEcuObservation, _resetEcuObservationsForTest,
} from '../platform/obd/ecuAddressability';
import { buildDiagnosticCompleteness, ecuCoverageKey } from '../platform/obd/ecuCompleteness';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import type { ProbeRecord } from '../platform/obd/discovery/serviceProbeModel';

const EPOCH = 7;

beforeEach(() => { _resetEcuObservationsForTest(); });

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function functionalEvidence(
  over: Partial<FunctionalAttributionInput> = {},
): FunctionalAttributionInput {
  return {
    service: '03', ecuAttribution: 'UNKNOWN', protocol: '6',
    provenance: 'live', atMs: 1_700_000_000_000, sessionEpoch: EPOCH,
    transactionId: 'txn-1', evidenceCorrelationId: 'corr-1',
    vehicleRef: 'veh-A', ...over,
  };
}

/** Köprünün ürettiği kaydı resolver'ın gördüğü `ResolvableGap`e çevirir. */
function asGap(c: ReturnType<typeof planFunctionalAttributionGaps>[number],
  ecuKeyOverride?: string): ResolvableGap {
  const ev = c.record.evidence ?? null;
  const target = {
    ecuKey: ecuKeyOverride ?? ev?.ecuKey ?? null,
    service: ev?.service ?? null,
    subFunction: ev?.subFunction ?? null,
  };
  return {
    key: gapKey('REGISTRY', c.record.signal, target, c.record.context,
      gapEvidenceDiscriminator(ev)),
    origin: 'REGISTRY', gapClass: c.record.signal, scope: c.record.scope,
    target, context: c.record.context, observations: 1,
    lastSeenMs: c.record.atMs, lastNrc: null,
    transportLimited: false, sessionConditioned: false,
    evidence: ev, evidenceState: ev?.state ?? 'UNAVAILABLE', registryKey: null,
  };
}

/** Ölçüm kaydı — `ecuKey` ÇAĞIRANDAN yankılanır (fail-open'ın kaynağı). */
function probe(over: Partial<ProbeRecord> = {}): ProbeRecord {
  return {
    service: '03', subFunction: null, ecuKey: '11:7E8',
    classification: 'PRESENT', outcome: 'POSITIVE', nrc: null,
    sessionOpened: null, atMs: 1_700_000_000_000,
    ...over,
  } as ProbeRecord;
}

/** F6-A defterine ÖLÇÜLMÜŞ (PROVEN) bir sahiplik kaydı yazar. */
function proveOwner(rxHeader = '7E8', sessionEpoch = EPOCH): void {
  recordEcuObservation({
    atMs: 1_700_000_000_000, sessionEpoch, protocol: '6',
    rxHeader, txHeader: '7E0', addressBits: 11, label: 'Motor (ECM)',
    role: 'engine', roleEvidence: 'standard',
    discoverySource: 'physical_probe', probeOutcome: 'responded',
    txProvenance: 'standard', addressability: 'PROVEN',
    addressabilityReason: 'fiziksel istek cevaplandı',
    attempts: [], admission: 'READY', kwpTargetVerified: false,
    publishedToAuthority: null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   1) ROOT CAUSE #1 — kapsam satırı atıf boşluğu ÜRETEMEZ (tasarım)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-1 · kapsam satırı ATIF belirsizliği üretmez', () => {
  it('🔒 KİLİT: `coverageGapRoot` HİÇBİR girdide ATTRIBUTION_UNRESOLVED üretmez', () => {
    /* Kapsam satırları uç nokta BAŞINA tutulur ve anahtarı `ecuCoverageKey`tir;
       sahibi YAPISAL OLARAK bellidir. Oradan atıf boşluğu üretmek, OLMAYAN bir
       belirsizliği UYDURMAK olurdu. */
    const outcomes: DtcCoverageOutcome[] = ['COMPLETE', 'PARTIAL', 'UNSUPPORTED_MEASURED',
      'UNKNOWN', 'DEFERRED', 'BLOCKED', 'NOT_APPLICABLE'];
    const measured = [null, 'ok', 'unsupported', 'no_response', 'timeout', 'malformed',
      'transport_error', 'security_required', 'condition_required', 'not_addressable'];
    const skips: (DtcCoverageSkipReason | null)[] = [null, 'NOT_QUERIED',
      'PROTOCOL_MISMATCH', 'NOT_ADDRESSABLE', 'TRANSPORT_LIMIT',
      'SUBFUNCTION_GATE_DENIED', 'NO_SERVICE_DEFINITION', 'BUDGET_EXHAUSTED',
      'SESSION_CONDITIONED', 'NO_PRECONDITION_EVIDENCE', 'SERVICE_ABSENT_MEASURED',
      'CAPABILITY_REUSED'];
    for (const o of outcomes) {
      for (const m of measured) {
        for (const sk of skips) {
          expect(coverageGapRoot(o, m, sk)).not.toBe('ATTRIBUTION_UNRESOLVED');
        }
      }
    }
  });

  it('🔒 KİLİT: kapsam köprüsü hiçbir satırdan atıf boşluğu YAZMAZ', () => {
    const rows: CoverageGapRowInput[] = DTC_COVERAGE_CLASS_SPECS.map((sp) => ({
      axis: sp.axis, service: sp.service, subFunction: sp.subFunction,
      outcome: 'UNKNOWN', gapRoot: coverageGapRoot('UNKNOWN', 'no_response', null),
      skipReason: null, measuredOutcome: 'no_response', requestCount: 1, cls: sp.cls,
    }));
    const ep: CoverageGapEndpointInput = {
      ecuKey: '11:7E8', txHeader: '7E0', rxHeader: '7E8', protocol: '6',
      provenance: 'live', atMs: 1, sessionEpoch: EPOCH,
      transactionId: 't', evidenceCorrelationId: 'c', vehicleRef: 'veh-A', rows,
    };
    expect(planCoverageGaps([ep]).some((g) => g.root === 'ATTRIBUTION_UNRESOLVED'))
      .toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ROOT CAUSE #2 — fonksiyonel atıf boşluğu artık sicile ULAŞIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-1 · fonksiyonel atıf → kanonik sicil', () => {
  it('🔒 KİLİT (1): sahibi ölçülemeyen fonksiyonel okuma boşluk ÜRETİR', () => {
    const gaps = planFunctionalAttributionGaps([functionalEvidence()]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.record.signal).toBe('UNKNOWN_ECU_ATTRIBUTION');
    expect(gaps[0]!.root).toBe('ATTRIBUTION_UNRESOLVED');
  });

  it('🔒 KİLİT (1): boşluk DOĞRU kök nedene ve — hedef VARSA — doğru adaya gider', () => {
    const targetless = asGap(planFunctionalAttributionGaps([functionalEvidence()])[0]!);
    /* Kök neden İKİ YERDE hesaplanmıyor — mevcut otorite aynısını türetir. */
    expect(classifyRootCause(targetless)).toBe('ATTRIBUTION_UNRESOLVED');
    expect(EXECUTABLE_CANDIDATES.has('VERIFY_ECU_ATTRIBUTION')).toBe(true);

    /* P0-VDK-F6D-2 — fonksiyonel atıf boşluğunun hedefi TANIMI GEREĞİ yoktur;
       o hâlde güvenli ölçüm de yoktur (0 PDU). Ayrıntılı kilitler
       `targetlessAttributionNoSafeAction.test.ts` dosyasındadır. */
    const ctx = {
      isCan: true, genericBridge: true, targetVerified: true,
      priorAttemptsFor: () => 0,
    };
    expect(selectCandidate(candidatesFor(targetless, 'ATTRIBUTION_UNRESOLVED', ctx), 0).kind)
      .toBe('NO_SAFE_ACTION');

    /* Sahip BAŞKA bir yoldan ölçülüp hedef bilinir hâle geldiyse mevcut
       aday yolu aynen çalışır. */
    const targeted = asGap(
      planFunctionalAttributionGaps([functionalEvidence()])[0]!, '11:7E8');
    const cands = candidatesFor(targeted, 'ATTRIBUTION_UNRESOLVED', ctx);
    expect(cands.map((c) => c.kind)).toContain('VERIFY_ECU_ATTRIBUTION');
    expect(selectCandidate(cands, 0).kind).toBe('VERIFY_ECU_ATTRIBUTION');
  });

  it('🔒 KİLİT: SAHİP UYDURULMAZ — zarfın ecuKey’i NULL kalır', () => {
    const ev = planFunctionalAttributionGaps([functionalEvidence()])[0]!.record.evidence!;
    expect(ev.ecuKey).toBeNull();
    expect(ev.service).toBe('03');
    /* F5-D referansları taşınır (araç izolasyonu için şart). */
    expect(ev.vehicleFingerprintRef).toBe('veh-A');
    expect(ev.sessionEpoch).toBe(EPOCH);
    expect(ev.provenance).toBe('live');
  });

  it('🔒 KİLİT (5): araç A kanıtı araç B satırına SIZMAZ', () => {
    const a = planFunctionalAttributionGaps([functionalEvidence({ vehicleRef: 'veh-A' })])[0]!;
    const b = planFunctionalAttributionGaps([functionalEvidence({ vehicleRef: 'veh-B' })])[0]!;
    expect(a.record.evidence!.vehicleFingerprintRef).toBe('veh-A');
    expect(b.record.evidence!.vehicleFingerprintRef).toBe('veh-B');
    /* Farklı oturum → farklı kanıt; aynı satıra ezilmez. */
    const other = planFunctionalAttributionGaps([
      functionalEvidence({ sessionEpoch: 99 })])[0]!;
    expect(other.record.evidence!.sessionEpoch).toBe(99);
  });

  it('sahibi ÖLÇÜLEN fonksiyonel okuma boşluk ÜRETMEZ', () => {
    expect(planFunctionalAttributionGaps([
      functionalEvidence({ ecuAttribution: 'MEASURED' })])).toHaveLength(0);
  });

  it('bağlam ayrı ve deterministik; servis başına TEK satır', () => {
    expect(functionalAttributionContext('03')).toBe('dtc_attribution:functional:03');
    /* Kapsam köprüsünün önekiyle karışmaz. */
    expect(targetFromContext(functionalAttributionContext('03')))
      .toEqual({ ecuKey: null, service: null, subFunction: null });
    expect(planFunctionalAttributionGaps([
      functionalEvidence(), functionalEvidence(), functionalEvidence({ service: '07' }),
    ])).toHaveLength(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) ROOT CAUSE #3 — YANKILANAN künye artık KANIT SAYILMAZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-1 · atıf yalnız BAĞIMSIZ ölçümle kapanır', () => {
  const gapWithTarget = () =>
    asGap(planFunctionalAttributionGaps([functionalEvidence()])[0]!, '11:7E8');

  it('🔒 KİLİT (2): sahiplik BAĞIMSIZ ölçüldüyse boşluk kapanır', () => {
    proveOwner('7E8', EPOCH);
    const v = judgeEvidence(gapWithTarget(), [probe()], 'live', true);
    expect(v.lifecycle).toBe('RESOLVED');
    expect(v.detail).toContain('ÖLÇÜLDÜ');
  });

  it('🔒 KİLİT (6): sahiplik ölçülmediyse boşluk AÇIK kalır — yankı kanıt DEĞİL', () => {
    /* ecuKey kayıtta VAR (çağırandan yankılandı) ama bağımsız ölçüm YOK. */
    const v = judgeEvidence(gapWithTarget(), [probe()], 'live', false);
    expect(v.lifecycle).toBe('UNKNOWN');
    expect(v.detail).toContain('yankıland');
  });

  it('🔒 KİLİT: parametre VERİLMEZSE fail-closed (varsayılan güvenli)', () => {
    const v = judgeEvidence(gapWithTarget(), [probe()], 'live');
    expect(v.lifecycle).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: sahip künyesi HİÇ yoksa yine AÇIK kalır', () => {
    const v = judgeEvidence(gapWithTarget(), [probe({ ecuKey: null })], 'live', true);
    expect(v.lifecycle).toBe('UNKNOWN');
    expect(v.detail).toContain('SAHİBİ');
  });

  it('🔒 KİLİT (8): replay/sentetik kanıt TRUSTED sayılmaz', () => {
    proveOwner('7E8', EPOCH);
    for (const p of ['replay', 'synthetic', 'imported'] as const) {
      const v = judgeEvidence(gapWithTarget(), [probe()], p, true);
      expect(v.lifecycle).toBe('UNKNOWN');
      expect(v.detail).toContain('ürün güveni');
    }
  });

  it('🔒 KİLİT (5): BAŞKA aracın/oturumun PROVEN kaydı sahiplik kanıtı SAYILMAZ', () => {
    /* Farklı oturumda kanıtlanmış bir uç nokta bu turun kanıtı değildir —
       `_attributionProven` oturum mührünü karşılaştırır. Burada kilit,
       yanlış oturumun `true` ÜRETEMEYECEĞİDİR (çağıran `false` iletir). */
    proveOwner('7E8', 999);
    expect(judgeEvidence(gapWithTarget(), [probe()], 'live', false).lifecycle)
      .toBe('UNKNOWN');
  });

  /* ── ÜRETİM HESABI DOĞRUDAN KANITLANIR ─────────────────────────
     Yukarıdaki kilitler `attributionProven` bayrağını ELLE veriyor. Aşağıdakiler
     üretimde o bayrağı ÜRETEN hesabı (F6-A defteri okuması) doğrudan kilitler —
     aksi hâlde zincirin en kritik halkası test edilmemiş kalırdı. */
  it('🔒 KİLİT (2): üretim hesabı ÖLÇÜLMÜŞ sahipliği bulur', () => {
    proveOwner('7E8', EPOCH);
    expect(attributionProvenFor(gapWithTarget(), EPOCH)).toBe(true);
  });

  it('🔒 KİLİT: anahtar biçimi `ecuCoverageKey` ile BİREBİR AYNI', () => {
    /* İki taraf aynı kimliği kullanmazsa "doğrulanmış sahiplik" BAŞKA bir uç
       noktaya atfedilebilirdi — sessiz ve tehlikeli bir karışma. */
    proveOwner('7E8', EPOCH);
    expect(ecuCoverageKey({ rxHeader: '7E8', addressBits: 11 })).toBe('11:7E8');
    expect(attributionProvenFor(gapWithTarget(), EPOCH)).toBe(true);
  });

  it('🔒 KİLİT (5): BAŞKA OTURUMUN kanıtı sahiplik kanıtı SAYILMAZ', () => {
    proveOwner('7E8', 999);                    // başka oturum (başka araç olabilir)
    expect(attributionProvenFor(gapWithTarget(), EPOCH)).toBe(false);
  });

  it('🔒 KİLİT (4): BAŞKA UÇ NOKTANIN kanıtı bu hedefi doğrulamaz', () => {
    proveOwner('7E9', EPOCH);                  // başka ECU kanıtlandı
    expect(attributionProvenFor(gapWithTarget(), EPOCH)).toBe(false);
  });

  it('🔒 KİLİT (6): PROVEN olmayan gözlem sahiplik kanıtı DEĞİLDİR', () => {
    recordEcuObservation({
      atMs: 1, sessionEpoch: EPOCH, protocol: '6',
      rxHeader: '7E8', txHeader: '7E0', addressBits: 11, label: 'Motor (ECM)',
      role: 'engine', roleEvidence: 'standard',
      discoverySource: 'functional_0100', probeOutcome: 'no_response',
      txProvenance: 'standard', addressability: 'NOT_ADDRESSABLE',
      addressabilityReason: 'ECU sustu', attempts: [], admission: 'READY',
      kwpTargetVerified: false, publishedToAuthority: null,
    });
    expect(attributionProvenFor(gapWithTarget(), EPOCH)).toBe(false);
  });

  it('🔒 KİLİT: defter BOŞken fail-closed (kanıt yok → kanıtlanmamış)', () => {
    expect(attributionProvenFor(gapWithTarget(), EPOCH)).toBe(false);
  });

  it('🔒 KİLİT (9): hiçbir yol SAHTE `ABSENT` üretemez', () => {
    /* Atıf dalı yalnız RESOLVED/UNKNOWN üretir — "servis yok" hükmü YOK. */
    for (const proven of [true, false]) {
      const v = judgeEvidence(gapWithTarget(), [probe()], 'live', proven);
      expect(['RESOLVED', 'UNKNOWN']).toContain(v.lifecycle);
      expect(v.detail).not.toContain('ABSENT');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) KAPSAM HATTI — yalnız DOĞRU satır, RESOLVED tek başına yetmez
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-1 · kapsam yalnız gerçek ölçümle değişir', () => {
  it('🔒 KİLİT (3+4): yalnız hedeflenen (uç nokta × sınıf) güncellenir', () => {
    /* Tazeleme anahtarı `${ecuKey}|${cls}`tir: başka ECU ya da başka sınıf
       ASLA eşleşmez. Burada o anahtarın ayrıştırıcılığı kilitlenir. */
    const k = (ecu: string, cls: string) => `${ecu}|${cls}`;
    expect(k('11:7E8', 'UDS_DTC_BY_STATUS')).not.toBe(k('11:7E9', 'UDS_DTC_BY_STATUS'));
    expect(k('11:7E8', 'UDS_DTC_BY_STATUS')).not.toBe(k('11:7E8', 'UDS_SUPPORTED_DTC'));
    expect(k('11:7E8', 'STANDARD_STORED')).not.toBe(k('11:7E8', 'STANDARD_PENDING'));
  });

  it('🔒 KİLİT (7): `RESOLVED` yaşam döngüsü TEK BAŞINA kapsamı tamamlamaz', () => {
    /* Tazeleme `lifecycle`e BAKMAZ — yalnız ÖLÇÜLEN sonuca bakar. */
    expect(coverageOutcomeFromHealing(null)).toBeNull();          // ölçüm yok → dokunma
    expect(coverageOutcomeFromHealing('UNKNOWN:-')).toBe('UNKNOWN');
    expect(coverageOutcomeFromHealing('PRESENT_BUT_CONDITIONED:33')).toBe('UNKNOWN');
    /* Yalnız gerçek terminal ölçüm tamamlar. */
    expect(coverageOutcomeFromHealing('PRESENT:-')).toBe('COMPLETE');
  });

  it('🔒 KİLİT (6): başarısız/belirsiz atıf sonrası satır UNKNOWN kalır → COMPLETE YOK', () => {
    const rows = DTC_COVERAGE_CLASS_SPECS.map((sp) => ({
      cls: sp.cls,
      outcome: (sp.cls === 'UDS_DTC_BY_STATUS' ? 'UNKNOWN' : 'COMPLETE') as DtcCoverageOutcome,
    }));
    expect(rollupEcuDtcCoverage(rows).core.verdict).not.toBe('COMPLETE');
  });

  it('🔒 KİLİT (10): 0 DTC + eksik CORE hâlâ "clean" olamaz', () => {
    const d = buildDiagnosticCompleteness([{
      ecuKey: '11:7E8', coreVerdict: 'PARTIAL', deepVerdict: 'COMPLETE',
      corePlannedUnits: 6, coreTerminalUnits: 5,
      deepPlannedUnits: 2, deepTerminalUnits: 2,
      roleUnknown: false, productTrusted: true, requestCount: 6, rows: [],
    }]);
    expect(d.verdict).not.toBe('CORE_COMPLETE');
    expect(d.coreCoverageRatio).toBeCloseTo(5 / 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) BÜTÇE · ANTI-LOOP · GÜVENLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D-1 · korunan invaryantlar', () => {
  it('🔒 KİLİT (11): anti-loop ve bütçe sabitleri DEĞİŞMEDİ', async () => {
    const pol = await import('../platform/obd/healing/resolutionPolicy');
    expect(pol.MAX_ATTEMPTS_PER_TRIPLE).toBe(2);
    expect(pol.MAX_ATTEMPTS_PER_GAP).toBe(4);
    const trig = await import('../platform/obd/healing/selfHealingTrigger');
    expect(trig.HEALING_BUDGET_SHARE).toBe(0.25);
    expect(trig.HEALING_MAX_REQUESTS).toBe(10);
    expect(trig.HEALING_MIN_RESERVE_REQUESTS).toBe(24);
  });

  it('🔒 KİLİT (11): deneme tavanı dolunca aday SEÇİLMEZ', () => {
    const gap = asGap(planFunctionalAttributionGaps([functionalEvidence()])[0]!, '11:7E8');
    const cands = candidatesFor(gap, 'ATTRIBUTION_UNRESOLVED', {
      isCan: true, genericBridge: true, targetVerified: true,
      priorAttemptsFor: () => 2,
    });
    expect(selectCandidate(cands, 0).candidate).toBeNull();
    expect(selectCandidate(cands, 4).kind).toBe('NO_SAFE_ACTION');
  });

  it('🔒 KİLİT (12): atıf yolu DESTRUCTIVE hiçbir servis üretemez', () => {
    const destructive = new Set(DESTRUCTIVE_SERVICES);
    for (const svc of ['03', '07', '0A']) {
      const ev = planFunctionalAttributionGaps([
        functionalEvidence({ service: svc })])[0]!.record.evidence!;
      expect(destructive.has(ev.service ?? '')).toBe(false);
    }
    /* Aday sözlüğünde yazma/aktüatör/güvenlik erişimi YOKTUR. */
    for (const k of EXECUTABLE_CANDIDATES) {
      expect(k).not.toMatch(/CLEAR|WRITE|RESET|SECURITY|ROUTINE|CODING/i);
    }
  });

  it('🔒 KİLİT: atıf boşluğu TEMEL eksende ve derin kanıttan ÖNCE gelir', () => {
    expect(coverageGapPriority('core', 'ATTRIBUTION_UNRESOLVED'))
      .toBeLessThan(coverageGapPriority('deep', 'CAPABILITY_UNMEASURED'));
  });

  it('aynı ölçüm → aynı sicil anahtarı (rastgele ID YOK)', () => {
    const k = (c: ReturnType<typeof planFunctionalAttributionGaps>[number]) =>
      gapRegistryKey(c.record.signal, c.record.context, c.record.evidence ?? null);
    expect(k(planFunctionalAttributionGaps([functionalEvidence()])[0]!))
      .toBe(k(planFunctionalAttributionGaps([functionalEvidence()])[0]!));
  });
});
