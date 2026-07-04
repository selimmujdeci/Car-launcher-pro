/**
 * obdCoreV2.patch12.uds.test.ts — Patch 12A/12B (UDS Mode 22 / manufacturerPidService)
 *
 * Kilitler:
 *  - vehicleDidProfile şema doğrulama: bozuk/eksik profil YÜKLENMEZ (dürüst hata listesi);
 *    source ZORUNLU, decode.fn yalnız izinli küme (eval/DSL yok), ecu referans bütünlüğü,
 *    yinelenen DID, min>max, div a=0 (sıfıra bölme) reddi.
 *  - decode fn tablosu: A/AB/temp40/pct/linear/div — saf fonksiyon, sınır dışı → NaN.
 *  - manufacturerPidService: izleyici yokken zamanlayıcı KURULMAZ (Mali-400 sıfır maliyet),
 *    ilk izleyici başlatır/son izleyici durdurur, tur → readObdDid → decode → watcher.
 *  - 7F-31/33 (supported:false) → KALICI desteklenmiyor, bir sonraki turda tekrar sorulmaz.
 *  - Bağlantısız (native reject) → değer güncellenmez, dürüst undefined/null kalır.
 *  - sensorQueryService köprüsü: profilsiz davranış DEĞİŞMEZ; profil yüklüyse DID Türkçe
 *    adı alias havuzuna katılır, querySensor 'manufacturer' kaynaklı dürüst cevap üretir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  isNative: true,
  readObdDidMock: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => M.isNative) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readObdDid: (...args: unknown[]) => M.readObdDidMock(...args),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

// sensorQueryService bu iki modülü de import eder — CORE/EXTENDED dallarını bu dosyada
// egzersiz etmiyoruz ama import zinciri kırılmasın diye patch9 testindeki desenle mock'lanır.
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(() => ({})),
}));
vi.mock('../platform/obd/extendedPidService', () => ({
  getPidValue: vi.fn(() => undefined),
  isPidSupported: vi.fn(() => null),
  watchPid: vi.fn(() => () => {}),
}));

import {
  validateVehicleDidProfile,
  compileVehicleDidProfile,
  decodeCompiledDid,
} from '../platform/obd/vehicleDidProfile';
import type { VehicleDidProfile } from '../platform/obd/vehicleDidProfile';
import {
  loadProfile, unloadProfile, watchDid, getDidValue, isDidSupported, getSupportedDids, _internals,
} from '../platform/obd/manufacturerPidService';
import { querySensor, resolveSensor } from '../platform/obd/sensorQueryService';

const VALID_PROFILE: VehicleDidProfile = {
  brand: 'TestMoto',
  source: 'ISO 14229-1 (kamu standart, test amaçlı fixture)',
  ecus: [
    { id: 'engine', name: 'Motor ECU', tx: '7E0', rx: '7E8' },
  ],
  dids: [
    { did: '1234', ecu: 'engine', name: 'Diferansiyel sıcaklığı', unit: '°C', bytes: 1, min: -40, max: 215, category: 'sicaklik', decode: { fn: 'temp40' } },
    { did: '5678', ecu: 'engine', name: 'Özel motor yükü', unit: '%', bytes: 1, min: 0, max: 100, category: 'motor', decode: { fn: 'pct' } },
  ],
};

beforeEach(() => {
  _internals.reset();
  M.isNative = true;
  M.readObdDidMock.mockReset();
});

describe('Patch 12B — vehicleDidProfile şema doğrulama', () => {
  it('geçerli profil kabul edilir', () => {
    const r = validateVehicleDidProfile(VALID_PROFILE);
    expect(r.valid).toBe(true);
  });

  it('nesne olmayan girdi reddedilir', () => {
    expect(validateVehicleDidProfile(null).valid).toBe(false);
    expect(validateVehicleDidProfile('string').valid).toBe(false);
    expect(validateVehicleDidProfile([]).valid).toBe(false);
    expect(validateVehicleDidProfile(42).valid).toBe(false);
  });

  it('source eksikse/boşsa reddedilir — hata mesajında "source" geçer', () => {
    const bad = { ...VALID_PROFILE, source: '' };
    const r = validateVehicleDidProfile(bad);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.toLowerCase().includes('source'))).toBe(true);
  });

  it('brand eksikse reddedilir', () => {
    const bad = { ...VALID_PROFILE, brand: undefined };
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });

  it('geçersiz decode.fn (eval/DSL girişimi) reddedilir', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PROFILE));
    bad.dids[0].decode = { fn: 'eval', a: 1 };
    const r = validateVehicleDidProfile(bad);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.includes('decode.fn'))).toBe(true);
  });

  it("'div' fonksiyonunda a=0 (sıfıra bölme) reddedilir", () => {
    const bad = JSON.parse(JSON.stringify(VALID_PROFILE));
    bad.dids[0].decode = { fn: 'div', a: 0 };
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });

  it('yinelenen DID reddedilir', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PROFILE));
    bad.dids.push({ ...bad.dids[0], name: 'kopya DID' });
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });

  it('tanımsız ecu referansı reddedilir', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PROFILE));
    bad.dids[0].ecu = 'olmayan-ecu';
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });

  it('min > max reddedilir', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PROFILE));
    bad.dids[0].min = 100;
    bad.dids[0].max = 0;
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });

  it('geçersiz DID hex formatı reddedilir', () => {
    const bad = JSON.parse(JSON.stringify(VALID_PROFILE));
    bad.dids[0].did = 'ZZZZ';
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });

  it('ecus boş dizi ise reddedilir', () => {
    const bad = { ...VALID_PROFILE, ecus: [] };
    expect(validateVehicleDidProfile(bad).valid).toBe(false);
  });
});

describe('Patch 12B — decode fn tablosu', () => {
  const profile: VehicleDidProfile = {
    brand: 'Test', source: 'kaynak (test fixture)',
    ecus: [{ id: 'e', name: 'ECU', tx: '7E0', rx: '7E8' }],
    dids: [
      { did: '0001', ecu: 'e', name: 'A',           unit: '',   bytes: 1, min: 0,    max: 200,   category: 'x', decode: { fn: 'A' } },
      { did: '0002', ecu: 'e', name: 'AB',          unit: '',   bytes: 2, min: 0,    max: 65535, category: 'x', decode: { fn: 'AB' } },
      { did: '0003', ecu: 'e', name: 'temp40',      unit: '°C', bytes: 1, min: -40,  max: 215,   category: 'x', decode: { fn: 'temp40' } },
      { did: '0004', ecu: 'e', name: 'pct',         unit: '%',  bytes: 1, min: 0,    max: 100,   category: 'x', decode: { fn: 'pct' } },
      { did: '0005', ecu: 'e', name: 'linear1bayt', unit: '',   bytes: 1, min: 0,    max: 1000,  category: 'x', decode: { fn: 'linear', a: 2, b: 10 } },
      { did: '0006', ecu: 'e', name: 'linear2bayt', unit: '',   bytes: 2, min: 0,    max: 100000, category: 'x', decode: { fn: 'linear', a: 0.25 } },
      { did: '0007', ecu: 'e', name: 'div1bayt',    unit: '',   bytes: 1, min: 0,    max: 100,   category: 'x', decode: { fn: 'div', a: 2 } },
      { did: '0008', ecu: 'e', name: 'div2bayt',    unit: '',   bytes: 2, min: 0,    max: 10000, category: 'x', decode: { fn: 'div', a: 10 } },
    ],
  };
  const compiled = compileVehicleDidProfile(profile);

  it('A: ilk bayt aynen', () => {
    expect(decodeCompiledDid(compiled.get('0001')!, '7F')).toBe(127);
  });
  it('AB: 2 bayt big-endian', () => {
    expect(decodeCompiledDid(compiled.get('0002')!, '01F4')).toBe(500); // 0x01F4 = 500
  });
  it('temp40: A-40', () => {
    expect(decodeCompiledDid(compiled.get('0003')!, '32')).toBe(10); // 0x32=50, 50-40=10
  });
  it('pct: A/2.55', () => {
    expect(decodeCompiledDid(compiled.get('0004')!, 'FF')).toBeCloseTo(100, 5); // 255/2.55≈100
  });
  it('linear 1-bayt: A*a+b', () => {
    expect(decodeCompiledDid(compiled.get('0005')!, '05')).toBe(20); // 5*2+10=20
  });
  it('linear 2-bayt: AB*a (b varsayılan 0)', () => {
    expect(decodeCompiledDid(compiled.get('0006')!, '0064')).toBe(25); // AB=100, *0.25=25
  });
  it('div 1-bayt: A/a', () => {
    expect(decodeCompiledDid(compiled.get('0007')!, '0A')).toBe(5); // 10/2=5
  });
  it('div 2-bayt: AB/a', () => {
    expect(decodeCompiledDid(compiled.get('0008')!, '0064')).toBe(10); // AB=100, /10=10
  });
  it('sınır dışı değer → NaN (fail-soft, çağıran atlar)', () => {
    expect(decodeCompiledDid(compiled.get('0001')!, 'FF')).toBeNaN(); // 255 > max(200)
  });
  it('yetersiz bayt → NaN', () => {
    expect(decodeCompiledDid(compiled.get('0002')!, '01')).toBeNaN(); // 2 bayt bekleniyor, 1 geldi
  });
});

describe('Patch 12B — manufacturerPidService: sıfır-boşta + abonelik (Mali-400 kuralı)', () => {
  it('izleyici yokken zamanlayıcı KURULMAZ', () => {
    loadProfile(VALID_PROFILE);
    expect(_internals.hasTimer()).toBe(false);
  });

  it('ilk izleyici zamanlayıcıyı başlatır, son izleyici bırakınca durur', () => {
    loadProfile(VALID_PROFILE);
    const unsub = watchDid('1234', () => {});
    expect(_internals.hasTimer()).toBe(true);
    unsub();
    expect(_internals.hasTimer()).toBe(false);
  });

  it('profil yükleme başarısızsa (bozuk profil) mevcut hiçbir DID izlenemez', () => {
    const bad = { ...VALID_PROFILE, source: '' };
    const r = loadProfile(bad);
    expect(r.ok).toBe(false);
    expect(getSupportedDids()).toEqual([]);
  });

  it('tur: readObdDid çağrılır, değer decode edilip watcher\'a ulaşır', async () => {
    loadProfile(VALID_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: '32', supported: true }); // temp40(0x32)=10
    const values: number[] = [];
    watchDid('1234', (v) => values.push(v.value));

    await _internals.tick();

    expect(M.readObdDidMock).toHaveBeenCalledWith({ tx: '7E0', rx: '7E8', did: '1234' });
    expect(values).toEqual([10]);
    expect(getDidValue('1234')?.value).toBe(10);
  });

  it('unloadProfile sonrası izlenecek DID kalmaz, zamanlayıcı durur', () => {
    loadProfile(VALID_PROFILE);
    const unsub = watchDid('1234', () => {});
    expect(_internals.hasTimer()).toBe(true);
    unloadProfile();
    expect(_internals.hasTimer()).toBe(false);
    expect(getSupportedDids()).toEqual([]);
    unsub();
  });
});

describe('Patch 12B — 7F-31/33 kalıcı desteklenmiyor işareti', () => {
  it('supported:false → kalıcı işaretlenir, sonraki turda TEKRAR SORULMAZ', async () => {
    loadProfile(VALID_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: null, supported: false });
    watchDid('1234', () => {});

    await _internals.tick();
    expect(isDidSupported('1234')).toBe(false);

    M.readObdDidMock.mockClear();
    await _internals.tick(); // tek izlenen DID zaten _unsupported'ta → _watchedDids() boş
    expect(M.readObdDidMock).not.toHaveBeenCalled();
  });
});

describe('Patch 12B — bağlantısız dürüst davranış', () => {
  it('native reddederse (bağlantı yok) değer güncellenmez, dürüst undefined/null kalır', async () => {
    loadProfile(VALID_PROFILE);
    M.readObdDidMock.mockRejectedValue(new Error('OBD bağlantısı yok'));
    watchDid('1234', () => {});

    await _internals.tick();

    expect(getDidValue('1234')).toBeUndefined();
    expect(isDidSupported('1234')).toBeNull();
  });
});

describe('Patch 12B — sensorQueryService DID köprüsü', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('profil YOKSA manufacturer-DID sorusu eşleşmez (profilsiz davranış DEĞİŞMEZ)', () => {
    expect(resolveSensor('diferansiyel sıcaklığı kaç derece')).toBeNull();
  });

  it('profil yüklüyse DID Türkçe adı alias havuzuna katılır', () => {
    loadProfile(VALID_PROFILE);
    expect(resolveSensor('diferansiyel sıcaklığı kaç derece')).toMatchObject({ kind: 'did', did: '1234' });
  });

  it('taze önbellek varsa querySensor anında "manufacturer" cevabı döner', async () => {
    loadProfile(VALID_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: '32', supported: true }); // temp40(0x32)=10
    const unsub = watchDid('1234', () => {});
    await _internals.tick();
    unsub();

    const a = await querySensor('diferansiyel sıcaklığı');
    expect(a).not.toBeNull();
    expect(a!.source).toBe('manufacturer');
    expect(a!.value).toBe(10);
    expect(a!.text).toBe('Diferansiyel sıcaklığı 10 derece.');
  });

  it('7F-31 sonrası querySensor dürüst "desteklenmiyor" cevabı verir, bekleme yok', async () => {
    loadProfile(VALID_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: null, supported: false });
    const unsub = watchDid('1234', () => {});
    await _internals.tick();
    unsub();

    const a = await querySensor('diferansiyel sıcaklığı');
    expect(a!.value).toBeNull();
    expect(a!.text).toContain('desteklenmiyor');
  });

  it('önbellek yoksa geçici abonelikle taze değer beklenir ve abonelik BIRAKILIR', async () => {
    vi.useFakeTimers();
    loadProfile(VALID_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: '32', supported: true });

    const p = querySensor('diferansiyel sıcaklığı');
    await vi.advanceTimersByTimeAsync(0); // watcher kurulsun
    await _internals.tick(); // round-robin turu manuel tetikle (fake setInterval'i beklemeden)

    const a = await p;
    expect(a!.value).toBe(10);
    expect(_internals.hasTimer()).toBe(false); // sorgu bitince abonelik bırakıldı → zamanlayıcı durdu
  });

  it('eşleşmeyen soru → null (sahte cevap yasak)', async () => {
    loadProfile(VALID_PROFILE);
    expect(await querySensor('bugün hava nasıl')).toBeNull();
  });
});
