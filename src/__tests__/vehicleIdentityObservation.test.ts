/**
 * vehicleIdentityObservation.test.ts — KANONİK KİMLİK MODELİ KİLİTLERİ.
 *
 * Kilitlenen otorite sınırları:
 *   · VIN sahiplik otoritesi DEĞİL · `device_id` kimlik DEĞİL
 *   · ham parmak izi girdisi gözleme GİRMEZ · tahmin ÜRETİLMEZ
 *   · NULL → değer geçişi ÇAKIŞMA DEĞİLDİR (öğrenmedir)
 *   · protokol değişimi çakışma DEĞİL, revizyon ilerlemesidir
 */

import { describe, it, expect } from 'vitest';
import {
  buildIdentityObservation,
  evaluatePublishable,
  classifyIdentityChange,
  shouldPublishChange,
  isConflictChange,
  identitySignature,
  deriveVehicleGeneration,
  FINGERPRINT_SCHEMA_VERSION,
  EMPTY_IDENTITY_OBSERVATION,
  type VehicleIdentityObservation,
} from '../platform/telemetry/vehicleIdentityObservation';

const NOW = 1_700_000_000_000;
const VIN = 'WVWZZZ1JZ3W386752';
const FP = 'a1b2c3d4e5f6a7b8';

function obs(over: Partial<Parameters<typeof buildIdentityObservation>[0]> = {}) {
  return buildIdentityObservation({
    nowMs: NOW,
    vid: {
      vin: VIN, make: 'Volkswagen', model: 'Golf', modelYear: 2019,
      activeProtocol: 'ISO 15765-4 CAN 11/500', transportVerified: true,
    },
    fingerprint: { hash: FP, confidence: 0.7, sourceCount: 3, lastSeen: NOW },
    ...over,
  });
}

describe('kimlik modeli · kanıt kapıları', () => {
  it('1. 🔒 tam kanıtla tüm alanlar dolar', () => {
    const o = obs();
    expect(o.vin).toBe(VIN);
    expect(o.vinSource).toBe('OBD_MODE09');
    expect(o.make).toBe('Volkswagen');
    expect(o.modelYear).toBe(2019);
    expect(o.activeProtocol).toBe('ISO 15765-4 CAN 11/500');
    expect(o.fingerprintHash).toBe(FP);
    expect(o.fingerprintVersion).toBe(FINGERPRINT_SCHEMA_VERSION);
    expect(o.source).toBe('OBD_HANDSHAKE');
  });

  it('2. 🔒 geçersiz VIN → vin VE vinSource İKİSİ de null', () => {
    const o = obs({ vid: { vin: 'KISA', transportVerified: true } });
    expect(o.vin).toBeNull();
    expect(o.vinSource).toBeNull();
  });

  it('3. 🔒 marka/yıl VIN TÜREVİDİR — VIN yoksa taşınmaz (tahmin YOK)', () => {
    const o = obs({
      vid: { vin: null, make: 'Volkswagen', modelYear: 2019, transportVerified: true },
    });
    expect(o.make).toBeNull();
    expect(o.modelYear).toBeNull();
  });

  it('4. 🔒 doğrulanmamış taşımada protokol "aktif" SAYILMAZ', () => {
    const o = obs({
      vid: { vin: VIN, activeProtocol: 'ISO 15765-4', transportVerified: false },
    });
    expect(o.activeProtocol).toBeNull();
  });

  it('5. 🔒 parmak izi yoksa şema sürümü de taşınmaz', () => {
    const o = obs({ fingerprint: { hash: null } });
    expect(o.fingerprintHash).toBeNull();
    expect(o.fingerprintVersion).toBeNull();
  });

  it('6. 🔒 hiç kanıt yoksa kaynak UNKNOWN ve her alan null', () => {
    const o = buildIdentityObservation({ nowMs: NOW });
    expect(o.source).toBe('UNKNOWN');
    expect(o.vin).toBeNull();
    expect(o.fingerprintHash).toBeNull();
    expect(o.confidence).toBeNull();
    expect(EMPTY_IDENTITY_OBSERVATION.source).toBe('UNKNOWN');
  });

  it('7. 🔒 model kullanıcı profilinden gelebilir (VIN\'e bağlı DEĞİL)', () => {
    const o = obs({ vid: { vin: null, model: 'Doblo', transportVerified: true } });
    expect(o.model).toBe('Doblo');
    expect(o.source).toBe('OBD_FINGERPRINT');   // hash var
  });

  it('8. 🔒 güven 0–1 aralığına kırpılır, geçersizse null', () => {
    expect(obs({ fingerprint: { hash: FP, confidence: 5 } }).confidence).toBe(1);
    expect(obs({ fingerprint: { hash: FP, confidence: -1 } }).confidence).toBe(0);
    expect(obs({ fingerprint: { hash: FP, confidence: NaN } }).confidence).toBeNull();
  });
});

describe('kimlik modeli · araç nesli TÜREVDİR', () => {
  it('9. 🔒 marka VE yıl varsa nesil türer', () => {
    expect(deriveVehicleGeneration('Volkswagen', 2019)).toBe('Volkswagen 2015-2019');
    expect(deriveVehicleGeneration('Renault', 2021)).toBe('Renault 2020-2024');
  });

  it('10. 🔒 kanıt eksikse nesil UYDURULMAZ', () => {
    expect(deriveVehicleGeneration(null, 2019)).toBeNull();
    expect(deriveVehicleGeneration('Volkswagen', null)).toBeNull();
    expect(deriveVehicleGeneration(null, null)).toBeNull();
  });
});

describe('kimlik modeli · yayınlanabilirlik', () => {
  it('11. 🔒 VIN veya parmak izi varsa yayınlanabilir', () => {
    expect(evaluatePublishable(obs()).publishable).toBe(true);
    expect(evaluatePublishable(obs({ vid: { vin: null, transportVerified: true } })).publishable).toBe(true);
  });

  it('12. 🔒 kanıtsız gözlem YAYINLANMAZ', () => {
    const o = buildIdentityObservation({ nowMs: NOW });
    const d = evaluatePublishable(o);
    expect(d.publishable).toBe(false);
    expect(d.rejection).toBe('NO_EVIDENCE');
  });

  it('13. 🔒 yalnız protokol varsa yayınlanmaz (kimlik değil)', () => {
    const o = buildIdentityObservation({
      nowMs: NOW,
      vid: { activeProtocol: 'CAN', transportVerified: true },
    });
    const d = evaluatePublishable(o);
    expect(d.publishable).toBe(false);
    expect(d.rejection).toBe('PROTOCOL_UNVERIFIED');
  });

  it('14. 🔒 gözlem anı yoksa yayınlanmaz', () => {
    const o = buildIdentityObservation({ nowMs: NaN, vid: { vin: VIN, transportVerified: true } });
    expect(evaluatePublishable(o).rejection).toBe('NO_OBSERVED_AT');
  });
});

describe('kimlik modeli · değişim sınıflandırması (§4 politikası)', () => {
  it('15. 🔒 önceki gözlem yoksa FIRST_OBSERVATION', () => {
    expect(classifyIdentityChange(null, obs())).toBe('FIRST_OBSERVATION');
  });

  it('16. 🔒 aynı kimlik → UNCHANGED → GÖNDERİLMEZ', () => {
    const change = classifyIdentityChange(obs(), obs());
    expect(change).toBe('UNCHANGED');
    expect(shouldPublishChange(change)).toBe(false);
  });

  it('17. 🔒 confidence değişimi kimlik değişimi DEĞİLDİR', () => {
    const a = obs({ fingerprint: { hash: FP, confidence: 0.5 } });
    const b = obs({ fingerprint: { hash: FP, confidence: 0.9 } });
    expect(classifyIdentityChange(a, b)).toBe('UNCHANGED');
    expect(identitySignature(a)).toBe(identitySignature(b));
  });

  it('18. 🔒 VIN DEĞİŞTİ → VIN_CONFLICT', () => {
    const a = obs();
    const b = obs({ vid: { vin: 'WVWZZZ1KZAW123456', transportVerified: true } });
    const change = classifyIdentityChange(a, b);
    expect(change).toBe('VIN_CONFLICT');
    expect(isConflictChange(change)).toBe(true);
  });

  it('19. 🔒 NULL → VIN geçişi ÇAKIŞMA DEĞİL, ÖĞRENMEDİR', () => {
    const a = obs({ vid: { vin: null, transportVerified: true } });
    const b = obs();
    const change = classifyIdentityChange(a, b);
    expect(change).toBe('ENRICHED');
    expect(isConflictChange(change)).toBe(false);
  });

  it('20. 🔒 parmak izi DEĞİŞTİ → FINGERPRINT_CONFLICT', () => {
    const a = obs({ vid: { vin: null, transportVerified: true } });
    const b = obs({
      vid: { vin: null, transportVerified: true },
      fingerprint: { hash: 'ffffffffffffffff' },
    });
    expect(classifyIdentityChange(a, b)).toBe('FINGERPRINT_CONFLICT');
  });

  it('21. 🔒 ŞEMA SÜRÜMÜ farklıysa hash farkı ÇAKIŞMA DEĞİL', () => {
    const a: VehicleIdentityObservation = { ...obs(), fingerprintVersion: 'fp0' };
    const b: VehicleIdentityObservation = { ...obs(), fingerprintHash: 'ffffffffffffffff', fingerprintVersion: 'fp1' };
    const change = classifyIdentityChange(a, b);
    expect(change).toBe('ENRICHED');
    expect(isConflictChange(change)).toBe(false);
  });

  it('22. 🔒 PROTOKOL değişimi ÇAKIŞMA DEĞİL → PROTOCOL_CHANGED', () => {
    const a = obs();
    const b = obs({
      vid: {
        vin: VIN, make: 'Volkswagen', model: 'Golf', modelYear: 2019,
        activeProtocol: 'ISO 14230-4 KWP', transportVerified: true,
      },
    });
    const change = classifyIdentityChange(a, b);
    expect(change).toBe('PROTOCOL_CHANGED');
    expect(isConflictChange(change)).toBe(false);
    expect(shouldPublishChange(change)).toBe(true);
  });

  it('23. 🔒 ÇAKIŞMA zenginleşmeyi EZER (aynı turda ikisi de olursa)', () => {
    const a = obs({ vid: { vin: VIN, transportVerified: false } });   // protokol null
    const b = obs({
      vid: {
        vin: 'WVWZZZ1KZAW123456', make: 'VW', model: 'Golf', modelYear: 2019,
        activeProtocol: 'CAN', transportVerified: true,
      },
    });
    // Hem protokol öğrenildi hem VIN değişti → ÇAKIŞMA kazanır.
    expect(classifyIdentityChange(a, b)).toBe('VIN_CONFLICT');
  });
});

describe('kimlik modeli · imza (dedupe anahtarı)', () => {
  it('24. 🔒 imza confidence/observedAt/revision İÇERMEZ', () => {
    const a = obs();
    const b: VehicleIdentityObservation = {
      ...a, confidence: 0.99, observedAt: NOW + 999_999, identityRevision: 42,
      vehicleGeneration: 'Baska Nesil',
    };
    expect(identitySignature(a)).toBe(identitySignature(b));
  });

  it('25. 🔒 kimlik alanı değişince imza DEĞİŞİR', () => {
    const a = obs();
    expect(identitySignature(a)).not.toBe(
      identitySignature(obs({ vid: { vin: 'WVWZZZ1KZAW123456', transportVerified: true } })),
    );
    expect(identitySignature(a)).not.toBe(
      identitySignature(obs({ fingerprint: { hash: 'ffffffffffffffff' } })),
    );
  });
});

describe('kimlik modeli · otorite sınırları', () => {
  it('26. 🔒 gözlem HAM PARMAK İZİ GİRDİSİ taşımaz (ECU/bitmap/MAC)', () => {
    const keys = Object.keys(obs());
    for (const forbidden of ['ecuAddresses', 'supportedPidBitmap', 'adapterMac', 'metadata']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('27. 🔒 gözlem `device_id` TAŞIMAZ (araç kimliği ≠ cihaz)', () => {
    const s = JSON.stringify(obs()).toLowerCase();
    expect(s).not.toContain('device');
    expect(Object.keys(obs())).not.toContain('deviceId');
  });

  it('28. 🔒 gözlem SAHİPLİK alanı TAŞIMAZ (VIN otorite değil)', () => {
    const keys = Object.keys(obs()).map((k) => k.toLowerCase());
    for (const forbidden of ['ownerid', 'owner', 'userid', 'companyid']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('29. 🔒 güven puanı SUNUCUDAN gelmez, yerel öğrenmedir; revizyon istemcide ÜRETİLMEZ', () => {
    // knownRevision verilmezse null kalır — istemci revizyon UYDURMAZ.
    expect(obs().identityRevision).toBeNull();
    expect(buildIdentityObservation({
      nowMs: NOW, vid: { vin: VIN, transportVerified: true }, knownRevision: 7,
    }).identityRevision).toBe(7);
  });
});
