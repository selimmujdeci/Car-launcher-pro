/**
 * obdCoreV2.pidExpansion.test.ts — Standart J1979 dizel/emisyon PID genişlemesi (PR-PID-1).
 *
 * Kilitlenen davranışlar:
 *  1. Registry PID sayısı arttı (yeni dizel/emisyon PID'leri eklendi).
 *  2. Yeni PID'ler (0x6B/0x78/0x79/0x7C/0x83/0x8E) doğru ad/birim/decode ile çözülüyor.
 *  3. Hot-poll (core) listesi DEĞİŞMEDİ — yalnız 7 çekirdek PID core; yenilerin hiçbiri
 *     core değil (EXTENDED aday listesinde). Poll frekansına dokunulmadı.
 *  4. Keşif aralığı 0x80/0xA0/0xC0/0xE0 bloklarını görüyor (zincir E0'a kadar ilerliyor).
 *  5. Bilinmeyen PID davranışı bozulmadı (tanımsız → NaN; destek filtresi sağlam).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  STANDARD_PID_MAP,
  STANDARD_PIDS,
  EXTENDED_CANDIDATE_PIDS,
  decodeStandardPid,
} from '../platform/obd/StandardPidRegistry';

/** PR-PID-1 ile eklenen yeni standart PID'ler. */
const NEW_PIDS = ['6B', '78', '79', '7C', '83', '8E'] as const;
/** Değişmemesi gereken hot-poll (core) kümesi. */
const CORE_PIDS = ['05', '0B', '0C', '0D', '0F', '11', '2F'] as const;

describe('PR-PID-1 — registry genişlemesi', () => {
  it('1) PID sayısı arttı (≥ 80, önceki 76 + yeni dizel/emisyon)', () => {
    expect(STANDARD_PIDS.length).toBeGreaterThanOrEqual(80);
    expect(STANDARD_PID_MAP.size).toBe(STANDARD_PIDS.length);
  });

  it('2) yeni PID\'lerin hepsi kayıtlı ve 0x64-0x9D aralığında', () => {
    for (const pid of NEW_PIDS) {
      const def = STANDARD_PID_MAP.get(pid);
      expect(def, `${pid} kayıtlı olmalı`).toBeDefined();
      const n = parseInt(pid, 16);
      expect(n).toBeGreaterThanOrEqual(0x64);
      expect(n).toBeLessThanOrEqual(0x9d);
    }
  });

  it('3) EGT (0x78) destek-baytı sonrası sensör 1: (256B+C)/10−40', () => {
    // A=01 (destek), B,C = 0x0D4C → (3404)/10−40 = 300.4°C
    expect(decodeStandardPid('78', '010D4C')).toBeCloseTo(300.4, 5);
    expect(STANDARD_PID_MAP.get('78')?.unit).toBe('°C');
  });

  it('4) EGR sıcaklığı (0x6B) destek-baytı sonrası B−40', () => {
    // A=01 (destek), B=0x64 → 100−40 = 60°C
    expect(decodeStandardPid('6B', '0164')).toBe(60);
  });

  it('5) DPF sıcaklığı (0x7C) + NOx (0x83) + sürtünme torku (0x8E)', () => {
    expect(decodeStandardPid('7C', '010D4C')).toBeCloseTo(300.4, 5); // DPF sıcaklık
    expect(decodeStandardPid('83', '01012C')).toBe(300);            // NOx = 0x012C = 300 ppm
    expect(decodeStandardPid('8E', 'FF')).toBe(130);                 // sürtünme torku A−125
  });

  it('6) her yeni PID min/max aralık koruması sağlam (FF..FF → aralık içi/NaN)', () => {
    for (const pid of NEW_PIDS) {
      const def = STANDARD_PID_MAP.get(pid)!;
      const v = decodeStandardPid(pid, 'FF'.repeat(def.bytes));
      if (!Number.isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(def.min);
        expect(v).toBeLessThanOrEqual(def.max);
      }
    }
  });
});

describe('PR-PID-1 — hot-poll (core) DEĞİŞMEDİ', () => {
  it('7) tam olarak 7 core PID var ve kümesi birebir aynı', () => {
    const coreInRegistry = STANDARD_PIDS.filter((d) => d.core).map((d) => d.pid).sort();
    expect(coreInRegistry).toEqual([...CORE_PIDS].sort());
  });

  it('8) yeni PID\'lerin HİÇBİRİ core değil (hepsi EXTENDED adayı)', () => {
    for (const pid of NEW_PIDS) {
      expect(STANDARD_PID_MAP.get(pid)?.core).toBeFalsy();
      expect(EXTENDED_CANDIDATE_PIDS).toContain(pid);
    }
  });
});

describe('PR-PID-1 — bilinmeyen PID davranışı korunuyor', () => {
  it('9) tanımsız PID → NaN (fallback bozulmadı)', () => {
    expect(decodeStandardPid('FF', '00')).toBeNaN();
    expect(decodeStandardPid('9D', '00')).toBeNaN(); // aralıkta ama eklenmedi → tanımsız
    expect(decodeStandardPid('8B', '0000')).toBeNaN(); // kasıtlı eklenmedi → tanımsız
  });
});

/* ── Keşif aralığı genişlemesi (extendedPidService) ─────────────────────────── */

const M = vi.hoisted(() => ({ pushedLists: [] as string[][], isNative: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => M.isNative) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    setObdExtendedPids: vi.fn(async (opts: { pids: string[] }) => { M.pushedLists.push(opts.pids); }),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { watchPid, _internals } from '../platform/obd/extendedPidService';

describe('PR-PID-1 — keşif 0x80/A0/C0/E0 bloklarını görüyor', () => {
  beforeEach(() => {
    _internals.reset();
    M.pushedLists.length = 0;
    M.isNative = true;
  });

  it('10) zincir 60→80→A0→C0→E0 ilerliyor (her bitmask sonrakini destekliyorsa)', () => {
    watchPid('78', () => {}); // yeni EGT PID'ini izle
    // Her bitmask yanıtı yalnız bir sonraki 0x_0 bayrağını set eder (byte3 bit0).
    const NEXT = '00000001';
    _internals.onExtendedData({ pid: '00', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['20']);
    _internals.onExtendedData({ pid: '20', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['40']);
    _internals.onExtendedData({ pid: '40', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['60']);
    _internals.onExtendedData({ pid: '60', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['80']); // ← YENİ blok
    _internals.onExtendedData({ pid: '80', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['A0']); // ← YENİ blok
    _internals.onExtendedData({ pid: 'A0', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['C0']); // ← YENİ blok
    _internals.onExtendedData({ pid: 'C0', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual(['E0']); // ← YENİ blok
    _internals.onExtendedData({ pid: 'E0', data: NEXT });
    expect(_internals.getDiscoveryQueue()).toEqual([]);     // E0 sonrası zincir biter
  });

  it('11) blok desteklenmezse zincir erken durur (Mali-400: boşa sorgu yok)', () => {
    watchPid('78', () => {});
    // 60 yanıtı 0x80 bayrağını set ETMEZSE zincir 60\'ta durur.
    _internals.onExtendedData({ pid: '00', data: '00000001' });
    _internals.onExtendedData({ pid: '20', data: '00000001' });
    _internals.onExtendedData({ pid: '40', data: '00000001' });
    _internals.onExtendedData({ pid: '60', data: '00000000' }); // 0x80 yok
    expect(_internals.getDiscoveryQueue()).toEqual([]);
  });
});
