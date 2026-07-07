/**
 * classifyObdErrorReason — native soket hatasını PII-güvenli kategoriye sınıflandırma.
 * KİLİT: kategori doğru + ham mesaj (cihaz adı/MAC) ASLA döndürülmez.
 */
import { describe, it, expect } from 'vitest';
import { classifyObdErrorReason } from '../platform/obdDiagEmitter';

const ALLOWED = new Set([
  'resource_busy', 'connection_refused', 'broken_pipe', 'socket_closed', 'read_failed',
  'permission_denied', 'no_vehicle_response', 'timeout', 'bt_disabled', 'device_not_found',
  'other', 'unknown',
]);

describe('classifyObdErrorReason — kategori eşleme', () => {
  const cases: Array<[string, string]> = [
    ['Device or resource busy',                                   'resource_busy'],
    ['java.io.IOException: Connection refused',                   'connection_refused'],
    ['read failed, socket might be closed or timeout, read ret: -1', 'socket_closed'],
    ['Broken pipe (EPIPE)',                                       'broken_pipe'],
    ['read failed',                                               'read_failed'],
    ['BLUETOOTH_CONNECT permission denied',                       'permission_denied'],
    ['OBD_UNABLE_TO_CONNECT: araç yanıt vermedi',                 'no_vehicle_response'],
    ['OBD bağlantısı zaman aşımına uğradı (15s)',                 'timeout'],
    ['Bluetooth kapalı',                                          'bt_disabled'],
    ['Device not found',                                          'device_not_found'],
  ];
  it.each(cases)('%s → %s', (msg, expected) => {
    expect(classifyObdErrorReason(new Error(msg))).toBe(expected);
  });

  it('boş/null → unknown', () => {
    expect(classifyObdErrorReason(null)).toBe('unknown');
    expect(classifyObdErrorReason(new Error(''))).toBe('unknown');
  });

  it('tanınmayan mesaj → other', () => {
    expect(classifyObdErrorReason(new Error('bilinmeyen garip hata xyz'))).toBe('other');
  });
});

describe('classifyObdErrorReason — PII güvenliği (KİLİT)', () => {
  it('cihaz adı/MAC içeren mesajda ham metin ASLA dönmez — yalnız güvenli kategori', () => {
    const piiMsgs = [
      'Failed to connect to Selim-ELM327 (AA:BB:CC:DD:EE:FF): Device or resource busy',
      'secure=Failed to connect to My OBD 00:11:22:33:44:55 | insecure=Connection refused',
      "read failed to 'CarScannerAdapter' AA-BB-CC socket might be closed",
    ];
    for (const raw of piiMsgs) {
      const cat = classifyObdErrorReason(new Error(raw));
      // 1) çıktı whitelist kategorilerinden biri olmalı
      expect(ALLOWED.has(cat)).toBe(true);
      // 2) çıktı ham mesajın PII parçalarını İÇERMEMELİ
      expect(cat).not.toMatch(/ELM327|OBD|Selim|CarScanner|[0-9A-F]{2}[:-][0-9A-F]{2}/i);
      expect(cat.length).toBeLessThanOrEqual(20); // kısa etiket, uzun mesaj değil
    }
  });
});
