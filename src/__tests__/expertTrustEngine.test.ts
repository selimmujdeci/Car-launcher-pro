// @vitest-environment node
// expertTrustSeal WebCrypto (crypto.subtle) kullanır — Node realm'de koşar (jsdom
// SubtleCrypto cross-realm buffer reddediyor, CI). localStorage: setup shim'i sağlar.
/**
 * TrustEngine + expertTrustSeal birim testleri
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    readdir:    vi.fn().mockResolvedValue({ files: [] }),
    readFile:   vi.fn().mockResolvedValue({ data: '' }),
    writeFile:  vi.fn().mockResolvedValue({}),
    deleteFile: vi.fn().mockResolvedValue({}),
    rename:     vi.fn().mockResolvedValue({}),
    stat:       vi.fn().mockResolvedValue({ size: 10 }),
  },
  Directory: { Data: 'DATA' },
  Encoding:  { UTF8: 'utf8' },
}));

import {
  computeTrustScore,
  evaluateTrust,
  isWriteLocked,
  WRITE_LOCK_THRESHOLD,
  rollbackPenaltyPoints,
} from '../platform/expert/TrustEngine';
import {
  flushSignedState,
  loadSignedState,
  EXPERT_TRUST_STORAGE_KEY,
  EXPERT_TRUST_SEED_KEY,
  canonicalStringify,
} from '../platform/expert/expertTrustSeal';
import {
  safeGetRaw,
  safeRemoveRaw,
  safeFlushAll,
} from '../utils/safeStorage';

const VALID_VIN = '1HGBH41JXMN109186';

describe('TrustEngine — skor ve yazım kilidi', () => {
  it('tam güven profili 100 skor verir', () => {
    const s = computeTrustScore({
      vin: VALID_VIN,
      ecuSupplier: 'BOSCH',
      rollbackFrequency: 0,
    });
    expect(s).toBe(100);
  });

  it('maksimum ceza 0 ile sınırlanır', () => {
    const s = computeTrustScore({
      vin: '',
      ecuSupplier: '',
      rollbackFrequency: 1,
    });
    expect(s).toBe(0);
  });

  it('rollback frekansı 1 üzeri sıkıştırılır', () => {
    const a = computeTrustScore({
      vin: VALID_VIN,
      ecuSupplier: 'BOSCH',
      rollbackFrequency: 2,
    });
    const b = computeTrustScore({
      vin: VALID_VIN,
      ecuSupplier: 'BOSCH',
      rollbackFrequency: 1,
    });
    expect(a).toBe(b);
  });

  it('rollbackPenaltyPoints negatif girdiyi 0 kabul eder', () => {
    expect(rollbackPenaltyPoints(-1)).toBe(0);
  });

  it('skor 69 → yazım kilitli; 70 → açık', () => {
    const s69 = computeTrustScore({
      vin: VALID_VIN,
      ecuSupplier: 'BOSCH',
      rollbackFrequency: 0.62,
    });
    expect(s69).toBe(69);
    expect(isWriteLocked(s69)).toBe(true);

    const s70 = computeTrustScore({
      vin: VALID_VIN,
      ecuSupplier: 'BOSCH',
      rollbackFrequency: 0.6,
    });
    expect(s70).toBe(70);
    expect(isWriteLocked(s70)).toBe(false);
  });

  it('evaluateTrust eşik WRITE_LOCK_THRESHOLD ile uyumlu', () => {
    expect(WRITE_LOCK_THRESHOLD).toBe(70);
    const edge = evaluateTrust({
      vin: VALID_VIN,
      ecuSupplier: 'BOSCH',
      rollbackFrequency: 0.6,
    });
    expect(edge.score).toBe(70);
    expect(edge.writeLocked).toBe(false);
  });
});

describe('expertTrustSeal — mühür ve okuma', () => {
  beforeEach(() => {
    safeRemoveRaw(EXPERT_TRUST_STORAGE_KEY);
    safeRemoveRaw(EXPERT_TRUST_SEED_KEY);
  });

  afterEach(() => {
    safeFlushAll();
    safeRemoveRaw(EXPERT_TRUST_STORAGE_KEY);
    safeRemoveRaw(EXPERT_TRUST_SEED_KEY);
    try {
      localStorage.clear();
    } catch { /* ignore */ }
  });

  it('round-trip: yazılan gövde imzadan sonra aynen okunur', async () => {
    const body = {
      schemaVersion: 1 as const,
      vin: VALID_VIN,
      ecuSupplier: 'CONTINENTAL',
      rollbackNumerator: 3,
      rollbackDenominator: 1000,
    };
    await flushSignedState(body);
    const read = await loadSignedState();
    expect(read).toEqual(body);
  });

  it('sigHex bozulunca loadSignedState null döner', async () => {
    const body = {
      schemaVersion: 1 as const,
      vin: VALID_VIN,
      ecuSupplier: 'DENSO',
      rollbackNumerator: 0,
      rollbackDenominator: 500,
    };
    await flushSignedState(body);
    const raw = safeGetRaw(EXPERT_TRUST_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const env = JSON.parse(raw!) as { sigHex: string };
    env.sigHex = `${env.sigHex.slice(0, -4)}dead`;
    localStorage.setItem(EXPERT_TRUST_STORAGE_KEY, JSON.stringify(env));
    const read = await loadSignedState();
    expect(read).toBeNull();
  });

  it('canonicalStringify anahtar sırasından bağımsızdır', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});
