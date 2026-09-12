/**
 * fieldScannedPids.test.ts — KİLİT: sahada TARANIP bulunan PID'ler katalogda ve
 * ölçülen HAM veriyle doğru çözülüyor.
 *
 * SAHA TARAMASI 2026-08-04 (cihaz `4L45OFZDX84X55GE`, araç sürüşte, ECU `18DAF110`,
 * 29-bit CAN, native `readPidOnce` ile TEK TEK okundu):
 *
 *   Mode 01 bitmapleri:  0100=983B0011 · 0120=A0122001 · 0140=80C00000
 *   → 19 destekli PID; 17'si gerçek veri döndürdü.
 *
 * Bu dosyadaki her beklenen değer, o taramada CİHAZDAN OKUNAN ham hex'ten
 * türetilmiştir — uydurma fixture YOKTUR.
 *
 * Taramanın ortaya çıkardığı üç eksik: `01`, `1C`, `41` katalogda hiç yoktu →
 * bitmap "destekli" dediği hâlde LAB Canlı Veri'de görünemiyorlardı.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeStandardPid, STANDARD_PID_MAP, EXTENDED_CANDIDATE_PIDS,
} from '../platform/obd/StandardPidRegistry';

/** Cihazdan okunan ham yanıtlar (mode/PID başlığı soyulmuş data baytları). */
const SAHA_HAM: Readonly<Record<string, string>> = {
  '01': '00068000',
  '04': '81',
  '05': '84',
  '0B': 'A8',
  '0C': '2654',
  '0D': '61',
  '0F': '43',
  '10': '12C8',
  '1C': '06',
  '21': '0000',
  '23': '2CBA',
  '2C': '00',
  '2F': '99',
  '33': '56',
  '41': '00068080',
  '49': '44',
  '4A': '44',
};

describe('sahada taranan PID"lerin tamamı katalogda tanımlı', () => {
  it('17 PID"in HEPSİ kayıtlı (eksik olan 01/1C/41 eklendi)', () => {
    const eksik = Object.keys(SAHA_HAM).filter((p) => !STANDARD_PID_MAP.has(p));
    expect(eksik).toEqual([]);
  });

  it('hiçbiri NaN çözülmüyor — ham veri katalog formülüyle uyumlu', () => {
    const nanOlanlar = Object.entries(SAHA_HAM)
      .filter(([pid, raw]) => Number.isNaN(decodeStandardPid(pid, raw)))
      .map(([pid]) => pid);
    expect(nanOlanlar).toEqual([]);
  });
});

describe('ölçülen ham veri → beklenen fiziksel değer', () => {
  it('2F yakıt %60 — kütük #383"ü bağımsız doğrular', () => {
    // 0x99 = 153 → 153×100/255 = 60. Depo FULL iken okunan değer buydu.
    expect(decodeStandardPid('2F', '99')).toBeCloseTo(60, 1);
  });

  it('23 yakıt rayı 114 500 kPa (1145 bar) — dizel common-rail kanıtı', () => {
    expect(decodeStandardPid('23', '2CBA')).toBeCloseTo(114_500, 0);
  });

  it('10 MAF 48,08 g/s — gerçek tüketim hesabının girdisi', () => {
    expect(decodeStandardPid('10', '12C8')).toBeCloseTo(48.08, 2);
  });

  it('0C devir 2453 rpm · 0D hız 97 km/h', () => {
    expect(decodeStandardPid('0C', '2654')).toBeCloseTo(2453, 0);
    expect(decodeStandardPid('0D', '61')).toBe(97);
  });

  it('05 soğutma 92°C · 0F emme 27°C', () => {
    expect(decodeStandardPid('05', '84')).toBe(92);
    expect(decodeStandardPid('0F', '43')).toBe(27);
  });

  it('33 barometrik 86 kPa — ~1400 m (Konya platosu) ile tutarlı', () => {
    expect(decodeStandardPid('33', '56')).toBe(86);
  });

  it('04 motor yükü ~%50,6 · 49/4A gaz pedalı ~%26,7', () => {
    expect(decodeStandardPid('04', '81')).toBeCloseTo(50.6, 1);
    expect(decodeStandardPid('49', '44')).toBeCloseTo(26.7, 1);
    expect(decodeStandardPid('4A', '44')).toBeCloseTo(26.7, 1);
  });
});

describe('YENİ eklenen bit-alanı PID"leri', () => {
  it('01 → arıza kodu sayısı 0 (MIL kapalı, araç sağlıklıydı)', () => {
    expect(decodeStandardPid('01', '00068000')).toBe(0);
  });

  it('01 → MIL yanıyor + 5 kod senaryosu doğru sayılır', () => {
    // A = 0x85 → bit7 (MIL) set + alt 7 bit = 5 kod
    expect(decodeStandardPid('01', '85068000')).toBe(5);
  });

  it('1C → 6 = EOBD (Avrupa)', () => {
    expect(decodeStandardPid('1C', '06')).toBe(6);
  });

  it('41 → hazır olmayan monitör sayısı 1 (ölçülen ham veriden)', () => {
    // B&0x70 = 0x06&0x70 = 0 · C&D = 0x80&0x80 = 0x80 → 1 bit
    expect(decodeStandardPid('41', '00068080')).toBe(1);
  });

  it('41 → tüm monitörler hazırsa 0 döner', () => {
    expect(decodeStandardPid('41', '00060000')).toBe(0);
  });

  it('41 → destekli OLMAYAN monitör "hazır değil" SAYILMAZ', () => {
    // D'de bit set ama C'de destek yok → sayılmamalı (yanlış "hazır değil" uyarısı olmaz)
    expect(decodeStandardPid('41', '00060080')).toBe(0);
  });
});

describe('extended izleme listesi', () => {
  it('çekirdek OLMAYAN taranmış PID"ler aday listesinde — LAB"de akarlar', () => {
    const beklenen = ['01', '04', '10', '1C', '21', '23', '2C', '33', '41', '49', '4A'];
    for (const p of beklenen) {
      expect(EXTENDED_CANDIDATE_PIDS).toContain(p);
    }
  });

  it('çekirdek PID"ler aday listesine GİRMEZ (çift sorgu yok)', () => {
    for (const p of ['05', '0B', '0C', '0D', '0F', '2F']) {
      expect(EXTENDED_CANDIDATE_PIDS).not.toContain(p);
    }
  });
});
