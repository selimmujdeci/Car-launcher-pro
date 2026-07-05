/**
 * obdProfiles.renaultZoePh2 — Renault Zoe Ph2 (OVMS3/MIT kaynaklı) profil kilitleri.
 *
 * Kilitlenen davranışlar:
 *  1. Profil şema doğrulayıcıdan geçer (bozuk profil YÜKLENMEZ sözleşmesi).
 *  2. Formüller OVMS3 kaynak koduna birebir sadık (kaynaklı gerçek — uydurma yasak):
 *     TPMS basınç raw16*0.75 kPa · TPMS sıcaklık raw8-30 °C · kabin (raw16-400)/10 °C
 *     · VIN ascii · [Patch 13 EVC/LBC] odometre CAN_UINT24 km · 12V akü *0.01 V ·
 *     dış sıcaklık *0.1-273 °C · devir *1 rpm · SOC/SOH *0.01 % · batarya V *0.1 ·
 *     batarya °C *0.0625-40 · enerji CAN_UINT24*0.001 kWh. Bu sabitler değişirse
 *     kaynakla bağ kopar — bilinçli güncelleme ister.
 *  3. Registry/etiket/kaynak üçlüsünde 'renault-zoe-ph2' eksiksiz (UI seçici buna dayanır).
 *  4. ECU adres disiplini (Patch 13 ile GÜNCELLENDİ — eski kilit "yalnız 11-bit"ti):
 *     native withEcuHeader artık 29-bit destekliyor (ATCP/ATSP7) → adresler TAM 3 hane
 *     (11-bit: BCM 745/765, HVAC 744/764) VEYA TAM 8 hane (29-bit: EVC/LBC 18DAxxxx)
 *     olabilir; ara uzunluk (4-7 hane) YASAK (native dispatcher'ın hiçbir dalıyla
 *     eşleşmez — sessiz ölü DID üretirdi).
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

  it('ECU adresleri TAM 3 (11-bit) veya TAM 8 (29-bit) hane — ara uzunluk yasak (Patch 13)', () => {
    for (const ecu of renaultZoePh2Profile.ecus) {
      expect([3, 8], `${ecu.id} tx 3 veya 8 hex olmalı: ${ecu.tx}`).toContain(ecu.tx.length);
      expect([3, 8], `${ecu.id} rx 3 veya 8 hex olmalı: ${ecu.rx}`).toContain(ecu.rx.length);
    }
    // 11-bit çekirdek (Patch 12D'den beri) aynen duruyor — 29-bit eklerken kaybolmadı.
    const byId = new Map(renaultZoePh2Profile.ecus.map((e) => [e.id, e]));
    expect(byId.get('bcm')?.tx).toBe('745');
    expect(byId.get('hvac')?.tx).toBe('744');
    // 29-bit EVC/LBC adresleri OVMS3 kaynağındaki gibi (18DA + hedef/kaynak bayt çifti).
    expect(byId.get('evc')?.tx).toBe('18DADAF1');
    expect(byId.get('evc')?.rx).toBe('18DAF1DA');
    expect(byId.get('lbc')?.tx).toBe('18DADBF1');
    expect(byId.get('lbc')?.rx).toBe('18DAF1DB');
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

    // ── Patch 13: EVC (rz2_pids_EVC.cpp, MIT) ────────────────────────────────
    it('odometre: CAN_UINT24 (3 bayt büyük-uçlu) km (OVMS: CAN_UINT24(0))', () => {
      const def = compiled.get('2006')!;
      // raw 0x01E240 = 123456 → 123456 km (24-bit birleştirme kilidi — AB ile 0x01E2=482 çıkardı)
      expect(decodeCompiledDid(def, '01E240')).toBe(123456);
      expect(def.unit).toBe('km');
    });

    it('12V akü: raw16 * 0.01 V (OVMS: CAN_UINT(0)*0.01)', () => {
      const def = compiled.get('2005')!;
      // raw 0x04E2 = 1250 → 12.5 V
      expect(decodeCompiledDid(def, '04E2')).toBeCloseTo(12.5);
    });

    it('dış ortam sıcaklığı: raw16 * 0.1 - 273 °C (OVMS: CAN_UINT(0)*0.1-273)', () => {
      const def = compiled.get('2218')!;
      // raw 0x0B7C = 2940 → 294.0 - 273 = 21 °C
      expect(decodeCompiledDid(def, '0B7C')).toBeCloseTo(21);
    });

    it('motor devri: raw16 * 1 rpm (OVMS: CAN_UINT(0))', () => {
      const def = compiled.get('3064')!;
      expect(decodeCompiledDid(def, '0FA0')).toBe(4000);
    });

    // ── Patch 13: LBC/BMS (rz2_pids_LBC.cpp, MIT) ────────────────────────────
    it('SOC: raw16 * 0.01 % (OVMS: CAN_UINT(0)*0.01)', () => {
      const def = compiled.get('9002')!;
      // raw 0x1D4C = 7500 → 75 %
      expect(decodeCompiledDid(def, '1D4C')).toBeCloseTo(75);
    });

    it('SOH: raw16 * 0.01 % (OVMS: CAN_UINT(0)*0.01)', () => {
      const def = compiled.get('9003')!;
      // raw 0x2648 = 9800 → 98 %
      expect(decodeCompiledDid(def, '2648')).toBeCloseTo(98);
    });

    it('batarya voltajı: raw16 * 0.1 V (OVMS: CAN_UINT(0)*0.1)', () => {
      const def = compiled.get('9005')!;
      // raw 0x0E74 = 3700 → 370 V
      expect(decodeCompiledDid(def, '0E74')).toBeCloseTo(370);
    });

    it('batarya sıcaklığı: raw16 * 0.0625 - 40 °C (OVMS: CAN_UINT(0)*0.0625-40)', () => {
      const def = compiled.get('9012')!;
      // raw 0x03E8 = 1000 → 62.5 - 40 = 22.5 °C
      expect(decodeCompiledDid(def, '03E8')).toBeCloseTo(22.5);
    });

    it('kullanılabilir enerji: CAN_UINT24 * 0.001 kWh (OVMS: CAN_UINT24(0)*0.001)', () => {
      const def = compiled.get('91C8')!;
      // raw 0x00A028 = 41000 → 41 kWh
      expect(decodeCompiledDid(def, '00A028')).toBeCloseTo(41);
    });
  });

  it("registry + etiket + kaynak üçlüsünde 'renault-zoe-ph2' eksiksiz", () => {
    expect(MANUFACTURER_DID_PROFILES['renault-zoe-ph2']).toBe(renaultZoePh2Profile);
    expect(MANUFACTURER_DID_PROFILE_LABELS['renault-zoe-ph2']).toBe(renaultZoePh2Profile.brand);
    expect(MANUFACTURER_DID_PROFILE_SOURCES['renault-zoe-ph2']).toMatch(/OVMS3/);
  });
});
