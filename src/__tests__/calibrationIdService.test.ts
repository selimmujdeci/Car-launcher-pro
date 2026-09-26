/**
 * calibrationIdService.test — Mode 09 PID 04 (Kalibrasyon Kimliği) salt-okunur sorgusu.
 *
 * Kilitler:
 *  1. İstek GERÇEK genel PDU zincirinden (vdkPduTransport → GenericPduTransport →
 *     native sendDiagnosticPdu) gider — servis '09'/'04' native köprüye AYNEN ulaşır.
 *  2. Pozitif yanıt doğru ayrıştırılır ve `useVidStore.vehicle.calibrationId`e yazılır.
 *  3. Negatif/timeout/transport hatası `value: null` döner, ÖNCEKİ kalıcı değeri SİLMEZ.
 *  4. Hiçbir yeni native metod/kapı gerekmez (mevcut '09' salt-okunur izniyle gider).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { sendDiagnosticPdu: vi.fn() },
}));

import { CarLauncher } from '../platform/nativePlugin';
import { queryCalibrationId, getCalibrationIdResult, _resetCalibrationIdForTest } from '../platform/obd/calibrationIdService';
import { useVidStore } from '../store/useVidStore';

type NativeCall = Record<string, unknown>;

function mockBridge(reply: (o: NativeCall) => Record<string, unknown>): void {
  vi.mocked(CarLauncher.sendDiagnosticPdu!).mockImplementation(async (o: unknown) => reply(o as NativeCall));
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetCalibrationIdForTest();
  useVidStore.getState().resetStore();
});

describe('queryCalibrationId — genel PDU zincirinden Mode 09 PID 04', () => {
  it('istek servis "09" alt-fonksiyon "04" ile native köprüye ulaşır (yeni kapı GEREKMEZ)', async () => {
    mockBridge((o) => {
      expect(o.service).toBe('09');
      expect(o.subFunction).toBe('04');
      return { outcome: 'ok', raw: '49 04 01 41 42 43', nrc: null };
    });
    await queryCalibrationId();
    expect(CarLauncher.sendDiagnosticPdu).toHaveBeenCalledTimes(1);
  });

  it('pozitif yanıt doğru ayrıştırılır ve useVidStore.vehicle.calibrationId\'e yazılır', async () => {
    mockBridge(() => ({
      outcome: 'ok',
      raw: '49 04 01 31 30 33 37 35 32 34 37 39 31 30 31 33 30 30 30',
      nrc: null,
    }));
    const r = await queryCalibrationId();
    expect(r.value).toBe('1037524791013000');
    expect(r.outcome).toBe('POSITIVE');
    expect(useVidStore.getState().vehicle.calibrationId).toBe('1037524791013000');
    expect(getCalibrationIdResult()?.value).toBe('1037524791013000');
  });

  it('ECU sustu (NO DATA) → value null, throw etmez, ÖNCEKİ kalıcı değer SİLİNMEZ', async () => {
    mockBridge(() => ({ outcome: 'ok', raw: '49 04 01 58 59 5A', nrc: null }));
    await queryCalibrationId();
    expect(useVidStore.getState().vehicle.calibrationId).toBe('XYZ');

    mockBridge(() => ({ outcome: 'no_response', raw: null, nrc: null }));
    const r = await queryCalibrationId();
    expect(r.value).toBeNull();
    // Kısmi/başarısız yeni tur, ÖNCEKİ kanıtlı değeri SİLMEZ.
    expect(useVidStore.getState().vehicle.calibrationId).toBe('XYZ');
  });

  it('açık negatif yanıt (7F 09 <NRC>) → value null, uydurulmaz', async () => {
    mockBridge(() => ({ outcome: 'negative_nrc', raw: '7F 09 11', nrc: '11' }));
    const r = await queryCalibrationId();
    expect(r.value).toBeNull();
    expect(r.outcome).toBe('NEGATIVE');
  });

  it('köprü yoksa (eski APK) exception atmaz, value null döner', async () => {
    delete (CarLauncher as unknown as Record<string, unknown>).sendDiagnosticPdu;
    const r = await queryCalibrationId();
    expect(r.value).toBeNull();
    expect(r.outcome).toBe('NOT_SUPPORTED_BY_TRANSPORT');
  });
});
