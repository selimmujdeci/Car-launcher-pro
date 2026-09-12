/**
 * obdHypotheses.test.ts — Diagnostics V2 · PR-6 (OBD çok-hipotez kök-neden analizörü).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. handshake AŞAMA kanıtından RAKİP AĞIRLIKLI hipotezler üretir.
 *  2. VİZYONUN TAM ÖRNEĞİ: handshake ok + bitmap ok + VIN timeout → "Mode09 zinciri"
 *     en yüksek güvenli hipotez, codePointer parseVIN.
 *  3. not_supported → native performHandshake eksik (critical, CarLauncherPlugin).
 *  4. Hiç bağlanmadıysa (source:none) OBD hipotezi YOK (INCONCLUSIVE devrede).
 *  5. Sağlıklı handshake → hipotez yok.
 */
import { describe, it, expect } from 'vitest';
import { buildRootCauseSnapshot, type TriageSections } from '../platform/diagnosticTriage';

const conn = { source: 'ble', connectionState: 'connected', lastSeenMs: 1765000000000 };

describe('OBD çok-hipotez analizörü — PR-6', () => {
  it('VİZYON: handshake ok + bitmap ok + VIN timeout → Mode09 zinciri en yüksek', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: {
        outcome: 'ok', bitmapClass: 'ok', vinClass: 'timeout', vinPresent: false, supportedCount: 12,
      } },
    };
    const rc = buildRootCauseSnapshot(s);
    const vinFail = rc.hypotheses.find((h) => h.code === 'OBD_HS_VIN_FAIL');
    const vinUnsup = rc.hypotheses.find((h) => h.code === 'OBD_HS_VIN_UNSUPPORTED');
    expect(vinFail).toBeDefined();
    expect(vinUnsup).toBeDefined();
    expect(vinFail!.confidence).toBeGreaterThan(vinUnsup!.confidence);   // 70 > 25
    expect(vinFail!.codePointer!.symbol).toBe('parseVIN');
    expect(vinFail!.analysis).toMatch(/Mode09/);
  });

  it('not_supported → native performHandshake eksik (critical, CarLauncherPlugin)', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: { outcome: 'not_supported', supportedCount: 0 } },
    };
    const h = buildRootCauseSnapshot(s).hypotheses.find((x) => x.code === 'OBD_HS_NATIVE_MISSING');
    expect(h).toBeDefined();
    expect(h!.severity).toBe('critical');
    expect(h!.confidence).toBe(90);
    expect(h!.codePointer!.file).toMatch(/CarLauncherPlugin\.java$/);
  });

  it('fail(timeout) → rakip hipotezler güven toplamı ~100, transport en yüksek (protokol izi YOK)', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: { outcome: 'fail', failReason: 'timeout', supportedCount: 0 } },
    };
    const hs = buildRootCauseSnapshot(s).hypotheses.filter((h) => h.code.startsWith('OBD_HS_FAIL'));
    expect(hs.length).toBe(3);
    const sum = hs.reduce((a, h) => a + h.confidence, 0);
    expect(sum).toBeGreaterThanOrEqual(95);
    expect(sum).toBeLessThanOrEqual(105);
    expect(hs[0].code).toBe('OBD_HS_FAIL_TRANSPORT');
  });

  // PR-1a: protokol-uyuşmazlığı — dongle başka araçtan geldi (Doblo→Trafic canlı senaryo).
  it('PR-1a: protocolTried set + protocolActive yok → PROTOCOL_MISMATCH en yüksek, güven timeout sayısından türer', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: {
        outcome: 'fail', failReason: 'timeout', timeoutStage: 'connect',
        protocolTried: '7', protocolActive: null,
        reconnectHistory: [{ ts: 1, reason: 'timeout' }, { ts: 2, reason: 'timeout' }],
      } },
    };
    const all = buildRootCauseSnapshot(s).hypotheses;
    const mm = all.find((h) => h.code === 'OBD_HS_PROTOCOL_MISMATCH');
    expect(mm).toBeDefined();
    expect(mm!.confidence).toBe(84);                    // 72 + 2×6 (kanıttan türedi)
    expect(mm!.codePointer!.symbol).toBe('performHandshake');
    expect(mm!.evidence.join(' ')).toMatch(/protocolTried=7/);
    // En yüksek güvenli hipotez mismatch olmalı
    expect(all[0].code).toBe('OBD_HS_PROTOCOL_MISMATCH');
    // Geriye uyum: klasik FAIL_UNSUPPORTED/PROTOCOL üçlüsü BU dalda üretilmez
    expect(all.some((h) => h.code === 'OBD_HS_FAIL_UNSUPPORTED')).toBe(false);
  });

  it('PR-1a: protocolTried set AMA protocolActive de set (uyuştu) → mismatch YOK', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: {
        outcome: 'fail', failReason: 'timeout', protocolTried: '6', protocolActive: '6',
      } },
    };
    const all = buildRootCauseSnapshot(s).hypotheses;
    expect(all.some((h) => h.code === 'OBD_HS_PROTOCOL_MISMATCH')).toBe(false);
    expect(all.some((h) => h.code === 'OBD_HS_FAIL_TRANSPORT')).toBe(true);   // klasik dala düşer
  });

  it('bitmap alınamadı → Mode01 zinciri hipotezi', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: { outcome: 'ok', bitmapClass: 'no_data', vinClass: 'ok', supportedCount: 0 } },
    };
    const h = buildRootCauseSnapshot(s).hypotheses.find((x) => x.code === 'OBD_HS_BITMAP_FAIL');
    expect(h).toBeDefined();
    expect(h!.codePointer!.symbol).toBe('parseSupportedPIDs');
  });

  it('hiç bağlanmadı (source:none) → OBD handshake hipotezi YOK', () => {
    const s: TriageSections = {
      obdDeep: { adapter: { source: 'none' }, handshake: { outcome: 'fail', failReason: 'timeout' } },
    };
    const hs = buildRootCauseSnapshot(s).hypotheses.filter((h) => h.code.startsWith('OBD_HS_'));
    expect(hs).toEqual([]);
  });

  it('sağlıklı handshake (ok+ok+VIN var+PID>0) → hipotez yok', () => {
    const s: TriageSections = {
      obdDeep: { adapter: conn, handshake: {
        outcome: 'ok', bitmapClass: 'ok', vinClass: 'ok', vinPresent: true, supportedCount: 20,
      } },
    };
    const hs = buildRootCauseSnapshot(s).hypotheses.filter((h) => h.code.startsWith('OBD_HS_'));
    expect(hs).toEqual([]);
  });
});
