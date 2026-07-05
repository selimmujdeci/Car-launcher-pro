/**
 * obdProfiles.renaultZoePh2 — Renault Zoe Ph2 (OVMS3/MIT kaynaklı) profil kilitleri.
 *
 * Kilitlenen davranışlar:
 *  1. Profil şema doğrulayıcıdan geçer (bozuk profil YÜKLENMEZ sözleşmesi).
 *  2. Formüller OVMS3 kaynak koduna birebir sadık (kaynaklı gerçek — uydurma yasak):
 *     TPMS basınç raw16*0.75 kPa · TPMS sıcaklık raw8-30 °C · kabin (raw16-400)/10 °C
 *     · VIN ascii. Bu sabitler değişirse kaynakla bağ kopar — bilinçli güncelleme ister.
 *  3. Registry/etiket/kaynak üçlüsünde 'renault-zoe-ph2' eksiksiz (UI seçici buna dayanır).
 *  4. Yalnız 11-bit ECU adresleri (BCM 745/765, HVAC 744/764) — 29-bit (18DAxxxx)
 *     native'de desteklenmeden profile GİREMEZ (sessiz ölü DID üretmesin).
 */
import { describe, it, expect } from 'vitest';

import {
  validateVehicleDidProfile,
  compileVehicleDidProfile,
  decodeCompiledDid,
} from '../platform/obd/vehicleDidProfile';
import { renaultZoePh2Profile } from '../platform/obd/profiles/renaultZoePh2Profile';
import {
  MANUFACTURER_DID_PROFILES,
  MANUFACTURER_DID_PROFILE_LABELS,
  MANUFACTURER_DID_PROFILE_SOURCES,
} from '../platform/obd/profiles';

describe('Renault Zoe Ph2 profili — şema + kaynak sadakati (OVMS3/MIT)', () => {
  it('şema doğrulayıcıdan geçer', () => {
    const r = validateVehicleDidProfile(renaultZoePh2Profile);
    expect(r.valid, r.valid ? '' : (r as { errors: string[] }).errors.join('; ')).toBe(true);
  });

  it('kaynak alanı OVMS3 + MIT izi taşır (kaynaksız profil yasak)', () => {
    expect(renaultZoePh2Profile.source).toMatch(/OVMS3/);
    expect(renaultZoePh2Profile.source).toMatch(/MIT/);
  });

  it('yalnız 11-bit ECU adresleri — 29-bit native desteklenmeden giremez', () => {
    for (const ecu of renaultZoePh2Profile.ecus) {
      expect(ecu.tx.length, `${ecu.id} tx 11-bit (3 hex) olmalı: ${ecu.tx}`).toBe(3);
      expect(ecu.rx.length, `${ecu.id} rx 11-bit (3 hex) olmalı: ${ecu.rx}`).toBe(3);
    }
  });

  describe('formüller OVMS3 kaynak koduna birebir', () => {
    const compiled = compileVehicleDidProfile(renaultZoePh2Profile);

    it('TPMS basınç: raw16 * 0.75 kPa (OVMS: CAN_UINT(0)*7.5/10)', () => {
      const def = compiled.get('6300')!;
      // raw 0x0140 = 320 → 240 kPa (tipik lastik basıncı ~2.4 bar)
      expect(decodeCompiledDid(def, '0140')).toBeCloseTo(240);
      expect(def.unit).toBe('kPa');
    });

    it('TPMS sıcaklık: raw8 - 30 °C (OVMS: CAN_BYTE(0)-30)', () => {
      const def = compiled.get('6310')!;
      // raw 0x37 = 55 → 25 °C
      expect(decodeCompiledDid(def, '37')).toBe(25);
    });

    it('kabin sıcaklığı: (raw16-400)/10 °C (OVMS: (CAN_INT(0)-400)/10)', () => {
      const def = compiled.get('4009')!;
      // raw 0x0262 = 610 → 21 °C
      expect(decodeCompiledDid(def, '0262')).toBeCloseTo(21);
    });

    it('VIN metin DID (ascii) — string döner', () => {
      const def = compiled.get('4060')!;
      expect(def.isText).toBe(true);
      // 'VF1AG000164999999' ASCII hex'i
      const vinHex = Array.from('VF1AG000164999999')
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      expect(decodeCompiledDid(def, vinHex)).toBe('VF1AG000164999999');
    });

    it('sınır dışı değer NaN (fail-soft sözleşmesi)', () => {
      const def = compiled.get('6300')!;
      // raw 0xFFFF = 65535 → 49151 kPa → max 450 üstü → NaN
      expect(Number.isNaN(decodeCompiledDid(def, 'FFFF') as number)).toBe(true);
    });
  });

  it("registry + etiket + kaynak üçlüsünde 'renault-zoe-ph2' eksiksiz", () => {
    expect(MANUFACTURER_DID_PROFILES['renault-zoe-ph2']).toBe(renaultZoePh2Profile);
    expect(MANUFACTURER_DID_PROFILE_LABELS['renault-zoe-ph2']).toBe(renaultZoePh2Profile.brand);
    expect(MANUFACTURER_DID_PROFILE_SOURCES['renault-zoe-ph2']).toMatch(/OVMS3/);
  });
});
