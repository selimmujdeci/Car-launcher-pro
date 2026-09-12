/**
 * aiCoreVehicleMemory.test.ts — AI Core Faz-1 · Vehicle Memory (self-learning).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Pekiştirme: aynı gerçek tekrar gözlenince güven ARTAR (monoton, asla 1'e ulaşmaz).
 *  2. Ham VIN hash reddedilir (gizlilik); geçersiz girdi → hafıza yazılmaz.
 *  3. Bounded: araç başı max gerçek → en zayıf düşer; max araç → en eski araç düşer.
 *  4. Kalıcılık: safeStorage üzerinden yeniden yüklenir.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  VehicleMemoryStore, reinforceConfidence,
} from '../platform/aiCore/vehicleMemory';

const HASH_A = 'a1b2c3d4e5f6a7b8';
const HASH_B = 'ffeeddccbbaa9988';
let seq = 0;
function freshKey(): string { return `test-vmem-${seq++}`; }

describe('reinforceConfidence', () => {
  it('güven monoton artar ama tavanı aşmaz', () => {
    let c = 0.6;
    const first = reinforceConfidence(c, 0.6);
    expect(first).toBeGreaterThan(c);
    for (let i = 0; i < 100; i++) c = reinforceConfidence(c, 0.9);
    expect(c).toBeLessThanOrEqual(0.99);
    expect(c).toBeGreaterThan(0.9);
  });
});

describe('VehicleMemoryStore', () => {
  let store: VehicleMemoryStore;
  beforeEach(() => {
    store = new VehicleMemoryStore({ storageKey: freshKey() });
    store.clear();
  });

  it('yeni gerçek eklenir, tekrar gözlem PEKİŞTİRİR', () => {
    const f1 = store.remember(HASH_A, { key: 'kwp_speed_in_abs', statement: 'KWP: hız ABS ECU\'sunda', confidence: 0.6, source: 'obd' })!;
    expect(f1.observations).toBe(1);
    const f2 = store.remember(HASH_A, { key: 'kwp_speed_in_abs', statement: 'KWP: hız ABS ECU\'sunda', confidence: 0.6 })!;
    expect(f2.observations).toBe(2);
    expect(f2.confidence).toBeGreaterThan(f1.confidence);
    expect(f2.firstSeen).toBe(f1.firstSeen);   // korunur
  });

  it('ham VIN hash reddedilir + geçersiz girdi yazılmaz', () => {
    expect(store.remember('WVWZZZ1JZXW000001', { key: 'x', statement: 'y', confidence: 1 })).toBeNull();
    expect(store.remember(HASH_A, { key: '', statement: 'y', confidence: 1 })).toBeNull();
    expect(store.remember(HASH_A, { key: 'k', statement: '   ', confidence: 1 })).toBeNull();
    expect(store.vehicleCount).toBe(0);
  });

  it('recall güvene göre azalan döner', () => {
    store.remember(HASH_A, { key: 'lo', statement: 'düşük', confidence: 0.3 });
    store.remember(HASH_A, { key: 'hi', statement: 'yüksek', confidence: 0.9 });
    const facts = store.recall(HASH_A);
    expect(facts.map((f) => f.key)).toEqual(['hi', 'lo']);
  });

  it('araç başı bounded: en zayıf gerçek düşer', () => {
    const s = new VehicleMemoryStore({ storageKey: freshKey(), maxFactsPerVehicle: 2 });
    s.clear();
    s.remember(HASH_A, { key: 'weak', statement: 'zayıf', confidence: 0.2 });
    s.remember(HASH_A, { key: 'mid', statement: 'orta', confidence: 0.5 });
    s.remember(HASH_A, { key: 'strong', statement: 'güçlü', confidence: 0.8 });
    const keys = s.recall(HASH_A).map((f) => f.key).sort();
    expect(keys).toEqual(['mid', 'strong']);   // en zayıf 'weak' düştü
  });

  it('max araç bounded: en eski araç düşer', () => {
    const s = new VehicleMemoryStore({ storageKey: freshKey(), maxVehicles: 1 });
    s.clear();
    s.remember(HASH_A, { key: 'k', statement: 'a', confidence: 0.5 });
    s.remember(HASH_B, { key: 'k', statement: 'b', confidence: 0.5 });
    expect(s.vehicleCount).toBe(1);
    expect(s.recall(HASH_A)).toEqual([]);       // A düştü
    expect(s.recall(HASH_B)).toHaveLength(1);
  });

  it('forget + forgetVehicle', () => {
    store.remember(HASH_A, { key: 'k1', statement: 'a', confidence: 0.5 });
    store.remember(HASH_A, { key: 'k2', statement: 'b', confidence: 0.5 });
    expect(store.forget(HASH_A, 'k1')).toBe(true);
    expect(store.recallFact(HASH_A, 'k1')).toBeNull();
    expect(store.recall(HASH_A)).toHaveLength(1);
    expect(store.forgetVehicle(HASH_A)).toBe(true);
    expect(store.recall(HASH_A)).toEqual([]);
  });

  it('kalıcılık: aynı storageKey ile yeni örnek gerçekleri yükler', () => {
    const key = freshKey();
    const s1 = new VehicleMemoryStore({ storageKey: key });
    s1.clear();
    s1.remember(HASH_A, { key: 'persist', statement: 'kalıcı', confidence: 0.7 });
    const s2 = new VehicleMemoryStore({ storageKey: key });
    expect(s2.recallFact(HASH_A, 'persist')?.statement).toBe('kalıcı');
  });
});
