/**
 * driverScore.test.ts — V-16/4 sürücü skorunun KİLİTLERİ.
 *
 * ── NEDEN BU ÖZELLİK "DİKKATLİ" YAZILDI ────────────────────────────────────
 * Bir sürücüye 100 üzerinden puan vermek masum değildir: performans
 * değerlendirmesi, prim, hatta işten çıkarma buna dayanabilir. Kanıtı olmayan
 * bir skor, sahte kesinliğin en pahalı biçimidir.
 *
 * Kilitler dört şeyi korur:
 *  (A) Kanıt yokken SKOR ÜRETİLMEDİĞİ (dört ayrı gerekçeyle)
 *  (B) Eksik bileşenin GİZLENMEDİĞİ ve 0/ortalama SAYILMADIĞI
 *  (C) Provenance ve sapmanın skora yansıdığı
 *  (D) TEK OTORİTE: ham satır DEĞİL, DNA görünümü kullanıldığı
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeDriverScore, scoreDisclaimer, bandPoints, SCORE_BANDS,
  SCORE_VERDICT_LABEL,
} from '@/lib/fleet/driverScore';
import { EMPTY_DNA_VIEW, type DriverDnaView, type DnaRate } from '@/lib/fleet/driverDnaView';

const rate = (label: string, value: number | null,
              provenance: DnaRate['provenance'] = 'MEASURED', sampleCount = 10): DnaRate =>
  ({ label, value, unit: '', provenance, sampleCount });

const view = (over: Partial<DriverDnaView>): DriverDnaView => ({
  ...EMPTY_DNA_VIEW,
  present: true, status: 'ACTIVE', learningLevel: 'HIGH',
  tripCount: 120, totalDistanceKm: 3000,
  driftState: 'STABLE',
  rates: [rate('Sert fren', 1), rate('Sert hızlanma', 1), rate('Rölanti payı', 0.1)],
  absentReason: null,
  ...over,
});

/* ══════════════════════════════════════════════════════════════════════════
 * A) KANIT YOKKEN SKOR YOK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('sürücü skoru › kanıt yokken skor üretilmez', () => {
  it('DNA hiç yoksa NO_DNA — ve skor `null`, 0 DEĞİL', () => {
    const s = computeDriverScore(EMPTY_DNA_VIEW);
    expect(s.verdict).toBe('NO_DNA');
    expect(s.score).toBeNull();
  });

  it('eşik ALTINDA olmak, HİÇ SÜRMEMEKTEN ayrıdır', () => {
    /* İkisini "skor yok" diye birleştirmek, hiç sürmeyenle henüz yeterince
       sürmeyeni aynı şey yapardı. */
    const below = computeDriverScore({ ...EMPTY_DNA_VIEW, absentReason: 'BELOW_THRESHOLD' });
    expect(below.verdict).toBe('LEARNING');
    expect(computeDriverScore({ ...EMPTY_DNA_VIEW, absentReason: 'NO_ROW' }).verdict).toBe('NO_DNA');
  });

  it('FORMING durumunda erken skor VERİLMEZ', () => {
    expect(computeDriverScore(view({ status: 'FORMING' })).verdict).toBe('LEARNING');
  });

  it('katkı GERİ ALINMIŞSA skor verilmez — yanlış kişi puanlanır', () => {
    const s = computeDriverScore(view({ retracted: true, retractedTripCount: 4 }));
    expect(s.verdict).toBe('RETRACTED');
    expect(s.score).toBeNull();
  });

  it('puanlanabilir ölçüm yoksa NO_MEASURES', () => {
    const s = computeDriverScore(view({
      rates: [rate('Sert fren', null, 'UNKNOWN', 0), rate('Yakıt', 7)],
    }));
    expect(s.verdict).toBe('NO_MEASURES');
    expect(s.score).toBeNull();
    expect(s.missingComponentCount).toBe(3);
  });

  it('örnek sayısı 0 olan oran puanlanmaz (değeri olsa bile)', () => {
    const s = computeDriverScore(view({
      rates: [rate('Sert fren', 1, 'MEASURED', 0),
              rate('Sert hızlanma', 1, 'MEASURED', 0),
              rate('Rölanti payı', 0.1, 'MEASURED', 0)],
    }));
    expect(s.verdict).toBe('NO_MEASURES');
  });

  it('beş hükmün hepsi AYRI etiketli', () => {
    expect(new Set(Object.values(SCORE_VERDICT_LABEL)).size).toBe(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) EKSİK BİLEŞEN GİZLENMEZ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('sürücü skoru › eksik bileşen', () => {
  it('eksik bileşen 0 SAYILMAZ (sürücüyü cezalandırmaz)', () => {
    /* Yalnız "Sert fren" ölçülmüş ve mükemmel. Eksik ikisi 0 sayılsaydı
       skor ~35 olurdu; doğru cevap 100'dür. */
    const s = computeDriverScore(view({ rates: [rate('Sert fren', 0.1)] }));
    expect(s.verdict).toBe('OK');
    expect(s.score).toBeCloseTo(100);
    expect(s.missingComponentCount).toBe(2);
  });

  it('eksik bileşen ORTALAMA da sayılmaz (ödüllendirmez)', () => {
    /* Yalnız "Sert fren" ölçülmüş ve KÖTÜ. Eksikler 50 sayılsaydı skor
       ~32 olurdu; doğru cevap 0'dır. */
    const s = computeDriverScore(view({ rates: [rate('Sert fren', 20)] }));
    expect(s.score).toBeCloseTo(0);
  });

  it('ağırlıklar YALNIZ eldeki bileşenler üzerinden normalize edilir', () => {
    const s = computeDriverScore(view({
      rates: [rate('Sert fren', 0.1), rate('Rölanti payı', 1)],
    }));
    /* fren 100 puan (ağırlık .35) + rölanti 0 puan (ağırlık .30)
       → 100*.35 / (.35+.30) ≈ 53,8 */
    expect(s.score).toBeCloseTo(53.85, 1);
  });

  it('eksik sayısı raporlanır ve cümlede SÖYLENİR', () => {
    const s = computeDriverScore(view({ rates: [rate('Sert fren', 1)] }));
    expect(s.missingComponentCount).toBe(2);
    expect(scoreDisclaimer(s)).toMatch(/2 bileşenin ölçümü yok/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) PROVENANCE VE SAPMA
 * ═════════════════════════════════════════════════════════════════════════ */
describe('sürücü skoru › provenance ve sapma', () => {
  it('bir bileşen bile ölçülmemişse skor TÜRETİLMİŞ sayılır', () => {
    const s = computeDriverScore(view({
      rates: [rate('Sert fren', 1), rate('Sert hızlanma', 1, 'DERIVED'),
              rate('Rölanti payı', 0.1)],
    }));
    expect(s.provenance).toBe('DERIVED');
    expect(scoreDisclaimer(s)).toMatch(/TÜRETİLMİŞTİR/);
  });

  it('hepsi ölçülmüşse MEASURED', () => {
    expect(computeDriverScore(view({})).provenance).toBe('MEASURED');
  });

  it('sapma varsa skorun güncelliği SORGULANIR', () => {
    const s = computeDriverScore(view({ driftState: 'DRIFTING' }));
    expect(s.driftWarning).toBe(true);
    expect(scoreDisclaimer(s)).toMatch(/güncel davranışı yansıtmayabilir/);
  });

  it('eşikler AÇIK — "neden bu puanı aldım" cevaplanabilir', () => {
    const s = computeDriverScore(view({}));
    expect(s.components.length).toBe(3);
    for (const c of s.components) {
      expect(c.value).toBeTypeOf('number');
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.points).toBeLessThanOrEqual(100);
    }
    expect(scoreDisclaimer(s)).toMatch(/Eşikler açıktır/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) PUANLAMA MATEMATİĞİ
 * ═════════════════════════════════════════════════════════════════════════ */
describe('sürücü skoru › puanlama', () => {
  const band = SCORE_BANDS[0];

  it('iyi eşiğin altı 100, kötü eşiğin üstü 0', () => {
    expect(bandPoints(band, band.good - 1)).toBe(100);
    expect(bandPoints(band, band.bad + 100)).toBe(0);
  });

  it('arada doğrusal ve MONOTON azalan', () => {
    const mid = (band.good + band.bad) / 2;
    expect(bandPoints(band, mid)).toBeCloseTo(50, 0);
    expect(bandPoints(band, band.good + 0.1)).toBeGreaterThan(bandPoints(band, band.bad - 0.1));
  });

  it('geçersiz sayı 100 puan VERMEZ', () => {
    /* NaN "iyi eşiğin altında" sayılsaydı ölçülemeyen sürücü tam puan alırdı. */
    expect(bandPoints(band, Number.NaN)).toBe(0);
  });

  it('skor her zaman 0-100 aralığında', () => {
    for (const v of [0, 0.01, 1, 5, 50, 1000]) {
      const s = computeDriverScore(view({
        rates: [rate('Sert fren', v), rate('Sert hızlanma', v), rate('Rölanti payı', v)],
      }));
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E) TEK OTORİTE VE SAFLIK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('sürücü skoru › tek otorite ve saflık', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/fleet/driverScore.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('HAM satır alanlarını YENİDEN yorumlamaz — görünümü kullanır', () => {
    /* `brake_sum` gibi ham alanlara dokunmak ikinci otorite kurmak olurdu:
       kart ile skor kaçınılmaz olarak ayrışırdı. */
    expect(src).not.toMatch(/brake_sum|accel_sum|idle_sum|driver_dna\b/);
    expect(src).toMatch(/DriverDnaView/);
  });

  it('saat okumaz, I/O yapmaz, ağ çağırmaz', () => {
    expect(src).not.toMatch(/Date\.now\(|new Date\(|fetch\(|supabase/);
  });

  it('yalnız yerel import — dış bağımlılık yok', () => {
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((i) => i.startsWith('.'))).toBe(true);
  });
});
