/**
 * diagnosticVerdict.test.ts — Diagnostics V2 · PR-7 (birleşik TOP-10 verdict + old/new).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Aktif kök-neden varsa headline = en yüksek güvenli hipotez + dosya.
 *  2. SAHA DERSİ: hipotez yok + tüm hatalar önceki oturumdan → "yeni regresyon değil".
 *  3. errorFreshness (activeNowCount/previousBootCount/staleRatio/topActive) doğru.
 *  4. inconclusive verdict'e taşınır.
 */
import { describe, it, expect } from 'vitest';
import { buildDiagnosticVerdict, type TriageSections, type ErrorLedgerLike } from '../platform/diagnosticTriage';

describe('buildDiagnosticVerdict — PR-7', () => {
  it('aktif kök-neden → headline en yüksek hipotez + dosya', () => {
    const s: TriageSections = {
      transport: { reconnectAttempts: 4 },
      obdDeep: { health: { connectionQuality: 41 } },
    };
    const v = buildDiagnosticVerdict(s, null);
    expect(v.hasActiveRootCause).toBe(true);
    expect(v.headline).toMatch(/%\d+/);            // güven yüzdesi
    expect(v.headline).toMatch(/→ src\//);         // dosya işaretçisi
    expect(v.topRootCauses[0].code).toBe('TRANSPORT_RECONNECT');
  });

  it('SAHA DERSİ: hipotez yok + hatalar önceki oturumdan → "yeni regresyon değil"', () => {
    const ledger: ErrorLedgerLike = {
      activeNowCount: 0, previousBootCount: 3,
      entries: [
        { ctx: 'OBD:Reconnect', activeNow: false },
        { ctx: 'HealthMonitor:GPS', activeNow: false },
        { ctx: 'DTC:Read', activeNow: false },
      ],
    };
    const v = buildDiagnosticVerdict({}, ledger);
    expect(v.hasActiveRootCause).toBe(false);
    expect(v.headline).toMatch(/yeni regresyon değil/);
    expect(v.errorFreshness.previousBootCount).toBe(3);
    expect(v.errorFreshness.activeNowCount).toBe(0);
    expect(v.errorFreshness.staleRatio).toBe(1);
    expect(v.errorFreshness.topActive).toEqual([]);
  });

  it('aktif hata bağlamları topActive\'e yansır', () => {
    const ledger: ErrorLedgerLike = {
      activeNowCount: 2, previousBootCount: 1,
      entries: [
        { ctx: 'GPS', activeNow: true },
        { ctx: 'OBD:StartNative', activeNow: true },
        { ctx: 'OBD:Reconnect', activeNow: false },
      ],
    };
    const v = buildDiagnosticVerdict({}, ledger);
    expect(v.errorFreshness.topActive).toEqual(['GPS', 'OBD:StartNative']);
    expect(v.errorFreshness.staleRatio).toBeCloseTo(0.33, 1);
  });

  it('inconclusive verdict\'e taşınır (OBD kopuk)', () => {
    const v = buildDiagnosticVerdict({ obdDeep: { adapter: { source: 'none' } } }, null);
    expect(v.inconclusive.some((n) => n.code === 'OBD_DISCONNECTED_NO_VERIFY')).toBe(true);
    // hipotez yok + hata yok → nötr headline
    expect(v.headline).toMatch(/belirsiz|bulunamadı/);
  });
});
