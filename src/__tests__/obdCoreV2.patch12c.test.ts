/**
 * obdCoreV2.patch12c.test.ts — Patch 12C/12D kilitleri (HANDOFF #13'te "12C için YENİ TEST
 * YOK" olarak işaretlenen eksik):
 *
 *  - vehicleDidProfile 'ascii' decode dalı (decodeCompiledDid isText): çok baytlı metin,
 *    yazdırılamayan bayt temizliği, yetersiz/boş veri → NaN (sayısal dalla AYNI fail-soft
 *    sözleşmesi).
 *  - manufacturerPidService.verifyVinAgainstMode09: F190 ↔ Mode 09 eşleşme/uyuşmazlık/
 *    karşılaştırılamama (matched:null) dalları — dürüstlük sözleşmesi.
 *  - didDiscoveryService.startDiscovery: tarama/iptal/kısmi-sonuç/plugin_unavailable +
 *    exportDiscoveryResultsAsJson şekli.
 *  - Her iki gerçek profil dosyası (universalUdsProfile, renaultDaciaProfile) şema
 *    doğrulamasından GEÇER (12A/B'de yalnız sentetik test profili doğrulanmıştı).
 *  - profiles/index registry + syncManufacturerDidProfile (Patch 12D profil yükleme
 *    bağlaması — önceden hiçbir yerden çağrılmıyordu, ölü kod kilidi).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  isNative: true,
  readObdDidMock: vi.fn(),
  handshakeVin: null as string | null,
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

vi.mock('../platform/safety/vinContext', () => ({
  getHandshakeVin: () => M.handshakeVin,
}));

// sensorQueryService importları (manufacturerPidService zinciri üzerinden) — patch12
// testindeki desenle aynı, CORE/EXTENDED dalları burada egzersiz edilmiyor.
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
  loadProfile, watchDid, getSupportedDids, verifyVinAgainstMode09, _internals,
} from '../platform/obd/manufacturerPidService';
import {
  startDiscovery, exportDiscoveryResultsAsJson,
} from '../platform/obd/didDiscoveryService';
import { universalUdsProfile } from '../platform/obd/profiles/universalUdsProfile';
import { renaultDaciaProfile } from '../platform/obd/profiles/renaultDaciaProfile';
import {
  MANUFACTURER_DID_PROFILES, MANUFACTURER_DID_PROFILE_LABELS, syncManufacturerDidProfile,
} from '../platform/obd/profiles';

beforeEach(() => {
  _internals.reset();
  M.isNative = true;
  M.readObdDidMock.mockReset();
  M.handshakeVin = null;
});

/* ── ascii decode ─────────────────────────────────────────────────────────── */

describe('Patch 12C — vehicleDidProfile ascii decode', () => {
  const profile: VehicleDidProfile = {
    brand: 'Test', source: 'kaynak (test fixture)',
    ecus: [{ id: 'e', name: 'ECU', tx: '7E0', rx: '7E8' }],
    dids: [
      { did: 'F190', ecu: 'e', name: 'VIN', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } },
    ],
  };
  const compiled = compileVehicleDidProfile(profile);
  const def = compiled.get('F190')!;

  it('çok baytlı yazdırılabilir ASCII doğru metne çözülür', () => {
    // "VF1" = 0x56 0x46 0x31
    expect(decodeCompiledDid(def, '564631')).toBe('VF1');
  });

  it('yazdırılamayan baytlar (dolgu/null) sessizce temizlenir', () => {
    // 0x00 + "AB" (0x41 0x42) + 0x0F gürültü baytları — yalnız yazdırılabilir olanlar kalır
    expect(decodeCompiledDid(def, '0041420F')).toBe('AB');
  });

  it('1 baytten az veri (< 2 hex hane) → NaN', () => {
    expect(decodeCompiledDid(def, '')).toBeNaN();
    expect(decodeCompiledDid(def, '5')).toBeNaN(); // tek hex hane — tam bayt değil
  });

  it('tamamı yazdırılamayan bayt → boş metin → NaN (fail-soft)', () => {
    expect(decodeCompiledDid(def, '0000')).toBeNaN();
  });

  it('baştaki/sondaki boşluk trim edilir', () => {
    // ' A ' = 0x20 0x41 0x20
    expect(decodeCompiledDid(def, '204120')).toBe('A');
  });
});

/* ── verifyVinAgainstMode09 ───────────────────────────────────────────────── */

describe('Patch 12C — verifyVinAgainstMode09 VIN çapraz doğrulama', () => {
  const VIN_PROFILE: VehicleDidProfile = {
    brand: 'Test', source: 'ISO 14229-1 (test fixture)',
    ecus: [{ id: 'engine', name: 'Motor ECU', tx: '7E0', rx: '7E8' }],
    dids: [
      { did: 'F190', ecu: 'engine', name: 'Şasi Numarası (VIN)', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } },
    ],
  };

  function hexOf(text: string): string {
    return [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  }

  it('F190 henüz okunmadıysa (profil yüklü değil) matched:null döner', () => {
    M.handshakeVin = 'VF1AAAAA000000001';
    const r = verifyVinAgainstMode09();
    expect(r.matched).toBeNull();
    expect(r.f190Vin).toBeNull();
  });

  it('F190 okundu ama Mode 09 VIN yoksa (el sıkışma yok) matched:null döner', async () => {
    loadProfile(VIN_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: hexOf('VF1AAAAA000000001'), supported: true });
    M.handshakeVin = null;
    const unsub = watchDid('F190', () => {});
    await _internals.tick();
    unsub();

    const r = verifyVinAgainstMode09();
    expect(r.matched).toBeNull();
    expect(r.mode09Vin).toBeNull();
  });

  it('iki VIN eşleşirse matched:true (büyük/küçük harf ve boşluk normalize edilir)', async () => {
    loadProfile(VIN_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: hexOf('VF1AAAAA000000001'), supported: true });
    M.handshakeVin = ' vf1aaaaa000000001 ';
    const unsub = watchDid('F190', () => {});
    await _internals.tick();
    unsub();

    const r = verifyVinAgainstMode09();
    expect(r.matched).toBe(true);
    expect(r.f190Vin).toBe('VF1AAAAA000000001');
    expect(r.mode09Vin).toBe('VF1AAAAA000000001');
  });

  it('iki VIN farklıysa matched:false (uyarı — header sızıntısı/yanlış ECU adayı)', async () => {
    loadProfile(VIN_PROFILE);
    M.readObdDidMock.mockResolvedValue({ data: hexOf('VF1AAAAA000000001'), supported: true });
    M.handshakeVin = 'WBAXXXXX999999999';
    const unsub = watchDid('F190', () => {});
    await _internals.tick();
    unsub();

    const r = verifyVinAgainstMode09();
    expect(r.matched).toBe(false);
  });
});

/* ── didDiscoveryService ──────────────────────────────────────────────────── */

describe('Patch 12C — didDiscoveryService saha keşif aracı', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('native platform değilse plugin_unavailable — hiç sorgu atılmaz', async () => {
    M.isNative = false;
    const r = await startDiscovery({ tx: '7E0', rx: '7E8', from: '2200', to: '2201' });
    expect(r.summary.stopReason).toBe('plugin_unavailable');
    expect(r.results).toEqual([]);
    expect(M.readObdDidMock).not.toHaveBeenCalled();
  });

  it('tam tarama: pozitif/negatif ayrımı doğru sayılır, negatifler listeye girmez', async () => {
    vi.useFakeTimers();
    M.readObdDidMock
      .mockResolvedValueOnce({ data: '564631', supported: true })   // 2200 → pozitif
      .mockResolvedValueOnce({ data: null, supported: false });     // 2201 → negatif

    const p = startDiscovery({ tx: '7E0', rx: '7E8', from: '2200', to: '2201' });
    await vi.runAllTimersAsync(); // yalnız DID'ler arası 150ms bekleme timer'ı var

    const r = await p;
    expect(r.summary.stopReason).toBe('completed');
    expect(r.summary.scanned).toBe(2);
    expect(r.summary.positive).toBe(1);
    expect(r.summary.negative).toBe(1);
    expect(r.results).toEqual([{ did: '2200', dataHex: '564631', bytes: [0x56, 0x46, 0x31] }]);
  });

  it('AbortSignal ile iptal — mevcut DID tamamlanır, sıradaki başlamadan durur (kısmi sonuç)', async () => {
    const controller = new AbortController();
    M.readObdDidMock.mockImplementation(async () => ({ data: '01', supported: true }));

    // İlk DID'in progress bildirimi sırasında iptal — döngü o DID'i BİTİRİR (zaten
    // başlamış istek yarıda kesilmez), yalnız BİR SONRAKİ DID'e geçmeden durur.
    const r = await startDiscovery({
      tx: '7E0', rx: '7E8', from: '2200', to: '2210',
      onProgress: (p) => { if (p.index === 0) controller.abort(); },
      signal: controller.signal,
    });

    expect(r.summary.stopReason).toBe('aborted');
    expect(r.summary.scanned).toBe(1);
    expect(r.results).toHaveLength(1);
    expect(M.readObdDidMock).toHaveBeenCalledTimes(1);
  });

  it('AbortSignal başlangıçta zaten iptal edilmişse hiç sorgu atılmadan durur', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await startDiscovery({
      tx: '7E0', rx: '7E8', from: '2200', to: '2210',
      signal: controller.signal,
    });
    expect(r.summary.stopReason).toBe('aborted');
    expect(r.summary.scanned).toBe(0);
    expect(M.readObdDidMock).not.toHaveBeenCalled();
  });

  it('bağlantı koparsa (native reject) KISMİ sonuçla dürüst durur', async () => {
    vi.useFakeTimers();
    M.readObdDidMock
      .mockResolvedValueOnce({ data: '01', supported: true })
      .mockRejectedValueOnce(new Error('bağlantı koptu'));

    const p = startDiscovery({ tx: '7E0', rx: '7E8', from: '2200', to: '2202' });
    await vi.runAllTimersAsync();

    const r = await p;
    expect(r.summary.stopReason).toBe('connection_lost');
    expect(r.summary.scanned).toBe(1);
    expect(r.results).toHaveLength(1);
  });

  it('exportDiscoveryResultsAsJson: ecu + summary + results alanları JSON\'da yer alır', async () => {
    M.readObdDidMock.mockResolvedValue({ data: '01', supported: true });
    const outcome = await startDiscovery({ tx: '7E0', rx: '7E8', from: '2200', to: '2200' });
    const json = exportDiscoveryResultsAsJson({ tx: '7E0', rx: '7E8' }, outcome);
    const parsed = JSON.parse(json);
    expect(parsed.ecu).toEqual({ tx: '7E0', rx: '7E8' });
    expect(parsed.summary.positive).toBe(1);
    expect(parsed.results[0].did).toBe('2200');
  });
});

/* ── Gerçek profil dosyaları şema doğrulamasından geçer ───────────────────── */

describe('Patch 12C — gerçek profiller (universalUdsProfile / renaultDaciaProfile)', () => {
  it('universalUdsProfile geçerli', () => {
    expect(validateVehicleDidProfile(universalUdsProfile).valid).toBe(true);
  });

  it('renaultDaciaProfile geçerli', () => {
    expect(validateVehicleDidProfile(renaultDaciaProfile).valid).toBe(true);
  });

  it('her iki profil de F190 (VIN) içerir — boru hattı uçtan uca kanıtı', () => {
    expect(universalUdsProfile.dids.some((d) => d.did === 'F190')).toBe(true);
    expect(renaultDaciaProfile.dids.some((d) => d.did === 'F190')).toBe(true);
  });
});

/* ── Patch 12D — profil kayıt defteri + yükleme bağlaması ─────────────────── */

describe('Patch 12D — profiles/index registry + syncManufacturerDidProfile (profil yükleme bağlaması)', () => {
  it('kayıtlı her iki profil de şema doğrulamasından geçer', () => {
    expect(validateVehicleDidProfile(MANUFACTURER_DID_PROFILES['universal-uds']).valid).toBe(true);
    expect(validateVehicleDidProfile(MANUFACTURER_DID_PROFILES['renault-dacia']).valid).toBe(true);
  });

  it('etiket tablosu üç kimliği de (none dahil) kapsar', () => {
    expect(MANUFACTURER_DID_PROFILE_LABELS.none).toBeTruthy();
    expect(MANUFACTURER_DID_PROFILE_LABELS['universal-uds']).toBeTruthy();
    expect(MANUFACTURER_DID_PROFILE_LABELS['renault-dacia']).toBeTruthy();
  });

  it("'none' → unloadProfile, izlenecek DID kalmaz", () => {
    syncManufacturerDidProfile('universal-uds');
    expect(getSupportedDids().length).toBeGreaterThan(0);
    const r = syncManufacturerDidProfile('none');
    expect(r.ok).toBe(true);
    expect(getSupportedDids()).toEqual([]);
  });

  it("'universal-uds' → profil gerçekten yüklenir (önceden hiçbir yerden çağrılmıyordu)", () => {
    const r = syncManufacturerDidProfile('universal-uds');
    expect(r.ok).toBe(true);
    expect(getSupportedDids().some((d) => d.did === 'F190')).toBe(true);
  });

  it("'renault-dacia' profiline geçiş öncekini TAMAMEN değiştirir", () => {
    syncManufacturerDidProfile('universal-uds');
    const before = getSupportedDids().length;
    const r = syncManufacturerDidProfile('renault-dacia');
    expect(r.ok).toBe(true);
    expect(getSupportedDids().length).toBeGreaterThan(0);
    // renaultDaciaProfile daha küçük bir set (henüz marka-özel DID doğrulanmadı, bkz. dosya notu)
    expect(getSupportedDids().length).toBeLessThanOrEqual(before);
  });
});
