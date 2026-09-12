/**
 * aiMechanicCore.test.ts — AI MECHANIC CORE P1 KİLİTLERİ.
 *
 * En önemli kilit: **AI Mechanic karar ÜRETMEZ.** Her testin ölçtüğü şey,
 * çıktının MAVI'den gelen karara sadık kalıp kalmadığıdır.
 *
 * SQL karşılıkları `supabase/tests/060_ai_mechanic_matrix.sql` içindedir;
 * bu dosya TS↔SQL paritesini de kilitler.
 */

import { describe, it, expect } from 'vitest';
import {
  MECHANIC_CATEGORIES, MECHANIC_ANALYSIS_STATES,
  categoryForIntent, resolveCategory, looksLikeCoolingMetric,
  stateForDecision, severityFor, analysisIdFor, analysisFromReasoning,
  summarizeAnalyses, chainRefFor,
  type ReasoningRowLike, type MechanicAnalysis,
} from '../platform/aiMechanic/aiMechanicModel';

/* ── yardımcı: geçerli bir MAVI satırı ───────────────────────────────── */
function row(over: Partial<ReasoningRowLike> = {}): ReasoningRowLike {
  return {
    reasoningId: 'r-1', intent: 'ENGINE', decision: 'UNSUPPORTED',
    confidence: 'HIGH', confidenceReason: 'SINGLE_OBSERVATION', state: 'UNSUPPORTED',
    evidenceCount: 1, conflictCount: 0,
    vehicleId: 'v-1', driverId: null, tripId: null,
    createdAt: '2026-08-01T18:00:00.000Z',
    evidenceIds: ['e-1'],
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   1 · KAPSAM — AI MECHANIC KENDİ ALANI DIŞINDA KONUŞMAZ
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · kapsam', () => {
  it('P1 kategori listesi paket şartıyla BİREBİR', () => {
    expect([...MECHANIC_CATEGORIES]).toEqual([
      'ENGINE', 'COOLING', 'BATTERY', 'FUEL', 'OBD',
      'TEMPERATURE', 'CONNECTIVITY', 'UNKNOWN',
    ]);
  });

  it('mekanik OLMAYAN niyetler kapsam dışıdır (null) — UNKNOWN DEĞİL', () => {
    // null = "söyleyecek sözüm yok"; UNKNOWN = "mekanik ama çözülemedi".
    for (const i of ['DRIVER', 'FLEET', 'TRIP_STATUS', 'LOCATION'] as const) {
      expect(categoryForIntent(i)).toBeNull();
    }
  });

  it('kapsam dışı niyetten ANALİZ ÜRETİLMEZ', () => {
    expect(analysisFromReasoning(row({ intent: 'FLEET' }))).toBeNull();
    expect(analysisFromReasoning(row({ intent: 'DRIVER' }))).toBeNull();
  });

  it('mekanik niyetler doğru kategoriye düşer (SQL paritesi)', () => {
    expect(categoryForIntent('ENGINE')).toBe('ENGINE');
    expect(categoryForIntent('BATTERY')).toBe('BATTERY');
    expect(categoryForIntent('FUEL')).toBe('FUEL');
    expect(categoryForIntent('TEMPERATURE')).toBe('TEMPERATURE');
    expect(categoryForIntent('CONNECTIVITY')).toBe('CONNECTIVITY');
    expect(categoryForIntent('DIAGNOSTIC')).toBe('OBD');
    expect(categoryForIntent('VEHICLE_HEALTH')).toBe('UNKNOWN');
    expect(categoryForIntent('UNKNOWN')).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   2 · SOĞUTMA — METRİKSİZ İDDİA EDİLMEZ
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · COOLING ayrımı', () => {
  it('soğutma yalnız GERÇEK kanıt metriğiyle seçilir', () => {
    expect(looksLikeCoolingMetric('coolant_temp_c')).toBe(true);
    expect(looksLikeCoolingMetric('radiator_fan_duty')).toBe(true);
    expect(looksLikeCoolingMetric('thermostat_state')).toBe(true);
    expect(looksLikeCoolingMetric('intake_air_temp')).toBe(false);
    expect(looksLikeCoolingMetric('')).toBe(false);
    expect(looksLikeCoolingMetric(null)).toBe(false);
  });

  it('metrik YOKSA TEMPERATURE kalır — COOLING UYDURULMAZ', () => {
    expect(resolveCategory('TEMPERATURE', undefined)).toBe('TEMPERATURE');
    expect(resolveCategory('TEMPERATURE', [])).toBe('TEMPERATURE');
    expect(resolveCategory('TEMPERATURE', ['intake_air_temp'])).toBe('TEMPERATURE');
  });

  it('soğutma metriği VARSA COOLING olur', () => {
    expect(resolveCategory('TEMPERATURE', ['coolant_temp_c'])).toBe('COOLING');
  });

  it('soğutma ayrımı yalnız TEMPERATURE niyetinde uygulanır', () => {
    expect(resolveCategory('ENGINE', ['coolant_temp_c'])).toBe('ENGINE');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   3 · KARAR SADAKATİ — YENİ KARAR/GÜVEN ÜRETİLMEZ
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · karar üretmez, yalnız taşır', () => {
  it('analiz durumları paket şartıyla BİREBİR', () => {
    expect([...MECHANIC_ANALYSIS_STATES]).toEqual([
      'SUPPORTED', 'UNSUPPORTED', 'UNKNOWN',
      'INSUFFICIENT_EVIDENCE', 'CONFLICTED_EVIDENCE', 'EXPIRED_EVIDENCE',
    ]);
  });

  it('her MAVI kararı AYNEN karşılığına geçer', () => {
    expect(stateForDecision('SUPPORTED')).toBe('SUPPORTED');
    expect(stateForDecision('UNSUPPORTED')).toBe('UNSUPPORTED');
    expect(stateForDecision('INSUFFICIENT_EVIDENCE')).toBe('INSUFFICIENT_EVIDENCE');
    expect(stateForDecision('CONFLICTED_EVIDENCE')).toBe('CONFLICTED_EVIDENCE');
    expect(stateForDecision('EXPIRED_EVIDENCE')).toBe('EXPIRED_EVIDENCE');
    expect(stateForDecision('UNKNOWN')).toBe('UNKNOWN');
  });

  it('REJECTED analiz ÜRETMEZ (girdi hatası, teşhis değil)', () => {
    expect(stateForDecision('REJECTED')).toBeNull();
    expect(analysisFromReasoning(row({ decision: 'REJECTED' }))).toBeNull();
  });

  it('GÜVEN yeniden hesaplanmaz — MAVI değeri AYNEN taşınır', () => {
    for (const c of ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const) {
      expect(analysisFromReasoning(row({ confidence: c }))!.confidence).toBe(c);
    }
  });

  it('tanınmayan güven UNKNOWN olur (fail-closed, uydurma yok)', () => {
    expect(analysisFromReasoning(row({ confidence: 'SUPER_SURE' }))!.confidence).toBe('UNKNOWN');
  });

  it('kanıt/çelişki sayıları MAVI\'den taşınır, yeniden sayılmaz', () => {
    const a = analysisFromReasoning(row({ evidenceCount: 7, conflictCount: 2 }))!;
    expect(a.evidenceCount).toBe(7);
    expect(a.conflictCount).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   4 · ŞİDDET — SUNUM SIRALAMASI, KARAR DEĞİL
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · şiddet', () => {
  it('SUPPORTED daima NONE — "sorun yok" şiddeti yükseltmez', () => {
    expect(severityFor('SUPPORTED', 'VERY_HIGH')).toBe('NONE');
    expect(severityFor('SUPPORTED', 'LOW')).toBe('NONE');
  });

  it('UNSUPPORTED şiddeti YALNIZ MAVI güveninden türer', () => {
    expect(severityFor('UNSUPPORTED', 'VERY_HIGH')).toBe('CRITICAL');
    expect(severityFor('UNSUPPORTED', 'HIGH')).toBe('CRITICAL');
    expect(severityFor('UNSUPPORTED', 'MEDIUM')).toBe('WARNING');
    expect(severityFor('UNSUPPORTED', 'LOW')).toBe('WARNING');
  });

  it('güven UNKNOWN ise ŞİDDET İDDİA EDİLMEZ', () => {
    expect(severityFor('UNSUPPORTED', 'UNKNOWN')).toBe('UNKNOWN');
  });

  it('ÇELİŞKİ bir arıza değil BİLGİ EKSİKLİĞİDİR — WARNING olamaz', () => {
    // MAVI'nin "çelişkide karar üretilmez" kuralı arkadan dolanılamaz.
    expect(severityFor('CONFLICTED_EVIDENCE', 'HIGH')).toBe('UNKNOWN');
    expect(severityFor('INSUFFICIENT_EVIDENCE', 'HIGH')).toBe('UNKNOWN');
    expect(severityFor('EXPIRED_EVIDENCE', 'VERY_HIGH')).toBe('UNKNOWN');
    expect(severityFor('UNKNOWN', 'HIGH')).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   5 · KİMLİK VE REPLAY
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · kimlik', () => {
  it('analysisId reasoningId\'den DETERMİNİSTİK türer', () => {
    expect(analysisIdFor('abc')).toBe('mech:abc');
    expect(analysisFromReasoning(row({ reasoningId: 'xyz' }))!.analysisId).toBe('mech:xyz');
  });

  it('REPLAY yeni kimlik üretmez — aynı karar aynı analiz', () => {
    const a1 = analysisFromReasoning(row())!;
    const a2 = analysisFromReasoning(row())!;
    expect(a1.analysisId).toBe(a2.analysisId);
  });

  it('reasoningId yoksa analiz ÜRETİLMEZ (dayanaksız teşhis olamaz)', () => {
    expect(analysisFromReasoning(row({ reasoningId: '' }))).toBeNull();
    expect(analysisFromReasoning(null)).toBeNull();
    expect(analysisFromReasoning(undefined)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   6 · ÖNERİ YOKTUR (paket şartı §5)
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · öneri üretmez', () => {
  it('analiz nesnesinde serbest metin / tavsiye alanı YOKTUR', () => {
    const a = analysisFromReasoning(row())! as unknown as Record<string, unknown>;
    for (const forbidden of [
      'message', 'summary', 'text', 'explanation', 'answer', 'title',
      'recommendation', 'advice', 'repair', 'part', 'parts', 'cost', 'action',
    ]) {
      expect(a[forbidden], `yasak alan: ${forbidden}`).toBeUndefined();
    }
  });

  it('alan kümesi kanonik model ile BİREBİR (sızıntı kilidi)', () => {
    const a = analysisFromReasoning(row())!;
    expect(Object.keys(a).sort()).toEqual([
      'analysisId', 'confidence', 'confidenceReason', 'conflictCount',
      'createdAt', 'diagnosticCategory', 'driverId', 'evidenceCount',
      'evidenceIds', 'reasoningId', 'reasoningState', 'severity', 'state',
      'tripId', 'vehicleId',
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   7 · MUHAKEME ZİNCİRİ (paket şartı §6)
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · zincir okunabilirliği', () => {
  it('analiz hangi karar · kanıt · yolculuk · araç üzerinden oluştu — okunur', () => {
    const a = analysisFromReasoning(row({
      vehicleId: 'v-9', driverId: 'd-9', tripId: 't-9', evidenceIds: ['e-1', 'e-2'],
    }))!;
    const c = chainRefFor(a);
    expect(c.reasoningId).toBe('r-1');
    expect(c.vehicleId).toBe('v-9');
    expect(c.driverId).toBe('d-9');
    expect(c.tripId).toBe('t-9');
    expect(c.evidenceIds).toEqual(['e-1', 'e-2']);
    // Zincir MAVI'de yaşar — AI Mechanic ikinci bir zincir DEPOLAMAZ.
    expect(c.chainSource).toBe('mavi_reasoning_chain');
  });
});

/* ══════════════════════════════════════════════════════════════════════
   8 · ÖZET — BOŞ KÜMEDE ORAN NULL
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · özet', () => {
  it('hiç analiz yoksa oranlar NULL (0 DEĞİL)', () => {
    const s = summarizeAnalyses([]);
    expect(s.analysisTotal).toBe(0);
    expect(s.conclusiveRatio).toBeNull();
    expect(s.highConfidenceRatio).toBeNull();
  });

  it('sayaçlar analizlerden türer; UNKNOWN/çelişki/expired ayrı görünür', () => {
    const list = [
      analysisFromReasoning(row({ reasoningId: 'a', decision: 'SUPPORTED', confidence: 'HIGH' }))!,
      analysisFromReasoning(row({ reasoningId: 'b', decision: 'UNSUPPORTED', confidence: 'LOW' }))!,
      analysisFromReasoning(row({ reasoningId: 'c', decision: 'CONFLICTED_EVIDENCE', confidence: 'UNKNOWN' }))!,
      analysisFromReasoning(row({ reasoningId: 'd', decision: 'EXPIRED_EVIDENCE', confidence: 'UNKNOWN' }))!,
      analysisFromReasoning(row({ reasoningId: 'e', decision: 'UNKNOWN', confidence: 'UNKNOWN' }))!,
    ] as MechanicAnalysis[];
    const s = summarizeAnalyses(list);
    expect(s.analysisTotal).toBe(5);
    expect(s.unknownCount).toBe(1);
    expect(s.conflictCount).toBe(1);
    expect(s.expiredCount).toBe(1);
    expect(s.conclusiveRatio).toBeCloseTo(2 / 5);
    expect(s.highConfidenceRatio).toBeCloseTo(1 / 5);
    expect(s.byCategory.ENGINE).toBe(5);
    expect(s.bySeverity.NONE).toBe(1);       // SUPPORTED
    expect(s.bySeverity.WARNING).toBe(1);    // UNSUPPORTED + LOW
    expect(s.bySeverity.UNKNOWN).toBe(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   9 · FAIL-CLOSED
   ════════════════════════════════════════════════════════════════════ */

describe('AI Mechanic · fail-closed', () => {
  it('tanınmayan karar UNKNOWN analizine düşer, uydurma YOK', () => {
    const a = analysisFromReasoning(row({ decision: 'DEFINITELY_BROKEN' }))!;
    expect(a.state).toBe('UNKNOWN');
    expect(a.severity).toBe('UNKNOWN');
  });

  it('tanınmayan gerekçe kodu NO_EVIDENCE\'a düşer (bounded küme korunur)', () => {
    expect(analysisFromReasoning(row({ confidenceReason: 'ÇÜNKÜ ÖYLE' }))!.confidenceReason)
      .toBe('NO_EVIDENCE');
  });

  it('bozuk sayılar negatife/NaN\'a kaçmaz', () => {
    const a = analysisFromReasoning(row({
      evidenceCount: Number.NaN, conflictCount: -5,
    }))!;
    expect(a.evidenceCount).toBe(0);
    expect(a.conflictCount).toBe(0);
  });

  it('analiz nesnesi DONMUŞTUR (tüketici mutasyon edemez)', () => {
    expect(Object.isFrozen(analysisFromReasoning(row())!)).toBe(true);
  });
});
