/**
 * aiEvidence.test.ts — AI EVIDENCE ENGINE P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Bu katman AI cevabı ÜRETMEZ** — LLM/model/tahmin/doğal dil yok.
 *  2. **Kaynaksız kanıt ACTIVE olamaz** (`SOURCE_UNKNOWN`).
 *  3. **Güven kanıttan bağımsız yazılamaz** — daima türetilir.
 *  4. Aynı kanıt ikinci kez açılmaz; **ilk kanıt zamanı korunur**.
 *  5. Kanıt DEĞİŞMEZ; süresi dolan **silinmez**.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EVIDENCE_SOURCES, EVIDENCE_CATEGORIES, EVIDENCE_SEVERITIES,
  EVIDENCE_CONFIDENCES, EVIDENCE_STATES, EVIDENCE_CONSUMERS,
  EVIDENCE_REJECT_REASONS, COVERAGE_SCOPES, EVIDENCE_VERSION,
  deriveEvidenceConfidence, sourceConfidenceCeiling,
  provenanceConfidenceCeiling, sampleConfidenceCeiling,
  weakestEvidenceConfidence, evidenceKey, chainKey, canActivate,
  isEvidenceValid, expectedCategoriesFor,
  evidenceSourceLabel, evidenceCategoryLabel, evidenceStateLabel,
  evidenceSeverityLabel, evidenceRejectReasonLabel, evidenceConsumerLabel,
  type AiEvidence,
} from '../platform/fleet/aiEvidence';
import {
  EMPTY_EVIDENCE_LEDGER, IMMUTABLE_EVIDENCE_FIELDS,
  recordEvidence, expireEvidence, linkEvidence, evidenceChainFor,
  consumersOfEvidence, computeEvidenceCoverage, validateEvidenceMutation,
  readAiEvidence, aiEvidenceStore, _resetAiEvidenceStoreForTest,
  type EvidenceInput, type EvidenceLedger,
} from '../platform/fleet/aiEvidenceEngine';

const CO = 'co-1';
const VEH = 'veh-1';
const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
const DAY = 86_400_000;

function input(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    companyId: CO, vehicleId: VEH, driverId: null, tripId: null,
    source: 'TRIP_ENGINE', category: 'FUEL', severity: 'NOTICE',
    provenance: 'MEASURED', metric: 'fuel_l_per_100km',
    value: 9.4, sampleCount: 6, observedAt: T0,
    ...over,
  };
}

function ledgerWith(...inputs: EvidenceInput[]): EvidenceLedger {
  return inputs.reduce((l, i) => recordEvidence(l, i), EMPTY_EVIDENCE_LEDGER);
}

beforeEach(() => { _resetAiEvidenceStoreForTest(); });

/* ═══ A. SÖZLEŞME ══════════════════════════════════════════════════════ */

describe('AiEvidence · A. Kanonik sözleşme', () => {
  it('A1. 🔒 13 kategori ve 9 kaynak SÖZLEŞMEDİR', () => {
    expect(EVIDENCE_CATEGORIES).toHaveLength(13);
    for (const c of ['DRIVER', 'TRIP', 'VEHICLE', 'ENGINE', 'TEMPERATURE',
                     'FUEL', 'BATTERY', 'LOCATION', 'CONNECTIVITY',
                     'DIAGNOSTIC', 'BLACKBOX', 'FLEET', 'UNKNOWN']) {
      expect(EVIDENCE_CATEGORIES).toContain(c);
    }
    for (const s of ['TRIP_ENGINE', 'DRIVER_DNA', 'FLEET_INTELLIGENCE',
                     'DEEP_SCAN', 'VEHICLE_IDENTITY', 'TELEMETRY',
                     'BLACKBOX', 'HEALTH_MONITOR']) {
      expect(EVIDENCE_SOURCES).toContain(s);
    }
  });

  it('A2. 🔒 kanıt bir CÜMLE DEĞİLDİR (doğal dil alanı yok)', () => {
    const l = ledgerWith(input());
    for (const forbidden of ['title', 'message', 'explanation', 'summary',
                             'answer', 'text', 'recommendation']) {
      expect(Object.keys(l.entries[0]!)).not.toContain(forbidden);
    }
  });

  it('A3. 🔒 model TÜM istenen alanları taşır', () => {
    const e = ledgerWith(input()).entries[0]!;
    for (const f of ['id', 'companyId', 'vehicleId', 'driverId', 'tripId',
                     'source', 'category', 'severity', 'confidence',
                     'createdAt', 'expiresAt', 'state', 'evidenceVersion']) {
      expect(Object.keys(e)).toContain(f);
    }
    expect(e.evidenceVersion).toBe(EVIDENCE_VERSION);
  });

  it('A4. 🔒 süresiz kanıt YOKTUR', () => {
    const e = ledgerWith(input()).entries[0]!;
    expect(e.expiresAt).toBeGreaterThan(e.createdAt);
    expect(isEvidenceValid(e, T0 + DAY)).toBe(true);
  });

  it('A5. 🔒 durum ve tüketici listeleri sabittir', () => {
    expect([...EVIDENCE_STATES]).toEqual(['ACTIVE', 'EXPIRED', 'SUPERSEDED', 'REJECTED']);
    /* AI_ANSWER bilinçli: gelecekte her AI cümlesi kanıta bağlanacak. */
    expect(EVIDENCE_CONSUMERS).toContain('AI_ANSWER');
    expect([...COVERAGE_SCOPES]).toEqual(['COMPANY', 'VEHICLE', 'DRIVER', 'TRIP']);
  });
});

/* ═══ B. KAYNAK ZORUNLU ════════════════════════════════════════════════ */

describe('AiEvidence · B. Kaynaksız kanıt ACTIVE olamaz', () => {
  it('B1. 🔒 SOURCE_UNKNOWN kanıt REDDEDİLİR ve gerekçesi yazılır', () => {
    const l = ledgerWith(input({ source: 'SOURCE_UNKNOWN' }));
    const e = l.entries[0]!;
    expect(e.state).toBe('REJECTED');
    expect(e.rejectReason).toBe('SOURCE_UNKNOWN');
    expect(l.rejectedCount).toBe(1);
  });

  it('B2. 🔒 ÖZNESİZ kanıt REDDEDİLİR', () => {
    const l = ledgerWith(input({ vehicleId: null, driverId: null, tripId: null }));
    expect(l.entries[0]!.rejectReason).toBe('NO_SUBJECT');
  });

  it('B3. 🔒 ÖLÇÜMSÜZ kanıt REDDEDİLİR (0 sayılmaz)', () => {
    const l = ledgerWith(input({ value: null, provenance: 'UNKNOWN' }));
    expect(l.entries[0]!.rejectReason).toBe('NO_MEASUREMENT');
  });

  it('B4. 🔒 REDDEDİLEN kanıt SAKLANIR (görünür kalır)', () => {
    const l = ledgerWith(input({ source: 'SOURCE_UNKNOWN', metric: 'm1' }));
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]!.state).toBe('REJECTED');
  });

  it('B5. 🔒 canActivate dört kapının hepsini denetler', () => {
    const base = ledgerWith(input()).entries[0]!;
    expect(canActivate(base)).toEqual({ ok: true });
    expect(canActivate({ ...base, source: 'SOURCE_UNKNOWN' }))
      .toEqual({ ok: false, reason: 'SOURCE_UNKNOWN' });
    expect(canActivate({ ...base, vehicleId: null, driverId: null, tripId: null }))
      .toEqual({ ok: false, reason: 'NO_SUBJECT' });
    expect(canActivate({ ...base, confidence: 'UNKNOWN' }))
      .toEqual({ ok: false, reason: 'CONFIDENCE_UNKNOWN' });
  });
});

/* ═══ C. GÜVEN TÜRETİLİR ═══════════════════════════════════════════════ */

describe('AiEvidence · C. Güven kanıttan bağımsız yazılamaz', () => {
  it('C1. 🔒 girdi sözleşmesinde `confidence` alanı YOKTUR', () => {
    /* Tip seviyesinde: `EvidenceInput`ta güven yok — çağıran yazamaz. */
    const i = input() as Record<string, unknown>;
    expect(Object.keys(i)).not.toContain('confidence');
  });

  it('C2. 🔒 güven ÜÇ tavanın en zayıfından türer', () => {
    expect(sourceConfidenceCeiling('BLACKBOX')).toBe('VERY_HIGH');
    expect(sourceConfidenceCeiling('HEALTH_MONITOR')).toBe('MEDIUM');
    expect(sourceConfidenceCeiling('SOURCE_UNKNOWN')).toBe('UNKNOWN');
    expect(provenanceConfidenceCeiling('ESTIMATED')).toBe('MEDIUM');
    expect(sampleConfidenceCeiling(1)).toBe('MEDIUM');
    expect(sampleConfidenceCeiling(0)).toBe('UNKNOWN');

    expect(deriveEvidenceConfidence({
      source: 'BLACKBOX', provenance: 'MEASURED', sampleCount: 10,
    })).toBe('VERY_HIGH');
    expect(deriveEvidenceConfidence({
      source: 'HEALTH_MONITOR', provenance: 'MEASURED', sampleCount: 10,
    })).toBe('MEDIUM');
    expect(deriveEvidenceConfidence({
      source: 'BLACKBOX', provenance: 'ESTIMATED', sampleCount: 10,
    })).toBe('MEDIUM');
  });

  it('C3. 🔒 TEK gözlem MEDIUM tavanını AŞAMAZ', () => {
    expect(deriveEvidenceConfidence({
      source: 'BLACKBOX', provenance: 'MEASURED', sampleCount: 1,
    })).toBe('MEDIUM');
  });

  it('C4. 🔒 kaynaksız/ölçümsüz kanıt güven ÜRETEMEZ', () => {
    expect(deriveEvidenceConfidence({
      source: 'SOURCE_UNKNOWN', provenance: 'MEASURED', sampleCount: 50,
    })).toBe('UNKNOWN');
    expect(deriveEvidenceConfidence({
      source: 'BLACKBOX', provenance: 'UNKNOWN', sampleCount: 50,
    })).toBe('UNKNOWN');
  });

  it('C5. 🔒 en zayıf halka kuralı', () => {
    expect(weakestEvidenceConfidence('VERY_HIGH', 'LOW')).toBe('LOW');
    expect(weakestEvidenceConfidence('HIGH', 'HIGH')).toBe('HIGH');
  });
});

/* ═══ D. BİRLEŞTİRME ═══════════════════════════════════════════════════ */

describe('AiEvidence · D. Birleştirme (merge)', () => {
  it('D1. 🔒 AYNI kanıt İKİNCİ KEZ açılmaz, refreshCount artar', () => {
    let l = ledgerWith(input());
    for (let i = 0; i < 5; i++) {
      l = recordEvidence(l, input({ observedAt: T0 + (i + 1) * 1000 }));
    }
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]!.refreshCount).toBe(5);
    expect(l.mergeCount).toBe(5);
  });

  it('D2. 🔒 İLK kanıt zamanı KORUNUR', () => {
    let l = ledgerWith(input());
    l = recordEvidence(l, input({ observedAt: T0 + 10 * DAY }));
    expect(l.entries[0]!.createdAt).toBe(T0);
    expect(l.entries[0]!.lastSeenAt).toBe(T0 + 10 * DAY);
  });

  it('D3. 🔒 FARKLI özne/metrik AYRI kanıttır', () => {
    const l = ledgerWith(
      input(),
      input({ metric: 'idle_ratio' }),
      input({ vehicleId: 'veh-2' }),
    );
    expect(l.entries).toHaveLength(3);
  });

  it('D4. 🔒 kimlik zamanı İÇERMEZ (her tazeleme yeni kanıt üretmez)', () => {
    const k1 = evidenceKey({
      companyId: CO, source: 'TRIP_ENGINE', category: 'FUEL',
      metric: 'm', vehicleId: VEH, driverId: null, tripId: null,
    });
    const k2 = evidenceKey({
      companyId: CO, source: 'TRIP_ENGINE', category: 'FUEL',
      metric: 'm', vehicleId: VEH, driverId: null, tripId: null,
    });
    expect(k1).toBe(k2);
  });

  it('D5. 🔒 REDDEDİLEN tekrar, GEÇERLİ kanıtı BOZMAZ', () => {
    let l = ledgerWith(input());
    const before = l.entries[0]!;
    l = recordEvidence(l, input({ value: null, provenance: 'UNKNOWN' }));
    expect(l.entries[0]).toEqual(before);
    expect(l.rejectedCount).toBe(1);
  });

  it('D6. 🔒 tazelemede güven YENİDEN türetilir', () => {
    let l = ledgerWith(input({ source: 'TELEMETRY', provenance: 'ESTIMATED', sampleCount: 1 }));
    expect(l.entries[0]!.confidence).toBe('MEDIUM');
    l = recordEvidence(l, input({
      source: 'TELEMETRY', provenance: 'MEASURED', sampleCount: 9,
      observedAt: T0 + DAY,
    }));
    expect(l.entries[0]!.confidence).toBe('HIGH');   // kaynak tavanı
  });
});

/* ═══ E. SÜRE DOLUMU ═══════════════════════════════════════════════════ */

describe('AiEvidence · E. Süre dolumu (silmez)', () => {
  it('E1. 🔒 süresi dolan kanıt EXPIRED olur ama SİLİNMEZ', () => {
    const l = expireEvidence(ledgerWith(input()), T0 + 60 * DAY);
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]!.state).toBe('EXPIRED');
    expect(l.entries[0]!.createdAt).toBe(T0);
  });

  it('E2. 🔒 expiry İDEMPOTENTTİR', () => {
    const once = expireEvidence(ledgerWith(input()), T0 + 60 * DAY);
    const twice = expireEvidence(once, T0 + 120 * DAY);
    expect(twice).toEqual(once);
  });

  it('E3. 🔒 süresi dolmamış kanıt DOKUNULMAZ', () => {
    const l = ledgerWith(input());
    expect(expireEvidence(l, T0 + DAY)).toBe(l);
  });

  it('E4. 🔒 yeni gözlem kanıtı CANLANDIRIR, doğuş anı KORUNUR', () => {
    let l = expireEvidence(ledgerWith(input()), T0 + 60 * DAY);
    l = recordEvidence(l, input({ observedAt: T0 + 61 * DAY }));
    expect(l.entries[0]!.state).toBe('ACTIVE');
    expect(l.entries[0]!.createdAt).toBe(T0);
  });
});

/* ═══ F. DEĞİŞMEZLİK ═══════════════════════════════════════════════════ */

describe('AiEvidence · F. Değişmezlik (immutable)', () => {
  it('F1. 🔒 değişmez alan listesi SÖZLEŞMEDİR', () => {
    for (const f of ['id', 'companyId', 'vehicleId', 'driverId', 'tripId',
                     'source', 'category', 'metric', 'createdAt', 'evidenceVersion']) {
      expect(IMMUTABLE_EVIDENCE_FIELDS).toContain(f);
    }
  });

  it('F2. 🔒 kaynak/özne/doğuş değiştirme REDDEDİLİR', () => {
    const e = ledgerWith(input()).entries[0]!;
    for (const mutated of [
      { ...e, source: 'BLACKBOX' as const },
      { ...e, vehicleId: 'baska' },
      { ...e, createdAt: T0 + 1 },
      { ...e, category: 'FLEET' as const },
    ]) {
      expect(validateEvidenceMutation(e, mutated as AiEvidence, e.source))
        .toEqual({ ok: false, reason: 'IMMUTABLE_VIOLATION' });
    }
  });

  it('F3. 🔒 BAŞKA modül BAŞKASININ kanıtını değiştiremez', () => {
    const e = ledgerWith(input()).entries[0]!;
    expect(validateEvidenceMutation(e, e, 'BLACKBOX'))
      .toEqual({ ok: false, reason: 'FOREIGN_SOURCE' });
    expect(validateEvidenceMutation(e, { ...e, refreshCount: 3 }, e.source))
      .toEqual({ ok: true });
  });
});

/* ═══ G. KANIT ZİNCİRİ ═════════════════════════════════════════════════ */

describe('AiEvidence · G. Kanıt zinciri', () => {
  it('G1. 🔒 çıktı kanıta bağlanır ve zincir OKUNUR', () => {
    let l = ledgerWith(input(), input({ metric: 'idle_ratio' }));
    const [a, b] = l.entries;
    l = linkEvidence(l, { evidenceId: a!.id, consumer: 'FLEET_INSIGHT', consumerId: 'i-1' });
    l = linkEvidence(l, { evidenceId: b!.id, consumer: 'FLEET_INSIGHT', consumerId: 'i-1' });

    const chain = evidenceChainFor(l, 'FLEET_INSIGHT', 'i-1');
    expect(chain).toHaveLength(2);
    expect(chain.map((e) => e.metric).sort())
      .toEqual(['fuel_l_per_100km', 'idle_ratio']);
  });

  it('G2. 🔒 AYNI bağ iki kez yazılmaz (idempotent)', () => {
    let l = ledgerWith(input());
    const link = { evidenceId: l.entries[0]!.id, consumer: 'AI_ANSWER' as const, consumerId: 'a-1' };
    l = linkEvidence(l, link);
    l = linkEvidence(l, link);
    expect(l.chain).toHaveLength(1);
    expect(chainKey(link)).toBe(`AI_ANSWER|a-1|${l.entries[0]!.id}`);
  });

  it('G3. 🔒 VAR OLMAYAN kanıta bağ KURULAMAZ', () => {
    const l = ledgerWith(input());
    const after = linkEvidence(l, {
      evidenceId: 'yok', consumer: 'AI_ANSWER', consumerId: 'a-1',
    });
    expect(after.chain).toHaveLength(0);
  });

  it('G4. 🔒 TERS yön: bir kanıtın beslediği çıktılar görünür', () => {
    let l = ledgerWith(input());
    const id = l.entries[0]!.id;
    l = linkEvidence(l, { evidenceId: id, consumer: 'FLEET_INSIGHT', consumerId: 'i-1' });
    l = linkEvidence(l, { evidenceId: id, consumer: 'AI_ANSWER', consumerId: 'a-1' });
    expect(consumersOfEvidence(l, id)).toHaveLength(2);
  });
});

/* ═══ H. KAPSAM ════════════════════════════════════════════════════════ */

describe('AiEvidence · H. Kapsam', () => {
  it('H1. 🔒 kanıt YOKSA oran null (0 DEĞİL) ve güven UNKNOWN', () => {
    const c = computeEvidenceCoverage(EMPTY_EVIDENCE_LEDGER, 'VEHICLE', VEH, T0);
    expect(c.ratio).toBeNull();
    expect(c.confidence).toBe('UNKNOWN');
    expect(c.activeEvidenceCount).toBe(0);
    expect(c.missingCategories).toEqual([...expectedCategoriesFor('VEHICLE')]);
  });

  it('H2. 🔒 EKSİK kategoriler tek tek listelenir', () => {
    const l = ledgerWith(
      input({ category: 'FUEL' }),
      input({ category: 'ENGINE', metric: 'rpm_peak' }),
    );
    const c = computeEvidenceCoverage(l, 'VEHICLE', VEH, T0);
    expect(c.presentCategories.sort()).toEqual(['ENGINE', 'FUEL']);
    expect(c.missingCategories).toContain('BATTERY');
    expect(c.missingCategories).toContain('TEMPERATURE');
    expect(c.ratio).toBeCloseTo(2 / 7, 6);
  });

  it('H3. 🔒 düşük kapsam güveni KIRPAR', () => {
    const l = ledgerWith(input({ category: 'FUEL' }));
    const c = computeEvidenceCoverage(l, 'VEHICLE', VEH, T0);
    expect(c.ratio).toBeLessThan(0.5);
    expect(['LOW', 'UNKNOWN']).toContain(c.confidence);
  });

  it('H4. 🔒 SÜRESİ DOLAN kanıt kapsamı DOLDURMAZ ama SAYILIR', () => {
    const l = expireEvidence(ledgerWith(input()), T0 + 60 * DAY);
    const c = computeEvidenceCoverage(l, 'VEHICLE', VEH, T0 + 60 * DAY);
    expect(c.activeEvidenceCount).toBe(0);
    expect(c.expiredEvidenceCount).toBe(1);
    expect(c.ratio).toBeNull();
  });

  it('H5. 🔒 beklenen kategoriler gerçeğe göre AŞAĞI ÇEKİLMEZ', () => {
    /* "Zaten sıcaklık verimiz yok, beklemeyelim" demek eksikliği gizlerdi. */
    expect(expectedCategoriesFor('VEHICLE')).toContain('TEMPERATURE');
    expect(expectedCategoriesFor('VEHICLE')).toContain('BATTERY');
    expect(expectedCategoriesFor('TRIP')).toContain('LOCATION');
  });
});

/* ═══ I. AI YOK · SAFLIK · GÖZLEM ══════════════════════════════════════ */

describe('AiEvidence · I. AI üretmez ve saftır', () => {
  const MODEL = readFileSync(
    join(process.cwd(), 'src/platform/fleet/aiEvidence.ts'), 'utf8');
  const ENGINE = readFileSync(
    join(process.cwd(), 'src/platform/fleet/aiEvidenceEngine.ts'), 'utf8');

  it('I1. 🔒 LLM/AI ÇAĞRISI YOK', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      for (const forbidden of ['fetch(', 'openrouter', 'gemini', 'anthropic',
                               'openai', 'aiService', 'semanticAi', 'llm']) {
        expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('I2. 🔒 katman SAF (I/O · zaman · timer · depolama YOK)', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      expect(code).not.toContain('Date.now()');
      expect(code).not.toContain('setInterval');
      expect(code).not.toContain('setTimeout');
      expect(code).not.toContain('safeGetRaw');
      expect(code).not.toContain('supabase');
    }
  });

  it('I3. 🔒 DNA · Fleet Intelligence · trip · deep scan ÇAĞRILMAZ', () => {
    for (const src of [MODEL, ENGINE]) {
      for (const forbidden of ['driverDnaEngine', 'fleetIntelligenceEngine',
                               'buildDna', 'buildInsight', 'tripLogService',
                               'deepScanOrchestrator']) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it('I4. 🔒 kanıt KİŞİSEL VERİ taşımaz', () => {
    const e = ledgerWith(input()).entries[0]!;
    const keys = Object.keys(e).map((k) => k.toLowerCase());
    for (const forbidden of ['name', 'displayname', 'phone', 'email',
                             'plate', 'vin', 'latitude', 'longitude', 'route']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('I5. 🔒 etiketler tüm enum değerlerini KAPSAR', () => {
    for (const s of EVIDENCE_SOURCES) expect(evidenceSourceLabel(s).length).toBeGreaterThan(0);
    for (const c of EVIDENCE_CATEGORIES) expect(evidenceCategoryLabel(c).length).toBeGreaterThan(0);
    for (const s of EVIDENCE_STATES) expect(evidenceStateLabel(s).length).toBeGreaterThan(0);
    for (const s of EVIDENCE_SEVERITIES) expect(evidenceSeverityLabel(s).length).toBeGreaterThan(0);
    for (const r of EVIDENCE_REJECT_REASONS) {
      expect(evidenceRejectReasonLabel(r).length).toBeGreaterThan(0);
    }
    for (const c of EVIDENCE_CONSUMERS) expect(evidenceConsumerLabel(c).length).toBeGreaterThan(0);
    expect(EVIDENCE_CONFIDENCES).toHaveLength(5);
  });

  it('I6. 🔒 head unit deposu BOŞ başlar ve sahte veri üretmez', () => {
    const r = readAiEvidence(T0);
    expect(r.source).toBe('NONE');
    expect(r.evidenceCount).toBe(0);
    expect(r.chainLinkCount).toBe(0);
    expect(r.integrityOk).toBe(true);
  });

  it('I7. 🔒 BÜTÜNLÜK: kaynaksız ACTIVE kanıt varsa bayrak DÜŞER', () => {
    const broken: EvidenceLedger = {
      ...EMPTY_EVIDENCE_LEDGER,
      entries: [{
        ...ledgerWith(input()).entries[0]!,
        source: 'SOURCE_UNKNOWN', state: 'ACTIVE',
      }],
    };
    aiEvidenceStore.setFromServer(broken);
    expect(readAiEvidence(T0).integrityOk).toBe(false);
  });

  it('I8. 🔒 sunucudan gelen defter SAYILARI dürüstçe raporlanır', () => {
    let l = ledgerWith(input(), input({ metric: 'idle_ratio' }),
                       input({ source: 'SOURCE_UNKNOWN', metric: 'bad' }));
    l = recordEvidence(l, input({ observedAt: T0 + 1000 }));
    l = linkEvidence(l, {
      evidenceId: l.entries[0]!.id, consumer: 'AI_ANSWER', consumerId: 'a-1',
    });
    l = expireEvidence({ ...l }, T0 + 60 * DAY);
    aiEvidenceStore.setFromServer(l);

    const r = readAiEvidence(T0 + 60 * DAY);
    expect(r.source).toBe('SERVER');
    expect(r.evidenceCount).toBe(3);
    expect(r.expiredCount).toBe(2);          // iki geçerli kanıt süresi doldu
    expect(r.rejectedCount).toBe(1);
    expect(r.refreshTotal).toBe(1);
    expect(r.mergeCount).toBe(1);
    expect(r.chainLinkCount).toBe(1);
    expect(r.sourceBreakdown.length).toBeGreaterThan(0);
  });

  it('I9. 🔒 LAB ekranı istenen alanları GÖSTERİR', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/AiEvidenceEngineScreen.tsx'), 'utf8');
    for (const field of ['evidenceCount', 'sourceBreakdown', 'chainLinkCount',
                         'coverage', 'unknownConfidenceCount', 'expiredCount',
                         'refreshTotal', 'mergeCount', 'confidence', 'integrityOk']) {
      expect(SCREEN).toContain(field);
    }
    expect(SCREEN).not.toContain('setInterval');
  });
});
