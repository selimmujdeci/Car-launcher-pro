/**
 * offlineChangeDetection.test.ts — W5-3c-3 "Offline Change Detection Handler Wiring" kilitleri.
 *
 * KAPSAM: `change_detection` offline fazı İLK kez gerçek bir handler'a bağlanır. Handler
 * yalnız PASİF okuma yapar (fingerprint store + deep scan persistence); araca HİÇBİR aktif
 * sorgu göndermez, hiçbir şey YAZMAZ, Event Bus'a dokunmaz.
 *
 * FAIL-CLOSED SÖZLEŞMESİ: baseline bulunamaması "değişiklik yok" DEĞİLDİR → `no_baseline`.
 * Kanıt yoksa `changedEcu`/`changedFirmware` BİLDİRİLMEZ (undefined) — orchestrator yalnız
 * `=== true` ise `recordChangeDetection`'a düşer.
 *
 * MİMARİ NOT (neden VIN matcher): fingerprint hash'i `V:vin|P:proto|E:ecus|B:bitmap`
 * türevidir → ECU seti değişince HASH DE DEĞİŞİR. Bu yüzden yalnız hash ile arama ECU
 * değişimini ASLA tespit edemez (anahtarın kendisi değişir). Baseline önce hash ile aranır;
 * bulunamazsa VIN eşleşen ÖNCEKİ fingerprint üzerinden bulunur ve ECU setleri karşılaştırılır.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createChangeBaselineAdapter,
  type ChangeBaselineDeps,
} from '../platform/deepScan/changeBaselineAdapter';
import {
  createOfflineChangeDetectionHandler,
} from '../platform/deepScan/offlineChangeDetectionHandler';
import type { PhaseContext, PhaseResult } from '../platform/deepScan/deepScanOrchestrator';
import type { DeepScanRecord } from '../platform/deepScan/deepScanPersistence';
import type { VehicleFingerprint } from '../platform/vehicleFingerprintService';

const SRC_DIR = join(process.cwd(), 'src');
const HANDLER_SRC = readFileSync(join(SRC_DIR, 'platform', 'deepScan', 'offlineChangeDetectionHandler.ts'), 'utf8');
const ADAPTER_SRC = readFileSync(join(SRC_DIR, 'platform', 'deepScan', 'changeBaselineAdapter.ts'), 'utf8');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreDeepScanWiring.ts'), 'utf8');

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

function fp(over: Partial<VehicleFingerprint> = {}): VehicleFingerprint {
  return {
    hash: 'aaaaaaaabbbbbbbb',
    vin: 'WVWZZZ1JZXW000001',
    protocol: 'CAN_11B_500K',
    ecuAddresses: ['7E0', '7E8'],
    supportedPidBitmap: 'BE1FA813',
    metadata: { adapterMac: null, name: null, profileHint: null } as VehicleFingerprint['metadata'],
    firstSeen: 1000,
    lastSeen: 2000,
    ...over,
  };
}

function record(over: Partial<DeepScanRecord> = {}): DeepScanRecord {
  return {
    schemaVersion: 1,
    vehicleFingerprintHash: 'aaaaaaaabbbbbbbb',
    lastScanId: 'scan-1',
    lastMode: 'full',
    lastStatus: 'completed',
    firstScanAt: 100,
    lastScanStartedAt: 100,
    lastScanCompletedAt: 200,
    lastUpdatedAt: 200,
    hasCompletedFullScan: true,
    completedScanCount: 3,
    changeCheckCount: 7,
    lastProgressPercent: 100,
    discoveredEcus: ['7E0', '7E8'],
    discoveredPids: ['0105'],
    discoveredDids: [],
    firmwareInventory: [{ ecu: '7E0', version: 'SW-1.2.3' }],
    capabilitySummary: null,
    newDiscoveriesCount: 0,
    changedFirmware: false,
    changedEcu: false,
    warnings: [],
    reportSummary: null,
    lastCompletedScanId: 'scan-1',
    ...over,
  } as DeepScanRecord;
}

/** Sahte store'lar — çağrı sayaçlı (lazy-load kanıtı için). */
function makeDeps(opts: {
  fingerprints?: readonly VehicleFingerprint[];
  records?: Record<string, DeepScanRecord | null>;
  onPersistenceLoad?: () => void;
} = {}) {
  const listSpy = vi.fn(() => [...(opts.fingerprints ?? [])]);
  const loadSpy = vi.fn((hash: unknown) => {
    opts.onPersistenceLoad?.();
    return (opts.records ?? {})[String(hash)] ?? null;
  });
  const deps: ChangeBaselineDeps = {
    fingerprintStore: { list: listSpy } as unknown as ChangeBaselineDeps['fingerprintStore'],
    persistence: { load: loadSpy } as unknown as ChangeBaselineDeps['persistence'],
  };
  return { deps, listSpy, loadSpy };
}

function ctx(over: Partial<PhaseContext> = {}): PhaseContext {
  return {
    phase: 'change_detection',
    mode: 'full',
    snapshot: { vehicleFingerprintHash: null } as PhaseContext['snapshot'],
    isCancelled: () => false,
    ...over,
  };
}

async function run(deps: ChangeBaselineDeps): Promise<PhaseResult> {
  const handler = createOfflineChangeDetectionHandler({ baseline: createChangeBaselineAdapter(deps) });
  return await handler(ctx());
}

/* ── 1. Lazy-load ─────────────────────────────────────────────────────────── */

describe('W5-3c-3 · baseline lazy-load', () => {
  it('fingerprint hash ile baseline lazy-load edilir (handler çalışınca)', async () => {
    const { deps, listSpy, loadSpy } = makeDeps({
      fingerprints: [fp()],
      records: { aaaaaaaabbbbbbbb: record() },
    });

    const result = await run(deps);

    expect(listSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalledWith('aaaaaaaabbbbbbbb');   // HASH ile arandı
    expect(result.status).toBe('success');
  });

  it('baseline change_detection ÖNCESİNDE yüklenmez (adapter kurulumu I/O yapmaz)', () => {
    const { deps, listSpy, loadSpy } = makeDeps({ fingerprints: [fp()], records: { aaaaaaaabbbbbbbb: record() } });

    // Adapter + handler kurulur — ama faz çalıştırılmaz.
    const adapter = createChangeBaselineAdapter(deps);
    createOfflineChangeDetectionHandler({ baseline: adapter });

    expect(listSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();   // LAZY: faza gelinmeden disk okunmaz
  });
});

/* ── 2. Baseline var → handler karar üretir ───────────────────────────────── */

describe('W5-3c-3 · baseline mevcut', () => {
  it('baseline mevcutsa handler çağrılır ve unchanged_offline döner', async () => {
    const { deps } = makeDeps({ fingerprints: [fp()], records: { aaaaaaaabbbbbbbb: record() } });

    const result = await run(deps);

    expect(result.status).toBe('success');
    expect(result.reason).toBe('unchanged_offline');
    // Kanıt yok → değişim BİLDİRİLMEZ (fail-closed: "değişmedi" iddiası değil)
    expect(result.changedEcu).toBeUndefined();
    expect(result.changedFirmware).toBeUndefined();
  });
});

/* ── 3. Fail-closed: baseline yok ─────────────────────────────────────────── */

describe('W5-3c-3 · fail-closed no_baseline', () => {
  it('kayıt yoksa "değişiklik yok" DEMEZ → no_baseline', async () => {
    const { deps } = makeDeps({ fingerprints: [fp()], records: {} });

    const result = await run(deps);

    expect(result.reason).toBe('no_baseline');
    expect(result.changedEcu).toBeUndefined();      // temiz/değişmedi İDDİASI YOK
    expect(result.changedFirmware).toBeUndefined();
  });

  it('hiç fingerprint yoksa no_baseline (araç kimliği bilinmiyor)', async () => {
    const { deps, loadSpy } = makeDeps({ fingerprints: [] });

    const result = await run(deps);

    expect(result.reason).toBe('no_baseline');
    expect(loadSpy).not.toHaveBeenCalled();
    expect(result.changedEcu).toBeUndefined();
  });
});

/* ── 4. GERÇEK TESPİT: VIN eşleşir, ECU seti değişmiş ─────────────────────── */

describe('W5-3c-3 · ECU değişim tespiti (VIN matcher)', () => {
  it('aynı VIN + farklı hash + FARKLI ECU seti → changedEcu:true', async () => {
    const current = fp({ hash: 'ffffffff00000000', ecuAddresses: ['7E0', '7E8', '760'] });  // 760 EKLENDİ
    const prior   = fp({ hash: 'aaaaaaaabbbbbbbb', ecuAddresses: ['7E0', '7E8'] });
    const { deps } = makeDeps({
      fingerprints: [current, prior],
      records: { aaaaaaaabbbbbbbb: record() },   // yalnız ESKİ hash'te kayıt var
    });

    const result = await run(deps);

    expect(result.status).toBe('success');
    expect(result.changedEcu).toBe(true);
    expect(result.reason).toBe('ecu_set_changed');
    expect(result.changedFirmware).toBeUndefined();   // offline'da firmware envanteri YOK
  });

  it('aynı VIN + farklı hash ama AYNI ECU seti (bitmap/protokol değişmiş) → changedEcu iddiası YOK', async () => {
    const current = fp({ hash: 'ffffffff00000000', supportedPidBitmap: 'BE1FA811' });  // yalnız bitmap
    const prior   = fp({ hash: 'aaaaaaaabbbbbbbb', supportedPidBitmap: 'BE1FA813' });
    const { deps } = makeDeps({
      fingerprints: [current, prior],
      records: { aaaaaaaabbbbbbbb: record() },
    });

    const result = await run(deps);

    expect(result.changedEcu).toBeUndefined();   // ECU seti AYNI → yanlış alarm YOK
    expect(result.reason).toBe('unchanged_offline');
  });

  it('VIN eşleşen önceki araç TARANMAMIŞSA (kayıt yok) → no_baseline', async () => {
    const current = fp({ hash: 'ffffffff00000000', ecuAddresses: ['7E0', '7E8', '760'] });
    const prior   = fp({ hash: 'aaaaaaaabbbbbbbb' });
    const { deps } = makeDeps({ fingerprints: [current, prior], records: {} });   // hiç kayıt yok

    const result = await run(deps);

    expect(result.reason).toBe('no_baseline');
    expect(result.changedEcu).toBeUndefined();
  });

  it('FARKLI VIN → başka araç; baseline devralınmaz → no_baseline', async () => {
    const current = fp({ hash: 'ffffffff00000000', vin: 'WVWZZZ1JZXW999999' });
    const prior   = fp({ hash: 'aaaaaaaabbbbbbbb', vin: 'WVWZZZ1JZXW000001' });
    const { deps } = makeDeps({ fingerprints: [current, prior], records: { aaaaaaaabbbbbbbb: record() } });

    const result = await run(deps);

    expect(result.reason).toBe('no_baseline');   // farklı araç → önceki araç baseline OLAMAZ
    expect(result.changedEcu).toBeUndefined();
  });

  it('matcher KENDİSİYLE eşleşmez (tautoloji koruması)', async () => {
    // Tek fingerprint + kaydı yok: list()[0] kendisiyle eşleşip "changed" DEMEMELİ.
    const { deps } = makeDeps({ fingerprints: [fp()], records: {} });

    const result = await run(deps);

    expect(result.reason).toBe('no_baseline');
    expect(result.changedEcu).toBeUndefined();
  });
});

/* ── 5. Hata izolasyonu ───────────────────────────────────────────────────── */

describe('W5-3c-3 · handler hatası', () => {
  it('store patlarsa faz BAŞARILI sayılmaz (error + fail-closed)', async () => {
    const deps: ChangeBaselineDeps = {
      fingerprintStore: { list: () => { throw new Error('disk bozuk'); } } as unknown as ChangeBaselineDeps['fingerprintStore'],
      persistence: { load: () => null } as unknown as ChangeBaselineDeps['persistence'],
    };

    const result = await run(deps);

    expect(result.status).toBe('error');            // 'success' DEĞİL
    expect(result.errorCode).toBe('baseline_unavailable');
    expect(result.changedEcu).toBeUndefined();      // hata "değişmedi" anlamına GELMEZ
    expect(result.changedFirmware).toBeUndefined();
  });

  it('persistence patlarsa faz BAŞARILI sayılmaz', async () => {
    const deps: ChangeBaselineDeps = {
      fingerprintStore: { list: () => [fp()] } as unknown as ChangeBaselineDeps['fingerprintStore'],
      persistence: { load: () => { throw new Error('kota'); } } as unknown as ChangeBaselineDeps['persistence'],
    };

    const result = await run(deps);

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('baseline_unavailable');
  });
});

/* ── 6/7. Bounded çıktı ───────────────────────────────────────────────────── */

describe('W5-3c-3 · bounded çıktı', () => {
  it('changedEcu ve changedFirmware BOOLEAN kalır; ECU listesi/VIN dışarı SIZMAZ', async () => {
    const current = fp({ hash: 'ffffffff00000000', ecuAddresses: ['7E0', '7E8', '760', '740'] });
    const prior   = fp({ hash: 'aaaaaaaabbbbbbbb', ecuAddresses: ['7E0'] });
    const { deps } = makeDeps({ fingerprints: [current, prior], records: { aaaaaaaabbbbbbbb: record() } });

    const result = await run(deps);

    expect(typeof result.changedEcu).toBe('boolean');
    // Bounded: keşif yükü ASLA taşınmaz (orchestrator zaten yok sayar; handler üretmez de)
    expect(result.ecus).toBeUndefined();
    expect(result.pids).toBeUndefined();
    expect(result.dids).toBeUndefined();
    expect(result.firmware).toBeUndefined();
    // reason sabit bir etiket — ham telemetri/VIN/ECU adresi taşımaz
    expect(result.reason).toBe('ecu_set_changed');
    const blob = JSON.stringify(result);
    expect(blob).not.toContain('WVWZZZ');   // VIN sızıntısı yok
    expect(blob).not.toContain('7E0');      // ECU adresi sızıntısı yok
  });

  it('reason sözlüğü kapalı kümedir (serbest metin yok)', async () => {
    const { deps } = makeDeps({ fingerprints: [fp()], records: { aaaaaaaabbbbbbbb: record() } });
    const result = await run(deps);
    expect(['no_baseline', 'unchanged_offline', 'ecu_set_changed']).toContain(result.reason);
  });
});

/* ── 8/9. Full-scan sayaçları korunur ─────────────────────────────────────── */

describe('W5-3c-3 · persistence bütünlüğü', () => {
  it('handler persistence\'a YAZMAZ → hasCompletedFullScan ve sayaçlar korunur', async () => {
    const saveSnapshot = vi.fn();
    const completeScan = vi.fn();
    const before = record();
    const deps: ChangeBaselineDeps = {
      fingerprintStore: { list: () => [fp()] } as unknown as ChangeBaselineDeps['fingerprintStore'],
      persistence: { load: () => before, saveSnapshot, completeScan } as unknown as ChangeBaselineDeps['persistence'],
    };

    await run(deps);

    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(completeScan).not.toHaveBeenCalled();
    // Kayıt nesnesi DEĞİŞMEDİ (mutasyon yok)
    expect(before.hasCompletedFullScan).toBe(true);
    expect(before.completedScanCount).toBe(3);
    expect(before.changeCheckCount).toBe(7);
  });

  it('handler fingerprint store\'a YAZMAZ', async () => {
    const save = vi.fn();
    const remove = vi.fn();
    const deps: ChangeBaselineDeps = {
      fingerprintStore: { list: () => [fp()], save, remove } as unknown as ChangeBaselineDeps['fingerprintStore'],
      persistence: { load: () => record() } as unknown as ChangeBaselineDeps['persistence'],
    };

    await run(deps);

    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

/* ── 10. Kapsam kilidi (statik) ───────────────────────────────────────────── */

describe('W5-3c-3 · kapsam kilidi', () => {
  it('handler/adapter Event Bus\'a DOKUNMAZ', () => {
    for (const src of [HANDLER_SRC, ADAPTER_SRC]) {
      expect(src).not.toMatch(/eventBus|appEventBus|publish\(/i);
    }
  });

  it('handler/adapter AKTİF araç sorgusu YAPMAZ (OBD/CAN/native yok)', () => {
    for (const src of [HANDLER_SRC, ADAPTER_SRC]) {
      expect(src).not.toMatch(/obdService|sendCommand|Capacitor|CarLauncher|nativePlugin|commandExecutor/i);
      expect(src).not.toMatch(/\b(01|09|22|19)[0-9A-F]{2}\b/);   // ham OBD/UDS komutu
    }
  });

  it('handler/adapter YAZMA yapmaz (persistence/store write API çağrısı yok)', () => {
    for (const src of [HANDLER_SRC, ADAPTER_SRC]) {
      expect(src).not.toMatch(/\.saveSnapshot\(|\.completeScan\(|\.save\(|\.remove\(|safeStorage/);
    }
  });

  it('wiring change_detection handler\'ını offline pass\'e bağlar', () => {
    expect(WIRING_SRC).toMatch(/change_detection/);
    expect(WIRING_SRC).toMatch(/createOfflineChangeDetectionHandler/);
  });

  it('wiring AKTİF faza handler bağlamaz (yalnız OfflinePhaseHandlers)', () => {
    // Aktif faz adları wiring'de handler anahtarı olarak GEÇMEMELİ.
    expect(WIRING_SRC).not.toMatch(/ecu_discovery\s*:/);
    expect(WIRING_SRC).not.toMatch(/firmware_inventory\s*:/);
    expect(WIRING_SRC).not.toMatch(/vehicle_identity\s*:/);
  });
});
