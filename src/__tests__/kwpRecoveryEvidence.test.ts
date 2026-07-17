/**
 * kwpRecoveryEvidence.test.ts — PR-KWP-EVID: native KWP kurtarma kanıtının TS aynası.
 *
 * Native tarafın kendi kilitleri KwpRecoveryEvidenceTest.java'da (5 senaryo). Burası
 * KÖPRÜ sözleşmesini kilitler: eski APK'da çökmeme, alan eşlemesi, Data Gate bildiriminin
 * ateşle-unut olması (gate yolunu BLOKLAMAMALI).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  native: true,
  evidence: null as Record<string, unknown> | null,
  shouldThrow: false,
  teardownCalls: 0,
  hasRecoveryMethod: true,
  hasTeardownMethod: true,
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => M.native } }));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    get getObdKwpRecoveryEvidence() {
      if (!M.hasRecoveryMethod) return undefined;
      return async () => {
        if (M.shouldThrow) throw new Error('köprü hatası');
        return M.evidence;
      };
    },
    get notifyObdDataGateTeardown() {
      if (!M.hasTeardownMethod) return undefined;
      return async () => { M.teardownCalls++; };
    },
  },
}));

import {
  refreshKwpRecoveryEvidence, getKwpRecoveryEvidence, notifyKwpDataGateTeardown,
  describeKwpRecovery, _internals, type KwpRecoveryStatus,
} from '../platform/obd/kwpRecoveryEvidence';

const FULL = {
  status: 'RECOVERED', coreNoDataStreak: 0, maxCoreNoDataStreak: 4,
  recoveryCount: 1, suppressedCount: 0, atpcSendFailures: 0,
  lastRecoveryAt: 1_700_000_000_000, lastRecoveryToFirstPidMs: 1_240,
  killedByDataGate: 0, protocolAtRecovery: '5', threshold: 4, maxPerSession: 3,
};

beforeEach(() => {
  M.native = true; M.evidence = { ...FULL }; M.shouldThrow = false;
  M.teardownCalls = 0; M.hasRecoveryMethod = true; M.hasTeardownMethod = true;
  _internals.setSnapshot(null);
});

describe('köprü — alan eşlemesi', () => {
  it('native kanıtı eksiksiz aynalar', async () => {
    await refreshKwpRecoveryEvidence();
    expect(getKwpRecoveryEvidence()).toEqual(FULL);
  });

  it('CAN oturumu: NOT_ATTEMPTED + sıfır sayaç (KWP yolu devrede değil)', async () => {
    M.evidence = {
      status: 'NOT_ATTEMPTED', coreNoDataStreak: 0, maxCoreNoDataStreak: 0,
      recoveryCount: 0, suppressedCount: 0, atpcSendFailures: 0,
      lastRecoveryAt: 0, lastRecoveryToFirstPidMs: -1, killedByDataGate: 0,
      protocolAtRecovery: null, threshold: 4, maxPerSession: 3,
    };
    await refreshKwpRecoveryEvidence();
    const s = getKwpRecoveryEvidence()!;
    expect(s.status).toBe('NOT_ATTEMPTED');
    expect(s.recoveryCount).toBe(0);
    expect(s.protocolAtRecovery).toBeNull();
  });

  it('Data Gate kurtarmayı yıktıysa sayaç aynalanır (saha hipotezi görünür olmalı)', async () => {
    M.evidence = { ...FULL, status: 'FAILED', killedByDataGate: 2, lastRecoveryToFirstPidMs: -1 };
    await refreshKwpRecoveryEvidence();
    const s = getKwpRecoveryEvidence()!;
    expect(s.killedByDataGate).toBe(2);
    expect(s.status).toBe('FAILED');
  });

  it('eksik alanlar güvenli varsayılana düşer (uydurma yok)', async () => {
    M.evidence = { status: 'IN_PROGRESS' };
    await refreshKwpRecoveryEvidence();
    const s = getKwpRecoveryEvidence()!;
    expect(s.recoveryCount).toBe(0);
    expect(s.lastRecoveryToFirstPidMs).toBe(-1); // "ölçülmedi" — 0 DEĞİL
    expect(s.protocolAtRecovery).toBeNull();
  });
});

describe('fail-soft — kanıt yoksa YOK de, uydurma', () => {
  it('eski APK (metod yok) → null, çökme yok', async () => {
    M.hasRecoveryMethod = false;
    await expect(refreshKwpRecoveryEvidence()).resolves.toBeUndefined();
    expect(getKwpRecoveryEvidence()).toBeNull();
  });

  it('native olmayan platform → null', async () => {
    M.native = false;
    await refreshKwpRecoveryEvidence();
    expect(getKwpRecoveryEvidence()).toBeNull();
  });

  it('köprü hatası → null (rapor "kanıt yok" der)', async () => {
    M.shouldThrow = true;
    await refreshKwpRecoveryEvidence();
    expect(getKwpRecoveryEvidence()).toBeNull();
  });
});

describe('Data Gate bildirimi — ateşle-unut, gate yolunu BLOKLAMAZ', () => {
  it('native metodu çağırır', () => {
    notifyKwpDataGateTeardown();
    expect(M.teardownCalls).toBe(1);
  });

  it('senkron döner (await YOK — gate timeout yolu beklemez)', () => {
    // Dönüş değeri void olmalı; Promise dönerse çağıran yanlışlıkla await edebilirdi.
    expect(notifyKwpDataGateTeardown()).toBeUndefined();
  });

  it('eski APK (metod yok) → sessiz no-op, çökme yok', () => {
    M.hasTeardownMethod = false;
    expect(() => notifyKwpDataGateTeardown()).not.toThrow();
    expect(M.teardownCalls).toBe(0);
  });

  it('native olmayan platformda no-op', () => {
    M.native = false;
    notifyKwpDataGateTeardown();
    expect(M.teardownCalls).toBe(0);
  });
});

describe('insan-okur özet', () => {
  it('her durumun boş olmayan açıklaması var', () => {
    const all: KwpRecoveryStatus[] = ['NOT_ATTEMPTED', 'IN_PROGRESS', 'RECOVERED', 'FAILED'];
    for (const s of all) expect(describeKwpRecovery(s).length).toBeGreaterThan(0);
  });
});
