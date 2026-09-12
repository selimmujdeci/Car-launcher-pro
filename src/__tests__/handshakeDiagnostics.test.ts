/**
 * handshakeDiagnostics.test.ts — Diagnostics V2 · PR-5a (OBD handshake AŞAMA kanıtı).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. getHandshakeDiagnostics() non-PII aşama kanıtı döner (outcome/vinClass/bitmapClass/
 *     readBlocks/supportedCount) — HAM VIN ASLA yok (yalnız sınıf + vinPresent bayrağı).
 *  2. Varsayılan (handshake koşmadan): outcome 'not_run', güvenli boş değerler.
 *  3. Dönen kopya izole (readBlocks referansı paylaşılmaz).
 *
 * NOT: gerçek handshake sonucu native+araç ister (PR-5b, cihaz-gated). Bu test
 * yalnız JS SÖZLEŞMESİNİ ve non-PII güvencesini kilitler.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {}, isNative: () => false }));

import { getHandshakeDiagnostics, type HandshakeDiagnostics } from '../platform/obdService';

describe('getHandshakeDiagnostics — PR-5a', () => {
  it('varsayılan: outcome not_run + güvenli boş değerler', () => {
    const d = getHandshakeDiagnostics();
    expect(d.outcome).toBe('not_run');
    expect(d.vinPresent).toBe(false);
    expect(d.supportedCount).toBe(0);
    expect(Array.isArray(d.readBlocks)).toBe(true);
  });

  it('non-PII: HAM VIN alanı YOK — yalnız sınıf + present bayrağı', () => {
    const d = getHandshakeDiagnostics() as HandshakeDiagnostics & Record<string, unknown>;
    // 'vin' adında ham değer taşıyan alan olmamalı; yalnız vinClass + vinPresent.
    expect('vin' in d).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(d, 'vinClass')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(d, 'vinPresent')).toBe(true);
    // Serileştirilmiş halde ham VIN token'ı (17 karakter) sızmasın.
    const flat = JSON.stringify(d);
    expect(flat).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/);
  });

  it('dönen kopya izole (readBlocks referansı paylaşılmaz)', () => {
    const a = getHandshakeDiagnostics();
    a.readBlocks.push('deadbeef');
    const b = getHandshakeDiagnostics();
    expect(b.readBlocks).not.toContain('deadbeef');
  });

  /* ── PR-1a: yaşam-döngüsü kanıtı (bounded, non-PII) ── */
  it('PR-1a alanları mevcut + güvenli varsayılan', () => {
    const d = getHandshakeDiagnostics() as HandshakeDiagnostics & Record<string, unknown>;
    for (const k of ['timeoutStage', 'durationMs', 'protocolTried', 'protocolActive',
      'lastSuccessAt', 'reconnectReason', 'reconnectHistory']) {
      expect(Object.prototype.hasOwnProperty.call(d, k)).toBe(true);
    }
    expect(d.timeoutStage).toBeNull();
    expect(d.protocolTried).toBeNull();
    expect(Array.isArray(d.reconnectHistory)).toBe(true);
  });

  it('reconnectHistory dönen kopya izole (mutasyon sızmaz)', () => {
    const a = getHandshakeDiagnostics();
    a.reconnectHistory.push({ ts: 1, reason: 'timeout' });
    const b = getHandshakeDiagnostics();
    expect(b.reconnectHistory).toHaveLength(0);
  });

  it('non-PII: PR-1a alanları yalnız enum/sayı/timestamp — ham çerçeve/PID yok', () => {
    const flat = JSON.stringify(getHandshakeDiagnostics());
    // Ham CAN/OBD frame işareti (uzun hex dizisi) veya koordinat sızmamalı.
    expect(flat).not.toMatch(/[0-9A-Fa-f]{20,}/);
  });
});
