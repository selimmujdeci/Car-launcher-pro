/**
 * fuelCostModel.test.ts — V-16/5 yakıt maliyet analizinin KİLİTLERİ.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * Enterprise sayfası "Yakıt maliyet analizi" vaat ediyordu; `grep` ile kodda
 * KARŞILIĞI YOKTU. Ama asıl mesele özelliğin yokluğu değil, **hangi veriyle**
 * yapılacağıydı.
 *
 * PROD ÖLÇÜMÜ (2026-08-22, 34 yolculuk):
 *   distance_source = MEASURED
 *   fuel_source     = ESTIMATED (34/34)   ← ölçülmemiş
 *   price_source    = DEFAULT_FALLBACK    ← gerçek fiyat HİÇ girilmemiş
 * Yani bugün üretilebilecek tutar = ölçülmüş mesafe × TAHMİNİ tüketim ×
 * VARSAYILAN fiyat. Bunu düz bir "₺" olarak göstermek sahte kesinlik olurdu.
 *
 * Kilitler üç şeyi korur:
 *  (A) Toplamın EN ZAYIF girdisi kadar güçlü olduğu
 *  (B) Üç ayrı "yok"un birleştirilmediği
 *  (C) Sahte 0 / sahte oran üretilmediği
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  summarizeFuelCost, rowQuality, costDisclaimer,
  QUALITY_LABEL, COST_VERDICT_LABEL, type TripCostRow,
} from '@/lib/console/fuelCostModel';

/** Prod'da GERÇEKTEN görülen satır biçimi. */
const PROD_LIKE: TripCostRow = {
  distance_km: 0.6, distance_source: 'MEASURED',
  fuel_used_l: 0.04, fuel_source: 'ESTIMATED',
  estimated_cost: 1.59, cost_source: 'ESTIMATED',
  fuel_unit_price: 45, price_source: 'DEFAULT_FALLBACK',
};

/* ══════════════════════════════════════════════════════════════════════════
 * A) EN ZAYIF GİRDİ KURALI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('yakıt maliyeti › en zayıf girdi', () => {
  it('PROD gerçeği: ölçülmüş mesafe, tutarı ÖLÇÜLMÜŞ YAPMAZ', () => {
    const s = summarizeFuelCost([PROD_LIKE, PROD_LIKE]);
    expect(s.verdict).toBe('OK');
    /* Mesafe MEASURED ama fiyat DEFAULT_FALLBACK → toplam en zayıfa iner. */
    expect(s.quality).toBe('FALLBACK_PRICE');
    expect(QUALITY_LABEL[s.quality]).toBe('VARSAYILAN FİYAT');
  });

  it('varsayılan fiyat, ÖLÇÜLMÜŞ tüketimi bile aşağı çeker', () => {
    /* Tüketim ölçülmüş olsa bile tutar uydurma bir fiyattan çıkıyorsa
       tutar güvenilir DEĞİLDİR. */
    expect(rowQuality({
      fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'DEFAULT_FALLBACK',
    })).toBe('FALLBACK_PRICE');
  });

  it('tam ölçülmüş satır MEASURED sayılır', () => {
    expect(rowQuality({
      fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'STATION_API',
    })).toBe('MEASURED');
  });

  it('kaynak bildirilmemişse UYDURULMAZ — UNKNOWN', () => {
    expect(rowQuality({})).toBe('UNKNOWN');
  });

  it('KARIŞIK dönemde toplam, en zayıf satıra iner', () => {
    const s = summarizeFuelCost([
      { estimated_cost: 100, fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'STATION_API', distance_km: 100 },
      { estimated_cost: 10, fuel_source: 'ESTIMATED', cost_source: 'ESTIMATED', price_source: 'STATION_API', distance_km: 10 },
    ]);
    /* Biri tahmin → toplam "ölçüldü" DİYEMEZ. */
    expect(s.quality).toBe('ESTIMATED');
    expect(s.qualityMix.MEASURED).toBe(1);
    expect(s.qualityMix.ESTIMATED).toBe(1);
  });

  it('tutarı OLMAYAN yolculuk toplamı zayıflatmaz (toplama girmemiştir)', () => {
    const s = summarizeFuelCost([
      { estimated_cost: 50, fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'STATION_API', distance_km: 50 },
      { distance_km: 5 },                       // maliyetsiz satır
    ]);
    expect(s.quality).toBe('MEASURED');
    expect(s.tripCount).toBe(2);
    expect(s.costedTripCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) ÜÇ AYRI "YOK"
 * ═════════════════════════════════════════════════════════════════════════ */
describe('yakıt maliyeti › üç ayrı yok', () => {
  it('okunamadı ≠ yolculuk yok ≠ maliyet üretilemez', () => {
    expect(summarizeFuelCost(null).verdict).toBe('UNREADABLE');
    expect(summarizeFuelCost([]).verdict).toBe('NO_TRIPS');
    expect(summarizeFuelCost([{ distance_km: 5 }]).verdict).toBe('NO_COST_INPUT');
    /* Üçü AYRI etiketle görünmeli. */
    const labels = new Set(Object.values(COST_VERDICT_LABEL));
    expect(labels.size).toBe(4);
  });

  it('her hükmün kendi dürüstlük cümlesi var', () => {
    expect(costDisclaimer(summarizeFuelCost(null))).toMatch(/OKUNAMADI/);
    expect(costDisclaimer(summarizeFuelCost(null))).toMatch(/"yolculuk yok" anlamına GELMEZ/);
    expect(costDisclaimer(summarizeFuelCost([]))).toMatch(/ölçülmüş bir YOK/);
    expect(costDisclaimer(summarizeFuelCost([{ distance_km: 5 }]))).toMatch(/Sahte bir tutar gösterilmez/);
  });

  it('varsayılan fiyatta kullanıcıya NE YAPACAĞI söylenir', () => {
    const s = summarizeFuelCost([PROD_LIKE]);
    expect(costDisclaimer(s)).toMatch(/fiyatı girin/);
    expect(costDisclaimer(s)).toMatch(/gerçek harcamayı YANSITMAZ/);
  });

  it('dönem içinde fiyat değiştiyse bu SÖYLENİR', () => {
    const s = summarizeFuelCost([
      { ...PROD_LIKE, fuel_unit_price: 45 },
      { ...PROD_LIKE, fuel_unit_price: 48 },
    ]);
    expect(s.unitPrices).toEqual([45, 48]);
    expect(costDisclaimer(s)).toMatch(/2 farklı birim fiyat/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) SAHTE 0 / SAHTE ORAN YASAĞI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('yakıt maliyeti › sahte değer yasağı', () => {
  it('hiç yakıt bildirilmemişse litre `null` — 0 DEĞİL', () => {
    const s = summarizeFuelCost([{ distance_km: 10, estimated_cost: 5, cost_source: 'ESTIMATED', price_source: 'X' }]);
    expect(s.litres).toBeNull();
    expect(s.litresPer100Km).toBeNull();
  });

  it('mesafe yoksa 100 km oranı ÜRETİLMEZ (Infinity de 0 da yalan)', () => {
    const s = summarizeFuelCost([{ estimated_cost: 5, cost_source: 'ESTIMATED', price_source: 'X' }]);
    expect(s.cost).toBe(5);
    expect(s.distanceKm).toBeNull();
    expect(s.costPer100Km).toBeNull();
  });

  it('mesafe SIFIR ise de oran üretilmez', () => {
    const s = summarizeFuelCost([{ distance_km: 0, estimated_cost: 5, cost_source: 'ESTIMATED', price_source: 'X' }]);
    expect(s.costPer100Km).toBeNull();
  });

  it('toplamlar doğru hesaplanır', () => {
    const s = summarizeFuelCost([
      { distance_km: 100, fuel_used_l: 8, estimated_cost: 360, fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'API' },
      { distance_km: 100, fuel_used_l: 10, estimated_cost: 450, fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'API' },
    ]);
    expect(s.distanceKm).toBe(200);
    expect(s.litres).toBe(18);
    expect(s.cost).toBe(810);
    expect(s.costPer100Km).toBeCloseTo(405);
    expect(s.litresPer100Km).toBeCloseTo(9);
  });

  it('geçersiz sayılar (NaN/Infinity) toplama SIZMAZ', () => {
    const s = summarizeFuelCost([
      { distance_km: Number.NaN, estimated_cost: Number.POSITIVE_INFINITY },
      { distance_km: 10, estimated_cost: 20, cost_source: 'ESTIMATED', price_source: 'API' },
    ]);
    expect(s.distanceKm).toBe(10);
    expect(s.cost).toBe(20);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C2) PostgREST METİN-SAYI TUZAĞI
 *
 * PostgREST `numeric` kolonlarını METİN döndürür. Model yalnız `number`
 * kabul etseydi ÜRETİMDE her toplam sessizce `null` olur, ekranda her yerde
 * `—` görünürdü — ve testler (sayı verdikleri için) YEŞİL kalırdı.
 * TypeScript bunu yakaladı; bu kilitler geri gelmesini engeller.
 * ═════════════════════════════════════════════════════════════════════════ */
describe('yakıt maliyeti › PostgREST metin-sayı', () => {
  it('METİN gelen sayılar doğru toplanır', () => {
    const s = summarizeFuelCost([
      { distance_km: '100.5', fuel_used_l: '8.25', estimated_cost: '360.75',
        fuel_source: 'MEASURED', cost_source: 'MEASURED', price_source: 'API',
        fuel_unit_price: '45.00' },
    ] as unknown as TripCostRow[]);
    expect(s.distanceKm).toBeCloseTo(100.5);
    expect(s.litres).toBeCloseTo(8.25);
    expect(s.cost).toBeCloseTo(360.75);
    expect(s.unitPrices).toEqual([45]);
  });

  it('BOŞ metin `0` sayılmaz — `Number("") === 0` tuzağı', () => {
    const s = summarizeFuelCost([
      { distance_km: '', estimated_cost: '', fuel_used_l: '  ' },
    ] as unknown as TripCostRow[]);
    /* Boş metin 0 sayılsaydı "0 TL harcandı" gibi YANLIŞ bir tutar çıkardı. */
    expect(s.distanceKm).toBeNull();
    expect(s.cost).toBeNull();
    expect(s.litres).toBeNull();
    expect(s.verdict).toBe('NO_COST_INPUT');
  });

  it('sayıya çevrilemeyen metin `null` verir, NaN toplamı bozmaz', () => {
    const s = summarizeFuelCost([
      { estimated_cost: 'abc', distance_km: '5' },
      { estimated_cost: '10', distance_km: '5', cost_source: 'ESTIMATED', price_source: 'API' },
    ] as unknown as TripCostRow[]);
    expect(s.cost).toBe(10);
    expect(s.distanceKm).toBe(10);
  });

  it('metin ve sayı KARIŞIK gelse de toplanır', () => {
    const s = summarizeFuelCost([
      { estimated_cost: 10, distance_km: 5, cost_source: 'ESTIMATED', price_source: 'API' },
      { estimated_cost: '20', distance_km: '5', cost_source: 'ESTIMATED', price_source: 'API' },
    ] as unknown as TripCostRow[]);
    expect(s.cost).toBe(30);
    expect(s.distanceKm).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) SAFLIK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('yakıt maliyeti › saflık', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/console/fuelCostModel.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('model saat okumaz, I/O yapmaz', () => {
    expect(src).not.toMatch(/Date\.now\(|new Date\(|fetch\(|supabase/);
  });

  it('dış bağımlılık yok', () => {
    expect([...src.matchAll(/^import .* from '([^']+)'/gm)]).toEqual([]);
  });
});
