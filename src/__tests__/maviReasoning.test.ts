/**
 * maviReasoning.test.ts — MAVI REASONING ENGINE P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **LLM KARAR VERMEZ** — bu katmanda model/tahmin/doğal dil yok.
 *  2. **Karar kanıtsız üretilemez** — "veri yok = sorun yok" bir karar değil.
 *  3. **Güven istemciden alınamaz** — daima kanıttan türetilir ve formül
 *     kanıt omurgasından İTHAL edilir (ikinci otorite yok).
 *  4. **Çelişkili kanıtta karar üretilmez.**
 *  5. **Süresi dolmuş kanıt karara katılmaz** ama zincirden silinmez.
 *  6. **Replay yeni karar açmaz**; geçersiz durum geçişi reddedilir.
 *  7. **Tek veri kapısı** — motor yalnız `aiEvidence*` modüllerini okur.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REASONING_INTENTS, REASONING_DECISIONS, REASONING_STATES,
  CONFIDENCE_REASONS, CONFLICT_KINDS, REASONING_CHAIN_LAYERS,
  REASONING_VERSION, REASONING_DEFAULT_TTL_MS, CONFLICT_RELATIVE_TOLERANCE,
  canTransitionReasoning, categoriesForIntent, confidenceReasonLabel,
  conflictKindLabel, evidenceSignature, intentForCategory,
  isConclusiveDecision, isReasoningDecision, isReasoningIntent,
  isReasoningState, isReasoningValid, reasoningChainLayerLabel,
  reasoningDecisionLabel, reasoningIntentLabel, reasoningKey,
  reasoningStateLabel, stateForDecision, valuesConflict,
  weakestReasoningConfidence,
  type MaviReasoning,
} from '../platform/reasoning/maviReasoning';
import {
  EMPTY_REASONING_LEDGER, INTENT_ORIGINS,
  buildReasoningChain, expireReasoning, reason, readMaviReasoning,
  recordReasoning, resolveConfidence, resolveConflicts, resolveDecision,
  resolveEvidence, resolveIntent, transitionReasoning,
  maviReasoningStore, _resetMaviReasoningStoreForTest,
} from '../platform/reasoning/maviReasoningEngine';
import {
  EMPTY_EVIDENCE_LEDGER, linkEvidence, recordEvidence,
  type EvidenceInput, type EvidenceLedger,
} from '../platform/fleet/aiEvidenceEngine';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

const CO = 'co-1';
const VEH = 'veh-1';
const T0 = 1_700_000_000_000;

function ev(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    companyId: CO,
    vehicleId: VEH,
    driverId: null,
    tripId: null,
    source: 'TELEMETRY',
    category: 'ENGINE',
    severity: 'INFO',
    provenance: 'MEASURED',
    metric: 'engine.rpm.max',
    value: 3200,
    sampleCount: 8,
    observedAt: T0,
    ...over,
  };
}

function ledgerWith(...inputs: readonly EvidenceInput[]): EvidenceLedger {
  return inputs.reduce((l, i) => recordEvidence(l, i), EMPTY_EVIDENCE_LEDGER);
}

beforeEach(() => { _resetMaviReasoningStoreForTest(); });

/* ══════════════════════════════════════════════════════════════════════ */
describe('A · Kanonik model ve sözleşme', () => {
  it('A1. karar/niyet/durum kümeleri BOUNDED ve tam', () => {
    expect(REASONING_INTENTS).toContain('UNKNOWN');
    expect(REASONING_DECISIONS).toHaveLength(7);
    expect(REASONING_STATES).toEqual([
      'NEW', 'ANALYZING', 'SUPPORTED', 'UNSUPPORTED',
      'UNKNOWN', 'REJECTED', 'EXPIRED', 'CONFLICTED',
    ]);
    expect(CONFLICT_KINDS).toEqual(['VALUE_DIVERGENCE', 'REVISION_DIVERGENCE']);
    expect(REASONING_VERSION).toBe(1);
  });

  it('A2. 🔒 GEREKÇE bounded KOD — serbest metin alanı YOK', () => {
    /* Gerekçe bir cümle olsaydı bu katman doğal dil üretmeye başlardı. */
    for (const r of CONFIDENCE_REASONS) {
      expect(r).toMatch(/^[A-Z_]+$/);
      expect(confidenceReasonLabel(r).length).toBeGreaterThan(0);
    }
  });

  it('A3. yalnız SUPPORTED/UNSUPPORTED bir bilgi taşır', () => {
    expect(isConclusiveDecision('SUPPORTED')).toBe(true);
    expect(isConclusiveDecision('UNSUPPORTED')).toBe(true);
    for (const d of ['INSUFFICIENT_EVIDENCE', 'CONFLICTED_EVIDENCE',
      'EXPIRED_EVIDENCE', 'UNKNOWN', 'REJECTED'] as const) {
      expect(isConclusiveDecision(d)).toBe(false);
    }
  });

  it('A4. tip korumaları yabancı değeri reddeder', () => {
    expect(isReasoningIntent('ENGINE')).toBe(true);
    expect(isReasoningIntent('MOTOR')).toBe(false);
    expect(isReasoningDecision('SUPPORTED')).toBe(true);
    expect(isReasoningDecision('MAYBE')).toBe(false);
    expect(isReasoningState('ANALYZING')).toBe(true);
    expect(isReasoningState('THINKING')).toBe(false);
  });

  it('A5. her karar ve durum için Türkçe etiket var (eksik etiket = boşluk)', () => {
    for (const d of REASONING_DECISIONS) expect(reasoningDecisionLabel(d).length).toBeGreaterThan(0);
    for (const s of REASONING_STATES) expect(reasoningStateLabel(s).length).toBeGreaterThan(0);
    for (const i of REASONING_INTENTS) expect(reasoningIntentLabel(i).length).toBeGreaterThan(0);
    for (const k of CONFLICT_KINDS) expect(conflictKindLabel(k).length).toBeGreaterThan(0);
    for (const l of REASONING_CHAIN_LAYERS) {
      expect(reasoningChainLayerLabel(l).length).toBeGreaterThan(0);
    }
  });

  it('A6. varsayılan karar ömrü SONLUDUR (süresiz karar yok)', () => {
    expect(REASONING_DEFAULT_TTL_MS).toBeGreaterThan(0);
    expect(Number.isFinite(REASONING_DEFAULT_TTL_MS)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('B · Niyet çözücü', () => {
  it('B1. açık niyet verilirse o kullanılır', () => {
    const r = resolveIntent({ requestedIntent: 'FUEL', categories: ['ENGINE'] });
    expect(r).toMatchObject({ intent: 'FUEL', origin: 'REQUESTED' });
  });

  it('B2. TEK aday varsa kategoriden türetilir', () => {
    const r = resolveIntent({ categories: ['TEMPERATURE'] });
    expect(r).toMatchObject({ intent: 'TEMPERATURE', origin: 'DERIVED' });
  });

  it('B3. 🔒 BİRDEN FAZLA aday varsa motor KURA ÇEKMEZ → UNKNOWN', () => {
    const r = resolveIntent({ categories: ['ENGINE', 'FUEL'] });
    expect(r.intent).toBe('UNKNOWN');
    expect(r.origin).toBe('UNRESOLVED');
    expect(r.candidates).toHaveLength(2);
  });

  it('B4. hiç ipucu yoksa UNKNOWN', () => {
    expect(resolveIntent({ categories: [] }).intent).toBe('UNKNOWN');
  });

  it('B5. 🔒 kategorisi UNKNOWN olan kanıt NİYET ÜRETMEZ', () => {
    /* Bilinmeyenden bilgi çıkmaz. */
    const r = resolveIntent({ categories: ['UNKNOWN'] });
    expect(r.intent).toBe('UNKNOWN');
    expect(r.candidates).toHaveLength(0);
  });

  it('B6. BLACKBOX kategorisi tanısal niyete düşer', () => {
    expect(intentForCategory('BLACKBOX')).toBe('DIAGNOSTIC');
  });

  it('B7. 🔒 beklenti gerçeğe göre AŞAĞI ÇEKİLMEZ', () => {
    /* Araç sağlığı tek sinyalin işi değildir. */
    expect(categoriesForIntent('VEHICLE_HEALTH')).toEqual(
      ['VEHICLE', 'ENGINE', 'TEMPERATURE', 'BATTERY', 'DIAGNOSTIC']);
    /* Bilinmeyen niyet için beklenti YOK — boş liste "hepsi" DEĞİLDİR. */
    expect(categoriesForIntent('UNKNOWN')).toEqual([]);
  });

  it('B8. niyet kaynağı bounded', () => {
    expect(INTENT_ORIGINS).toEqual(['REQUESTED', 'DERIVED', 'UNRESOLVED']);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('C · Kanıt çözücü (tek veri kapısı)', () => {
  it('C1. yalnız niyetin beklediği kategoriler karara girer', () => {
    const l = ledgerWith(ev(), ev({ category: 'FUEL', metric: 'fuel.used_l' }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'ENGINE', T0);
    expect(r.active).toHaveLength(1);
    expect(r.active[0]!.category).toBe('ENGINE');
  });

  it('C2. 🔒 BAŞKA şirketin kanıtı karara GİRMEZ (cross-tenant)', () => {
    const l = ledgerWith(ev({ companyId: 'co-2' }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'ENGINE', T0);
    expect(r.matched).toHaveLength(0);
  });

  it('C3. 🔒 BAŞKA aracın kanıtı karara GİRMEZ', () => {
    const l = ledgerWith(ev({ vehicleId: 'veh-2' }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'ENGINE', T0);
    expect(r.matched).toHaveLength(0);
  });

  it('C4. 🔒 süresi dolmuş kanıt AYRILIR ama SİLİNMEZ', () => {
    const l = ledgerWith(ev({ ttlMs: 1000 }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'ENGINE', T0 + 5000);
    expect(r.active).toHaveLength(0);
    expect(r.expired).toHaveLength(1);
    expect(r.matched).toHaveLength(1);   // zincir bozulmadı
  });

  it('C5. 🔒 kanıt yoksa kapsam NULL (0 DEĞİL)', () => {
    const r = resolveEvidence(EMPTY_EVIDENCE_LEDGER,
      { companyId: CO, vehicleId: VEH }, 'ENGINE', T0);
    expect(r.coverageRatio).toBeNull();
  });

  it('C6. eksik kategoriler TEK TEK listelenir', () => {
    const l = ledgerWith(ev({ category: 'ENGINE' }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'VEHICLE_HEALTH', T0);
    expect(r.coverageRatio).toBeCloseTo(1 / 5);
    expect(r.missingCategories).toEqual(
      ['VEHICLE', 'TEMPERATURE', 'BATTERY', 'DIAGNOSTIC']);
  });

  it('C7. niyet UNKNOWN ise kanıt toplanmaz', () => {
    const l = ledgerWith(ev());
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'UNKNOWN', T0);
    expect(r.matched).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('D · Çelişki çözücü', () => {
  it('D1. farklı KAYNAKLAR aynı metriği farklı ölçerse çelişki', () => {
    const l = ledgerWith(
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 40 }),
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 70, source: 'TRIP_ENGINE' }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'FUEL', T0);
    const c = resolveConflicts(r.active);
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe('VALUE_DIVERGENCE');
  });

  it('D2. 🔒 KÜÇÜK fark çelişki DEĞİLDİR (ölçüm gürültüsü)', () => {
    expect(valuesConflict(12.5, 12.6)).toBe(false);
    expect(valuesConflict(100, 105)).toBe(false);
    expect(valuesConflict(100, 120)).toBe(true);
    expect(CONFLICT_RELATIVE_TOLERANCE).toBe(0.10);
  });

  it('D3. 🔒 ölçümü olmayan kanıt ÇELİŞEMEZ (null bir değer değil)', () => {
    expect(valuesConflict(null, 100)).toBe(false);
    expect(valuesConflict(null, null)).toBe(false);
  });

  it('D4. iki değer de 0 ise bağıl eşik tanımsızdır — çelişki yok', () => {
    expect(valuesConflict(0, 0)).toBe(false);
  });

  it('D5. çelişki tespiti SİMETRİK ve deterministik', () => {
    expect(valuesConflict(40, 70)).toBe(valuesConflict(70, 40));
    const l = ledgerWith(
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 40 }),
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 70, source: 'TRIP_ENGINE' }));
    const r = resolveEvidence(l, { companyId: CO, vehicleId: VEH }, 'FUEL', T0);
    const a = resolveConflicts(r.active);
    const b = resolveConflicts([...r.active].reverse());
    expect(a).toEqual(b);
  });

  it('D6. FARKLI özne aynı metrikte çelişmez', () => {
    const l = ledgerWith(
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 40 }),
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 70,
        source: 'TRIP_ENGINE', vehicleId: 'veh-2' }));
    /* Özne süzgeci olmadan da çelişmemeli — özne imzası farklı. */
    expect(resolveConflicts([...l.entries])).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('E · Karar çözücü (fail-closed sıra)', () => {
  const subject = { companyId: CO, vehicleId: VEH };

  it('E1. 🔒 ÖZNESİZ istek REDDEDİLİR', () => {
    const out = reason(EMPTY_EVIDENCE_LEDGER,
      { subject: { companyId: CO }, requestedIntent: 'ENGINE', observedAt: T0 });
    expect(out.reasoning.decision).toBe('REJECTED');
    expect(out.reasoning.confidenceReason).toBe('SUBJECT_MISMATCH');
  });

  it('E2. 🔒 niyet çözülemezse UNKNOWN (kura YOK)', () => {
    const l = ledgerWith(ev(), ev({ category: 'FUEL', metric: 'fuel.used_l' }));
    const out = reason(l, { subject, observedAt: T0 });
    expect(out.reasoning.decision).toBe('UNKNOWN');
    expect(out.reasoning.confidenceReason).toBe('INTENT_UNRESOLVED');
  });

  it('E3. 🔒 KANIT YOKSA "sorun yok" DEMEZ → INSUFFICIENT_EVIDENCE', () => {
    const out = reason(EMPTY_EVIDENCE_LEDGER,
      { subject, requestedIntent: 'ENGINE', observedAt: T0 });
    expect(out.reasoning.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(out.reasoning.confidence).toBe('UNKNOWN');
    expect(out.reasoning.evidenceIds).toHaveLength(0);
  });

  it('E4. 🔒 kanıtların hepsinin süresi dolmuşsa EXPIRED_EVIDENCE', () => {
    const l = ledgerWith(ev({ ttlMs: 1000 }));
    const out = reason(l, { subject, requestedIntent: 'ENGINE', observedAt: T0 + 5000 });
    expect(out.reasoning.decision).toBe('EXPIRED_EVIDENCE');
    expect(out.reasoning.confidenceReason).toBe('ALL_EVIDENCE_EXPIRED');
  });

  it('E5. 🔒 ÇELİŞKİDE karar ÜRETİLMEZ', () => {
    const l = ledgerWith(
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 40 }),
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 70, source: 'TRIP_ENGINE' }));
    const out = reason(l, { subject, requestedIntent: 'FUEL', observedAt: T0 });
    expect(out.reasoning.decision).toBe('CONFLICTED_EVIDENCE');
    expect(out.reasoning.confidence).toBe('UNKNOWN');
    expect(out.reasoning.state).toBe('CONFLICTED');
  });

  it('E6. olumsuz kanıt (CRITICAL) → UNSUPPORTED', () => {
    const l = ledgerWith(ev({
      category: 'TEMPERATURE', metric: 'coolant.max_c',
      severity: 'CRITICAL', value: 121,
    }));
    const out = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    expect(out.reasoning.decision).toBe('UNSUPPORTED');
  });

  it('E7. olumsuz kanıt yoksa SUPPORTED', () => {
    const l = ledgerWith(ev({ category: 'TEMPERATURE', metric: 'coolant.max_c', value: 88 }));
    const out = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    expect(out.reasoning.decision).toBe('SUPPORTED');
  });

  it('E8. 🔒 karar sırası pazarlıksız: çelişki, olumsuz kanıttan ÖNCE gelir', () => {
    const l = ledgerWith(
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 40, severity: 'CRITICAL' }),
      ev({ category: 'FUEL', metric: 'fuel.used_l', value: 70, source: 'TRIP_ENGINE' }));
    const out = reason(l, { subject, requestedIntent: 'FUEL', observedAt: T0 });
    expect(out.reasoning.decision).toBe('CONFLICTED_EVIDENCE');
  });

  it('E9. eksik kapsam gerekçesi kaydedilir', () => {
    const l = ledgerWith(ev({ category: 'ENGINE' }));
    const out = reason(l, { subject, requestedIntent: 'VEHICLE_HEALTH', observedAt: T0 });
    expect(out.reasoning.confidenceReason).toBe('COVERAGE_INCOMPLETE');
  });

  it('E10. resolveDecision doğrudan da aynı sırayı uygular', () => {
    const d = resolveDecision(
      { companyId: '' },
      { intent: 'ENGINE', origin: 'REQUESTED', candidates: ['ENGINE'] },
      resolveEvidence(EMPTY_EVIDENCE_LEDGER, { companyId: CO }, 'ENGINE', T0),
      []);
    expect(d.decision).toBe('REJECTED');
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('F · Güven çözücü (ikinci otorite YOK)', () => {
  const subject = { companyId: CO, vehicleId: VEH };

  it('F1. 🔒 sonuçlandırıcı OLMAYAN karar güven ÜRETEMEZ', () => {
    const e = resolveEvidence(EMPTY_EVIDENCE_LEDGER, subject, 'ENGINE', T0);
    for (const d of ['UNKNOWN', 'REJECTED', 'INSUFFICIENT_EVIDENCE',
      'CONFLICTED_EVIDENCE', 'EXPIRED_EVIDENCE'] as const) {
      expect(resolveConfidence(d, e)).toBe('UNKNOWN');
    }
  });

  it('F2. 🔒 TEK kanıtlı karar MEDIUM tavanını AŞAMAZ', () => {
    const l = ledgerWith(ev({ category: 'TEMPERATURE', metric: 'coolant.max_c' }));
    const out = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    expect(out.reasoning.decision).toBe('SUPPORTED');
    expect(out.reasoning.confidence).toBe('MEDIUM');
  });

  it('F3. 🔒 EN ZAYIF kanıt halkası güveni bağlar', () => {
    const l = ledgerWith(
      ev({ category: 'FUEL', metric: 'fuel.a', source: 'BLACKBOX', sampleCount: 20 }),
      ev({ category: 'FUEL', metric: 'fuel.b', source: 'HEALTH_MONITOR',
        provenance: 'ESTIMATED', sampleCount: 20 }));
    const out = reason(l, { subject, requestedIntent: 'FUEL', observedAt: T0 });
    /* HEALTH_MONITOR tavanı MEDIUM → karar da MEDIUM'u aşamaz. */
    expect(out.reasoning.confidence).toBe('MEDIUM');
  });

  it('F4. 🔒 EKSİK KAPSAM güveni AŞAĞI çeker', () => {
    /* 5 kategoriden yalnız 1'i var → %20 kapsam → LOW tavanı. */
    const l = ledgerWith(
      ev({ category: 'ENGINE', metric: 'e.a', source: 'BLACKBOX', sampleCount: 20 }),
      ev({ category: 'ENGINE', metric: 'e.b', source: 'BLACKBOX', sampleCount: 20 }),
      ev({ category: 'ENGINE', metric: 'e.c', source: 'BLACKBOX', sampleCount: 20 }));
    const out = reason(l, { subject, requestedIntent: 'VEHICLE_HEALTH', observedAt: T0 });
    expect(out.reasoning.confidence).toBe('LOW');
  });

  it('F5. 🔒 güven formülü kanıt omurgasından İTHAL edilir', () => {
    /* Yeniden yazılsaydı iki otorite olurdu; aynı fonksiyon olmalı. */
    expect(weakestReasoningConfidence('HIGH', 'LOW')).toBe('LOW');
    expect(weakestReasoningConfidence('UNKNOWN', 'VERY_HIGH')).toBe('UNKNOWN');
  });

  it('F6. hiçbir adım güveni YÜKSELTEMEZ', () => {
    const l = ledgerWith(
      ev({ category: 'LOCATION', metric: 'loc.a', source: 'HEALTH_MONITOR',
        provenance: 'ESTIMATED', sampleCount: 50 }),
      ev({ category: 'LOCATION', metric: 'loc.b', source: 'HEALTH_MONITOR',
        provenance: 'ESTIMATED', sampleCount: 50 }));
    const out = reason(l, { subject, requestedIntent: 'LOCATION', observedAt: T0 });
    expect(out.reasoning.confidence).toBe('MEDIUM');   // kapsam %100 ama kaynak tavanı MEDIUM
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('G · Tekilleştirme ve replay', () => {
  const subject = { companyId: CO, vehicleId: VEH };

  it('G1. kanıt imzası SIRADAN BAĞIMSIZ ve tekrarsız', () => {
    expect(evidenceSignature(['b', 'a'])).toBe(evidenceSignature(['a', 'b']));
    expect(evidenceSignature(['a', 'a', 'b'])).toBe('a,b');
  });

  it('G2. 🔒 aynı kanıtla ikinci düşünme YENİ karar AÇMAZ', () => {
    const l = ledgerWith(ev({ category: 'TEMPERATURE', metric: 'coolant.max_c' }));
    const r1 = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    const r2 = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 + 60_000 });
    expect(r2.reasoning.reasoningId).toBe(r1.reasoning.reasoningId);

    let ledger = EMPTY_REASONING_LEDGER;
    ledger = recordReasoning(ledger, r1.reasoning).ledger;
    const second = recordReasoning(ledger, r2.reasoning);
    expect(second.result).toBe('DUPLICATE');
    expect(second.ledger.entries).toHaveLength(1);
    /* Bastırılan tekrar SESSİZCE YUTULMAZ. */
    expect(second.ledger.duplicateCount).toBe(1);
  });

  it('G3. 🔒 KANIT DEĞİŞİRSE bu ARTIK BAŞKA KARARDIR', () => {
    const l1 = ledgerWith(ev({ category: 'TEMPERATURE', metric: 'coolant.max_c' }));
    const l2 = recordEvidence(l1, ev({ category: 'TEMPERATURE', metric: 'coolant.avg_c' }));
    const r1 = reason(l1, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    const r2 = reason(l2, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    expect(r2.reasoning.reasoningId).not.toBe(r1.reasoning.reasoningId);
  });

  it('G4. karar kimliği ZAMAN İÇERMEZ', () => {
    const base = {
      companyId: CO, intent: 'ENGINE' as const,
      vehicleId: VEH, driverId: null, tripId: null, evidenceIds: ['x'],
    };
    expect(reasoningKey(base)).toBe(reasoningKey({ ...base }));
    expect(reasoningKey(base)).not.toContain(String(T0));
  });

  it('G5. defter TAVANLI (sınırsız dizi bellek sızıntısıdır)', () => {
    let ledger = EMPTY_REASONING_LEDGER;
    for (let i = 0; i < 600; i += 1) {
      ledger = recordReasoning(ledger, {
        ...makeReasoning(), reasoningId: `r-${i}`,
      }).ledger;
    }
    expect(ledger.entries.length).toBeLessThanOrEqual(500);
  });
});

function makeReasoning(over: Partial<MaviReasoning> = {}): MaviReasoning {
  return {
    reasoningId: 'r-1', intent: 'ENGINE', decision: 'SUPPORTED',
    confidence: 'HIGH', confidenceReason: 'WEAKEST_EVIDENCE_LINK',
    reasoningVersion: REASONING_VERSION,
    vehicleId: VEH, driverId: null, tripId: null, companyId: CO,
    evidenceIds: ['e-1'], insightIds: [], dnaIds: [],
    createdAt: T0, expiresAt: T0 + REASONING_DEFAULT_TTL_MS,
    state: 'SUPPORTED', ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
describe('H · Durum makinesi', () => {
  it('H1. 🔒 analiz edilmeden karar OLMAZ', () => {
    expect(canTransitionReasoning('NEW', 'SUPPORTED')).toBe(false);
    expect(canTransitionReasoning('NEW', 'ANALYZING')).toBe(true);
  });

  it('H2. ANALYZING her sonuca gidebilir', () => {
    for (const to of ['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN',
      'CONFLICTED', 'REJECTED'] as const) {
      expect(canTransitionReasoning('ANALYZING', to)).toBe(true);
    }
  });

  it('H3. 🔒 sonuçlanmış karar SESSİZCE değiştirilemez', () => {
    expect(canTransitionReasoning('SUPPORTED', 'UNSUPPORTED')).toBe(false);
    expect(canTransitionReasoning('SUPPORTED', 'EXPIRED')).toBe(true);
  });

  it('H4. 🔒 REJECTED ve EXPIRED MUTLAK terminal', () => {
    expect(canTransitionReasoning('REJECTED', 'ANALYZING')).toBe(false);
    expect(canTransitionReasoning('EXPIRED', 'SUPPORTED')).toBe(false);
    expect(canTransitionReasoning('EXPIRED', 'ANALYZING')).toBe(false);
  });

  it('H5. no-op geçiş yoktur', () => {
    for (const s of REASONING_STATES) {
      expect(canTransitionReasoning(s, s)).toBe(false);
    }
  });

  it('H6. karar → durum eşlemesi TAM', () => {
    expect(stateForDecision('SUPPORTED')).toBe('SUPPORTED');
    expect(stateForDecision('CONFLICTED_EVIDENCE')).toBe('CONFLICTED');
    expect(stateForDecision('REJECTED')).toBe('REJECTED');
    /* Yetersiz · süresi dolmuş · bilinmeyen — hepsi "bilmiyorum". */
    expect(stateForDecision('INSUFFICIENT_EVIDENCE')).toBe('UNKNOWN');
    expect(stateForDecision('EXPIRED_EVIDENCE')).toBe('UNKNOWN');
  });

  it('H7. 🔒 geçersiz geçiş REDDEDİLİR ve SAYILIR', () => {
    let ledger = recordReasoning(EMPTY_REASONING_LEDGER, makeReasoning()).ledger;
    const bad = transitionReasoning(ledger, 'r-1', 'UNSUPPORTED');
    expect(bad.ok).toBe(false);
    expect(bad.ledger.invalidTransitionCount).toBe(1);
    expect(bad.ledger.entries[0]!.state).toBe('SUPPORTED');   // sessizce değişmedi

    ledger = bad.ledger;
    const good = transitionReasoning(ledger, 'r-1', 'EXPIRED');
    expect(good.ok).toBe(true);
    expect(good.ledger.entries[0]!.state).toBe('EXPIRED');
    expect(good.ledger.invalidTransitionCount).toBe(1);       // geçerli geçiş saymaz
  });

  it('H8. bilinmeyen karar için geçiş denemesi sessizce başarılı OLMAZ', () => {
    const out = transitionReasoning(EMPTY_REASONING_LEDGER, 'yok', 'EXPIRED');
    expect(out.ok).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('I · Süre dolumu', () => {
  it('I1. 🔒 süresi dolan karar SİLİNMEZ, EXPIRED olur', () => {
    const ledger = recordReasoning(EMPTY_REASONING_LEDGER, makeReasoning()).ledger;
    const out = expireReasoning(ledger, T0 + REASONING_DEFAULT_TTL_MS + 1);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]!.state).toBe('EXPIRED');
  });

  it('I2. süre dolumu İDEMPOTENT', () => {
    const ledger = recordReasoning(EMPTY_REASONING_LEDGER, makeReasoning()).ledger;
    const once = expireReasoning(ledger, T0 + REASONING_DEFAULT_TTL_MS + 1);
    const twice = expireReasoning(once, T0 + REASONING_DEFAULT_TTL_MS + 2);
    expect(twice).toBe(once);            // değişiklik yoksa aynı nesne
  });

  it('I3. REJECTED karar süre dolumuyla DEĞİŞMEZ (mutlak terminal)', () => {
    const ledger = recordReasoning(EMPTY_REASONING_LEDGER,
      makeReasoning({ decision: 'REJECTED', state: 'REJECTED' })).ledger;
    const out = expireReasoning(ledger, T0 + REASONING_DEFAULT_TTL_MS + 1);
    expect(out.entries[0]!.state).toBe('REJECTED');
  });

  it('I4. süresi dolan kararın KANIT BAĞI korunur', () => {
    const ledger = recordReasoning(EMPTY_REASONING_LEDGER, makeReasoning()).ledger;
    const out = expireReasoning(ledger, T0 + REASONING_DEFAULT_TTL_MS + 1);
    expect(out.entries[0]!.evidenceIds).toEqual(['e-1']);
  });

  it('I5. geçerlilik yalnız sonuçlanmış ve süresi dolmamış karar için doğru', () => {
    const r = makeReasoning();
    expect(isReasoningValid(r, T0)).toBe(true);
    expect(isReasoningValid(r, T0 + REASONING_DEFAULT_TTL_MS + 1)).toBe(false);
    expect(isReasoningValid({ ...r, state: 'REJECTED' }, T0)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('J · Karar zinciri', () => {
  const subject = { companyId: CO, vehicleId: VEH };

  it('J1. zincir DECISION → EVIDENCE → VEHICLE olarak kurulur', () => {
    const l = ledgerWith(ev({ category: 'TEMPERATURE', metric: 'coolant.max_c' }));
    const out = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    const chain = buildReasoningChain(l, out.reasoning);
    expect(chain.filter((n) => n.layer === 'DECISION')).toHaveLength(1);
    expect(chain.filter((n) => n.layer === 'EVIDENCE')).toHaveLength(1);
    expect(chain.filter((n) => n.layer === 'VEHICLE')).toHaveLength(1);
  });

  it('J2. TRIP ucu kanıtın trip öznesinden çözülür', () => {
    const l = ledgerWith(ev({
      category: 'TRIP', metric: 'trip.distance_km', tripId: 'trip-1',
    }));
    const out = reason(l, { subject: { companyId: CO, tripId: 'trip-1' },
      requestedIntent: 'TRIP_STATUS', observedAt: T0 });
    const chain = buildReasoningChain(l, out.reasoning);
    expect(chain.filter((n) => n.layer === 'TRIP')).toHaveLength(1);
  });

  it('J3. içgörü/DNA uçları KANIT ZİNCİRİNDEN çözülür', () => {
    let l = ledgerWith(ev({ category: 'FLEET', metric: 'FUEL_OUTLIER.ratio',
      source: 'FLEET_INTELLIGENCE', provenance: 'DERIVED' }));
    const evId = l.entries[0]!.id;
    l = linkEvidence(l, {
      evidenceId: evId, consumer: 'FLEET_INSIGHT', consumerId: 'insight-1',
    });
    const out = reason(l, { subject, requestedIntent: 'FLEET', observedAt: T0 });
    expect(out.reasoning.insightIds).toEqual(['insight-1']);
    const chain = buildReasoningChain(l, out.reasoning);
    expect(chain.filter((n) => n.layer === 'FLEET_INSIGHT')).toHaveLength(1);
  });

  it('J4. 🔒 bağ YOKSA uç UYDURULMAZ', () => {
    const l = ledgerWith(ev({ category: 'TEMPERATURE', metric: 'coolant.max_c' }));
    const out = reason(l, { subject, requestedIntent: 'TEMPERATURE', observedAt: T0 });
    expect(out.reasoning.insightIds).toEqual([]);
    expect(out.reasoning.dnaIds).toEqual([]);
  });

  it('J5. 🔒 okunamayan kanıt düğümü GİZLENMEZ (resolved:false)', () => {
    const chain = buildReasoningChain(EMPTY_EVIDENCE_LEDGER,
      makeReasoning({ evidenceIds: ['yok-1'] }));
    const node = chain.find((n) => n.layer === 'EVIDENCE');
    expect(node?.resolved).toBe(false);
  });

  it('J6. zincir katman sırası sözleşmeye uyar', () => {
    expect(REASONING_CHAIN_LAYERS).toEqual(
      ['DECISION', 'EVIDENCE', 'FLEET_INSIGHT', 'DRIVER_DNA', 'TRIP', 'VEHICLE']);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('K · Determinizm (LLM olmadan da aynı sonuç)', () => {
  it('K1. 🔒 aynı defter + aynı istek → BİT BİT aynı karar', () => {
    const l = ledgerWith(
      ev({ category: 'TEMPERATURE', metric: 'coolant.max_c' }),
      ev({ category: 'TEMPERATURE', metric: 'coolant.avg_c', value: 82 }));
    const a = reason(l, { subject: { companyId: CO, vehicleId: VEH },
      requestedIntent: 'TEMPERATURE', observedAt: T0 });
    const b = reason(l, { subject: { companyId: CO, vehicleId: VEH },
      requestedIntent: 'TEMPERATURE', observedAt: T0 });
    expect(b.reasoning).toEqual(a.reasoning);
  });

  it('K2. kanıt SIRASI kararı değiştirmez', () => {
    const a = reason(ledgerWith(
      ev({ category: 'FUEL', metric: 'f.a' }),
      ev({ category: 'FUEL', metric: 'f.b', value: 10 })),
    { subject: { companyId: CO, vehicleId: VEH }, requestedIntent: 'FUEL', observedAt: T0 });
    const b = reason(ledgerWith(
      ev({ category: 'FUEL', metric: 'f.b', value: 10 }),
      ev({ category: 'FUEL', metric: 'f.a' })),
    { subject: { companyId: CO, vehicleId: VEH }, requestedIntent: 'FUEL', observedAt: T0 });
    expect(b.reasoning.decision).toBe(a.reasoning.decision);
    expect(b.reasoning.confidence).toBe(a.reasoning.confidence);
    expect(b.reasoning.reasoningId).toBe(a.reasoning.reasoningId);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('L · LAB gözlem yüzeyi (salt-okunur)', () => {
  it('L1. 🔒 head unit\'te karar deposu BOŞTUR ve dürüstçe söyler', () => {
    const d = readMaviReasoning(T0);
    expect(d.source).toBe('NONE');
    expect(d.reasoningCount).toBe(0);
    /* Karar yoksa yaş BİLİNMEZ — `0` DEĞİL. */
    expect(d.newestDecisionAgeMs).toBeNull();
    expect(d.oldestDecisionAgeMs).toBeNull();
  });

  it('L2. sunucudan gelen defter okunur ve sayaçlar doğru', () => {
    let ledger = recordReasoning(EMPTY_REASONING_LEDGER, makeReasoning()).ledger;
    ledger = recordReasoning(ledger, makeReasoning({
      reasoningId: 'r-2', decision: 'CONFLICTED_EVIDENCE', state: 'CONFLICTED',
      confidence: 'UNKNOWN',
    })).ledger;
    ledger = recordReasoning(ledger, makeReasoning({
      reasoningId: 'r-3', decision: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN',
      confidence: 'UNKNOWN', evidenceIds: [],
    })).ledger;
    maviReasoningStore.setFromServer(ledger);

    const d = readMaviReasoning(T0 + 1000);
    expect(d.source).toBe('SERVER');
    expect(d.reasoningCount).toBe(3);
    expect(d.conflictedCount).toBe(1);
    expect(d.unknownCount).toBe(1);
    expect(d.evidenceRefCount).toBe(2);
    expect(d.newestDecisionAgeMs).toBe(1000);
    expect(d.integrityOk).toBe(true);
  });

  it('L3. 🔒 BÜTÜNLÜK: kanıtsız sonuçlandırıcı karar BOZUK sayılır', () => {
    const ledger = recordReasoning(EMPTY_REASONING_LEDGER,
      makeReasoning({ evidenceIds: [] })).ledger;
    maviReasoningStore.setFromServer(ledger);
    expect(readMaviReasoning(T0).integrityOk).toBe(false);
  });

  it('L4. 🔒 BÜTÜNLÜK: güveni bilinmeyen sonuçlandırıcı karar BOZUK sayılır', () => {
    const ledger = recordReasoning(EMPTY_REASONING_LEDGER,
      makeReasoning({ confidence: 'UNKNOWN' })).ledger;
    maviReasoningStore.setFromServer(ledger);
    expect(readMaviReasoning(T0).integrityOk).toBe(false);
  });

  it('L5. okuma ASLA fırlatmaz', () => {
    expect(() => readMaviReasoning(Number.NaN)).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('M · 🔒 KAYNAK KİLİTLERİ (statik)', () => {
  const MODEL = readFileSync(
    join(process.cwd(), 'src/platform/reasoning/maviReasoning.ts'), 'utf8');
  const ENGINE = readFileSync(
    join(process.cwd(), 'src/platform/reasoning/maviReasoningEngine.ts'), 'utf8');

  it('M1. 🔒 LLM/AI ÇAĞRISI YOK', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/openrouter|gemini|anthropic|openai/i);
      expect(code).not.toMatch(/aiService|semanticAi|maviCore|aiCore/);
    }
  });

  it('M2. 🔒 katman SAF (I/O · zaman · timer · depolama YOK)', () => {
    for (const src of [MODEL, ENGINE]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/Date\.now\s*\(/);
      expect(code).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|safeStorage/);
      expect(code).not.toMatch(/supabase|createClient/i);
      expect(code).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('M3. 🔒 TEK VERİ KAPISI: yalnız kanıt omurgası import edilir', () => {
    const imports = [...ENGINE.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const i of imports) {
      const allowed = i.startsWith('./maviReasoning')
        || i === '../fleet/aiEvidence' || i === '../fleet/aiEvidenceEngine';
      expect(allowed, `yasak import: ${i}`).toBe(true);
    }
    /* Karar mantığı ham katmanlara DOKUNMAZ. */
    expect(ENGINE).not.toMatch(/driverDna|fleetIntelligence|tripEngine|deepScan/);
  });

  it('M4. 🔒 DOĞAL DİL alanı YOK (karar bir cümle değildir)', () => {
    const iface = MODEL.slice(
      MODEL.indexOf('export interface MaviReasoning'),
      MODEL.indexOf('export function reasoningKey'));
    for (const banned of ['title', 'message', 'explanation', 'summary',
      'answer', 'recommendation', 'advice']) {
      expect(iface, `yasak alan: ${banned}`).not.toMatch(
        new RegExp(`readonly\\s+${banned}\\b`));
    }
  });

  it('M5. 🔒 güven formülü KOPYALANMAZ, ithal edilir', () => {
    expect(MODEL).toMatch(/weakestEvidenceConfidence/);
    expect(ENGINE).toMatch(/sampleConfidenceCeiling/);
    /* Kendi güven ölçeğini yeniden tanımlamamalı. */
    expect(ENGINE).not.toMatch(/const\s+CONFIDENCE_ORDER/);
  });

  it('M6. 🔒 çelişki eşiği SABİT (çağıran gevşetemez)', () => {
    expect(MODEL).toMatch(/export const CONFLICT_RELATIVE_TOLERANCE = 0\.10/);
    /* Eşiği parametreye çeken bir imza olmamalı. */
    expect(MODEL).not.toMatch(/valuesConflict\([^)]*tolerance/);
  });

  it('M7. 🔒 LAB ekranı SALT-OKUNUR (timer/abonelik/yazma YOK)', () => {
    const SCREEN = readFileSync(
      join(process.cwd(), 'src/components/devtools/screens/MaviReasoningEngineScreen.tsx'),
      'utf8');
    expect(SCREEN).not.toMatch(/setInterval|setTimeout|addEventListener/);
    expect(SCREEN).not.toMatch(/\bfetch\s*\(/);
    expect(SCREEN).not.toMatch(/recordReasoning|transitionReasoning|expireReasoning|reason\(/);
    /* Açılışta tek okuma + mountedRef temizliği şart. */
    expect(SCREEN).toMatch(/mountedRef/);
    expect(SCREEN).toMatch(/return \(\) => \{ mountedRef\.current = false; \};/);
  });

  it('M8. 🔒 LAB kataloğu ve ekran haritası kayıtlı', () => {
    const CATALOG = readFileSync(
      join(process.cwd(), 'src/platform/devtools/carosLabCatalog.ts'), 'utf8');
    const MAP = readFileSync(
      join(process.cwd(), 'src/components/devtools/carosLabScreenMap.tsx'), 'utf8');
    expect(CATALOG).toMatch(/'mavi-reasoning-engine'/);
    expect(CATALOG).toMatch(/id: 'mavi-reasoning-engine'[\s\S]*?status: 'AVAILABLE'/);
    expect(MAP).toMatch(/case 'mavi-reasoning-engine'/);
  });

  it('M9. 🔒 migration 057 karar tetiklemeyi istemciye AÇMAZ', () => {
    const SQL = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260801000057_mavi_reasoning_engine_p1.sql'),
      'utf8');
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.mavi_reason\([^)]*\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT SELECT ON TABLE public\.mavi_reasoning TO authenticated/);
    expect(SQL).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*public\.mavi_reasoning[^;]*authenticated/);
  });

  it('M10. 🔒 TS ve SQL niyet↔kategori sözleşmesi AYNI', () => {
    const SQL = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260801000057_mavi_reasoning_engine_p1.sql'),
      'utf8');
    /* Araç sağlığı beş kategori bekler; SQL tarafı daraltılırsa kilit düşer. */
    expect(SQL).toMatch(
      /WHEN 'VEHICLE_HEALTH' THEN ARRAY\['VEHICLE','ENGINE','TEMPERATURE','BATTERY','DIAGNOSTIC'\]/);
    expect(categoriesForIntent('VEHICLE_HEALTH')).toEqual(
      ['VEHICLE', 'ENGINE', 'TEMPERATURE', 'BATTERY', 'DIAGNOSTIC']);
    expect(SQL).toMatch(/WHEN 'BLACKBOX'\s+THEN 'DIAGNOSTIC'/);
    expect(intentForCategory('BLACKBOX')).toBe('DIAGNOSTIC');
  });

  it('M11. 🔒 kanıt omurgası ve DNA/FI katmanları DEĞİŞTİRİLMEDİ', () => {
    const SQL = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260801000057_mavi_reasoning_engine_p1.sql'),
      'utf8');
    /* 057 mevcut fonksiyonları yeniden tanımlamamalı. */
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._ai_evidence_record/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._dna_/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._fleet_insight/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._trip_attribution_trigger/);
  });

  it('M12. 🔒 karar üretimi head unit\'te YOK (üretim sunucudadır)', () => {
    /* Motor saf bir kütüphanedir; cihazda onu KENDİLİĞİNDEN çalıştıran bir
       zamanlayıcı, abonelik veya köprü yoktur. Böyle bir yol eklenirse bu
       kilit düşer ve kapsam beyanı yeniden değerlendirilmelidir. */
    const wiring = readFileSync(
      join(process.cwd(), 'src/platform/reasoning/maviReasoningEngine.ts'), 'utf8');
    expect(wiring).toMatch(/head unit'te BİLİNÇLİ OLARAK BOŞTUR/);
    expect(readMaviReasoning(T0).source).toBe('NONE');
  });
});
