/**
 * fuelPidCapabilityPersistence.test.ts — YAKIT PID'i (0x2F) NEDEN HİÇ SORULMUYORDU.
 *
 * ── ÖLÇÜLEN KUSUR (gerçek araç, 2026-09-18) ─────────────────────────────────
 * Renault (VIN VF1FLBUBCBY406165), motor rölantide, CDP ile 90 sn boyunca
 * 35 OBD paketi yakalandı:
 *   · `rpm`        → 35/35 pakette geldi (~850)
 *   · `engineTemp` → 5 turda bir geldi (80 °C) — tasarlandığı gibi
 *   · `fuelLevel`  → 35/35 pakette **-1** (= "sorulmadı/desteklenmiyor")
 *
 * Yani yakıt verisi BOZUK değildi, HİÇ SORULMUYORDU.
 *
 * ZİNCİR:
 *  1. PID 0x2F, ICE taban listesinden BİLİNÇLİ çıkarılmış
 *     (`obdPidConfig.ts`: çoğu Fiat/PSA/Renault desteklemez; kör sorgu her
 *     turda 200 ms NO-DATA bekletir).
 *  2. Onu geri açan TEK yol `refinePidList`in bitmap kanıtıdır.
 *  3. Kanıt handshake'te üretilip diske YAZILIYORDU ama ÜRETİMDE HİÇ
 *     OKUNMUYORDU (`loadObdSupportedPidBitmap` yalnız testlerde çağrılıyordu).
 *  4. O oturumda handshake blok okuyamazsa `readBlocks.size === 0` → taban
 *     liste aynen döner → `012F` native'e hiç gitmez.
 *
 * Oysa bu aracın KENDİ kanıtı diskte duruyordu: cihazdan okunan gerçek bitmap
 * `983BA017 B81BA015 CCD20011 00000001 00200000` → ikinci grubun `1B` baytının
 * bit1'i = PID 0x2F DESTEKLENİYOR.
 *
 * Buradaki kilitler kusuru geri getiren her değişiklikte DÜŞER.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { decodeSupportedPidBitmap } from '../core/val/OBDHandshake';
import { refinePidList, getPidListForVehicle } from '../platform/obdPidConfig';
import {
  loadObdSupportedPidBitmapFor,
  saveObdSupportedPidBitmapFor,
} from '../platform/obdStorage';

/** Gerçek cihazdan (Xiaomi 23090RA98I · Renault) okunan kalıcı bitmap. */
const REAL_DEVICE_BITMAP = '983BA017B81BA015CCD200110000000100200000';
const REAL_VIN  = 'VF1FLBUBCBY406165';
const REAL_MAC  = '00:10:CC:4F:36:03';
const FUEL_PID  = 0x2f;

/* ── 1. Çözücü gerçek kanıtı doğru okur ────────────────────────────────── */

describe('bitmap çözücü · gerçek araç kanıtı', () => {
  it('1. 🔒 gerçek cihaz bitmap\'i PID 0x2F\'i DESTEKLENİYOR olarak çözer', () => {
    const { supportedPids, readBlocks } = decodeSupportedPidBitmap(REAL_DEVICE_BITMAP);
    expect(supportedPids.has(FUEL_PID)).toBe(true);
    expect(readBlocks.size).toBe(5);           // 40 hane / 8 = 5 blok
    expect([...readBlocks].sort((a, b) => a - b)).toEqual([0x00, 0x20, 0x40, 0x60, 0x80]);
  });

  it('2. 🔒 çözüm, GERÇEKTEN çalışan sinyallerle tutarlıdır (çapraz doğrulama)', () => {
    const { supportedPids } = decodeSupportedPidBitmap(REAL_DEVICE_BITMAP);
    /* Bu üçü sahada ÖLÇÜLDÜ: hız/devir/hararet akıyor. Çözücü onları
       "destekleniyor" demiyorsa çözüm yanlıştır. */
    expect(supportedPids.has(0x0c)).toBe(true); // RPM      — ölçüldü: ~850
    expect(supportedPids.has(0x0d)).toBe(true); // hız
    expect(supportedPids.has(0x05)).toBe(true); // hararet  — ölçüldü: 80 °C
  });

  it('3. 🔒 kanıt YOKSA boş küme döner (uydurma kanıt YOK)', () => {
    for (const bad of [null, undefined, '', '   ', 'ZZZZ']) {
      const d = decodeSupportedPidBitmap(bad as string | null);
      expect(d.readBlocks.size).toBe(0);
      expect(d.supportedPids.size).toBe(0);
    }
  });

  it('4. 🔒 YARIM blok "okundu" SAYILMAZ (8 haneden kısa kuyruk atılır)', () => {
    const d = decodeSupportedPidBitmap('983BA017' + 'B81B');  // 1 tam + yarım
    expect(d.readBlocks.size).toBe(1);
    expect(d.readBlocks.has(0x00)).toBe(true);
    /* Yarım blok çözülmediği için 0x2F "kanıtlı" DEĞİLDİR. */
    expect(d.supportedPids.has(FUEL_PID)).toBe(false);
  });
});

/* ── 2. Kanıt gerçekten yakıt PID'ini geri açıyor mu ───────────────────── */

describe('refinePidList · kanıt yakıt PID\'ini geri açar', () => {
  const base = getPidListForVehicle('ice');

  it('5. 🔒 TABAN listede 0x2F YOKTUR (bilinçli karar korunur)', () => {
    expect(base.some((p) => parseInt(p.replace(/^0x/i, ''), 16) === FUEL_PID)).toBe(false);
  });

  it('6. 🔒 kanıt YOKSA taban AYNEN döner → yakıt yine sorulmaz (eski davranış)', () => {
    const { supportedPids, readBlocks } = decodeSupportedPidBitmap(null);
    const out = refinePidList(base, supportedPids, readBlocks);
    expect(out).toEqual([...base]);
    expect(out.some((p) => parseInt(p.replace(/^0x/i, ''), 16) === FUEL_PID)).toBe(false);
  });

  it('7. 🔒 KALICI kanıtla 0x2F listeye EKLENİR — kusurun kapandığı yer', () => {
    const { supportedPids, readBlocks } = decodeSupportedPidBitmap(REAL_DEVICE_BITMAP);
    const out = refinePidList(base, supportedPids, readBlocks);
    /* MUTASYON KAPISI: kalıcı kanıt geri okunmazsa bu DÜŞER. */
    expect(out.some((p) => parseInt(p.replace(/^0x/i, ''), 16) === FUEL_PID)).toBe(true);
  });

  it('8. 🔒 bu araçta taban PID\'lerin HEPSİ kanıtlı destekleniyor (eleme olmaz)', () => {
    /* Ölçümle tutarlı: hız/devir/hararet/gaz kelebeği hepsi akıyor. Kanıt bu
       araçta hiçbir taban PID\'ini elemez — yalnız 0x2F\'i EKLER. */
    const { supportedPids, readBlocks } = decodeSupportedPidBitmap(REAL_DEVICE_BITMAP);
    for (const pid of base) {
      expect(supportedPids.has(parseInt(pid.replace(/^0x/i, ''), 16))).toBe(true);
    }
    const out = refinePidList(base, supportedPids, readBlocks);
    for (const pid of base) expect(out).toContain(pid);
  });

  it('9. 🔒 kanıt TEK YÖNLÜ değildir: kanıtlı desteklenmeyen taban PID\'i ELENİR', () => {
    /* Sentetik kanıt: blok 0x00 okundu ama 0x05 (hararet) biti TEMİZ.
       `98` = 1001 1000 → 0x05 biti (bit3) set; onu düşürünce `90` olur. */
    const { supportedPids, readBlocks } = decodeSupportedPidBitmap('903BA017');
    expect(readBlocks.has(0x00)).toBe(true);
    expect(supportedPids.has(0x05)).toBe(false);
    const out = refinePidList(base, supportedPids, readBlocks);
    expect(out.some((p) => parseInt(p.replace(/^0x/i, ''), 16) === 0x05)).toBe(false);
    /* Aynı blokta kanıtlı desteklenenler KORUNUR. */
    expect(out.some((p) => parseInt(p.replace(/^0x/i, ''), 16) === 0x0c)).toBe(true);
  });
});

/* ── 3. Kanıt ARACA bağlıdır (çapraz araç sızıntısı yok) ───────────────── */

describe('kalıcı kanıt · araca bağlı kapsam', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom */ }
  });

  it('9. 🔒 VIN kaydı MAC kaydına TERCİH edilir', () => {
    saveObdSupportedPidBitmapFor(REAL_MAC, null, '00000000');        // yalnız MAC
    saveObdSupportedPidBitmapFor(REAL_MAC, REAL_VIN, REAL_DEVICE_BITMAP);
    const got = loadObdSupportedPidBitmapFor(REAL_MAC, REAL_VIN);
    expect(decodeSupportedPidBitmap(got).supportedPids.has(FUEL_PID)).toBe(true);
  });

  it('10. 🔒 BAŞKA aracın VIN\'i bu aracın kanıtını ALMAZ', () => {
    saveObdSupportedPidBitmapFor(null, REAL_VIN, REAL_DEVICE_BITMAP);
    /* Farklı VIN, MAC de yok → kanıt YOK. Global OR\'lanmış anahtarın
       karar için kullanılamamasının sebebi tam olarak budur. */
    expect(loadObdSupportedPidBitmapFor(null, 'VF1AAAAAAAA000001')).toBeNull();
  });

  it('11. 🔒 kayıt YOKSA null döner (boş string DEĞİL)', () => {
    expect(loadObdSupportedPidBitmapFor(REAL_MAC, REAL_VIN)).toBeNull();
    expect(loadObdSupportedPidBitmapFor(null, null)).toBeNull();
  });

  it('12. 🔒 yeni kanıt öncekini SİLMEZ, OR ile genişletir', () => {
    saveObdSupportedPidBitmapFor(REAL_MAC, null, '983BA017');          // yalnız blok 0
    saveObdSupportedPidBitmapFor(REAL_MAC, null, '00000000B81BA015');  // blok 1 eklenir
    const got = loadObdSupportedPidBitmapFor(REAL_MAC, null);
    const d = decodeSupportedPidBitmap(got);
    expect(d.supportedPids.has(0x0c)).toBe(true);      // ilk kayıttan korundu
    expect(d.supportedPids.has(FUEL_PID)).toBe(true);  // ikinci kayıttan geldi
  });

  it('13. 🔒 boş kanıt NO-OP\'tur (mevcut kanıt silinmez)', () => {
    saveObdSupportedPidBitmapFor(REAL_MAC, null, REAL_DEVICE_BITMAP);
    saveObdSupportedPidBitmapFor(REAL_MAC, null, '');
    expect(decodeSupportedPidBitmap(loadObdSupportedPidBitmapFor(REAL_MAC, null))
      .supportedPids.has(FUEL_PID)).toBe(true);
  });
});
