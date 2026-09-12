/**
 * vehicleIdentityReport.test.ts — KİMLİK ÖZETİ KİLİTLERİ.
 *
 * Kilitlenen dürüstlük kuralları:
 *   · geçersiz VIN "düzeltilmez", gönderilmez
 *   · güven puanı istemcide üretilmez (gövdede güven alanı YOK)
 *   · ham VIN loglanmaz (yalnız maskeli)
 *   · sunucu yanıtı uydurulmaz (bilinmeyen güven `null`)
 */

import { describe, it, expect } from 'vitest';
import {
  buildIdentityReport,
  normalizeVin,
  maskVin,
  parseIdentityAck,
} from '../platform/telemetry/vehicleIdentityReport';

const VIN = 'WVWZZZ1JZ3W386752';       // 17 hane, geçerli
const FP  = 'a1b2c3d4e5f6a7b8';

describe('kimlik · VIN doğrulama', () => {
  it('1. 🔒 geçerli VIN normalize edilir (büyük harf, kırpılmış)', () => {
    expect(normalizeVin(` ${VIN.toLowerCase()} `)).toBe(VIN);
  });

  it('2. 🔒 kısa/uzun VIN REDDEDİLİR — tamamlanmaz, kırpılmaz', () => {
    expect(normalizeVin('WVW123')).toBeNull();
    expect(normalizeVin(VIN + 'ABC')).toBeNull();
  });

  it('3. 🔒 I·O·Q içeren VIN reddedilir (ISO 3779)', () => {
    expect(normalizeVin('WVWZZZ1JZ3W38675I')).toBeNull();
    expect(normalizeVin('WVWZZZ1JZ3W38675O')).toBeNull();
    expect(normalizeVin('WVWZZZ1JZ3W38675Q')).toBeNull();
  });

  it('4. 🔒 metin olmayan girdi reddedilir', () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      expect(normalizeVin(bad)).toBeNull();
    }
  });
});

describe('kimlik · gövde üretimi', () => {
  it('5. 🔒 geçersiz VIN gövdeye GİRMEZ ve kaynak da yazılmaz', () => {
    const r = buildIdentityReport({ vin: 'KISA', vinSource: 'OBD_MODE09', fingerprintHash: FP });
    expect(r.body.p_vin).toBeUndefined();
    expect(r.body.p_vin_source).toBeUndefined();
    expect(r.rejected.vin).toBe('gecersiz_vin_sekli');
  });

  it('6. 🔒 tanınmayan VIN kaynağı UNVERIFIED olur (uydurulmaz)', () => {
    expect(buildIdentityReport({ vin: VIN, vinSource: 'SIHIR' }).body.p_vin_source)
      .toBe('UNVERIFIED');
    expect(buildIdentityReport({ vin: VIN }).body.p_vin_source).toBe('UNVERIFIED');
    expect(buildIdentityReport({ vin: VIN, vinSource: 'OBD_MODE09' }).body.p_vin_source)
      .toBe('OBD_MODE09');
  });

  it('7. 🔒 GÜVEN PUANI gövdede YOKTUR (istemci kendini yükseltemez)', () => {
    const r = buildIdentityReport({
      vin: VIN, fingerprintHash: FP,
      // @ts-expect-error — istemci güven göndermeyi denerse yok sayılmalı
      identityConfidence: 0.99, confidence: 1,
    });
    const keys = Object.keys(r.body);
    expect(keys.some((k) => k.toLowerCase().includes('confidence'))).toBe(false);
    expect(keys.some((k) => k.toLowerCase().includes('guven'))).toBe(false);
  });

  it('8. 🔒 bilinmeyen alan gövdeye KONMAZ (null gönderilmez)', () => {
    const r = buildIdentityReport({ fingerprintHash: FP });
    expect(r.body.p_make).toBeUndefined();
    expect(r.body.p_model).toBeUndefined();
    expect(r.body.p_model_year).toBeUndefined();
    expect('p_make' in r.body).toBe(false);
  });

  it('9. 🔒 aralık dışı model yılı reddedilir', () => {
    expect(buildIdentityReport({ modelYear: 0, vin: VIN }).body.p_model_year).toBeUndefined();
    expect(buildIdentityReport({ modelYear: 1800, vin: VIN }).body.p_model_year).toBeUndefined();
    expect(buildIdentityReport({ modelYear: 2019, vin: VIN }).body.p_model_year).toBe(2019);
  });

  it('10. 🔒 geçersiz parmak izi reddedilir', () => {
    expect(buildIdentityReport({ fingerprintHash: 'kisa' }).body.p_fingerprint_hash).toBeUndefined();
    expect(buildIdentityReport({ fingerprintHash: 'boşluk var burada' }).body.p_fingerprint_hash)
      .toBeUndefined();
    expect(buildIdentityReport({ fingerprintHash: FP }).body.p_fingerprint_hash).toBe(FP);
  });

  it('11. 🔒 parmak izi geçersizse SÜRÜMÜ de gönderilmez', () => {
    const r = buildIdentityReport({ fingerprintHash: 'x', fingerprintVersion: 'v3' });
    expect(r.body.p_fingerprint_version).toBeUndefined();
  });

  it('12. 🔒 kimliksiz gövde GÖNDERİLMEZ', () => {
    expect(buildIdentityReport({ make: 'Renault', modelYear: 2019 }).sendable).toBe(false);
    expect(buildIdentityReport({ vin: VIN }).sendable).toBe(true);
    expect(buildIdentityReport({ fingerprintHash: FP }).sendable).toBe(true);
    expect(buildIdentityReport({}).sendable).toBe(false);
  });

  it('13. 🔒 protokol adı taşınır', () => {
    expect(buildIdentityReport({ vin: VIN, activeObdProtocol: 'ISO 15765-4 CAN 11/500' })
      .body.p_active_obd_protocol).toBe('ISO 15765-4 CAN 11/500');
  });
});

describe('kimlik · sızıntı yasağı', () => {
  it('14. 🔒 gözlem çıktısı TAM VIN İÇERMEZ (maskeli)', () => {
    const r = buildIdentityReport({ vin: VIN, fingerprintHash: FP });
    /* 2026-08-09: eski maske son 6 haneyi (SERİ NUMARASI) açıyordu → aracı
       tekilleştiriyordu. Artık yalnız WMI; tek otorite platform/privacy/vinMask
       (regresyon KİLİT 22). */
    expect(r.maskedVin).toBe('WVW**************');
    expect(r.maskedVin).not.toContain('386752');
    expect(r.maskedVin).not.toContain('WVWZZZ');
    expect(JSON.stringify({ maskedVin: r.maskedVin, presentKeys: r.presentKeys, rejected: r.rejected }))
      .not.toContain(VIN);
  });

  it('15. 🔒 VIN yoksa maske UNKNOWN (sahte maske yok)', () => {
    expect(maskVin(null)).toBe('UNKNOWN');
  });
});

describe('kimlik · sunucu yanıtı', () => {
  it('16. 🔒 çakışma yanıtı doğru okunur', () => {
    const a = parseIdentityAck({ state: 'IDENTITY_CONFLICT', conflict: true, identityConfidence: 0.3, reason: 'VIN_MISMATCH' });
    expect(a.state).toBe('IDENTITY_CONFLICT');
    expect(a.conflict).toBe(true);
    expect(a.identityConfidence).toBe(0.3);
    expect(a.reason).toBe('VIN_MISMATCH');
  });

  it('17. 🔒 tanınmayan durum UNKNOWN olur', () => {
    expect(parseIdentityAck({ state: 'SIHIR' }).state).toBe('UNKNOWN');
    expect(parseIdentityAck(null).state).toBe('UNKNOWN');
    expect(parseIdentityAck('metin').state).toBe('UNKNOWN');
  });

  it('18. 🔒 eksik/geçersiz güven UYDURULMAZ → null', () => {
    expect(parseIdentityAck({ state: 'UPDATED' }).identityConfidence).toBeNull();
    expect(parseIdentityAck({ state: 'UPDATED', identityConfidence: 1.5 }).identityConfidence).toBeNull();
    expect(parseIdentityAck({ state: 'UPDATED', identityConfidence: 'yüksek' }).identityConfidence).toBeNull();
    expect(parseIdentityAck({ state: 'UPDATED', identityConfidence: 0 }).identityConfidence).toBe(0);
  });

  it('19. 🔒 IDENTITY_CONFLICT durumu conflict bayrağını ZORLAR', () => {
    expect(parseIdentityAck({ state: 'IDENTITY_CONFLICT' }).conflict).toBe(true);
    expect(parseIdentityAck({ state: 'UPDATED' }).conflict).toBe(false);
  });
});
