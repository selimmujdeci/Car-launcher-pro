/**
 * raiseRenaultFrames — ARAÇTAN YAKALANAN GERÇEK ÇERÇEVELERLE kilit (Megane 4 · Raise, 2026-10-02).
 * Beklenen değerler kullanıcının NWD ekranında okuduklarıdır (uydurma değil).
 */
import { describe, it, expect } from 'vitest';
import {
  hexToBytes, decodeTpms, decodeTrip, decodeAmbient, applyMassageItem, CENTRAL_ID,
} from '../platform/vehicleDataLayer/raiseRenaultFrames';

const b = (hex: string): number[] => hexToBytes(hex)!;

describe('0x61 lastik basıncı', () => {
  it('ekrandaki 2,4 / 2,4 / – / 1,9 bar ile birebir (FF = henüz ölçülmedi, sahte 0 YOK)', () => {
    const t = decodeTpms(b('024F4FFF3F'), 1)!;      // 2E 61 05 02 4F 4F FF 3F BB
    expect(t.statusCode).toBe(2);
    expect(t.bar).toEqual([2.37, 2.37, null, 1.89]);
  });

  it('0 ve FF ölçüm yok sayılır', () => {
    expect(decodeTpms(b('00FFFFFFFF'), 1)!.bar).toEqual([null, null, null, null]);
    expect(decodeTpms(b('0000000000'), 1)!.bar).toEqual([null, null, null, null]);
  });
});

describe('0x81 yol bilgisayarı', () => {
  it('ort. tüketim 6,1 L/100 km · ort. hız 43,3 km/s · toplam 1590,4 km', () => {
    const t = decodeTrip(b('003D01B13E2000FF'), 1)!;   // 2E 81 08 ... 2A
    expect(t.avgFuelL100km).toBe(6.1);
    expect(t.avgSpeedKmh).toBe(43.3);
    expect(t.totalKm).toBe(1590.4);
  });

  it('FFFF = bilinmiyor', () => {
    const t = decodeTrip(b('FFFFFFFFFFFF00FF'), 1)!;
    expect(t.avgFuelL100km).toBeNull();
    expect(t.avgSpeedKmh).toBeNull();
    expect(t.totalKm).toBeNull();
  });
});

describe('0x71 iç ambiyans', () => {
  it('saha çerçevesi: açık · ön+arka açık · renk 1 · parlaklık 50', () => {
    const a = decodeAmbient(b('8124270001014B793201'), 1)!;   // 2E 71 0A ...
    expect(a).toMatchObject({ on: true, front: true, rear: true, colorIndex: 1, brightness: 50 });
  });
});

describe('0x72 masaj (ayar no + değer)', () => {
  it('saha sırası 90 00 · 91 02 · 92 04 · 93 05 → kapalı, mod 2, şiddet 4, hız 5', () => {
    let m = applyMassageItem(null, b('9000'), 1);
    m = applyMassageItem(m, b('9102'), 2);
    m = applyMassageItem(m, b('9204'), 3);
    m = applyMassageItem(m, b('9305'), 4);
    expect(m).toMatchObject({ driverOn: false, mode: 2, strength: 4, speed: 5, passengerOn: null, atMs: 4 });
  });

  it('masaj dışı ayar no → null (başka alanı kirletmez)', () => {
    expect(applyMassageItem(null, [0x9b, 1], 1)).toBeNull();
    expect(CENTRAL_ID.MASSAGE_DRIVER_ON).toBe(0x90);
  });
});
