/**
 * deepScanLegacyFullBaseline.test.ts — LEGACY FULL BASELINE FAIL-CLOSED kilitleri.
 *
 * SORUN: Completion Truth'tan ÖNCEKİ sürümler `hasCompletedFullScan = true`'yu yalnız
 * `status === 'completed'` görerek yazıyordu — kapsam kanıtı OLMADAN. O kayıtlar diskte
 * DURUYOR (silinmiyor · şema bump edilmiyor · toplu migration yok). Ham alana bakan her
 * tüketici onları "tam tarandı" sanar → araç CHANGE_CHECK'e geçer ve eksik bir kayıt
 * baseline olur ("değişiklik yok" sonucuna sahte kanıt).
 *
 * SÖZLEŞME (bu testler zayıflatılamaz/silinemez — CLAUDE.md regresyon kasası):
 *  - `hasCompletedFullScan:true` + `lastFinalVerdict` null/eksik/tutarsız → LEGACY_UNVERIFIED_FULL
 *  - LEGACY_UNVERIFIED_FULL: baseline OLAMAZ · `resolveMode` FULL_SCAN kalır
 *  - Kayıt SİLİNMEZ · sayaçlar DEĞİŞMEZ · şema sürümü DEĞİŞMEZ · alan yeniden YAZILMAZ
 *  - Sınıflandırma TEK merkezi otoritededir: `classifyFullScanTrust()` / `isVerifiedFullScan()`
 *
 * Gerçek disk/araç YOK — enjekte in-memory IO + kontrollü saat.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFullScanTrust,
  isVerifiedFullScan,
  DeepScanPersistenceStore,
  DEEP_SCAN_HISTORY_KEY,
  DEEP_SCAN_SCHEMA_VERSION,
  MAX_DEEP_SCAN_RECORDS,
  type DeepScanRecord,
  type DeepScanStoreIO,
} from '../platform/deepScan';
import {
  createChangeBaselineAdapter,
  type ChangeBaselineDeps,
} from '../platform/deepScan/changeBaselineAdapter';
import { createOfflineChangeDetectionHandler } from '../platform/deepScan/offlineChangeDetectionHandler';
import type { DeepScanSnapshot } from '../platform/deepScan';
import type { VehicleFingerprint } from '../platform/vehicleFingerprintService';
// Kaynak-metin kilidi (flake bağışık).
import persistenceSource from '../platform/deepScan/deepScanPersistence.ts?raw';
import adapterSource from '../platform/deepScan/changeBaselineAdapter.ts?raw';

const NOW = 5_000_000;
const now = () => NOW;
const HASH = 'aaaaaaaabbbbbbbb';

function memIO() {
  const map = new Map<string, string>();
  const io: DeepScanStoreIO = {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); },
  };
  return { io, map };
}

/* ── Ham disk kaydı üreticileri ───────────────────────────────────────────── */

/** ESKİ SÜRÜM kaydı: `hasCompletedFullScan:true` ama HİÇ completion metadata YOK. */
function legacyRawRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vehicleFingerprintHash: HASH,
    lastScanId: 'legacy-1',
    lastMode: 'FULL_SCAN',
    lastStatus: 'completed',
    firstScanAt: 100,
    lastScanStartedAt: 100,
    lastScanCompletedAt: 200,
    lastUpdatedAt: 200,
    hasCompletedFullScan: true,          // ★ kanıtsız iddia
    completedScanCount: 3,
    changeCheckCount: 7,
    lastProgressPercent: 100,
    discoveredEcus: ['7E0', '7E8'],
    discoveredPids: ['0105'],
    discoveredDids: [],
    firmwareInventory: [{ ecu: '7E0', version: 'SW-1.2.3' }],
    newDiscoveriesCount: 0,
    changedFirmware: false,
    changedEcu: false,
    warnings: [],
    lastCompletedScanId: 'legacy-1',
    // lastFinalVerdict / lastScanTerminal / lastIncompleteReasons / lastCoverage YOK
    ...over,
  };
}

/** YENİ sürüm kaydı: iddia + tutarlı kanıt. */
function verifiedRawRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return legacyRawRecord({
    lastScanId: 'new-1',
    lastCompletedScanId: 'new-1',
    lastScanTerminal: true,
    lastFinalVerdict: 'full',
    lastIncompleteReasons: [],
    lastCoverage: {
      requiredCount: 12, attemptedCount: 12, completedCount: 12, skippedCount: 0,
      failedCount: 0, unavailableCount: 0, timedOutCount: 0,
      budgetExhaustedCount: 0, partialCount: 0, unknownCount: 0,
    },
    partialScanCount: 0,
    ...over,
  });
}

/** Ham kayıtları diske koyup store aç (gerçek "eski kurulum" simülasyonu). */
function storeWith(items: Record<string, unknown>[], key = DEEP_SCAN_HISTORY_KEY) {
  const { io, map } = memIO();
  map.set(key, JSON.stringify({ schema: DEEP_SCAN_SCHEMA_VERSION, items }));
  return { store: new DeepScanPersistenceStore(key, MAX_DEEP_SCAN_RECORDS, 5000, io, now), io, map };
}

/* ── Baseline yardımcıları ────────────────────────────────────────────────── */

function fp(over: Partial<VehicleFingerprint> = {}): VehicleFingerprint {
  return {
    hash: HASH,
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

function baselineDeps(record: DeepScanRecord | null): ChangeBaselineDeps {
  return {
    fingerprintStore: { list: () => [fp()] } as unknown as ChangeBaselineDeps['fingerprintStore'],
    persistence: { load: () => record } as unknown as ChangeBaselineDeps['persistence'],
  };
}

async function runChangeDetection(record: DeepScanRecord | null) {
  const handler = createOfflineChangeDetectionHandler({
    baseline: createChangeBaselineAdapter(baselineDeps(record)),
  });
  return handler({
    phase: 'change_detection', mode: 'FULL_SCAN',
    snapshot: { vehicleFingerprintHash: null } as unknown as DeepScanSnapshot,
    isCancelled: () => false,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1-3 · Yeni doğrulanmış kayıt vs LEGACY kayıt
 * ════════════════════════════════════════════════════════════════════════ */

describe('1-3) doğrulanmış full vs LEGACY_UNVERIFIED_FULL', () => {
  it('1) YENİ doğrulanmış full kayıt baseline OLUR ve CHANGE_CHECK üretir', async () => {
    const { store } = storeWith([verifiedRawRecord()]);
    const rec = store.load(HASH)!;

    expect(classifyFullScanTrust(rec)).toBe('verified_full');
    expect(isVerifiedFullScan(rec)).toBe(true);
    expect(store.hasCompletedFullScan(HASH)).toBe(true);
    expect(store.resolveMode(HASH)).toBe('CHANGE_CHECK');
    expect(store.getFullScanTrust(HASH)).toBe('verified_full');

    expect(createChangeBaselineAdapter(baselineDeps(rec)).resolve().kind).toBe('match');
    expect((await runChangeDetection(rec)).reason).toBe('unchanged_offline');
  });

  it('2) LEGACY (hasCompletedFullScan:true + lastFinalVerdict null) baseline OLMAZ', async () => {
    const { store } = storeWith([legacyRawRecord()]);
    const rec = store.load(HASH)!;

    // Ham alan KORUNUR (silinmez/yeniden yazılmaz) ama KANIT yok.
    expect(rec.hasCompletedFullScan).toBe(true);
    expect(rec.lastFinalVerdict).toBeNull();
    expect(classifyFullScanTrust(rec)).toBe('legacy_unverified_full');
    expect(isVerifiedFullScan(rec)).toBe(false);

    expect(createChangeBaselineAdapter(baselineDeps(rec)).resolve().kind).toBe('no_baseline');
    const result = await runChangeDetection(rec);
    expect(result.reason).toBe('no_baseline');           // "değişiklik yok" DEMEZ
    expect(result.changedEcu).toBeUndefined();
    expect(result.changedFirmware).toBeUndefined();
  });

  it('3) LEGACY kayıt için resolveMode FULL_SCAN üretmeye DEVAM eder', () => {
    const { store } = storeWith([legacyRawRecord()]);

    expect(store.hasCompletedFullScan(HASH)).toBe(false);   // fail-closed karar kapısı
    expect(store.resolveMode(HASH)).toBe('FULL_SCAN');
    expect(store.getFullScanTrust(HASH)).toBe('legacy_unverified_full');
  });

  it('3b) TUTARSIZ metadata da legacy sayılır (full + gerekçe / terminal değil)', () => {
    const withReasons = storeWith([verifiedRawRecord({
      lastIncompleteReasons: ['required_phase_skipped'],
    })], 'k-l1').store;
    expect(withReasons.getFullScanTrust(HASH)).toBe('legacy_unverified_full');
    expect(withReasons.resolveMode(HASH)).toBe('FULL_SCAN');

    const notTerminal = storeWith([verifiedRawRecord({ lastScanTerminal: false })], 'k-l2').store;
    expect(notTerminal.getFullScanTrust(HASH)).toBe('legacy_unverified_full');
    expect(notTerminal.resolveMode(HASH)).toBe('FULL_SCAN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4-6 · Diğer verdict'ler baseline üretemez
 * ════════════════════════════════════════════════════════════════════════ */

describe('4-6) partial / incomplete / failed / cancelled kayıtlar baseline olmaz', () => {
  const cases: Array<{ label: string; raw: Record<string, unknown> }> = [
    {
      label: '4) partial',
      raw: verifiedRawRecord({
        hasCompletedFullScan: false, lastFinalVerdict: 'partial',
        lastIncompleteReasons: ['required_phase_skipped'], partialScanCount: 1,
      }),
    },
    {
      label: '5) incomplete',
      raw: verifiedRawRecord({
        hasCompletedFullScan: false, lastFinalVerdict: 'incomplete',
        lastIncompleteReasons: ['required_phase_handler_unavailable'],
      }),
    },
    {
      label: '6a) failed',
      raw: verifiedRawRecord({
        hasCompletedFullScan: false, lastStatus: 'failed', lastFinalVerdict: 'failed',
        lastIncompleteReasons: ['scan_failed'],
      }),
    },
    {
      label: '6b) cancelled',
      raw: verifiedRawRecord({
        hasCompletedFullScan: false, lastStatus: 'cancelled', lastFinalVerdict: 'cancelled',
        lastIncompleteReasons: ['scan_cancelled'],
      }),
    },
  ];

  for (const { label, raw } of cases) {
    it(`${label} kayıt baseline OLMAZ ve FULL_SCAN kalır`, async () => {
      const { store } = storeWith([raw], `k-${label}`);
      const rec = store.load(HASH)!;

      expect(classifyFullScanTrust(rec)).toBe('not_full');
      expect(store.resolveMode(HASH)).toBe('FULL_SCAN');
      expect(createChangeBaselineAdapter(baselineDeps(rec)).resolve().kind).toBe('no_baseline');
      expect((await runChangeDetection(rec)).reason).toBe('no_baseline');
    });
  }

  it('verdict "full" olan ama hasCompletedFullScan:false kayıt da not_full', () => {
    const { store } = storeWith([verifiedRawRecord({ hasCompletedFullScan: false })], 'k-mismatch');
    expect(store.getFullScanTrust(HASH)).toBe('not_full');
    expect(store.resolveMode(HASH)).toBe('FULL_SCAN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7-9 · Veriye DOKUNULMAZ (silme / sayaç / şema)
 * ════════════════════════════════════════════════════════════════════════ */

describe('7-9) legacy veri korunur — silme/sayaç/şema değişmez', () => {
  it('7) LEGACY kayıt SİLİNMEZ (okuma sınıflandırması kaydı kaldırmaz)', () => {
    const { store, map } = storeWith([legacyRawRecord()]);

    // Karar yollarının hepsi çalıştırılır…
    store.hasCompletedFullScan(HASH);
    store.resolveMode(HASH);
    store.getFullScanTrust(HASH);
    store.flush();

    // …kayıt yerinde.
    expect(store.size).toBe(1);
    expect(store.load(HASH)).not.toBeNull();
    expect(store.list()).toHaveLength(1);
    expect(map.get(DEEP_SCAN_HISTORY_KEY)).toContain(HASH);
  });

  it('8) completedScanCount ve diğer sayaçlar DEĞİŞTİRİLMEZ', () => {
    const { store } = storeWith([legacyRawRecord()]);
    const before = store.load(HASH)!;

    store.hasCompletedFullScan(HASH);
    store.resolveMode(HASH);
    store.getFullScanTrust(HASH);

    const after = store.load(HASH)!;
    expect(after.completedScanCount).toBe(3);      // ham değer korunur
    expect(after.changeCheckCount).toBe(7);
    expect(after.partialScanCount).toBe(0);
    expect(after.hasCompletedFullScan).toBe(true); // alan YENİDEN YAZILMAZ
    expect(after.completedScanCount).toBe(before.completedScanCount);
    expect(after.discoveredEcus).toEqual(['7E0', '7E8']);
  });

  it('9) şema sürümü DEĞİŞMEZ (bump yok, toplu migration yok)', () => {
    const { store, map } = storeWith([legacyRawRecord()]);
    expect(DEEP_SCAN_SCHEMA_VERSION).toBe(1);

    store.resolveMode(HASH);
    store.saveSnapshot({
      snapshot: {
        scanId: 'x', vehicleFingerprintHash: HASH, status: 'scanning', mode: 'FULL_SCAN',
        phase: 'ecu_discovery', progressPercent: 10, startedAt: NOW, updatedAt: NOW,
        completedAt: null, isFirstScan: false, ignitionRequired: true, ignitionConfirmed: true,
        discoveredEcuCount: 0, discoveredPidCount: 0, discoveredDidCount: 0, newDiscoveriesCount: 0,
        changedFirmware: false, changedEcu: false, warnings: [], errorCode: null, reportSummary: null,
      },
    });
    store.flush();

    const envelope = JSON.parse(map.get(DEEP_SCAN_HISTORY_KEY)!) as { schema: number };
    expect(envelope.schema).toBe(DEEP_SCAN_SCHEMA_VERSION);
  });

  it('9b) LEGACY kayıt LRU korumasını KAYBETMEZ (tamamlanmamış kayıt önce evict edilir)', () => {
    const hashN = (n: number) => n.toString(16).padStart(16, '0');
    // LEGACY (en eski) + hiç tamamlanmamış bir kayıt (EN YENİ) + 15 doğrulanmış = 17.
    const items = [
      legacyRawRecord({ lastUpdatedAt: 10_000, lastScanCompletedAt: 10_000 }),
      verifiedRawRecord({
        vehicleFingerprintHash: hashN(99), lastScanId: 's-99', lastCompletedScanId: 's-99',
        hasCompletedFullScan: false, lastFinalVerdict: 'partial',
        lastUpdatedAt: 99_000, lastScanCompletedAt: 99_000,
      }),
    ];
    for (let i = 1; i <= MAX_DEEP_SCAN_RECORDS - 1; i++) {
      items.push(verifiedRawRecord({
        vehicleFingerprintHash: hashN(i), lastScanId: `s-${i}`, lastCompletedScanId: `s-${i}`,
        lastUpdatedAt: 20_000 + i, lastScanCompletedAt: 20_000 + i,
      }));
    }
    const { store } = storeWith(items, 'k-lru');

    // 17 → 16: LEGACY kayıt "tamamlanmış" LRU korumasını SÜRDÜRÜR (fail-closed
    // sınıflandırma yalnız KARAR yollarını etkiler, saklama önceliğini DEĞİL) →
    // en yeni olmasına rağmen korumasız kayıt düşer, legacy veri KORUNUR.
    expect(store.size).toBe(MAX_DEEP_SCAN_RECORDS);
    expect(store.load(HASH)).not.toBeNull();
    expect(store.load(hashN(99))).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10-12 · Determinizm · eksik alan · geriye uyumluluk
 * ════════════════════════════════════════════════════════════════════════ */

describe('10-12) determinizm, eksik alan, geriye uyumluluk', () => {
  it('10) aynı kayıt tekrar okununca DETERMİNİSTİK sonuç verir', () => {
    const { store } = storeWith([legacyRawRecord()]);
    const results = Array.from({ length: 5 }, () => ({
      trust: store.getFullScanTrust(HASH),
      mode: store.resolveMode(HASH),
      full: store.hasCompletedFullScan(HASH),
    }));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toEqual({ trust: 'legacy_unverified_full', mode: 'FULL_SCAN', full: false });

    // "Restart" (aynı diskten yeni store) → aynı karar.
    const rec = store.load(HASH)!;
    expect(classifyFullScanTrust(rec)).toBe(classifyFullScanTrust(rec));
  });

  it('11) EKSİK/BOZUK alanlar throw ETMEZ (null · undefined · yanlış tip)', () => {
    expect(() => classifyFullScanTrust(null)).not.toThrow();
    expect(classifyFullScanTrust(null)).toBe('not_full');
    expect(classifyFullScanTrust(undefined)).toBe('not_full');
    expect(isVerifiedFullScan(null)).toBe(false);

    // Yalnız iddia var, hiçbir alan yok.
    expect(classifyFullScanTrust({ hasCompletedFullScan: true } as unknown as DeepScanRecord))
      .toBe('legacy_unverified_full');
    // Yanlış tipler.
    expect(classifyFullScanTrust({
      hasCompletedFullScan: true, lastFinalVerdict: 'FULL', lastScanTerminal: 'evet',
      lastIncompleteReasons: 'yok',
    } as unknown as DeepScanRecord)).toBe('legacy_unverified_full');
    expect(classifyFullScanTrust({} as unknown as DeepScanRecord)).toBe('not_full');

    // Store yolları da güvenli.
    const { store } = storeWith([]);
    expect(() => store.getFullScanTrust('yok')).not.toThrow();
    expect(store.getFullScanTrust(HASH)).toBe('not_full');
    expect(store.resolveMode(undefined)).toBe('FULL_SCAN');
  });

  it('12) YENİ kayıt yazma yolu geriye uyumlu — full tarama hâlâ CHANGE_CHECK açar', () => {
    const { io } = memIO();
    const store = new DeepScanPersistenceStore('k-fwd', MAX_DEEP_SCAN_RECORDS, 5000, io, now);
    const completion = {
      scanId: 'fresh-1',
      completionEligibility: 'eligible' as const,
      finalVerdict: 'full' as const,
      hasCompletedFullScan: true,
      incompleteReasons: [],
      coverage: {
        requiredCount: 12, attemptedCount: 12, completedCount: 12, skippedCount: 0,
        failedCount: 0, unavailableCount: 0, timedOutCount: 0,
        budgetExhaustedCount: 0, partialCount: 0, unknownCount: 0,
      },
    };
    const rec = store.completeScan({
      snapshot: {
        scanId: 'fresh-1', vehicleFingerprintHash: HASH, status: 'completed', mode: 'FULL_SCAN',
        phase: 'report_generation', progressPercent: 100, startedAt: NOW - 10, updatedAt: NOW,
        completedAt: NOW, isFirstScan: true, ignitionRequired: true, ignitionConfirmed: true,
        discoveredEcuCount: 0, discoveredPidCount: 0, discoveredDidCount: 0, newDiscoveriesCount: 0,
        changedFirmware: false, changedEcu: false, warnings: [], errorCode: null, reportSummary: null,
      },
      completion,
    })!;

    expect(classifyFullScanTrust(rec)).toBe('verified_full');
    expect(store.resolveMode(HASH)).toBe('CHANGE_CHECK');

    // Restart round-trip: diskten okunan kayıt da doğrulanmış kalır.
    store.flush();
    const restarted = new DeepScanPersistenceStore('k-fwd', MAX_DEEP_SCAN_RECORDS, 5000, io, now);
    expect(restarted.getFullScanTrust(HASH)).toBe('verified_full');
    expect(restarted.resolveMode(HASH)).toBe('CHANGE_CHECK');
  });

  it('12b) LEGACY araç yeni bir TAM tarama yapınca doğrulanmış hâle geçer', () => {
    const { store } = storeWith([legacyRawRecord()], 'k-upgrade');
    expect(store.resolveMode(HASH)).toBe('FULL_SCAN');      // önce yeniden tam tarama ister

    store.completeScan({
      snapshot: {
        scanId: 'after-1', vehicleFingerprintHash: HASH, status: 'completed', mode: 'FULL_SCAN',
        phase: 'report_generation', progressPercent: 100, startedAt: NOW - 10, updatedAt: NOW,
        completedAt: NOW, isFirstScan: false, ignitionRequired: true, ignitionConfirmed: true,
        discoveredEcuCount: 0, discoveredPidCount: 0, discoveredDidCount: 0, newDiscoveriesCount: 0,
        changedFirmware: false, changedEcu: false, warnings: [], errorCode: null, reportSummary: null,
      },
      completion: {
        scanId: 'after-1', completionEligibility: 'eligible', finalVerdict: 'full',
        hasCompletedFullScan: true, incompleteReasons: [],
        coverage: {
          requiredCount: 12, attemptedCount: 12, completedCount: 12, skippedCount: 0,
          failedCount: 0, unavailableCount: 0, timedOutCount: 0,
          budgetExhaustedCount: 0, partialCount: 0, unknownCount: 0,
        },
      },
    });

    expect(store.getFullScanTrust(HASH)).toBe('verified_full');
    expect(store.resolveMode(HASH)).toBe('CHANGE_CHECK');
    expect(store.load(HASH)!.completedScanCount).toBe(4);   // eski 3 + yeni 1 (sıfırlanmadı)
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Merkezi otorite kilidi — dağınık kontrol OLUŞMASIN
 * ════════════════════════════════════════════════════════════════════════ */

describe('merkezi otorite kilidi', () => {
  it('baseline adapter kendi kuralını YAZMAZ — merkezi helper’ı kullanır', () => {
    expect(adapterSource).toContain('isVerifiedFullScan');
    // Ham alan üzerinden kendi kararını üretmemeli (yalnız yorumda geçebilir).
    const code = adapterSource
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('hasCompletedFullScan ===');
    expect(code).not.toContain('.hasCompletedFullScan');
  });

  it('resolveMode kararı hasCompletedFullScan() kapısından geçer (ham alandan DEĞİL)', () => {
    const start = persistenceSource.indexOf('resolveMode(vehicleFingerprintHash: unknown)');
    expect(start).toBeGreaterThan(-1);
    const body = persistenceSource.slice(start, start + 220);
    expect(body).toContain('this.hasCompletedFullScan(');

    // Karar kapısının kendisi merkezi sınıflandırıcıyı kullanır.
    const gate = persistenceSource.indexOf('hasCompletedFullScan(vehicleFingerprintHash: unknown)');
    expect(gate).toBeGreaterThan(-1);
    expect(persistenceSource.slice(gate, gate + 200)).toContain('isVerifiedFullScan(');
  });
});
