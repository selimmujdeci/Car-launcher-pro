/**
 * evidenceCoverageView.test.ts — FLEET DASHBOARD KANIT KARTLARI KİLİTLERİ.
 *
 * ── KİLİTLENEN KURALLAR ────────────────────────────────────────────────
 *  1. Kanıt yoksa BOŞ KART değil, GEREKÇE gösterilir.
 *  2. Bilinmeyen değer `null` — **`0` DEĞİL**.
 *  3. Süresi dolmuş kanıt GİZLENMEZ ve "silinmedi" yazılır.
 *  4. Bütünlük bozuksa AÇIKÇA görünür.
 *  5. Panoda AI/öneri/LLM YOKTUR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildEvidenceCoverageView, evidenceAbsenceExplanation,
  buildSubjectEvidenceView,
  EMPTY_EVIDENCE_COVERAGE_VIEW,
  type EvidenceCoverageRow, type SubjectEvidenceRow,
} from '@/lib/fleet/evidenceCoverageView';

function row(over: Partial<EvidenceCoverageRow> = {}): EvidenceCoverageRow {
  return {
    company_id: 'co-1',
    evidence_total: 120, active_count: 90, expired_count: 25, rejected_count: 5,
    unknown_confidence_count: 3, merge_refresh_total: 340, chain_link_count: 48,
    distinct_source_count: 5, distinct_category_count: 8,
    vehicles_total: 10, vehicles_with_evidence: 7,
    drivers_total: 6, drivers_with_evidence: 4,
    vehicle_coverage: '0.7', driver_coverage: '0.666',
    high_confidence_ratio: '0.82', integrity_ok: true,
    ...over,
  };
}

describe('EvidenceCoverageView · A. Yokluk dürüstlüğü', () => {
  it('A1. 🔒 satır yoksa kart GÖSTERİLMEZ ve gerekçe verilir', () => {
    const v = buildEvidenceCoverageView(null);
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_ROW');
    expect(v).toEqual(EMPTY_EVIDENCE_COVERAGE_VIEW);
    expect(evidenceAbsenceExplanation(v)).toContain('bulunamadı');
  });

  it('A2. 🔒 KANIT YOKSA kartlar dolu gösterilmez ama eksikler taşınır', () => {
    const v = buildEvidenceCoverageView(row({
      evidence_total: 0, active_count: 0, vehicle_coverage: null,
    }));
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_EVIDENCE');
    expect(v.missingVehicleCount).toBe(3);
    expect(evidenceAbsenceExplanation(v)).toContain('açıklanamaz');
  });

  it('A3. 🔒 bozuk satır ÇÖKERTMEZ ve sahte değer üretmez', () => {
    const v = buildEvidenceCoverageView(
      { evidence_total: 'x', vehicle_coverage: 'y' } as unknown as EvidenceCoverageRow);
    expect(v.present).toBe(false);
    expect(v.vehicleCoverage).toBeNull();
  });
});

describe('EvidenceCoverageView · B. Kart dürüstlüğü', () => {
  it('B1. 🔒 dört kart üretilir ve hepsi kanıt bağlamı taşır', () => {
    const v = buildEvidenceCoverageView(row());
    expect(v.cards.map((c) => c.key)).toEqual(
      ['COVERAGE', 'QUALITY', 'EXPIRED', 'MISSING']);
    for (const c of v.cards) expect(c.detail.length).toBeGreaterThan(0);
  });

  it('B2. 🔒 kapsam ve kalite YÜZDE olarak gösterilir', () => {
    const v = buildEvidenceCoverageView(row());
    expect(v.cards.find((c) => c.key === 'COVERAGE')!.value).toBe(70);
    expect(v.cards.find((c) => c.key === 'QUALITY')!.value).toBe(82);
  });

  it('B3. 🔒 bilinmeyen kapsam null (0 DEĞİL)', () => {
    const v = buildEvidenceCoverageView(row({ vehicle_coverage: null }));
    const cov = v.cards.find((c) => c.key === 'COVERAGE')!;
    expect(cov.value).toBeNull();
    expect(cov.known).toBe(false);
  });

  it('B4. 🔒 SÜRESİ DOLMUŞ kanıt gizlenmez ve "silinmedi" yazılır', () => {
    const v = buildEvidenceCoverageView(row());
    const exp = v.cards.find((c) => c.key === 'EXPIRED')!;
    expect(exp.value).toBe(25);
    expect(exp.detail).toContain('Silinmedi');
  });

  it('B5. 🔒 EKSİK kanıt sayısı araç+sürücü olarak ayrışır', () => {
    const v = buildEvidenceCoverageView(row());
    const miss = v.cards.find((c) => c.key === 'MISSING')!;
    expect(miss.value).toBe(3 + 2);
    expect(miss.detail).toContain('3 araç');
    expect(miss.detail).toContain('2 sürücü');
    expect(miss.detail).toContain('kanıt sayılmadı');
  });

  it('B6. 🔒 güveni türetilememiş kanıtlar kalite kartında GÖRÜNÜR', () => {
    const v = buildEvidenceCoverageView(row({ unknown_confidence_count: 9 }));
    expect(v.cards.find((c) => c.key === 'QUALITY')!.detail)
      .toContain('9 kanıtın güveni türetilemedi');
  });

  it('B7. 🔒 bütünlük bayrağı TAŞINIR', () => {
    expect(buildEvidenceCoverageView(row({ integrity_ok: false })).integrityOk).toBe(false);
    expect(buildEvidenceCoverageView(row()).integrityOk).toBe(true);
  });
});

describe('EvidenceCoverageView · C. AI yok · PII yok · saflık', () => {
  const VIEW = readFileSync(
    join(process.cwd(), 'src/lib/fleet/evidenceCoverageView.ts'), 'utf8');
  const CARDS = readFileSync(
    join(process.cwd(), 'src/components/dashboard/EvidenceCoverageCards.tsx'), 'utf8');

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

  it('C4. 🔒 kartlar PII taşımaz', () => {
    for (const forbidden of ['plate', 'vin', 'display_name', 'phone', 'email',
                             'latitude', 'longitude']) {
      const re = new RegExp(String.raw`\b${forbidden}\b`, 'i');
      expect(VIEW).not.toMatch(re);
      expect(CARDS).not.toMatch(re);
    }
  });
});

/* ═══ D. ÖZNE KANIT LİSTESİ (Trip · DNA · Insight detayı) ═════════════ */

function evRow(over: Partial<SubjectEvidenceRow> = {}): SubjectEvidenceRow {
  return {
    evidence_id: 'ev-1', source: 'TRIP_ENGINE', category: 'FUEL',
    metric: 'fuel_used_l', value: '3.4', provenance: 'ESTIMATED',
    confidence: 'MEDIUM', state: 'ACTIVE', subject_revision: 1, refresh_count: 2,
    ...over,
  };
}

describe('SubjectEvidenceView · D. Kanıt listesi', () => {
  it('D1. 🔒 kanıt yoksa BOŞ LİSTE değil GEREKÇE döner', () => {
    const v = buildSubjectEvidenceView(null);
    expect(v.items).toHaveLength(0);
    expect(v.emptyReason).toContain('açıklanamaz');
  });

  it('D2. 🔒 satırlar daraltılır ve provenance/güven KORUNUR', () => {
    const v = buildSubjectEvidenceView([evRow()]);
    expect(v.items).toHaveLength(1);
    expect(v.items[0]!.value).toBeCloseTo(3.4, 6);
    expect(v.items[0]!.provenance).toBe('ESTIMATED');
    expect(v.items[0]!.confidence).toBe('MEDIUM');
    expect(v.items[0]!.active).toBe(true);
    expect(v.activeCount).toBe(1);
  });

  it('D3. 🔒 ÖLÇÜMÜ olmayan kanıt null (0 DEĞİL)', () => {
    const v = buildSubjectEvidenceView([evRow({ value: null })]);
    expect(v.items[0]!.value).toBeNull();
  });

  it('D4. 🔒 SUPERSEDED/EXPIRED kanıt gizlenmez ama AKTİF sayılmaz', () => {
    const v = buildSubjectEvidenceView([
      evRow({ evidence_id: 'a', state: 'ACTIVE' }),
      evRow({ evidence_id: 'b', state: 'SUPERSEDED' }),
      evRow({ evidence_id: 'c', state: 'EXPIRED' }),
    ]);
    expect(v.items).toHaveLength(3);
    expect(v.activeCount).toBe(1);
    expect(v.supersededCount).toBe(1);
    expect(v.expiredCount).toBe(1);
  });

  it('D5. 🔒 BOZUK satır SESSİZCE uydurulmaz (atlanır)', () => {
    const v = buildSubjectEvidenceView([
      evRow(), { evidence_id: null, metric: null } as SubjectEvidenceRow,
    ]);
    expect(v.items).toHaveLength(1);
  });

  it('D6. 🔒 liste SALT-OKUNUR (aksiyon/buton yok, PII yok)', () => {
    const LIST = readFileSync(
      join(process.cwd(), 'src/components/dashboard/SubjectEvidenceList.tsx'), 'utf8');
    expect(LIST).not.toContain('<button');
    expect(LIST).not.toContain('onClick');
    for (const forbidden of ['plate', 'vin', 'display_name', 'latitude', 'longitude']) {
      const re = new RegExp(String.raw`${forbidden}`, 'i');
      expect(LIST).not.toMatch(re);
    }
  });
});
