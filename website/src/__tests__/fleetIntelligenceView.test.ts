/**
 * fleetIntelligenceView.test.ts — FLEET DASHBOARD KARTLARI KİLİTLERİ.
 *
 * ── KİLİTLENEN KURALLAR ────────────────────────────────────────────────
 *  1. Kanıt yoksa BOŞ PANO değil, GEREKÇE gösterilir.
 *  2. Bilinmeyen değer `null` — **`0` DEĞİL**.
 *  3. "Bilinmeyenler" kartı GİZLENMEZ.
 *  4. Tek araçtan gelen içgörü "filo iddiası değil" olarak işaretlenir.
 *  5. Panoda ÖNERİ/TAHMİN/LLM YOKTUR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildFleetIntelligenceView, fleetIntelligenceAbsenceExplanation,
  confidenceLabel, trendDirectionLabel, healthStateLabel,
  INSIGHT_CONFIDENCES, TREND_DIRECTIONS, HEALTH_STATES,
  EMPTY_FLEET_INTELLIGENCE_VIEW, type FleetIntelligenceRow,
} from '@/lib/fleet/fleetIntelligenceView';

const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);
const DAY = 86_400_000;

function row(over: Partial<FleetIntelligenceRow> = {}): FleetIntelligenceRow {
  return {
    company_id: 'co-1',
    insight_count: 12, active_insight_count: 7, evidence_count: 96,
    unknown_insight_count: 2, single_vehicle_insight_count: 1,
    trend_count: 5, drifting_trend_count: 2, unknown_trend_count: 1,
    health_unknown_count: 2, health_dimension_count: 6,
    coverage: '0.6', vehicles_total: 10, vehicles_reporting: 6,
    learning_started_at: new Date(NOW - 30 * DAY).toISOString(),
    last_update_at: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

describe('FleetIntelligenceView · A. Yokluk dürüstlüğü', () => {
  it('A1. 🔒 satır yoksa pano GÖSTERİLMEZ ve gerekçe verilir', () => {
    const v = buildFleetIntelligenceView(null, NOW);
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_ROW');
    expect(v).toEqual(EMPTY_FLEET_INTELLIGENCE_VIEW);
    expect(fleetIntelligenceAbsenceExplanation(v)).toContain('bulunamadı');
  });

  it('A2. 🔒 KANIT YOKSA pano dolu gösterilmez ama sayaçlar taşınır', () => {
    const v = buildFleetIntelligenceView(
      row({ insight_count: 0, evidence_count: 0, active_insight_count: 0 }), NOW);
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_EVIDENCE');
    expect(v.vehiclesTotal).toBe(10);
    expect(v.coverage).toBeCloseTo(0.6, 6);
    expect(fleetIntelligenceAbsenceExplanation(v)).toContain('birden çok araçtan');
  });

  it('A3. 🔒 bozuk satır ÇÖKERTMEZ ve sahte değer üretmez', () => {
    const v = buildFleetIntelligenceView(
      { insight_count: 'x', coverage: 'y' } as unknown as FleetIntelligenceRow, NOW);
    expect(v.present).toBe(false);
    expect(v.coverage).toBeNull();
  });
});

describe('FleetIntelligenceView · B. Kart dürüstlüğü', () => {
  it('B1. 🔒 altı kart üretilir ve hepsi kanıt bağlamı taşır', () => {
    const v = buildFleetIntelligenceView(row(), NOW);
    expect(v.present).toBe(true);
    expect(v.cards).toHaveLength(6);
    for (const c of v.cards) expect(c.detail.length).toBeGreaterThan(0);
    expect(v.cards.map((c) => c.key)).toEqual(
      ['INSIGHTS', 'TRENDS', 'RISKS', 'LEARNING', 'COVERAGE', 'UNKNOWNS']);
  });

  it('B2. 🔒 BİLİNMEYEN kartı gizlenmez ve toplam doğrudur', () => {
    const v = buildFleetIntelligenceView(row(), NOW);
    const unknown = v.cards.find((c) => c.key === 'UNKNOWNS')!;
    expect(unknown.value).toBe(2 + 1 + 2);   // içgörü + trend + sağlık
    expect(v.unknownTotal).toBe(5);
  });

  it('B3. 🔒 kapsam bilinmiyorsa null (0 DEĞİL)', () => {
    const v = buildFleetIntelligenceView(row({ coverage: null }), NOW);
    const cov = v.cards.find((c) => c.key === 'COVERAGE')!;
    expect(cov.value).toBeNull();
    expect(cov.known).toBe(false);
  });

  it('B4. 🔒 TEK ARAÇLI içgörü "filo iddiası değil" olarak işaretlenir', () => {
    const v = buildFleetIntelligenceView(row({ single_vehicle_insight_count: 3 }), NOW);
    const risk = v.cards.find((c) => c.key === 'RISKS')!;
    expect(risk.detail).toContain('filo iddiası değil');
    expect(v.singleVehicleInsightCount).toBe(3);
  });

  it('B5. 🔒 öğrenme yaşı GERÇEK damgadan hesaplanır', () => {
    const v = buildFleetIntelligenceView(row(), NOW);
    expect(v.learningAgeDays).toBe(30);
    expect(v.cards.find((c) => c.key === 'LEARNING')!.value).toBe(30);
  });

  it('B6. 🔒 öğrenme damgası yoksa yaş null ve kart bunu söyler', () => {
    const v = buildFleetIntelligenceView(row({ learning_started_at: null }), NOW);
    const learning = v.cards.find((c) => c.key === 'LEARNING')!;
    expect(learning.value).toBeNull();
    expect(learning.known).toBe(false);
    expect(learning.detail).toContain('Henüz');
  });
});

describe('FleetIntelligenceView · C. AI yok · PII yok · saflık', () => {
  const VIEW = readFileSync(
    join(process.cwd(), 'src/lib/fleet/fleetIntelligenceView.ts'), 'utf8');
  const CARDS = readFileSync(
    join(process.cwd(), 'src/components/dashboard/FleetIntelligenceCards.tsx'), 'utf8');

  it('C1. 🔒 LLM/AI ÇAĞRISI YOK', () => {
    for (const src of [VIEW, CARDS]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      for (const forbidden of ['openrouter', 'gemini', 'anthropic', 'openai', 'llm']) {
        expect(code.toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it('C2. 🔒 ÖNERİ/TAVSİYE alanı üretilmez', () => {
    for (const forbidden of ['recommendation', 'suggestion', 'advice']) {
      expect(VIEW.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('C3. 🔒 görünüm modeli SAF (I/O · zaman yok)', () => {
    const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('Date.now()');
    expect(code).not.toContain('fetch(');
    expect(code).not.toContain('supabase');
  });

  it('C4. 🔒 pano PII taşımaz', () => {
    for (const forbidden of ['plate', 'vin', 'display_name', 'phone', 'email',
                             'latitude', 'longitude']) {
      const re = new RegExp(String.raw`\b${forbidden}\b`, 'i');
      expect(VIEW).not.toMatch(re);
      expect(CARDS).not.toMatch(re);
    }
  });

  it('C5. 🔒 etiketler tüm enum değerlerini KAPSAR', () => {
    for (const c of INSIGHT_CONFIDENCES) expect(confidenceLabel(c).length).toBeGreaterThan(0);
    for (const d of TREND_DIRECTIONS) expect(trendDirectionLabel(d).length).toBeGreaterThan(0);
    for (const s of HEALTH_STATES) expect(healthStateLabel(s).length).toBeGreaterThan(0);
  });
});
