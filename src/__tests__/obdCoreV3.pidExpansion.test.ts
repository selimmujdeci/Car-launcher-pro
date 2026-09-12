/**
 * obdCoreV3.pidExpansion.test.ts — SAHA KARŞILAŞTIRMASINDAN doğan standart PID genişlemesi.
 *
 * NEDEN VAR (kütük #681): gerçek araçta (Renault, benzinli) üçüncü-taraf bir teşhis
 * uygulaması 36 standart PID okurken Canlı Test paneli 28 gösteriyordu. Denetim, farkın
 * bir okuma/decode kusuru DEĞİL **tanım yokluğu** olduğunu ölçtü — eksik PID'ler kayıtta
 * hiç bulunmadığı için ekranda "YOK" bile yazmıyor, satır olarak mevcut değillerdi.
 *
 * Kilitlenen davranışlar:
 *  1. Registry 16 yeni PID kazandı ve HİÇBİR tekrar üretmedi.
 *  2. Her yeni PID, J1979 Tablo B.1 formülüyle BİLİNEN ham baytlardan doğru değeri çözer.
 *  3. 0x34-0x3B ailesi lambda DEĞİL **akım** çözer — 0x24-0x2B ile aynı sayıyı iki isimle
 *     göstermek tekrar olurdu; iki aile AYRI bilgi taşımalı.
 *  4. Hot-poll (core) kümesi DEĞİŞMEDİ — yeni PID'lerin hiçbiri core değil.
 *  5. Bit/enum durum PID'leri (0x03/0x13/0x1D…) BİLİNÇLİ olarak DIŞARIDA kaldı: bu kaydın
 *     sözleşmesi "ham baytlar → fiziksel sayı"dır, bitmask'e birim vermek uydurma olurdu.
 */
import { describe, it, expect } from 'vitest';
import {
  STANDARD_PID_MAP,
  STANDARD_PIDS,
  EXTENDED_CANDIDATE_PIDS,
  decodeStandardPid,
} from '../platform/obd/StandardPidRegistry';

/** v3 ile eklenen PID'ler. */
const NEW_PIDS = [
  '34', '35', '36', '37', '38', '39', '3A', '3B',
  '4F', '51', '64', '66', '67', '68', '69', '6A',
] as const;

/** Değişmemesi gereken hot-poll (core) kümesi — v2 testiyle aynı liste. */
const CORE_PIDS = ['05', '0B', '0C', '0D', '0F', '11', '2F'] as const;

/** Sözleşme gereği DIŞARIDA kalması gereken bit/enum durum PID'leri. */
const ENUM_PIDS_STAY_OUT = ['03', '12', '13', '1D', '1E', '5F', '65'] as const;

describe('v3 — registry genişlemesi', () => {
  it('16 yeni PID kayıtlı ve hiçbir tekrar yok', () => {
    for (const pid of NEW_PIDS) {
      expect(STANDARD_PID_MAP.get(pid), `PID ${pid} kayıtta yok`).toBeDefined();
    }
    const ids = STANDARD_PIDS.map((d) => d.pid);
    expect(new Set(ids).size, 'registry TEKRAR içeriyor').toBe(ids.length);
  });

  it('yeni PID\'lerin hiçbiri core DEĞİL — hot-poll frekansına dokunulmadı', () => {
    for (const pid of NEW_PIDS) {
      expect(STANDARD_PID_MAP.get(pid)?.core, `PID ${pid} core olmamalı`).toBeFalsy();
      expect(EXTENDED_CANDIDATE_PIDS).toContain(pid);
    }
    /* Core kümesi birebir korunmalı — genişleme sıcak yolu etkilemez. */
    const cores = STANDARD_PIDS.filter((d) => d.core).map((d) => d.pid).sort();
    expect(cores).toEqual([...CORE_PIDS].sort());
  });

  it('bit/enum durum PID\'leri BİLİNÇLİ olarak dışarıda kalır', () => {
    /* Bu kilit "eksik" değil "sözleşme" korur: bitmask'i sayıya çevirip birim vermek
       uydurma olur. Biri bunları buraya eklerse kilit düşer ve karar yeniden konuşulur. */
    for (const pid of ENUM_PIDS_STAY_OUT) {
      expect(STANDARD_PID_MAP.get(pid), `PID ${pid} bu kayda AİT DEĞİL`).toBeUndefined();
    }
  });
});

describe('v3 — J1979 decode doğruluğu (bilinen ham baytlar)', () => {
  it('0x34-0x3B AKIM çözer: (256C+D)/256 − 128', () => {
    /* C,D = 0x6666 = 26214 → 26214/256 − 128 = 102.4 − 128 = −25.6 mA */
    expect(decodeStandardPid('34', '7DE06666')).toBeCloseTo(-25.6, 2);
    /* C,D = 0x8000 = 32768 → 128 − 128 = 0 mA (stokiyometrik nokta) */
    expect(decodeStandardPid('35', '80008000')).toBeCloseTo(0, 6);
    /* Aile üyelerinin TAMAMI aynı formülü kullanır */
    for (const pid of ['36', '37', '38', '39', '3A', '3B']) {
      expect(decodeStandardPid(pid, '80008000')).toBeCloseTo(0, 6);
    }
  });

  it('0x34 ailesi 0x24 ailesinden FARKLI değer verir (tekrar değil, yeni bilgi)', () => {
    /* Aynı ham 4 bayt: 0x24 lambda (2AB/65536), 0x34 akım ((256C+D)/256−128).
       Bu ikisi eşit çıkarsa iki aileden biri gereksiz demektir — kilit onu yakalar. */
    const raw = '7DE06666';
    const asLambda = decodeStandardPid('24', raw);
    const asCurrent = decodeStandardPid('34', raw);
    expect(asLambda).toBeCloseTo(0.9829, 3);
    expect(asCurrent).toBeCloseTo(-25.6, 2);
    expect(asLambda).not.toBeCloseTo(asCurrent, 2);
  });

  it('0x51 yakıt tipi KODU ham döner (ada çevirme sunum katmanının işi)', () => {
    expect(decodeStandardPid('51', '01')).toBe(1);   // benzin
    expect(decodeStandardPid('51', '04')).toBe(4);   // dizel
    /* Sınır dışı kod (>23) reddedilir — uydurma tip üretilmez. */
    expect(Number.isNaN(decodeStandardPid('51', 'FF'))).toBe(true);
  });

  it('0x64 motor yüzde tork: A − 125', () => {
    expect(decodeStandardPid('64', '7D7D7D7D7D')).toBe(0);      // 125 − 125
    expect(decodeStandardPid('64', '967D7D7D7D')).toBe(25);     // 150 − 125
  });

  it('0x66-0x6A İLK bayt destek bitmask\'idir, ölçüm B\'den başlar', () => {
    /* 0x66 MAF: B,C = 0x0020 = 32 → 32/32 = 1.0 g/s */
    expect(decodeStandardPid('66', '0100200000')).toBeCloseTo(1.0, 6);
    /* 0x67 soğutma sıvısı: B = 0x5A = 90 → 90 − 40 = 50 °C */
    expect(decodeStandardPid('67', '015A00')).toBe(50);
    /* 0x68 emme havası: B = 0x5A → 50 °C (7 bayt) */
    expect(decodeStandardPid('68', '015A0000000000')).toBe(50);
    /* 0x69 komutlanan EGR: B = 0x80 = 128 → 128/2.55 ≈ 50.2 % */
    expect(decodeStandardPid('69', '01800000000000')).toBeCloseTo(50.196, 2);
    /* 0x6A dizel hava akışı: B = 0x80 → ≈50.2 % */
    expect(decodeStandardPid('6A', '0180000000')).toBeCloseTo(50.196, 2);
  });

  it('eksik bayt uydurma değer ÜRETMEZ — NaN döner', () => {
    /* 0x34 dört bayt ister; üç bayt verilirse çözüm YOK, sıfır DEĞİL. */
    expect(Number.isNaN(decodeStandardPid('34', '7DE066'))).toBe(true);
    expect(Number.isNaN(decodeStandardPid('68', '015A'))).toBe(true);
  });
});
