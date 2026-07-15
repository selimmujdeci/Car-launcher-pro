/**
 * OBD-OS-F3-1 — UDS Service 0x19 (ReadDTCInformation) ayrıştırması.
 *
 * NEDEN KRİTİK: standart Mode 03/07/0A yalnız EMİSYON (P0…) kodlarını verir. Renault DF…,
 * VAG, BMW üretici kodları UDS 0x19'da yaşar — F1-2'nin "MIL yanıyor ama standart kod yok"
 * uyarısının cevabı budur. Car Scanner'ın gördüğü, bizim göremediğimiz kodlar.
 *
 * F3-1'in ikinci kazancı: STATUS BAYTI. Mode 03 "kod var" der; UDS "kod ŞU AN aktif mi,
 * onaylı mı, bekleyen mi" der.
 */
import { describe, it, expect } from 'vitest';
import {
  parseUdsDtcResponse,
  parseUdsStatusByte,
  decodeUdsDtcCode,
  udsDtcToScanMode,
} from '../platform/obd/udsDtc';

describe('OBD-OS-F3-1 — decodeUdsDtcCode (SAE J2012 kodlaması)', () => {
  it('P / C / B / U harf alanları doğru çözülür (bayt0 bit7-6)', () => {
    expect(decodeUdsDtcCode(0x03, 0x01)).toBe('P0301');   // 00 → P
    expect(decodeUdsDtcCode(0x41, 0x23)).toBe('C0123');   // 01 → C
    expect(decodeUdsDtcCode(0x81, 0x34)).toBe('B0134');   // 10 → B
    expect(decodeUdsDtcCode(0xC1, 0x00)).toBe('U0100');   // 11 → U
  });
});

describe('OBD-OS-F3-1 — parseUdsStatusByte (ISO 14229-1 D.1)', () => {
  it('🔒 KİLİT: aktif/onaylı/bekleyen ayrılır — Mode 03 bunu YAPAMAZ', () => {
    // 0x09 = bit0 (testFailed=AKTİF) + bit3 (confirmed=ONAYLI)
    const s = parseUdsStatusByte(0x09);
    expect(s.testFailed).toBe(true);
    expect(s.confirmed).toBe(true);
    expect(s.pending).toBe(false);
  });

  it('MIL talebi (bit7) ve tamamlanmamış test (bit6) çözülür', () => {
    const s = parseUdsStatusByte(0xC0);
    expect(s.warningIndicatorRequested).toBe(true);
    expect(s.testNotCompletedThisCycle).toBe(true);
    expect(s.testFailed).toBe(false);   // geçmiş arıza — şu an aktif DEĞİL
  });
});

describe('OBD-OS-F3-1 — parseUdsDtcResponse', () => {
  it('🔒 KİLİT: üretici DTC kayıtları çözülür (kod + status + FTB)', () => {
    // availabilityMask(FF) + DTC1(P0301, FTB 1C, status 09) + DTC2(C1234, FTB 00, status 04)
    // C1234 → bayt0 = 01(C) 01(d1=1) 0010(d2=2) = 0x52 · bayt1 = 0x34 · FTB = 0x00
    const raw = 'FF' + '03011C' + '09' + '523400' + '04';
    const dtcs = parseUdsDtcResponse(raw);

    expect(dtcs).toHaveLength(2);
    expect(dtcs[0]!.code).toBe('P0301');
    expect(dtcs[0]!.failureType).toBe('1C');      // Mode 03'te bu bayt YOKTUR
    expect(dtcs[0]!.status.confirmed).toBe(true);
    expect(dtcs[0]!.status.testFailed).toBe(true);
    expect(dtcs[1]!.code).toBe('C1234');
    expect(dtcs[1]!.status.pending).toBe(true);
    expect(dtcs[1]!.status.confirmed).toBe(false);
  });

  it('ham DTC baytları KORUNUR (üretici tablosuyla/FleetKB eşleşmesi için)', () => {
    const dtcs = parseUdsDtcResponse('FF' + '03011C' + '09');
    expect(dtcs[0]!.rawDtc).toBe('03011C');
    expect(dtcs[0]!.rawStatus).toBe('09');
  });

  it('boşluklu hex de çözülür (adaptör biçimi değişebilir)', () => {
    const dtcs = parseUdsDtcResponse('FF 03 01 1C 09');
    expect(dtcs).toHaveLength(1);
    expect(dtcs[0]!.code).toBe('P0301');
  });

  it('ZERO-TRUST: kırık/eksik son kayıt SESSİZCE ATLANIR (uydurma kod YOK)', () => {
    const raw = 'FF' + '03011C' + '09' + '4123';   // ikinci kayıt yarım
    const dtcs = parseUdsDtcResponse(raw);
    expect(dtcs).toHaveLength(1);
    expect(dtcs[0]!.code).toBe('P0301');
  });

  it('000000 dolgu kaydı gerçek DTC sayılmaz', () => {
    const raw = 'FF' + '000000' + '00' + '03011C' + '09';
    const dtcs = parseUdsDtcResponse(raw);
    expect(dtcs).toHaveLength(1);
    expect(dtcs[0]!.code).toBe('P0301');
  });

  it('boş / çok kısa gövde → boş liste ("kod yok" DEĞİL — çağıran supported ile ayırır)', () => {
    expect(parseUdsDtcResponse('')).toEqual([]);
    expect(parseUdsDtcResponse('FF')).toEqual([]);
    expect(parseUdsDtcResponse('ZZZZ')).toEqual([]);
  });

  it('kod YOKKEN ECU yalnız availabilityMask döner → boş liste', () => {
    expect(parseUdsDtcResponse('FF00')).toEqual([]);
  });
});

describe('OBD-OS-F3-1 — udsDtcToScanMode (fail-closed eşleme)', () => {
  it('onaylı VEYA aktif → stored (daha ciddi olan seçilir)', () => {
    const [confirmed] = parseUdsDtcResponse('FF' + '03011C' + '08');   // confirmed
    const [active]    = parseUdsDtcResponse('FF' + '03011C' + '01');   // testFailed
    expect(udsDtcToScanMode(confirmed!)).toBe('stored');
    expect(udsDtcToScanMode(active!)).toBe('stored');
  });

  it('yalnız bekleyen → pending', () => {
    const [pending] = parseUdsDtcResponse('FF' + '03011C' + '04');
    expect(udsDtcToScanMode(pending!)).toBe('pending');
  });
});
