/**
 * coverageDrivenSelfHealing.test.ts — P0-VDK-F6D.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN KÖK NEDEN ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F6-C `measurableGapUnits` üretiyordu ama **o sayı hiçbir yere gitmiyordu**:
 * üretimde `recordGap`in TEK çağıranı F4-B servis keşfiydi, dolayısıyla
 * okunamayan bir DTC kanalı F5 resolver tarafından **GÖRÜLEMİYORDU**.
 *
 * Bu dosya köprüyü ve onun PAZARLIKSIZ sınırlarını kilitler:
 *  ① yalnız ÖLÇÜMLE kapanabilecek boşluk executable
 *  ② PARSER_BOUND = 0 PDU (araç kusuru değil, yazılım borcu)
 *  ③ CORE her zaman DEEP'ten önce
 *  ④ `gap RESOLVED` TEK BAŞINA `COMPLETE`/`clean` ÜRETMEZ
 */
import { describe, it, expect } from 'vitest';

import {
  coverageGapContext, coverageGapPriority, coverageGapRejection,
  coverageGapScope, coverageGapSignal, coverageOutcomeFromHealing,
  coveragePduOutcome, coveragePresence, isDeepCoverageContext,
  parseCoverageContext, planCoverageGaps,
  type CoverageGapEndpointInput, type CoverageGapRowInput,
} from '../platform/obd/healing/dtcCoverageGapBridge';
import { classifyRootCause } from '../platform/obd/healing/resolutionPolicy';
import {
  isMeasurementResolvable, gapKey, type ResolvableGap, type RootCauseClass,
} from '../platform/obd/healing/gapModel';
import { gapEvidenceDiscriminator, gapRegistryKey } from '../platform/obd/gapEvidence';
import { targetFromContext } from '../platform/obd/healing/gapResolverRuntime';
import { DESTRUCTIVE_SERVICES } from '../platform/obd/genericPduTransport';
import { buildDiagnosticCompleteness } from '../platform/obd/ecuCompleteness';

/* ── Yardımcılar ─────────────────────────────────────────────────────────── */

function row(over: Partial<CoverageGapRowInput> = {}): CoverageGapRowInput {
  return {
    axis: 'core', service: '19', subFunction: '02',
    outcome: 'UNKNOWN', gapRoot: 'CAPABILITY_UNMEASURED', skipReason: null,
    measuredOutcome: 'no_response', requestCount: 1, cls: 'UDS_DTC_BY_STATUS',
    ...over,
  };
}

function endpoint(over: Partial<CoverageGapEndpointInput> = {}): CoverageGapEndpointInput {
  return {
    ecuKey: '11:7E8', txHeader: '7E0', rxHeader: '7E8', protocol: '6',
    provenance: 'live', atMs: 1_700_000_000_000, sessionEpoch: 3,
    transactionId: 'txn-1', evidenceCorrelationId: 'corr-1',
    vehicleRef: 'veh-A', rows: [row()], ...over,
  };
}

/** Köprünün ürettiği kaydı, resolver'ın gördüğü `ResolvableGap`e çevirir. */
function asResolvableGap(c: ReturnType<typeof planCoverageGaps>[number]): ResolvableGap {
  const ev = c.record.evidence ?? null;
  const target = {
    ecuKey: ev?.ecuKey ?? null,
    service: ev?.service ?? null,
    subFunction: ev?.subFunction ?? null,
  };
  return {
    key: gapKey('REGISTRY', c.record.signal, target, c.record.context,
      gapEvidenceDiscriminator(ev)),
    origin: 'REGISTRY',
    gapClass: c.record.signal,
    scope: c.record.scope,
    target,
    context: c.record.context,
    observations: 1,
    lastSeenMs: c.record.atMs,
    lastNrc: ev?.observedNrc ?? null,
    transportLimited: c.record.signal === 'TRANSPORT_LIMITATION'
      || c.record.scope === 'TRANSPORT',
    sessionConditioned: c.record.scope === 'SESSION',
    evidence: ev,
    evidenceState: ev?.state ?? 'UNAVAILABLE',
    registryKey: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1) ROUND-TRIP — köprü ile resolver AYNI kök nedeni söyler
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · köprü ↔ resolver round-trip', () => {
  const roots: RootCauseClass[] = [
    'CAPABILITY_UNMEASURED', 'SESSION_CONDITIONED',
    'TRANSPORT_BOUND', 'PARSER_BOUND', 'ATTRIBUTION_UNRESOLVED',
  ];

  it('🔒 KİLİT: köprünün seçtiği sinyal, resolver’da AYNI kök nedene çözülür', () => {
    for (const root of roots) {
      const c = planCoverageGaps([endpoint({
        rows: [row({ gapRoot: root, outcome: root === 'TRANSPORT_BOUND' ? 'UNKNOWN' : 'UNKNOWN',
          measuredOutcome: root === 'PARSER_BOUND' ? 'malformed' : 'no_response' })],
      })])[0];
      expect(c, `root ${root} için kayıt üretilmeli`).toBeDefined();
      /* Kök neden İKİ YERDE hesaplanmıyor: burada seçilen sinyal, oradaki
         TEK otoritenin aynı sonucu üretmesini sağlayan girdidir. */
      expect(classifyRootCause(asResolvableGap(c!))).toBe(root);
    }
  });

  it('🔒 KİLİT: yeni sinyal sözlüğü YAZILMADI — hepsi mevcut ReplayGapSignal', () => {
    const known = new Set([
      'UNKNOWN_SERVICE', 'UNKNOWN_SUBFUNCTION', 'UNKNOWN_RESPONSE_SHAPE',
      'UNKNOWN_ECU_VARIANT', 'TRANSPORT_LIMITATION', 'PARSER_GAP', 'CAPABILITY_GAP',
      'UNEXPECTED_SID', 'MALFORMED_DTC_BODY', 'LEGACY_NATIVE_ONLY',
      'PARSER_PARITY_MISMATCH', 'UNKNOWN_ECU_ATTRIBUTION',
    ]);
    for (const root of roots) {
      const sig = coverageGapSignal(root, '02');
      expect(sig).not.toBeNull();
      expect(known.has(sig!)).toBe(true);
    }
  });

  it('yetenek çizgesine ait kökler kapsam satırından ÜRETİLMEZ (çift kayıt yok)', () => {
    expect(coverageGapSignal('CAPABILITY_STALE', null)).toBeNull();
    expect(coverageGapSignal('CAPABILITY_CONTESTED', null)).toBeNull();
    expect(coverageGapSignal('UNKNOWN', null)).toBeNull();
  });

  it('🔒 KİLİT: bağlam öneki AYRI — iki üretici aynı satıra EZİLMEZ', () => {
    const ctx = coverageGapContext('core', 'UDS_DTC_BY_STATUS');
    expect(ctx).toBe('dtc_coverage:core:UDS_DTC_BY_STATUS');
    /* `discovery:` bağlam çözücüsü bu öneke hedef ÜRETMEZ (uydurma hedef YASAK);
       hedef zarftan gelir. */
    expect(targetFromContext(ctx)).toEqual({ ecuKey: null, service: null, subFunction: null });
    expect(parseCoverageContext('discovery:1902')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) HANGİ SATIR BOŞLUK ÜRETİR
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · gap üretme kuralı', () => {
  it('🔒 KİLİT: POSITIVE_EMPTY / UNSUPPORTED_MEASURED / NOT_APPLICABLE gap ÜRETMEZ', () => {
    for (const outcome of ['COMPLETE', 'UNSUPPORTED_MEASURED', 'NOT_APPLICABLE'] as const) {
      expect(coverageGapRejection(row({ outcome, gapRoot: null }))).toBe('NOT_A_GAP');
      expect(planCoverageGaps([endpoint({ rows: [row({ outcome, gapRoot: null })] })]))
        .toHaveLength(0);
    }
  });

  it('🔒 KİLİT: plan dışı protokol servisi gap ÜRETMEZ', () => {
    /* CAN aracında KWP 0x18 → NOT_APPLICABLE. */
    expect(planCoverageGaps([endpoint({
      rows: [row({ service: '18', subFunction: null, cls: 'KWP_DTC_18',
        outcome: 'NOT_APPLICABLE', gapRoot: null })],
    })])).toHaveLength(0);
  });

  it('🔒 KİLİT: NO_RESPONSE ve TIMEOUT hedefli yeniden ölçüm adayı ÜRETİR', () => {
    for (const m of ['no_response', 'timeout']) {
      const gaps = planCoverageGaps([endpoint({ rows: [row({ measuredOutcome: m })] })]);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.root).toBe('CAPABILITY_UNMEASURED');
      expect(gaps[0]!.measurementResolvable).toBe(true);
    }
  });

  it('🔒 KİLİT: HİÇ ölçülmemiş satır AYNI turda gap ÜRETMEZ (kendi kendini yiyen loop yok)', () => {
    /* Bütçe bittiği için gönderilmemiş bir sorguyu hemen ardından gelen
       iyileştirme turunda yeniden denemek, bütçesi zaten bitmiş bir turda
       yeni istek üretmek olurdu. */
    expect(coverageGapRejection(row({
      outcome: 'DEFERRED', gapRoot: 'CAPABILITY_UNMEASURED',
      skipReason: 'BUDGET_EXHAUSTED', measuredOutcome: null, requestCount: 0,
    }))).toBe('NOT_MEASURED_THIS_RUN');
    /* 0x19-06 ön koşulu (ölçülmüş DTC) yoksa da gönderilecek hedef YOKTU. */
    expect(coverageGapRejection(row({
      axis: 'deep', outcome: 'DEFERRED', gapRoot: 'CAPABILITY_UNMEASURED',
      skipReason: 'NO_PRECONDITION_EVIDENCE', measuredOutcome: null, requestCount: 0,
    }))).toBe('NOT_MEASURED_THIS_RUN');
  });

  it('🔒 KİLİT: KAPI/TANIM sınırı (19-04) sicile YAZILMAZ — ürün sınırı, araç ölçümü değil', () => {
    const rej = coverageGapRejection(row({
      service: '19', subFunction: '04', cls: 'UDS_SNAPSHOT_RECORD', axis: 'deep',
      outcome: 'BLOCKED', gapRoot: 'TRANSPORT_BOUND',
      skipReason: 'NO_SERVICE_DEFINITION', measuredOutcome: null, requestCount: 0,
    }));
    expect(rej).toBe('PRODUCT_LIMIT_NOT_VEHICLE_MEASUREMENT');
    expect(planCoverageGaps([endpoint({
      rows: [row({ service: '19', subFunction: '04', cls: 'UDS_SNAPSHOT_RECORD',
        axis: 'deep', outcome: 'BLOCKED', gapRoot: 'TRANSPORT_BOUND',
        skipReason: 'NO_SERVICE_DEFINITION', measuredOutcome: null, requestCount: 0 })],
    })])).toHaveLength(0);
  });

  it('ÖLÇÜLMÜŞ taşıma hatası gap ÜRETİR (kapı sınırından AYRI)', () => {
    const gaps = planCoverageGaps([endpoint({
      rows: [row({ measuredOutcome: 'transport_error', gapRoot: 'TRANSPORT_BOUND' })],
    })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.record.scope).toBe('TRANSPORT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) PARSER — 0 PDU, PAZARLIKSIZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · PARSER_BOUND asla yeniden sorulmaz', () => {
  it('🔒 KİLİT: parser boşluğu ölçümle KAPANAMAZ olarak işaretlenir', () => {
    const gaps = planCoverageGaps([endpoint({
      rows: [row({ gapRoot: 'PARSER_BOUND', measuredOutcome: 'malformed' })],
    })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.measurementResolvable).toBe(false);
    expect(gaps[0]!.record.scope).toBe('PARSER');
    /* MEVCUT otorite de AYNI şeyi söyler — iki yerde kural yok, tek kural. */
    expect(isMeasurementResolvable('PARSER_BOUND')).toBe(false);
    expect(classifyRootCause(asResolvableGap(gaps[0]!))).toBe('PARSER_BOUND');
  });

  it('🔒 KİLİT: malformed "servis desteklenmiyor" DEĞİLDİR', () => {
    expect(coveragePduOutcome('malformed')).toBe('MALFORMED');
    expect(coveragePresence('MALFORMED')).toBe('UNKNOWN_RESPONSE_SHAPE');
    /* Hiçbir dal ABSENT üretemez — "servis yok" demek yalnız NRC 0x11 ile. */
    for (const m of ['no_response', 'timeout', 'malformed', 'transport_error',
      'security_required', 'condition_required', 'unsupported']) {
      expect(coveragePresence(coveragePduOutcome(m))).not.toBe('ABSENT');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) CORE > DEEP
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · CORE her zaman DEEP’ten önce', () => {
  it('🔒 KİLİT: HER core önceliği HER deep önceliğinden küçüktür', () => {
    const roots: RootCauseClass[] = ['CAPABILITY_UNMEASURED', 'SESSION_CONDITIONED',
      'ATTRIBUTION_UNRESOLVED', 'TRANSPORT_BOUND', 'PARSER_BOUND'];
    const core = roots.map((r) => coverageGapPriority('core', r));
    const deep = roots.map((r) => coverageGapPriority('deep', r));
    expect(Math.max(...core)).toBeLessThan(Math.min(...deep));
  });

  it('🔒 KİLİT: plan çıktısı CORE’u önce sıralar (deterministik)', () => {
    const gaps = planCoverageGaps([endpoint({
      rows: [
        row({ axis: 'deep', service: '19', subFunction: '03', cls: 'UDS_SNAPSHOT_ID' }),
        row({ axis: 'core', service: '19', subFunction: '02', cls: 'UDS_DTC_BY_STATUS' }),
      ],
    })]);
    expect(gaps.map((g) => g.axis)).toEqual(['core', 'deep']);
    /* Çözüm sırası da AYNI kuralı uygular. */
    expect(isDeepCoverageContext(gaps[0]!.record.context)).toBe(false);
    expect(isDeepCoverageContext(gaps[1]!.record.context)).toBe(true);
  });

  it('aynı girdi → aynı sıra ve aynı kayıt (deterministik, rastgelelik YOK)', () => {
    const ep = endpoint({ rows: [row(), row({ axis: 'deep', cls: 'UDS_EXTENDED_DATA',
      subFunction: '06' })] });
    expect(JSON.stringify(planCoverageGaps([ep])))
      .toBe(JSON.stringify(planCoverageGaps([ep])));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) DEDUPE — farklı ölçüm farklı boşluktur
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · dedupe kimliği', () => {
  const keyOf = (c: ReturnType<typeof planCoverageGaps>[number]) =>
    gapRegistryKey(c.record.signal, c.record.context, c.record.evidence ?? null);

  it('🔒 KİLİT: FARKLI ECU aynı servis → AYRI boşluk', () => {
    const a = planCoverageGaps([endpoint({ ecuKey: '11:7E8' })])[0]!;
    const b = planCoverageGaps([endpoint({ ecuKey: '11:7E9', rxHeader: '7E9' })])[0]!;
    expect(keyOf(a)).not.toBe(keyOf(b));
  });

  it('🔒 KİLİT: FARKLI alt fonksiyon → AYRI boşluk', () => {
    const a = planCoverageGaps([endpoint({ rows: [row({ subFunction: '02' })] })])[0]!;
    const b = planCoverageGaps([endpoint({
      rows: [row({ subFunction: '0A', cls: 'UDS_SUPPORTED_DTC' })] })])[0]!;
    expect(keyOf(a)).not.toBe(keyOf(b));
  });

  it('🔒 KİLİT: PARSER boşluğu ile SESSION boşluğu AYNI satıra EZİLMEZ', () => {
    const p = planCoverageGaps([endpoint({
      rows: [row({ gapRoot: 'PARSER_BOUND', measuredOutcome: 'malformed' })] })])[0]!;
    const q = planCoverageGaps([endpoint({
      rows: [row({ gapRoot: 'SESSION_CONDITIONED', measuredOutcome: 'security_required' })] })])[0]!;
    expect(keyOf(p)).not.toBe(keyOf(q));
    expect(p.record.scope).toBe('PARSER');
    expect(q.record.scope).toBe('SESSION');
  });

  it('AYNI ölçüm → AYNI anahtar (rastgele ID YOK)', () => {
    expect(keyOf(planCoverageGaps([endpoint()])[0]!))
      .toBe(keyOf(planCoverageGaps([endpoint()])[0]!));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) KANIT ZARFI — F5-D referansları ve GİZLİLİK
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · kanıt zarfı', () => {
  it('🔒 KİLİT: F5-D referansları TAŞINIR (araç izolasyonu için şart)', () => {
    const ev = planCoverageGaps([endpoint()])[0]!.record.evidence!;
    expect(ev.transactionId).toBe('txn-1');
    expect(ev.evidenceCorrelationId).toBe('corr-1');
    expect(ev.vehicleFingerprintRef).toBe('veh-A');
    expect(ev.sessionEpoch).toBe(3);
    expect(ev.provenance).toBe('live');
    /* Hedef künyesi + ölçüm sonucu var → zarf ÖLÇÜLMÜŞ sayılır. */
    expect(ev.state).toBe('MEASURED');
  });

  it('🔒 KİLİT: ham yanıt / DTC / NRC uydurulmaz — ölçülmeyen NULL', () => {
    const ev = planCoverageGaps([endpoint()])[0]!.record.evidence!;
    expect(ev.observedNrc).toBeNull();        // kapsam satırı NRC ölçmez
    expect(ev.requestIdentity).toBeNull();    // ham istek gövdesi yok
    expect(ev.sessionOpened).toBeNull();
    const json = JSON.stringify(planCoverageGaps([endpoint()]));
    expect(json).not.toContain('P0301');
    expect(json).not.toMatch(/VIN|token|secret/i);
  });

  it('🔒 KİLİT: köprü DESTRUCTIVE hiçbir servis üretemez', () => {
    const destructive = new Set(DESTRUCTIVE_SERVICES);
    for (const svc of ['03', '07', '0A', '19', '18', '13']) {
      const ev = planCoverageGaps([endpoint({
        rows: [row({ service: svc })] })])[0]?.record.evidence;
      expect(destructive.has(ev?.service ?? '')).toBe(false);
    }
    expect(destructive.has('04')).toBe(true);
    expect(destructive.has('27')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) İYİLEŞTİRME SONUCU → KAPSAM (kısayol YOK)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · healing ölçümü → kapsam sınıfı', () => {
  it('🔒 KİLİT: POZİTİF yeniden okuma TERMİNAL başarıdır', () => {
    expect(coverageOutcomeFromHealing('PRESENT:-')).toBe('COMPLETE');
  });

  it('🔒 KİLİT: ECU 7F-11 dediyse ölçülmüş desteklenmeme (terminal)', () => {
    expect(coverageOutcomeFromHealing('ABSENT:11')).toBe('UNSUPPORTED_MEASURED');
  });

  it('🔒 KİLİT: AYNI koşullu yanıt geri geldiyse kapsam TAMAMLANMAZ', () => {
    /* Oturumun açılmış olması BAŞARI DEĞİLDİR — asıl kanal hâlâ okunamadı. */
    expect(coverageOutcomeFromHealing('PRESENT_BUT_CONDITIONED:33')).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: başarısız yeniden ölçüm kapsamı DÜZELTMEZ', () => {
    for (const o of ['UNKNOWN:-', 'UNKNOWN_TRANSPORT_LIMIT:-', 'UNKNOWN_RESPONSE_SHAPE:-']) {
      expect(coverageOutcomeFromHealing(o)).toBe('UNKNOWN');
    }
  });

  it('🔒 KİLİT: ÖLÇÜM YOKSA kapsam satırına DOKUNULMAZ', () => {
    expect(coverageOutcomeFromHealing(null)).toBeNull();
    expect(coverageOutcomeFromHealing('NO_RECORD')).toBeNull();
    expect(coverageOutcomeFromHealing('NOT_PROBED:-')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   8) CLEAN VERDICT SAFETY — "RESOLVED" tek başına yetmez
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · kapsam gerçeği ≠ çözücü durumu', () => {
  const ep = (over: Record<string, unknown> = {}) => ({
    ecuKey: '11:7E8', coreVerdict: 'COMPLETE' as const, deepVerdict: 'COMPLETE' as const,
    corePlannedUnits: 6, coreTerminalUnits: 6, deepPlannedUnits: 2, deepTerminalUnits: 2,
    roleUnknown: false, productTrusted: true, requestCount: 6, rows: [], ...over,
  });

  it('🔒 KİLİT: eksik CORE varken kapsam TAM DEĞİL (0 DTC olsa bile)', () => {
    const d = buildDiagnosticCompleteness([
      ep({ coreVerdict: 'PARTIAL', coreTerminalUnits: 4 }),
    ]);
    expect(d.verdict).not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: eksik kanal GERÇEKTEN terminal okununca CORE tamamlanabilir', () => {
    /* İki uç nokta: biri tam, biri eksik → araç seviyesi KISMİ.
       (Tek uç nokta eksikse araç seviyesinde hiçbir şey okunmamış demektir ve
       hüküm dürüstçe `UNKNOWN` olur — aşağıdaki ayrı kilit onu doğrular.) */
    const before = buildDiagnosticCompleteness([
      ep({ ecuKey: '11:7E8' }),
      ep({ ecuKey: '11:7E9', coreVerdict: 'UNKNOWN', coreTerminalUnits: 0 }),
    ]);
    expect(before.verdict).toBe('PARTIAL');
    /* Healing eksik kanalı GERÇEKTEN terminal okudu → 6/6. */
    const after = buildDiagnosticCompleteness([
      ep({ ecuKey: '11:7E8' }), ep({ ecuKey: '11:7E9' }),
    ]);
    expect(after.verdict).toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: TEK uç nokta ve o da eksikse hüküm KISMİ değil BİLİNMİYOR', () => {
    /* Araç seviyesinde hiçbir uç nokta tam okunmadıysa "kısmi" demek,
       olmayan bir kısmı varmış gibi sunmak olurdu (fail-closed). */
    expect(buildDiagnosticCompleteness([
      ep({ coreVerdict: 'PARTIAL', coreTerminalUnits: 5 })]).verdict).toBe('UNKNOWN');
  });

  it('🔒 KİLİT: replay ölçümü ÜRÜN-GÜVENİLİR TAM hüküm ÜRETEMEZ', () => {
    expect(buildDiagnosticCompleteness([ep({ productTrusted: false })]).verdict)
      .not.toBe('CORE_COMPLETE');
  });

  it('🔒 KİLİT: DERİN eksen eksikken bile CORE tamamlanabilir (19-04 kilitlemez)', () => {
    const d = buildDiagnosticCompleteness([
      ep({ deepVerdict: 'PARTIAL', deepTerminalUnits: 1 })]);
    expect(d.verdict).toBe('CORE_COMPLETE');
    expect(d.deepComplete).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9) KAPSAM/GÜVENLİK SINIRLARI
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-VDK-F6D · kapsam sınırları', () => {
  it('🔒 KİLİT: rolü BİLİNMEYEN uç nokta da boşluk üretebilir (F6-A sözleşmesi)', () => {
    /* Köprü rolü HİÇ okumaz — girdi tipinde rol alanı YOKTUR. */
    expect(Object.keys(endpoint()).some((k) => k.toLowerCase().includes('role')))
      .toBe(false);
    expect(planCoverageGaps([endpoint()])).toHaveLength(1);
  });

  it('🔒 KİLİT: KWP servisleri yalnız planlandıysa boşluk üretir', () => {
    /* CAN aracında KWP satırı NOT_APPLICABLE → gap YOK (yukarıda kilitli).
       KWP aracında ÖLÇÜLMÜŞ 0x18 susması → gap VAR. */
    const g = planCoverageGaps([endpoint({
      protocol: '5',
      rows: [row({ service: '18', subFunction: null, cls: 'KWP_DTC_18',
        measuredOutcome: 'no_response' })],
    })]);
    expect(g).toHaveLength(1);
    expect(g[0]!.record.evidence!.service).toBe('18');
    /* Alt fonksiyonu olmayan servis → UNKNOWN_SERVICE (0x18 alt fonksiyonsuz). */
    expect(g[0]!.record.signal).toBe('UNKNOWN_SERVICE');
  });

  it('🔒 KİLİT: kapsam alanı kök nedene göre DOĞRU seçilir', () => {
    expect(coverageGapScope('SESSION_CONDITIONED')).toBe('SESSION');
    expect(coverageGapScope('TRANSPORT_BOUND')).toBe('TRANSPORT');
    expect(coverageGapScope('PARSER_BOUND')).toBe('PARSER');
    expect(coverageGapScope('CAPABILITY_UNMEASURED')).toBe('AUTHORITY');
  });

  it('boş girdi boş çıktı üretir (sahte boşluk YOK)', () => {
    expect(planCoverageGaps([])).toHaveLength(0);
    expect(planCoverageGaps([endpoint({ rows: [] })])).toHaveLength(0);
  });
});
