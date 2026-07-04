/**
 * obdCoreV2.patch8.registry.test.ts — Patch 8A (StandardPidRegistry)
 *
 * SAE J1979 Tablo B.1 bilinen vektörleriyle formül kilitleri + sınır/hata davranışı.
 */
import { describe, it, expect } from 'vitest';
import {
  STANDARD_PID_MAP,
  STANDARD_PIDS,
  EXTENDED_CANDIDATE_PIDS,
  decodeStandardPid,
} from '../platform/obd/StandardPidRegistry';

describe('Patch 8A — bilinen SAE vektörleri', () => {
  it('0C RPM: (256A+B)/4 — 1A F8 → 1726 rpm', () => {
    expect(decodeStandardPid('0C', '1AF8')).toBeCloseTo(1726, 5);
  });

  it('04 motor yükü: A/2.55 — FF → 100%, 00 → 0%', () => {
    expect(decodeStandardPid('04', 'FF')).toBeCloseTo(100, 1);
    expect(decodeStandardPid('04', '00')).toBe(0);
  });

  it('06 yakıt trim: A/1.28-100 — 80 → 0%, 00 → -100%', () => {
    expect(decodeStandardPid('06', '80')).toBeCloseTo(0, 5);
    expect(decodeStandardPid('06', '00')).toBe(-100);
  });

  it('0E ateşleme avansı: A/2-64 — 80 → 0°', () => {
    expect(decodeStandardPid('0E', '80')).toBe(0);
  });

  it('10 MAF: (256A+B)/100 — 01 F4 → 5.0 g/s', () => {
    expect(decodeStandardPid('10', '01F4')).toBeCloseTo(5.0, 5);
  });

  it('14 O2 voltajı: A/200 — 96 → 0.75V (ikinci bayt yoksayılır)', () => {
    expect(decodeStandardPid('14', '96FF')).toBeCloseTo(0.75, 5);
  });

  it('24 lambda: 2AB/65536 — 80 00 → 1.0 λ', () => {
    expect(decodeStandardPid('24', '80000000')).toBeCloseTo(1.0, 5);
  });

  it('32 EVAP basıncı İŞARETLİ: FF FC → -1 Pa', () => {
    expect(decodeStandardPid('32', 'FFFC')).toBeCloseTo(-1, 5);
  });

  it('3C katalizör sıcaklığı: AB/10-40 — 0D 4C → 300.4°C', () => {
    expect(decodeStandardPid('3C', '0D4C')).toBeCloseTo(300.4, 5);
  });

  it('42 modül voltajı: AB/1000 — 39 D4 → 14.804V', () => {
    expect(decodeStandardPid('42', '39D4')).toBeCloseTo(14.804, 5);
  });

  it('5C yağ sıcaklığı: A-40 — 8C → 100°C', () => {
    expect(decodeStandardPid('5C', '8C')).toBe(100);
  });

  it('5E yakıt tüketimi: AB/20 — 00 C8 → 10 L/h', () => {
    expect(decodeStandardPid('5E', '00C8')).toBeCloseTo(10, 5);
  });

  it('62 gerçek tork: A-125 — 7D → 0%, FF → 130%', () => {
    expect(decodeStandardPid('62', '7D')).toBe(0);
    expect(decodeStandardPid('62', 'FF')).toBe(130);
  });

  it('63 referans tork: 256A+B — 01 90 → 400 Nm', () => {
    expect(decodeStandardPid('63', '0190')).toBe(400);
  });
});

describe('Patch 8A — hata/sınır davranışı', () => {
  it('tanımsız PID → NaN', () => {
    expect(decodeStandardPid('FF', '00')).toBeNaN();
    expect(decodeStandardPid('03', '0100')).toBeNaN(); // enum PID bilinçli kapsam dışı
  });

  it('eksik bayt → NaN', () => {
    expect(decodeStandardPid('0C', '1A')).toBeNaN();  // 2 bayt ister
    expect(decodeStandardPid('24', '8000')).toBeNaN(); // 4 bayt ister
  });

  it('bozuk hex → NaN', () => {
    expect(decodeStandardPid('04', 'ZZ')).toBeNaN();
  });

  it('küçük harf PID ve boşluklu hex kabul edilir', () => {
    expect(decodeStandardPid('0c', '1A F8')).toBeCloseTo(1726, 5);
  });
});

describe('Patch 8A — tablo bütünlüğü', () => {
  it('tüm kayıtlar benzersiz, 2 hane büyük-harf hex PID taşır', () => {
    const seen = new Set<string>();
    for (const d of STANDARD_PIDS) {
      expect(d.pid).toMatch(/^[0-9A-F]{2}$/);
      expect(seen.has(d.pid)).toBe(false);
      seen.add(d.pid);
    }
  });

  it('kapsam ≥ 55 PID ve harita/dizi tutarlı', () => {
    expect(STANDARD_PIDS.length).toBeGreaterThanOrEqual(55);
    expect(STANDARD_PID_MAP.size).toBe(STANDARD_PIDS.length);
  });

  it('core PID\'ler EXTENDED aday listesinde YOK (çift sorgu israfı yasak)', () => {
    for (const corePid of ['05', '0B', '0C', '0D', '0F', '11', '2F']) {
      expect(STANDARD_PID_MAP.get(corePid)?.core).toBe(true);
      expect(EXTENDED_CANDIDATE_PIDS).not.toContain(corePid);
    }
    // Adaylar arasında en bilinenler var
    expect(EXTENDED_CANDIDATE_PIDS).toContain('5C'); // yağ sıcaklığı
    expect(EXTENDED_CANDIDATE_PIDS).toContain('42'); // modül voltajı
    expect(EXTENDED_CANDIDATE_PIDS).toContain('04'); // motor yükü
  });

  it('her decode kendi min/max aralığında değer üretir (sınır dışı NaN)', () => {
    // Tüm tabloda: maksimum ham girişle decode ya aralık içi ya NaN — asla aralık dışı sayı değil.
    for (const d of STANDARD_PIDS) {
      const maxHex = 'FF'.repeat(d.bytes);
      const v = decodeStandardPid(d.pid, maxHex);
      if (!Number.isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(d.min);
        expect(v).toBeLessThanOrEqual(d.max);
      }
    }
  });
});
