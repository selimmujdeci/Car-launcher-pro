/**
 * OBD-OS-F1-4 — Tarama Kapsamı (Scan Completeness) modeli.
 *
 * KABUL KRİTERİ (roadmap): "kısmi taramada coverage < 1 raporlanır".
 *
 * DÜRÜST COVERAGE: 'unsupported' bir kapsam kaybı DEĞİLDİR (araçta o mod YOK — okunamayan
 * değil, var olmayan şey) → paydaya girmez. Aksi halde 2005 model bir araçta Mode 0A
 * yüzünden coverage sonsuza dek <1 kalır ve rozet gürültüye dönüşür.
 */
import { describe, it, expect } from 'vitest';
import { buildScanReport } from '../platform/obd/scanReport';

describe('OBD-OS-F1-4 — buildScanReport', () => {
  it('🔒 KİLİT: bir mod DÜŞTÜYSE coverage < 1 (kısmi tarama sessiz kalmaz)', () => {
    const r = buildScanReport({ stored: 'ok', pending: 'failed', permanent: 'ok', status: 'ok' });
    expect(r.coverage).toBeLessThan(1);
    expect(r.complete).toBe(false);
    expect(r.failedCount).toBe(1);
    expect(r.summary).toMatch(/Kısmi tarama/);
    expect(r.summary).toMatch(/Bekleyen kodlar/);   // NEYİN eksik olduğu AÇIKÇA yazılır
  });

  it('tüm modlar okundu → coverage 1, complete', () => {
    const r = buildScanReport({ stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok' });
    expect(r.coverage).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.failedCount).toBe(0);
  });

  it('🔒 KİLİT: unsupported coverage’ı DÜŞÜRMEZ (araçta olmayan mod kapsam kaybı değil)', () => {
    // 2010 öncesi tipik araç: Mode 0A (kalıcı kod) YOK.
    const r = buildScanReport({ stored: 'ok', pending: 'ok', permanent: 'unsupported', status: 'ok' });
    expect(r.coverage).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.unsupportedCount).toBe(1);
    expect(r.summary).toMatch(/desteklemiyor/);   // ama kullanıcıya SÖYLENİR
  });

  it('unsupported + failed birlikte → coverage yalnız failed’den düşer', () => {
    const r = buildScanReport({ stored: 'ok', pending: 'failed', permanent: 'unsupported', status: 'ok' });
    expect(r.coverage).toBeCloseTo(2 / 3, 5);   // ok=2, failed=1 → 2/3; unsupported paydada YOK
    expect(r.unsupportedCount).toBe(1);
    expect(r.failedCount).toBe(1);
  });

  it('hiç tarama yapılmadı → coverage 0, "Tarama yapılmadı"', () => {
    const r = buildScanReport({});
    expect(r.coverage).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.summary).toMatch(/Tarama yapılmadı/);
  });

  it('hepsi düştü → coverage 0 ama complete DEĞİL (sıfır kanıt ≠ temiz)', () => {
    const r = buildScanReport({ stored: 'failed', pending: 'failed', permanent: 'failed', status: 'failed' });
    expect(r.coverage).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.failedCount).toBe(4);
  });

  it('rozet için tüm modlar etiketli döner (UI tek kaynaktan besleniyor)', () => {
    const r = buildScanReport({ stored: 'ok', pending: 'failed', permanent: 'unsupported', status: 'ok' });
    expect(r.modes).toHaveLength(4);
    expect(r.modes.map((m) => m.mode)).toEqual(['stored', 'pending', 'permanent', 'status']);
    expect(r.modes.every((m) => m.label.length > 0)).toBe(true);
  });
});
