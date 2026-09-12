/**
 * obdKwpAcquisition.test — PR-OBD-KWP-1: KWP (ISO 14230) veri-yolu kilitleri.
 *
 * Trafic sahası kök nedenleri:
 *  (1) CAN-adresli profil KWP hattında sorgulanıyordu → COMM_ERROR fırtınası.
 *  (2) Servis 21 (ReadDataByLocalIdentifier) yolu yoktu → KWP üretici verisi okunamazdı.
 *  (3) NO_DATA dönen extended PID'ler sonsuza dek yeniden sorgulanıyordu.
 * Bu dosya şema + protokol kapısı + servis parametresi + no-data durumu + signalHub
 * tek-otorite sözleşmesini kilitler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn().mockReturnValue(true) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { readObdDid: vi.fn(), setObdExtendedPids: vi.fn().mockResolvedValue(undefined), addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/safety/vinContext', () => ({ getHandshakeVin: vi.fn().mockReturnValue(null) }));

import { CarLauncher } from '../platform/nativePlugin';
import { validateVehicleDidProfile, compileVehicleDidProfile } from '../platform/obd/vehicleDidProfile';
import type { VehicleDidProfile } from '../platform/obd/vehicleDidProfile';
import {
  classifyMode22, getMode22Evidence, loadProfile, watchDid,
  _internals as m22Internals,
} from '../platform/obd/manufacturerPidService';
import { setActiveObdProtocol, getActiveProtocolClass } from '../platform/obd/activeProtocol';
import { renaultTraficKwpProfile } from '../platform/obd/profiles/renaultTraficKwpProfile';
import { renaultDaciaProfile } from '../platform/obd/profiles/renaultDaciaProfile';
import { universalUdsProfile } from '../platform/obd/profiles/universalUdsProfile';
import {
  getPidStatus, getUnavailablePids, notifyObdConnected, seedSupportedPids,
  _internals as extInternals,
} from '../platform/obd/extendedPidService';
import { startDiscovery } from '../platform/obd/didDiscoveryService';

/** Geçerli minimal profil üretici — testler alanları ezerek bozar. */
function baseProfile(over: Partial<VehicleDidProfile> = {}): VehicleDidProfile {
  return {
    brand: 'Test', source: 'ISO 14229-1 (test)',
    ecus: [{ id: 'engine', name: 'Motor', tx: '7E0', rx: '7E8' }],
    dids: [{
      did: 'F190', ecu: 'engine', name: 'VIN', unit: '', bytes: 17,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    }],
    ...over,
  };
}

describe('vehicleDidProfile şeması — KWP genişletmesi', () => {
  it('boş tx+rx (varsayılan oturum) KABUL edilir', () => {
    const r = validateVehicleDidProfile(baseProfile({
      ecus: [{ id: 'engine', name: 'Motor', tx: '', rx: '' }],
    }));
    expect(r.valid).toBe(true);
  });

  it('6 haneli KWP header (8110F1) KABUL edilir', () => {
    const r = validateVehicleDidProfile(baseProfile({
      ecus: [{ id: 'engine', name: 'Motor', tx: '8110F1', rx: 'F110' }],
    }));
    // rx 4 hane GEÇERSİZ — yalnız tx'in 6 hane kabulünü izole test etmek için rx'i de düzelt.
    expect(r.valid).toBe(false);
    const r2 = validateVehicleDidProfile(baseProfile({
      ecus: [{ id: 'engine', name: 'Motor', tx: '8110F1', rx: '' }],
    }));
    expect(r2.valid).toBe(true);
  });

  it('tx boşken rx dolu → RED (rx tek başına anlamsız)', () => {
    const r = validateVehicleDidProfile(baseProfile({
      ecus: [{ id: 'engine', name: 'Motor', tx: '', rx: '7E8' }],
    }));
    expect(r.valid).toBe(false);
    expect(!r.valid && r.errors.some((e) => e.includes('rx de boş'))).toBe(true);
  });

  it("servis 21 + 2 haneli LID KABUL; servis 21 + 4 haneli DID RED", () => {
    const ok = validateVehicleDidProfile(baseProfile({
      dids: [{
        did: '80', service: '21', ecu: 'engine', name: 'Test LID', unit: '', bytes: 1,
        min: 0, max: 255, category: 'motor', decode: { fn: 'A' },
      }],
    }));
    expect(ok.valid).toBe(true);

    const bad = validateVehicleDidProfile(baseProfile({
      dids: [{
        did: 'F190', service: '21', ecu: 'engine', name: 'Yanlış', unit: '', bytes: 1,
        min: 0, max: 255, category: 'motor', decode: { fn: 'A' },
      }],
    }));
    expect(bad.valid).toBe(false);
  });

  it('geçersiz protocols değeri RED edilir; geçerli liste kabul', () => {
    expect(validateVehicleDidProfile(baseProfile({
      protocols: ['canbus' as never],
    })).valid).toBe(false);
    expect(validateVehicleDidProfile(baseProfile({ protocols: ['kwp', 'iso9141'] })).valid).toBe(true);
  });

  it("derlenen tanım service taşır — belirtilmezse '22' (geriye dönük uyum)", () => {
    const compiled = compileVehicleDidProfile(baseProfile());
    expect(compiled.get('F190')?.service).toBe('22');
    const compiled21 = compileVehicleDidProfile(baseProfile({
      dids: [{
        did: '80', service: '21', ecu: 'engine', name: 'LID', unit: '', bytes: 1,
        min: 0, max: 255, category: 'motor', decode: { fn: 'A' },
      }],
    }));
    expect(compiled21.get('80')?.service).toBe('21');
  });
});

describe('hazır profiller — protokol kısıtları', () => {
  it('Trafic KWP profili geçerlidir ve kwp/iso9141 kısıtlıdır', () => {
    const r = validateVehicleDidProfile(renaultTraficKwpProfile);
    expect(r.valid).toBe(true);
    expect(renaultTraficKwpProfile.protocols).toEqual(['kwp', 'iso9141']);
    // Varsayılan oturum adreslemesi: header'a dokunulmaz (KWP'de en olası başarı yolu).
    expect(renaultTraficKwpProfile.ecus[0]!.tx).toBe('');
  });

  it("CAN profilleri 'can' kısıtı taşır (KWP hattında sorgulanmaz)", () => {
    expect(renaultDaciaProfile.protocols).toEqual(['can']);
    expect(universalUdsProfile.protocols).toEqual(['can']);
    expect(validateVehicleDidProfile(renaultDaciaProfile).valid).toBe(true);
    expect(validateVehicleDidProfile(universalUdsProfile).valid).toBe(true);
  });
});

describe('manufacturerPidService — protokol kapısı + servis parametresi', () => {
  beforeEach(() => {
    m22Internals.reset();
    vi.mocked(CarLauncher.readObdDid).mockReset();
    setActiveObdProtocol(null);
  });

  it('KWP hattında CAN-kısıtlı profil SORGULANMAZ → PROTOCOL_MISMATCH kanıtı', async () => {
    setActiveObdProtocol('5'); // KWP fast
    expect(getActiveProtocolClass()).toBe('kwp');
    expect(loadProfile(renaultDaciaProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    await m22Internals.tick();
    expect(CarLauncher.readObdDid).not.toHaveBeenCalled(); // COMM_ERROR fırtınası YOK
    const e = getMode22Evidence();
    expect(e.protocolGated).toBe(true);
    expect(e.decision).toBe('PROTOCOL_MISMATCH');
    stop();
  });

  it('KWP hattında Trafic profili sorgulanır — service ve boş tx native köprüye ULAŞIR', async () => {
    setActiveObdProtocol('5');
    expect(loadProfile(renaultTraficKwpProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({
      supported: true, data: '5646314A5A5A5A5A5A5A5A5A5A5A5A5A5A',
    });
    await m22Internals.tick();
    expect(CarLauncher.readObdDid).toHaveBeenCalledWith({ tx: '', rx: '', did: 'F190', service: '22' });
    expect(getMode22Evidence().decision).toBe('HAS_REAL_VALUE');
    stop();
  });

  it('protokol BİLİNMİYORKEN (null) kapı sorguyu KESMEZ (yanlış-negatif yasak)', async () => {
    setActiveObdProtocol(null);
    expect(loadProfile(renaultDaciaProfile).ok).toBe(true);
    const stop = watchDid('F190', () => {});
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({ supported: false, data: null });
    await m22Internals.tick();
    expect(CarLauncher.readObdDid).toHaveBeenCalled();
    stop();
  });

  it('classifyMode22: protocolGated + hiç probe yok → PROTOCOL_MISMATCH; probe varsa normal akış', () => {
    const base = { profileLoaded: true, watchedCount: 1, probed: 0, supported: 0, unsupported: 0, commError: 0 };
    expect(classifyMode22({ ...base, protocolGated: true })).toBe('PROTOCOL_MISMATCH');
    expect(classifyMode22({ ...base, protocolGated: true, probed: 2, supported: 1 })).toBe('HAS_REAL_VALUE');
    expect(classifyMode22({ ...base, protocolGated: false })).toBe('NOT_PROBED');
  });
});

describe('extendedPidService — NO_DATA gerçek neden durumu', () => {
  beforeEach(() => {
    extInternals.reset();
  });

  it("native demote olayı → getPidStatus 'no_data' + getUnavailablePids listeler", () => {
    extInternals.onExtendedPidStatus({ pid: '5c', status: 'no_data' });
    expect(getPidStatus('5C')).toBe('no_data');
    expect(getUnavailablePids().get('5C')).toBe('no_data');
  });

  it("taze değer 'live'; demote edilmişse değer olsa bile 'no_data' (artık akmıyor)", () => {
    extInternals.onExtendedData({ pid: '5C', data: '8C' }); // yağ sıcaklığı 100°C
    expect(getPidStatus('5C')).toBe('live');
    extInternals.onExtendedPidStatus({ pid: '5C', status: 'no_data' });
    expect(getPidStatus('5C')).toBe('no_data');
  });

  it("bitmap keşfi PID'i içermiyorsa 'unsupported'; hiç kanıt yoksa 'probing'", () => {
    expect(getPidStatus('5C')).toBe('probing'); // keşif yok → dürüst "bilinmiyor"
    seedSupportedPids([0x0c, 0x0d]); // handshake kanıtı: yalnız 0C/0D destekli → 5C YOK
    expect(getPidStatus('5C')).toBe('unsupported');
  });

  it('yeni bağlantı (notifyObdConnected) no_data damgalarını sıfırlar (farklı araç olabilir)', () => {
    extInternals.onExtendedPidStatus({ pid: '5C', status: 'no_data' });
    expect(getPidStatus('5C')).toBe('no_data');
    notifyObdConnected();
    expect(getUnavailablePids().size).toBe(0);
  });
});

describe('didDiscoveryService — Servis 21 LID taraması', () => {
  beforeEach(() => {
    vi.mocked(CarLauncher.readObdDid).mockReset();
  });

  it("service '21' → 2 haneli LID aralığı üretir ve service native'e geçer", async () => {
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({ supported: false, data: null });
    const out = await startDiscovery({ tx: '', rx: '', from: '00', to: '02', service: '21' });
    expect(out.summary.scanned).toBe(3);
    expect(CarLauncher.readObdDid).toHaveBeenCalledWith({ tx: '', rx: '', did: '00', service: '21' });
    expect(CarLauncher.readObdDid).toHaveBeenCalledWith({ tx: '', rx: '', did: '02', service: '21' });
  });

  it("service verilmezse '22' + 4 haneli DID (geriye dönük uyum)", async () => {
    vi.mocked(CarLauncher.readObdDid).mockResolvedValue({ supported: false, data: null });
    await startDiscovery({ tx: '7E0', rx: '7E8', from: 'F190', to: 'F190' });
    expect(CarLauncher.readObdDid).toHaveBeenCalledWith({ tx: '7E0', rx: '7E8', did: 'F190', service: '22' });
  });
});
