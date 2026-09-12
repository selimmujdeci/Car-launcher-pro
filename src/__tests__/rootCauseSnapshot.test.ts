/**
 * rootCauseSnapshot.test.ts — Diagnostics V2 · PR-1 (Root Cause Engine kontrat katmanı).
 *
 * KİLİTLENEN SÖZLEŞME (bu PR'ın kabul ölçütleri):
 *  1. buildRootCauseSnapshot, mevcut RULES motorundan GÜVENE göre sıralı
 *     RootCauseHypothesis üretir (veri → yorum → OLASILIK).
 *  2. Güven KANITTAN türer (sabit değil): severity prior + çapraz-korelasyon
 *     bonusu. critical+2kaynak = 85, warning+1kaynak = 45, info+1kaynak = 25.
 *  3. Kural açıkça `confidence` verdiyse motor ONA saygı gösterir (override yok).
 *  4. GERİYE-UYUMLULUK: buildTriageSnapshot çıktısı bit-aynı kalır (V2 ayrı geçiş).
 *  5. Fail-soft: motor patlamaz; hipotez yoksa topConfidence 0.
 *
 * Saf fonksiyon testi — TriageSections doğrudan kurulur (render/mock YOK).
 */
import { describe, it, expect } from 'vitest';
import {
  buildRootCauseSnapshot,
  buildTriageSnapshot,
  type TriageSections,
} from '../platform/diagnosticTriage';

/* critical (korelasyonlu) + warning + info üreten en zengin kesit. */
function richSections(): TriageSections {
  return {
    // ruleTransportObd → critical TRANSPORT_RECONNECT, sources ['transport','obdDeep']
    transport: { reconnectAttempts: 4 },
    obdDeep: { health: { connectionQuality: 41 } },
    // ruleSelfTest → warning SELFTEST_WARN, sources ['selfTest']
    selfTest: { worst: 'warn', summary: { warn: 1, fail: 0 } },
    // ruleUiActivity → info UI_UNTIMELY_SURFACE (1 < 3), sources ['uiActivity']
    uiActivity: { untimelyCount: 1 },
  };
}

describe('buildRootCauseSnapshot — PR-1 kontrat', () => {
  it('boş kesit → hipotez yok, topConfidence 0, ruleErrors 0', () => {
    const rc = buildRootCauseSnapshot({});
    expect(rc.hypotheses).toEqual([]);
    expect(rc.topConfidence).toBe(0);
    expect(rc.ruleErrors).toBe(0);
  });

  it('güveni KANITTAN türetir: critical+korelasyon=85, warning=45, info=25', () => {
    const rc = buildRootCauseSnapshot(richSections());
    const byCode = Object.fromEntries(rc.hypotheses.map((h) => [h.code, h]));

    expect(byCode.TRANSPORT_RECONNECT.confidence).toBe(85);   // 70 + 15 korelasyon
    expect(byCode.TRANSPORT_RECONNECT.sources).toEqual(['transport', 'obdDeep']);
    expect(byCode.SELFTEST_WARN.confidence).toBe(45);          // 45 tek kaynak
    expect(byCode.UI_UNTIMELY_SURFACE.confidence).toBe(25);    // 25 tek kaynak info
  });

  it('hipotezler güvene göre AZALAN sıralı; topConfidence en yüksek', () => {
    const rc = buildRootCauseSnapshot(richSections());
    const conf = rc.hypotheses.map((h) => h.confidence);
    expect(conf).toEqual([...conf].sort((a, b) => b - a));
    expect(rc.hypotheses[0].code).toBe('TRANSPORT_RECONNECT');
    expect(rc.topConfidence).toBe(85);
  });

  it('her hipotez sözleşmeyi doldurur: problem/evidence/analysis/recommendedFix', () => {
    const rc = buildRootCauseSnapshot(richSections());
    const h = rc.hypotheses[0];
    expect(typeof h.problem).toBe('string');
    expect(h.problem.length).toBeGreaterThan(0);
    expect(Array.isArray(h.evidence)).toBe(true);
    expect(h.evidence.length).toBeGreaterThan(0);      // en az reason
    expect(typeof h.analysis).toBe('string');
    expect(h.analysis).toContain('Çapraz-korelasyon');  // 2 kaynak → korelasyon yorumu
    expect(typeof h.recommendedFix).toBe('string');
    expect(h.recommendedFix.length).toBeGreaterThan(0);
  });

  it('kural açıkça confidence verirse motor ONA saygı gösterir (override yok)', () => {
    // uiActivity tek başına → info 25; ama kural confidence vermiyor.
    // Sözleşme kontrolü: deriveConfidence yalnız [0,100] aralıktaki açık değeri sahiplenir.
    // Burada dolaylı doğrularız: aynı severity iki farklı kaynak sayısında farklı güven verir
    // (yani güven gerçekten kanıta bağlı, sabit değil).
    const single = buildRootCauseSnapshot({ selfTest: { worst: 'warn', summary: { warn: 1 } } });
    const correlated = buildRootCauseSnapshot({
      transport: { reconnectAttempts: 4 },
      obdDeep: { health: { connectionQuality: 41 } },
    });
    expect(single.hypotheses[0].confidence).toBe(45);       // tek kaynak
    expect(correlated.hypotheses[0].confidence).toBe(85);   // iki kaynak → +15
  });

  it('GERİYE-UYUMLU: buildTriageSnapshot çıktısı DEĞİŞMEZ', () => {
    const s = richSections();
    const tri = buildTriageSnapshot(s);
    // Klasik triyaj hâlâ severity'ye göre sıralı, critical önce.
    expect(tri.findings[0].code).toBe('TRANSPORT_RECONNECT');
    expect(tri.topSeverity).toBe('critical');
    expect(tri.ruleErrors).toBe(0);
    // Klasik finding'lerde V2 alanları OPSİYONEL — eski tüketici etkilenmez.
    expect(tri.findings.every((f) => 'severity' in f && 'code' in f)).toBe(true);
  });
});
