/**
 * discoveryRepositoryAndCandidates.test — P0 Deep PID/DID Explorer Faz-1.
 * Kapsam: discoveredDataRepository (kalıcı kayıt + #20 eski profilleri bozmama),
 *         didCandidateProvider (#12 gereksiz tekrar taramama filtresi, #16 çapraz-ECU izolasyonu).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _store = new Map<string, string>();
vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => _store.get(k) ?? null,
  safeSetRaw: (k: string, v: string) => { _store.set(k, v); },
}));

import {
  hashVin, loadRecords, upsertDiscoveredRecord, getRecord, type DiscoveredDataRecord,
} from '../platform/obd/discovery/discoveredDataRepository';
import { gatherDidCandidates } from '../platform/obd/discovery/didCandidateProvider';
import type { VehicleDidProfile } from '../platform/obd/vehicleDidProfile';

beforeEach(() => {
  _store.clear();
});

describe('discoveredDataRepository — hashVin (autoDidDiscovery ile AYNI FNV-1a)', () => {
  it('deterministik ve aynı VIN → aynı hash', () => {
    expect(hashVin('VF1CDACIA0000001')).toBe(hashVin('VF1CDACIA0000001'));
    expect(hashVin('VF1CDACIA0000001')).not.toBe(hashVin('WVWZZZ1JZXW000001'));
  });
});

describe('discoveredDataRepository — upsert + load', () => {
  const base = {
    kind: 'did' as const, identifier: '2201', ecuAddress: '7E8', service: '22' as const,
    protocolClass: 'can' as const, vinHash: 'abc123',
    rawRequestSample: '222201', rawResponseSample: '4A20',
    decoderId: null, validationStatus: 'DISCOVERED_UNKNOWN' as const, confidence: 0.3,
    latencyMs: 120, success: true, recommendedPollClass: 'DISCOVERY_ONLY' as const,
    discoverySource: 'auto_did_cache' as const,
  };

  it('yeni kayıt oluşturur; firstSeenAt/lastSeenAt/sayaçlar doğru', () => {
    const rec = upsertDiscoveredRecord('fp1', base);
    expect(rec.successfulReadCount).toBe(1);
    expect(rec.failureCount).toBe(0);
    expect(rec.firstSeenAt).toBe(rec.lastSeenAt);
    expect(loadRecords('fp1')).toHaveLength(1);
  });

  it('ikinci gözlem MEVCUT kaydı GÜNCELLER (yeni kayıt oluşturmaz)', () => {
    upsertDiscoveredRecord('fp1', base);
    const second = upsertDiscoveredRecord('fp1', { ...base, success: false, validationStatus: 'SUSPICIOUS' });
    expect(loadRecords('fp1')).toHaveLength(1);
    expect(second.successfulReadCount).toBe(1);
    expect(second.failureCount).toBe(1);
    expect(second.validationStatus).toBe('SUSPICIOUS');
  });

  it('getRecord kind+identifier+ecuAddress ÜÇLÜSÜYLE bulur', () => {
    upsertDiscoveredRecord('fp1', base);
    expect(getRecord('fp1', 'did', '2201', '7E8')).not.toBeNull();
    expect(getRecord('fp1', 'did', '2201', '7E9')).toBeNull(); // farklı ECU → AYRI kayıt
    expect(getRecord('fp1', 'did', '2202', '7E8')).toBeNull(); // farklı DID → AYRI kayıt
  });

  it('#20 kalıcı yazma MEVCUT/ilgisiz safeStorage anahtarlarını BOZMAZ', () => {
    // Simüle: autoDidDiscovery'nin KENDİ cache anahtarı zaten var (DOKUNULMAZ dosya davranışı).
    _store.set('obd:autoDid:abc123', JSON.stringify({ vinHash: 'abc123', scannedAt: 1, ecus: 1, dids: [] }));
    const before = _store.get('obd:autoDid:abc123');

    upsertDiscoveredRecord('fp1', base);

    expect(_store.get('obd:autoDid:abc123')).toBe(before); // DEĞİŞMEDİ
    // Kendi anahtarım AYRI isim uzayında.
    const myKeys = [..._store.keys()].filter((k) => k.startsWith('obd:discovery:v1:'));
    expect(myKeys).toHaveLength(1);
    expect(myKeys[0]).not.toContain('obd:autoDid:');
  });
});

describe('didCandidateProvider — gatherDidCandidates (§B)', () => {
  const profileCan: VehicleDidProfile = {
    brand: 'Test CAN', source: 'test', protocols: ['can'],
    ecus: [{ id: 'engine', name: 'Motor', tx: '7E0', rx: '7E8' }],
    dids: [{ did: 'F190', ecu: 'engine', name: 'VIN', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } }],
  };
  const profileKwp: VehicleDidProfile = {
    brand: 'Test KWP', source: 'test', protocols: ['kwp'],
    ecus: [{ id: 'engine', name: 'Motor', tx: '8110F1', rx: '' }],
    dids: [{ did: '80', ecu: 'engine', service: '21', name: 'Sıcaklık', unit: '°C', bytes: 1, min: -40, max: 215, category: 'sicaklik', decode: { fn: 'temp40' } }],
  };

  it('protokol sınıfına göre filtreler (CAN aracında KWP profili DIŞARIDA kalır)', () => {
    const cands = gatherDidCandidates({ protocolClass: 'can', profiles: [profileCan, profileKwp] });
    expect(cands.map((c) => c.did)).toEqual(['F190']);
  });

  it('#16 AYNI DID farklı ECU/profillerde AYRI adaylardır (çapraz-ECU karışmaz — dedup anahtarı tx içerir)', () => {
    // (compileVehicleDidProfile Map anahtarı yalnız 'did' olduğundan — vehicleDidProfile.ts
    // KORUMALI/dokunulmaz — aynı profil İÇİNDE aynı DID iki ECU'da temsil edilemez; bu yüzden
    // çapraz-ECU senaryosu İKİ AYRI profil ile modellenir — gerçekçi durum: iki farklı üretici
    // profili aynı standart DID'i farklı ECU adresinde tanımlayabilir.)
    const profileEngine: VehicleDidProfile = {
      brand: 'Motor Profili', source: 'test', protocols: ['can'],
      ecus: [{ id: 'engine', name: 'Motor', tx: '7E0', rx: '7E8' }],
      dids: [{ did: 'F190', ecu: 'engine', name: 'VIN (motor)', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } }],
    };
    const profileTrans: VehicleDidProfile = {
      brand: 'Şanzıman Profili', source: 'test', protocols: ['can'],
      ecus: [{ id: 'trans', name: 'Şanzıman', tx: '7E1', rx: '7E9' }],
      dids: [{ did: 'F190', ecu: 'trans', name: 'VIN (şanzıman)', unit: '', bytes: 17, min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' } }],
    };
    const cands = gatherDidCandidates({ protocolClass: 'can', profiles: [profileEngine, profileTrans] });
    expect(cands).toHaveLength(2);
    expect(new Set(cands.map((c) => c.tx))).toEqual(new Set(['7E0', '7E1']));
  });

  it('#12 kalıcı depoda REJECTED/UNSUPPORTED aday olarak GERİ GELMEZ', () => {
    const repoRecords: DiscoveredDataRecord[] = [
      { vehicleFingerprint: 'fp', vinHash: null, protocolClass: 'can', ecuAddress: '7E8', kind: 'did',
        identifier: '2299', service: '22', rawRequestSample: '', rawResponseSample: '', decoderId: null,
        decoderVersion: 1, validationStatus: 'UNSUPPORTED', confidence: 0, firstSeenAt: 0, lastSeenAt: 0,
        successfulReadCount: 0, failureCount: 3, averageLatencyMs: 0, recommendedPollClass: 'DISCOVERY_ONLY',
        discoverySource: 'auto_did_cache' },
    ];
    const cands = gatherDidCandidates({ protocolClass: 'can', repositoryRecords: repoRecords });
    expect(cands).toHaveLength(0);
  });

  it('auto-discovered DID decoder BİLİNMİYOR olarak işaretlenir (uydurma yok)', () => {
    const cands = gatherDidCandidates({
      protocolClass: 'can', autoDiscovered: [{ did: '2201', dataHex: '4A20', ecuRx: '7E8' }],
    });
    expect(cands).toHaveLength(1);
    expect(cands[0]!.hasKnownDecoder).toBe(false);
    expect(cands[0]!.name).toBeNull();
  });

  it('aday tavanı (maxCandidates) bounded — DoS gibi davranmaz', () => {
    const manyDids = Array.from({ length: 50 }, (_, i) => ({
      did: (0x2200 + i).toString(16).toUpperCase(), dataHex: '00', ecuRx: '7E8',
    }));
    const cands = gatherDidCandidates({ protocolClass: 'can', autoDiscovered: manyDids, maxCandidates: 10 });
    expect(cands).toHaveLength(10);
  });
});
