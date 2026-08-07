/**
 * vehicleIdentityView.test.ts — FLEET KİMLİK GÖRÜNÜMÜ DÜRÜSTLÜK KİLİTLERİ.
 *
 * Kilitlenenler:
 *   · sunucu onayı/güveni yoksa VERIFIED DENMEZ
 *   · çakışma GİZLENMEZ (güven yüksek olsa bile)
 *   · TAM VIN bu katmandan GEÇEMEZ (savunma katmanlı maskeleme kapısı)
 *   · kanıt yoksa "Veri yok" — sahte 0 / sahte tarih YOK
 */

import { describe, it, expect } from 'vitest';
import {
  buildVehicleIdentityView,
  identityStatusLabel,
  identityFieldLabel,
  identityConflictLabel,
  identityConfidenceLabel,
  safeMaskedVin,
  identityTimeMs,
  IDENTITY_VERIFIED_MIN_CONFIDENCE,
  IDENTITY_STALE_AFTER_MS,
  type VehicleIdentityRow,
} from '../lib/fleet/vehicleIdentityView';

const NOW = 1_700_000_000_000;
const iso = (offset: number) => new Date(NOW - offset).toISOString();

function row(over: Partial<VehicleIdentityRow> = {}): VehicleIdentityRow {
  return {
    vehicle_id: '3f9a1c2e-7b44-4d51-9e10-c8ab7d6f2a55',
    vin_masked: '•••386752',
    vin_source: 'OBD_MODE09',
    make: 'Volkswagen', model: 'Golf', model_year: 2019,
    fingerprint_hash_short: 'a1b2c3d4e5f6',
    fingerprint_version: 'fp1',
    active_obd_protocol: 'ISO 15765-4 CAN 11/500',
    vehicle_generation: 'Volkswagen 2015-2019',
    identity_confidence: 0.70,
    identity_revision: 1,
    identity_updated_at: iso(60_000),
    identity_conflict_count: 0,
    last_conflict_reason: null,
    protocol_change_count: 0,
    ...over,
  };
}

const build = (over: Partial<VehicleIdentityRow> = {}, readable = true) =>
  buildVehicleIdentityView({ now: NOW, row: readable ? row(over) : null, readable });

describe('kimlik görünümü · durum dürüstlüğü', () => {
  it('1. 🔒 güven eşiği aşılırsa VERIFIED', () => {
    expect(build().status).toBe('VERIFIED');
    expect(build({ identity_confidence: 0.95 }).status).toBe('VERIFIED');
  });

  it('2. 🔒 güven eşiğin ALTINDA ise VERIFIED DENMEZ', () => {
    expect(build({ identity_confidence: 0.50 }).status).toBe('PENDING');
    expect(build({ identity_confidence: 0.30 }).status).toBe('PENDING');
    expect(IDENTITY_VERIFIED_MIN_CONFIDENCE).toBe(0.70);
  });

  it('3. 🔒 güven BİLİNMİYORSA VERIFIED DENMEZ', () => {
    expect(build({ identity_confidence: null }).status).toBe('PENDING');
  });

  it('4. 🔒 ÇAKIŞMA gizlenmez — güven yüksek olsa bile CONFLICT', () => {
    const v = build({ identity_confidence: 0.95, identity_conflict_count: 1,
                      last_conflict_reason: 'VIN_MISMATCH' });
    expect(v.status).toBe('CONFLICT');
    expect(v.conflictCount).toBe(1);
    expect(identityStatusLabel(v.status)).toBe('Farklı araç algılandı');
  });

  it('5. 🔒 bayat kayıt STALE', () => {
    expect(build({ identity_updated_at: iso(IDENTITY_STALE_AFTER_MS + 60_000) }).status)
      .toBe('STALE');
  });

  it('6. 🔒 kanıt yoksa UNKNOWN (VIN ve parmak izi ikisi de yok)', () => {
    expect(build({ vin_masked: null, fingerprint_hash_short: null }).status).toBe('UNKNOWN');
  });

  it('7. 🔒 kayıt okunamadıysa UNKNOWN ve hiçbir alan uydurulmaz', () => {
    const v = buildVehicleIdentityView({ now: NOW, row: null, readable: false });
    expect(v.status).toBe('UNKNOWN');
    expect(v.vinMasked).toBeNull();
    expect(v.confidence).toBeNull();
    expect(v.revision).toBeNull();
    expect(v.updatedAtMs).toBeNull();
    expect(v.conflictCount).toBe(0);
  });

  it('8. 🔒 VIN yok ama parmak izi varsa kanıt SAYILIR', () => {
    const v = build({ vin_masked: null });
    expect(v.status).not.toBe('UNKNOWN');
    expect(v.fingerprintShort).toBe('a1b2c3d4e5f6');
  });
});

describe('kimlik görünümü · maskeleme kapısı', () => {
  it('9. 🔒 maskeli VIN geçer', () => {
    expect(safeMaskedVin('•••386752')).toBe('•••386752');
    expect(build().vinMasked).toBe('•••386752');
  });

  it('10. 🔒 MASKESİZ tam VIN GEÇEMEZ (sunucu sözleşmesi bozulsa bile)', () => {
    expect(safeMaskedVin('WVWZZZ1JZ3W386752')).toBeNull();
    expect(build({ vin_masked: 'WVWZZZ1JZ3W386752' }).vinMasked).toBeNull();
  });

  it('11. 🔒 boş/geçersiz maske null olur', () => {
    expect(safeMaskedVin('')).toBeNull();
    expect(safeMaskedVin('   ')).toBeNull();
    expect(safeMaskedVin(null)).toBeNull();
    expect(safeMaskedVin(123)).toBeNull();
  });

  it('12. 🔒 görünümde TAM VIN hiçbir alanda YOK', () => {
    const s = JSON.stringify(build({ vin_masked: 'WVWZZZ1JZ3W386752' }));
    expect(s).not.toContain('WVWZZZ1JZ3W386752');
  });
});

describe('kimlik görünümü · sahte veri yasağı', () => {
  it('13. 🔒 bilinmeyen alan "Veri yok" (sahte 0 / boş metin YOK)', () => {
    const v = build({ make: null, model: null, model_year: null,
                      active_obd_protocol: null, vehicle_generation: null });
    expect(v.make).toBeNull();
    expect(v.modelYear).toBeNull();
    expect(identityFieldLabel(v.make)).toBe('Veri yok');
    expect(identityFieldLabel(v.modelYear)).toBe('Veri yok');
    expect(identityFieldLabel(v.obdProtocol)).toBe('Veri yok');
  });

  it('14. 🔒 ölçülen 0 "Veri yok" DEĞİLDİR', () => {
    expect(identityFieldLabel(0)).toBe('0');
  });

  it('15. 🔒 güven bilinmiyorsa %0 GÖSTERİLMEZ', () => {
    expect(identityConfidenceLabel(null)).toBe('Veri yok');
    expect(identityConfidenceLabel(0.7)).toBe('%70');
    expect(identityConfidenceLabel(0)).toBe('%0');
  });

  it('16. 🔒 geçersiz tarih UYDURULMAZ', () => {
    expect(identityTimeMs('bozuk')).toBeNull();
    expect(identityTimeMs(null)).toBeNull();
    expect(build({ identity_updated_at: 'bozuk' }).updatedAtMs).toBeNull();
  });

  it('17. 🔒 negatif/geçersiz sayaç 0\'a düşer ama uydurma değer YOK', () => {
    expect(build({ identity_conflict_count: -5 }).conflictCount).toBe(0);
    expect(build({ protocol_change_count: null }).protocolChangeCount).toBe(0);
  });
});

describe('kimlik görünümü · çakışma açıklaması', () => {
  it('18. 🔒 bilinen gerekçeler kullanıcı diline çevrilir', () => {
    expect(identityConflictLabel('VIN_MISMATCH')).toMatch(/şasi numarası/);
    expect(identityConflictLabel('VIN_MISMATCH')).toMatch(/korundu/);
    expect(identityConflictLabel('FINGERPRINT_MISMATCH')).toMatch(/imzası/);
  });

  it('19. 🔒 bilinmeyen gerekçe UYDURULMAZ ama gizlenmez', () => {
    const l = identityConflictLabel('YENI_SEBEP');
    expect(l).toMatch(/çelişki/);
    expect(l).not.toContain('YENI_SEBEP');   // teknik kod sızmaz
  });

  it('20. 🔒 çakışma yoksa açıklama YOK', () => {
    expect(identityConflictLabel(null)).toBeNull();
  });

  it('21. 🔒 kullanıcı metinlerinde teknik iç detay SIZMAZ', () => {
    const texts = [
      ...(['VERIFIED', 'PENDING', 'CONFLICT', 'STALE', 'UNKNOWN'] as const).map(identityStatusLabel),
      identityConflictLabel('VIN_MISMATCH') ?? '',
      identityConflictLabel('FINGERPRINT_MISMATCH') ?? '',
    ].join(' ');
    expect(texts).not.toMatch(/rpc|api_key|sql|column|null|undefined/i);
  });
});

describe('kimlik görünümü · sahiplik otoritesi DEĞİL', () => {
  it('22. 🔒 görünüm sahiplik alanı TAŞIMAZ', () => {
    const keys = Object.keys(build()).map((k) => k.toLowerCase());
    for (const forbidden of ['ownerid', 'owner', 'userid', 'companyid', 'apikey', 'deviceid']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('23. 🔒 revizyon ve protokol değişimi taşınır (kimlik ilerlemesi)', () => {
    const v = build({ identity_revision: 3, protocol_change_count: 2 });
    expect(v.revision).toBe(3);
    expect(v.protocolChangeCount).toBe(2);
  });
});
