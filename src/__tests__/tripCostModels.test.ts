/**
 * tripCostModels.test.ts — TRIP-COST-A1 Faz A.
 *
 * `makeCostItem`/`normalizeCostItem` — TEK merkezi CostItem doğrulayıcısı.
 * Kapsam: value=null yalnız unknown · known finite>=0 · sıfır geçerli ·
 * negatif reddi · NaN/Infinity reddi · confidence 0..1 · source/editable
 * korunur · unknown confidence 0'a normalize.
 */
import { describe, it, expect } from 'vitest';
import { makeCostItem, normalizeCostItem, type CostItemInput } from '../platform/trip/cost/models';

function baseInput(overrides: Partial<CostItemInput> = {}): CostItemInput {
  return {
    id:         'fuel',
    category:   'fuel',
    value:      1000,
    currency:   'TRY',
    source:     'calculated',
    confidence: 0.7,
    editable:   true,
    ...overrides,
  };
}

describe('makeCostItem — value/status sözleşmesi', () => {
  it('C) sıfır değer GEÇERLİ — parking=0, source=user → known (unknown DEĞİL)', () => {
    const item = makeCostItem(baseInput({ id: 'parking', category: 'parking', value: 0, source: 'user', confidence: 1 }));
    expect(item.status).toBe('known');
    expect(item.value).toBe(0);
    expect(item.source).toBe('user');
  });

  it('value=null + status verilmezse → otomatik unknown', () => {
    const item = makeCostItem(baseInput({ value: null, confidence: 0.5 }));
    expect(item.status).toBe('unknown');
    expect(item.value).toBeNull();
  });

  it('value=null + status:"known" açıkça verilirse → REDDEDİLİR (throw)', () => {
    expect(() => makeCostItem(baseInput({ value: null, status: 'known' }))).toThrow();
  });

  it('status:"unknown" + value dolu verilirse → REDDEDİLİR (çelişkili girdi)', () => {
    expect(() => makeCostItem(baseInput({ value: 500, status: 'unknown' }))).toThrow();
  });

  it('status:"stale" + value dolu → kabul edilir, toplamda tutulacak şekilde işaretlenir', () => {
    const item = makeCostItem(baseInput({ value: 250, status: 'stale', source: 'cached', confidence: 0.4 }));
    expect(item.status).toBe('stale');
    expect(item.value).toBe(250);
  });
});

describe('makeCostItem — D/E) negatif ve NaN/Infinity reddi', () => {
  it('negatif value → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ value: -1 }))).toThrow();
  });

  it('NaN value → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ value: NaN }))).toThrow();
  });

  it('Infinity value → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ value: Infinity }))).toThrow();
  });

  it('-Infinity value → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ value: -Infinity }))).toThrow();
  });
});

describe('makeCostItem — F) confidence 0..1 dışı reddi', () => {
  it('confidence > 1 → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ confidence: 1.01 }))).toThrow();
  });

  it('confidence < 0 → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ confidence: -0.01 }))).toThrow();
  });

  it('confidence NaN → REDDEDİLİR', () => {
    expect(() => makeCostItem(baseInput({ confidence: NaN }))).toThrow();
  });

  it('confidence tam 0 ve tam 1 → İKİSİ DE geçerli (sınır dahil)', () => {
    expect(() => makeCostItem(baseInput({ confidence: 0 }))).not.toThrow();
    expect(() => makeCostItem(baseInput({ confidence: 1 }))).not.toThrow();
  });

  it('unknown kalemin confidence\'ı girdiden BAĞIMSIZ 0\'a normalize edilir', () => {
    // confidence alanı input tipinde yok (unknown zaten value:null ile tetiklenir);
    // burada normalize kuralını value=null yoluyla doğruluyoruz.
    const item = makeCostItem(baseInput({ value: null, confidence: 0.9 }));
    expect(item.confidence).toBe(0);
  });
});

describe('makeCostItem — G/H) source ve editable KORUNUR', () => {
  it('source=user aynen korunur', () => {
    const item = makeCostItem(baseInput({ source: 'user' }));
    expect(item.source).toBe('user');
  });

  it('source=osm aynen korunur', () => {
    const item = makeCostItem(baseInput({ source: 'osm' }));
    expect(item.source).toBe('osm');
  });

  it('editable=false aynen korunur', () => {
    const item = makeCostItem(baseInput({ editable: false }));
    expect(item.editable).toBe(false);
  });

  it('editable=true aynen korunur', () => {
    const item = makeCostItem(baseInput({ editable: true }));
    expect(item.editable).toBe(true);
  });

  it('breakdown ve noteKey aynen taşınır', () => {
    const item = makeCostItem(baseInput({ breakdown: { a: 1 }, noteKey: 'test_key' }));
    expect(item.breakdown).toEqual({ a: 1 });
    expect(item.noteKey).toBe('test_key');
  });
});

describe('normalizeCostItem — makeCostItem ile BİREBİR aynı davranış (alias)', () => {
  it('normalizeCostItem === makeCostItem (aynı fonksiyon referansı)', () => {
    expect(normalizeCostItem).toBe(makeCostItem);
  });

  it('normalizeCostItem geçerli girdide aynı sonucu üretir', () => {
    const a = makeCostItem(baseInput());
    const b = normalizeCostItem(baseInput());
    expect(a).toEqual(b);
  });

  it('normalizeCostItem geçersiz girdide aynı şekilde throw eder', () => {
    expect(() => normalizeCostItem(baseInput({ value: -5 }))).toThrow();
  });
});

describe('makeCostItem — saflık (immutability niyeti)', () => {
  it('girdi objesi mutasyona uğratılmaz', () => {
    const input = baseInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    makeCostItem(input);
    expect(input).toEqual(snapshot);
  });

  it('her çağrı YENİ bir obje döner (aynı referans DEĞİL)', () => {
    const input = baseInput();
    const a = makeCostItem(input);
    const b = makeCostItem(input);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
