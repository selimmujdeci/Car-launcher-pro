/**
 * aiCoreEvidenceStore.test.ts — AI Core Faz-1 · Evidence Store.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. "0 ≠ no-data": no_data/unsupported sinyal KANIT DEĞİL (signalToEvidence null).
 *  2. Dedup: aynı anahtar → en TAZE gözlem kalır (eski gözlem yükseltmez).
 *  3. Bounded: taşınca en ESKİ gözlemli kanıt düşer.
 *  4. Query güvene göre azalan sıralar; PII sanitize edilir.
 */
import { describe, it, expect } from 'vitest';
import {
  EvidenceStore, createEvidenceStore, makeEvidence, signalToEvidence, dtcToEvidence,
} from '../platform/aiCore/evidenceStore';
import type { SignalEnvelope } from '../platform/obd/signalEnvelope';

function sig(partial: Partial<SignalEnvelope>): SignalEnvelope {
  return {
    value: 90, state: 'valid', confidence: 1, source: 'obd', updatedAt: 1000, ageMs: 0, unit: '°C',
    ...partial,
  };
}

describe('signalToEvidence — "0 ≠ no-data"', () => {
  it('no_data → kanıt DEĞİL', () => {
    expect(signalToEvidence('coolant', sig({ value: null, state: 'no_data' }))).toBeNull();
    expect(signalToEvidence('coolant', sig({ value: null, state: 'unsupported' }))).toBeNull();
  });

  it('gerçek sıfır (valid) → KANITTIR', () => {
    const ev = signalToEvidence('speed', sig({ value: 0, state: 'valid', unit: 'km/h' }), 'Hız');
    expect(ev).not.toBeNull();
    expect(ev!.key).toBe('signal.speed');
    expect(ev!.summary).toContain('Hız=0');
  });

  it('confidence envelope\'tan gelir', () => {
    const ev = signalToEvidence('coolant', sig({ confidence: 0.4, state: 'stale' }));
    expect(ev!.confidence).toBe(0.4);
  });
});

describe('dtcToEvidence', () => {
  it('critical DTC yüksek güven', () => {
    const ev = dtcToEvidence('P0128', 'critical', 5000);
    expect(ev!.key).toBe('dtc.P0128');
    expect(ev!.confidence).toBe(0.95);
    expect(ev!.kind).toBe('dtc');
  });
  it('boş kod → null', () => {
    expect(dtcToEvidence('', 'critical', 0)).toBeNull();
  });
});

describe('makeEvidence — sanitize', () => {
  it('VIN/koordinat summary\'den temizlenir', () => {
    const ev = makeEvidence({
      key: 'x', kind: 'derived', summary: 'araç WVWZZZ1JZXW000001 konum 41.0082,28.9784',
      confidence: 0.5, observedAt: 1, source: 'test',
    });
    expect(ev!.summary).not.toMatch(/WVWZZZ1JZXW000001/);
    expect(ev!.summary).toContain('[redacted]');
  });
  it('boş özet → null (sahte kanıt yok)', () => {
    expect(makeEvidence({ key: 'x', kind: 'derived', summary: '   ', confidence: 1, observedAt: 1, source: 't' })).toBeNull();
  });
});

describe('EvidenceStore — dedup + bounded', () => {
  it('aynı anahtar → en taze gözlem kalır', () => {
    const store = createEvidenceStore();
    store.ingest(makeEvidence({ key: 'signal.coolant', kind: 'signal', summary: 'eski', confidence: 0.9, observedAt: 100, source: 'obd' }));
    store.ingest(makeEvidence({ key: 'signal.coolant', kind: 'signal', summary: 'yeni', confidence: 0.5, observedAt: 200, source: 'obd' }));
    expect(store.size).toBe(1);
    expect(store.getByKey('signal.coolant')!.summary).toBe('yeni'); // taze kazanır (güven düşse de)
  });

  it('eski gözlem taze olanı yükseltmez', () => {
    const store = createEvidenceStore();
    store.ingest(makeEvidence({ key: 'k', kind: 'signal', summary: 'taze', confidence: 0.5, observedAt: 200, source: 'obd' }));
    const accepted = store.ingest(makeEvidence({ key: 'k', kind: 'signal', summary: 'bayat', confidence: 0.9, observedAt: 100, source: 'obd' }));
    expect(accepted).toBe(false);
    expect(store.getByKey('k')!.summary).toBe('taze');
  });

  it('bounded: taşınca en eski gözlemli düşer', () => {
    const store = new EvidenceStore({ maxItems: 2 });
    store.ingest(makeEvidence({ key: 'a', kind: 'signal', summary: 'a', confidence: 1, observedAt: 100, source: 'obd' }));
    store.ingest(makeEvidence({ key: 'b', kind: 'signal', summary: 'b', confidence: 1, observedAt: 200, source: 'obd' }));
    store.ingest(makeEvidence({ key: 'c', kind: 'signal', summary: 'c', confidence: 1, observedAt: 300, source: 'obd' }));
    expect(store.size).toBe(2);
    expect(store.getByKey('a')).toBeNull(); // en eski (100) düştü
    expect(store.getByKey('c')).not.toBeNull();
  });

  it('query güvene göre azalan + filtre', () => {
    const store = createEvidenceStore();
    store.ingest(dtcToEvidence('P0128', 'critical', 10));
    store.ingest(signalToEvidence('coolant', sig({ confidence: 0.6 })));
    const all = store.query();
    expect(all[0].kind).toBe('dtc'); // 0.95 > 0.6
    expect(store.query({ kind: 'dtc' })).toHaveLength(1);
    expect(store.query({ minConfidence: 0.9 })).toHaveLength(1);
    expect(store.query({ keyPrefix: 'signal.' })).toHaveLength(1);
  });

  it('pruneStale eski kanıtı temizler', () => {
    let t = 10_000;
    const store = createEvidenceStore({ now: () => t });
    store.ingest(makeEvidence({ key: 'old', kind: 'signal', summary: 'o', confidence: 1, observedAt: 1000, source: 'obd' }));
    store.ingest(makeEvidence({ key: 'new', kind: 'signal', summary: 'n', confidence: 1, observedAt: 9500, source: 'obd' }));
    const removed = store.pruneStale(2000); // cutoff = 8000
    expect(removed).toBe(1);
    expect(store.getByKey('old')).toBeNull();
    expect(store.getByKey('new')).not.toBeNull();
  });
});
