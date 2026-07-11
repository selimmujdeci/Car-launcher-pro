/**
 * deepScanPersistence.test.ts — Deep Scan Persistence Foundation birim testleri.
 *
 * Kapsam: boş load · save/load round-trip · mode kararı (full_scan/change_check) ·
 * sayaçlar (completed/change_check, idempotent, failed/cancelled) · normalizasyon
 * (ECU/PID/DID/firmware dedup, firstScanAt korunumu, lastUpdatedAt) · bounded 16
 * araç LRU (deterministik, sıra-bağımsız) · fail-soft (bozuk JSON / eski şema / tek
 * bozuk kayıt) · debounce/flush · dispose zero-leak · clear/remove · immutability ·
 * gizlilik (VIN/MAC reddi) · bounded listeler · import yan etkisizliği ·
 * SystemBoot wiring yokluğu · runtime davranışının değişmemesi.
 *
 * Not: Gerçek disk/araç YOK — enjekte edilebilir in-memory IO + kontrollü saat.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DeepScanPersistenceStore,
  DEEP_SCAN_HISTORY_KEY,
  DEEP_SCAN_SCHEMA_VERSION,
  MAX_DEEP_SCAN_RECORDS,
  MAX_RECORD_ECUS,
  MAX_RECORD_PIDS,
  type DeepScanStoreIO,
  type DeepScanPersistInput,
} from '../platform/deepScan/deepScanPersistence';
import { deepScanRuntimeService, type DeepScanSnapshot } from '../platform/deepScan';
// Kaynak-metin kilidi: transform-time sabit → paralel flake bağışık (bkz. ?raw deseni).
import persistenceSource from '../platform/deepScan/deepScanPersistence.ts?raw';

/* ── Sabitler / yardımcılar ──────────────────────────────────────────────── */

const HASH_A = 'a1b2c3d4e5f60718'; // 16 hex — geçerli parmak izi
const HASH_B = 'b2c3d4e5f6071829';
const HASH_C = 'c3d4e5f607182930';
const VIN_17 = '1HGCM82633A004352'; // 17 karakter → reddedilmeli

let _now = 1000;
const now = () => _now;

function memIO() {
  const map = new Map<string, string>();
  const stats = { reads: 0, writes: 0, removes: 0 };
  const io: DeepScanStoreIO = {
    read: (k) => { stats.reads++; return map.get(k) ?? null; },
    write: (k, v) => { stats.writes++; map.set(k, v); },
    remove: (k) => { stats.removes++; map.delete(k); },
  };
  return { io, map, stats };
}

function makeStore(io?: DeepScanStoreIO, debounceMs = 5000) {
  return new DeepScanPersistenceStore(DEEP_SCAN_HISTORY_KEY, MAX_DEEP_SCAN_RECORDS, debounceMs, io, now);
}

function snap(over: Partial<DeepScanSnapshot> = {}): DeepScanSnapshot {
  return {
    scanId: 'scan-1000-1',
    vehicleFingerprintHash: HASH_A,
    status: 'scanning',
    mode: 'FULL_SCAN',
    phase: 'ecu_discovery',
    progressPercent: 20,
    startedAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    isFirstScan: true,
    ignitionRequired: true,
    ignitionConfirmed: true,
    discoveredEcuCount: 0,
    discoveredPidCount: 0,
    discoveredDidCount: 0,
    newDiscoveriesCount: 0,
    changedFirmware: false,
    changedEcu: false,
    warnings: [],
    errorCode: null,
    reportSummary: null,
    ...over,
  };
}

/** Tamamlanmış bir tarama snapshot'ı. */
function completedSnap(over: Partial<DeepScanSnapshot> = {}): DeepScanSnapshot {
  return snap({
    status: 'completed',
    progressPercent: 100,
    completedAt: 2000,
    reportSummary: {
      mode: over.mode ?? 'FULL_SCAN',
      ecuCount: 3, pidCount: 10, didCount: 4,
      newDiscoveriesCount: 2, firmwareCheckedCount: 1,
      changedFirmware: false, changedEcu: false,
      warningCount: 0, durationMs: 1000, note: null,
    },
    ...over,
  });
}

const input = (s: DeepScanSnapshot, extra: Partial<DeepScanPersistInput> = {}): DeepScanPersistInput =>
  ({ snapshot: s, ...extra });

beforeEach(() => { _now = 1000; });
afterEach(() => { vi.useRealTimers(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1–2 · Temel load / save
 * ════════════════════════════════════════════════════════════════════════ */

describe('temel load/save', () => {
  it('1) boş store — load null, list boş, size 0', () => {
    const { io } = memIO();
    const s = makeStore(io);
    expect(s.load(HASH_A)).toBeNull();
    expect(s.list()).toEqual([]);
    expect(s.size).toBe(0);
  });

  it('2) yeni kayıt save → load geri getirir (restart round-trip)', () => {
    const { io, map } = memIO();
    const s1 = makeStore(io);
    s1.saveSnapshot(input(snap()));
    s1.flush();
    // "Restart": aynı diskten yeni store
    const s2 = new DeepScanPersistenceStore(DEEP_SCAN_HISTORY_KEY, MAX_DEEP_SCAN_RECORDS, 5000, io, now);
    const rec = s2.load(HASH_A);
    expect(rec).not.toBeNull();
    expect(rec!.vehicleFingerprintHash).toBe(HASH_A);
    expect(rec!.lastStatus).toBe('scanning');
    expect(map.get(DEEP_SCAN_HISTORY_KEY)).toContain(String(DEEP_SCAN_SCHEMA_VERSION));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3–5 · Mode kararı + sayaçlar
 * ════════════════════════════════════════════════════════════════════════ */

describe('mode kararı ve sayaçlar', () => {
  it('3) kayıt yok / tamamlanmamış → full_scan', () => {
    const s = makeStore(memIO().io);
    expect(s.resolveMode(HASH_A)).toBe('FULL_SCAN');       // kayıt yok
    s.saveSnapshot(input(snap()));                          // ilerleme var ama tamamlanmadı
    expect(s.hasCompletedFullScan(HASH_A)).toBe(false);
    expect(s.resolveMode(HASH_A)).toBe('FULL_SCAN');
  });

  it('4) tamamlanmış full_scan → sonraki bağlantı change_check', () => {
    const s = makeStore(memIO().io);
    s.completeScan(input(completedSnap()));
    expect(s.hasCompletedFullScan(HASH_A)).toBe(true);
    expect(s.resolveMode(HASH_A)).toBe('CHANGE_CHECK');
  });

  it('5) tamamlanmış change_check → changeCheckCount artar', () => {
    const s = makeStore(memIO().io);
    s.completeScan(input(completedSnap({ scanId: 'scan-a', mode: 'FULL_SCAN' })));
    _now = 3000;
    s.completeScan(input(completedSnap({ scanId: 'scan-b', mode: 'CHANGE_CHECK', reportSummary: {
      mode: 'CHANGE_CHECK', ecuCount: 3, pidCount: 10, didCount: 4, newDiscoveriesCount: 0,
      firmwareCheckedCount: 1, changedFirmware: false, changedEcu: false, warningCount: 0, durationMs: 500, note: null,
    } })));
    const rec = s.load(HASH_A)!;
    expect(rec.completedScanCount).toBe(2);
    expect(rec.changeCheckCount).toBe(1);
  });

  it('13) completedScanCount birden çok tam tarama ile doğru sayılır', () => {
    const s = makeStore(memIO().io);
    s.completeScan(input(completedSnap({ scanId: 'scan-1' })));
    _now = 3000;
    s.completeScan(input(completedSnap({ scanId: 'scan-2' })));
    expect(s.load(HASH_A)!.completedScanCount).toBe(2);
  });

  it('14) failed scan completedScanCount artırmaz', () => {
    const s = makeStore(memIO().io);
    s.completeScan(input(snap({ status: 'failed', errorCode: 'protocol_detection:timeout' })));
    const rec = s.load(HASH_A)!;
    expect(rec.completedScanCount).toBe(0);
    expect(rec.hasCompletedFullScan).toBe(false);
    expect(rec.lastStatus).toBe('failed');
  });

  it('15) cancelled scan completedScanCount artırmaz', () => {
    const s = makeStore(memIO().io);
    s.completeScan(input(snap({ status: 'cancelled' })));
    expect(s.load(HASH_A)!.completedScanCount).toBe(0);
    expect(s.load(HASH_A)!.lastStatus).toBe('cancelled');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6–10 · Duplicate / dedup
 * ════════════════════════════════════════════════════════════════════════ */

describe('duplicate ve dedup', () => {
  it('6) aynı snapshot iki kez → tek kayıt + idempotent sayaç', () => {
    const s = makeStore(memIO().io);
    s.completeScan(input(completedSnap({ scanId: 'scan-x' })));
    s.completeScan(input(completedSnap({ scanId: 'scan-x' }))); // aynı scanId
    expect(s.size).toBe(1);
    expect(s.load(HASH_A)!.completedScanCount).toBe(1); // şişmez
  });

  it('7) ECU duplicate tekilleşir (normalize + unique + sort)', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap(), { ecuAddresses: ['7E0', '0x7e0', ' 7E0 ', '7E8'] }));
    expect(s.load(HASH_A)!.discoveredEcus).toEqual(['7E0', '7E8']);
  });

  it('8) PID duplicate tekilleşir', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap(), { pidIds: ['0C', '0c', '0C', '0D'] }));
    expect(s.load(HASH_A)!.discoveredPids).toEqual(['0C', '0D']);
  });

  it('9) DID duplicate tekilleşir', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap(), { didIds: ['F190', 'f190', 'F1A0'] }));
    expect(s.load(HASH_A)!.discoveredDids).toEqual(['F190', 'F1A0']);
  });

  it('10) firmware ECU+version ile tekilleşir', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap(), { firmware: [
      { ecu: '7E0', version: 'V1.2' },
      { ecu: '7e0', version: 'v1.2' }, // aynı (normalize sonrası)
      { ecu: '7E0', version: 'V1.3' },
    ] }));
    const fw = s.load(HASH_A)!.firmwareInventory;
    expect(fw).toHaveLength(2);
    expect(fw.map((f) => f.version)).toEqual(['V1.2', 'V1.3']);
  });

  it('merge: ikinci save öncekilerle birleştirir (birikim)', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap(), { ecuAddresses: ['7E0'] }));
    s.saveSnapshot(input(snap(), { ecuAddresses: ['7E8'] }));
    expect(s.load(HASH_A)!.discoveredEcus).toEqual(['7E0', '7E8']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11–12 · Zaman alanları
 * ════════════════════════════════════════════════════════════════════════ */

describe('zaman alanları', () => {
  it('11) firstScanAt korunur (sonraki save değiştirmez)', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap({ startedAt: 1000 })));
    const first = s.load(HASH_A)!.firstScanAt;
    _now = 9000;
    s.saveSnapshot(input(snap({ scanId: 'scan-2', startedAt: 8000 })));
    expect(s.load(HASH_A)!.firstScanAt).toBe(first);
    expect(first).toBe(1000);
  });

  it('12) lastUpdatedAt her save ile güncellenir', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap()));
    expect(s.load(HASH_A)!.lastUpdatedAt).toBe(1000);
    _now = 5555;
    s.saveSnapshot(input(snap({ scanId: 'scan-2' })));
    expect(s.load(HASH_A)!.lastUpdatedAt).toBe(5555);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16–18 · Bounded LRU (16 araç)
 * ════════════════════════════════════════════════════════════════════════ */

describe('bounded LRU (16 araç)', () => {
  const hashN = (n: number) => n.toString(16).padStart(16, '0');

  it('16) 16 kayıt tavanı — 17. eklenince size 16 kalır', () => {
    const s = makeStore(memIO().io);
    for (let i = 0; i < MAX_DEEP_SCAN_RECORDS + 1; i++) {
      _now = 1000 + i;
      s.completeScan(input(completedSnap({ vehicleFingerprintHash: hashN(i), scanId: `scan-${i}` })));
    }
    expect(s.size).toBe(MAX_DEEP_SCAN_RECORDS);
  });

  it('17) tamamlanmamış / en eski kayıt önce evict edilir', () => {
    const s = makeStore(memIO().io);
    // 0 = tamamlanmamış (en değersiz) — ilk evict edilmeli
    _now = 500;
    s.saveSnapshot(input(snap({ vehicleFingerprintHash: hashN(0), scanId: 'scan-0' })));
    for (let i = 1; i <= MAX_DEEP_SCAN_RECORDS; i++) {
      _now = 1000 + i;
      s.completeScan(input(completedSnap({ vehicleFingerprintHash: hashN(i), scanId: `scan-${i}` })));
    }
    expect(s.size).toBe(MAX_DEEP_SCAN_RECORDS);
    expect(s.load(hashN(0))).toBeNull();           // tamamlanmamış olan gitti
    expect(s.load(hashN(1))).not.toBeNull();       // tamamlanmışlar korundu
  });

  it('18) LRU deterministik — ekleme sırasından bağımsız aynı sonuç', () => {
    const build = (order: number[]) => {
      const s = makeStore(memIO().io);
      for (const i of order) {
        _now = 1000 + i;                             // recency = i ile sabit (sıradan bağımsız)
        s.completeScan(input(completedSnap({ vehicleFingerprintHash: hashN(i), scanId: `scan-${i}` })));
      }
      return new Set(s.list().map((r) => r.vehicleFingerprintHash));
    };
    const forward = build([...Array(MAX_DEEP_SCAN_RECORDS + 2).keys()]);
    const reverse = build([...Array(MAX_DEEP_SCAN_RECORDS + 2).keys()].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.size).toBe(MAX_DEEP_SCAN_RECORDS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 19–21 · Fail-soft yükleme
 * ════════════════════════════════════════════════════════════════════════ */

describe('fail-soft yükleme', () => {
  it('19) bozuk JSON → boş store (throw yok)', () => {
    const { io, map } = memIO();
    map.set(DEEP_SCAN_HISTORY_KEY, '{bozuk json ::');
    const s = makeStore(io);
    expect(() => s.list()).not.toThrow();
    expect(s.size).toBe(0);
  });

  it('20) eski/uyumsuz şema → boş (fail-soft)', () => {
    const { io, map } = memIO();
    map.set(DEEP_SCAN_HISTORY_KEY, JSON.stringify({ schema: 999, items: [{ vehicleFingerprintHash: HASH_A }] }));
    const s = makeStore(io);
    expect(s.size).toBe(0);
    expect(s.resolveMode(HASH_A)).toBe('FULL_SCAN'); // güvenli varsayılan
  });

  it('21) tek bozuk kayıt diğerlerini bozmaz', () => {
    const { io, map } = memIO();
    map.set(DEEP_SCAN_HISTORY_KEY, JSON.stringify({
      schema: DEEP_SCAN_SCHEMA_VERSION,
      items: [
        { vehicleFingerprintHash: HASH_A, lastStatus: 'completed', hasCompletedFullScan: true },
        { /* hash yok — bozuk */ lastStatus: 'completed' },
        { vehicleFingerprintHash: VIN_17 }, // VIN → reddedilir
        { vehicleFingerprintHash: HASH_B, lastStatus: 'scanning' },
      ],
    }));
    const s = makeStore(io);
    expect(s.size).toBe(2);
    expect(s.load(HASH_A)).not.toBeNull();
    expect(s.load(HASH_B)).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 22–25 · Yazma politikası / yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('yazma politikası ve yaşam döngüsü', () => {
  it('22) debounce disk yazımını sınırlar (birden çok save → tek yazma)', () => {
    vi.useFakeTimers();
    const { io, stats } = memIO();
    const s = makeStore(io, 5000);
    s.saveSnapshot(input(snap({ scanId: 's1', progressPercent: 10 })));
    s.saveSnapshot(input(snap({ scanId: 's1', progressPercent: 20 })));
    s.saveSnapshot(input(snap({ scanId: 's1', progressPercent: 30 })));
    expect(stats.writes).toBe(0);           // debounce içinde henüz yazma yok
    vi.advanceTimersByTime(5000);
    expect(stats.writes).toBe(1);           // tek birleşik yazma
  });

  it('23) complete sonrası flush ile hemen diske yazılır', () => {
    const { io, stats } = memIO();
    const s = makeStore(io, 5000);
    s.completeScan(input(completedSnap()));
    expect(stats.writes).toBe(0);           // debounce bekliyor
    s.flush();
    expect(stats.writes).toBe(1);
  });

  it('24) dispose bekleyeni flush eder + sonrası yazma planlamaz (zero-leak)', () => {
    vi.useFakeTimers();
    const { io, stats } = memIO();
    const s = makeStore(io, 5000);
    s.saveSnapshot(input(snap()));
    s.dispose();
    expect(stats.writes).toBe(1);           // bekleyen yazıldı
    s.saveSnapshot(input(snap({ scanId: 's2' }))); // dispose sonrası
    vi.advanceTimersByTime(10000);
    expect(stats.writes).toBe(1);           // yeni yazma YOK (disposed no-op)
  });

  it('25) clear tüm kayıtları ve diski temizler', () => {
    const { io, stats } = memIO();
    const s = makeStore(io);
    s.saveSnapshot(input(snap()));
    s.clear();
    expect(s.size).toBe(0);
    expect(stats.removes).toBe(1);
    expect(s.load(HASH_A)).toBeNull();
  });

  it('26) remove yalnız hedef aracı siler', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap({ vehicleFingerprintHash: HASH_A })));
    s.saveSnapshot(input(snap({ vehicleFingerprintHash: HASH_B })));
    expect(s.remove(HASH_A)).toBe(true);
    expect(s.remove(HASH_A)).toBe(false);   // zaten yok
    expect(s.load(HASH_A)).toBeNull();
    expect(s.load(HASH_B)).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 27–28 · Immutability
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability', () => {
  it('27) list/load çıktısı caller tarafından mutate edilemez (frozen)', () => {
    const s = makeStore(memIO().io);
    s.saveSnapshot(input(snap(), { ecuAddresses: ['7E0'] }));
    const rec = s.load(HASH_A)!;
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.discoveredEcus)).toBe(true);
    expect(() => { (rec.discoveredEcus as string[]).push('BAD'); }).toThrow();
    // iç durum bozulmadı
    expect(s.load(HASH_A)!.discoveredEcus).toEqual(['7E0']);
  });

  it('28) girdi objesi ve dizileri mutate edilmez', () => {
    const s = makeStore(memIO().io);
    const ecus = ['7E0', '7E8'];
    const snapshot = snap();
    const frozenInput = input(snapshot, { ecuAddresses: ecus });
    s.saveSnapshot(frozenInput);
    expect(ecus).toEqual(['7E0', '7E8']);        // dokunulmadı
    expect(snapshot.progressPercent).toBe(20);   // dokunulmadı
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 29–31 · Gizlilik + bounded
 * ════════════════════════════════════════════════════════════════════════ */

describe('gizlilik ve bounded', () => {
  it('29) VIN parmak izi reddedilir; MAC firmware sürümü atlanır; VIN uyarı temizlenir', () => {
    const s = makeStore(memIO().io);
    // VIN hash → yazma reddedilir (null)
    expect(s.saveSnapshot(input(snap({ vehicleFingerprintHash: VIN_17 })))).toBeNull();
    expect(s.size).toBe(0);

    // MAC firmware sürümü → atlanır; VIN içeren uyarı → temizlenir
    const rec = s.saveSnapshot(input(
      snap({ warnings: [`arıza ${VIN_17} tespit`] }),
      { firmware: [{ ecu: '7E0', version: 'AA:BB:CC:DD:EE:FF' }, { ecu: '7E0', version: 'V2.0' }] },
    ))!;
    expect(rec.firmwareInventory.map((f) => f.version)).toEqual(['V2.0']); // MAC gitti
    const serialized = JSON.stringify(rec);
    expect(serialized).not.toContain(VIN_17);          // VIN hiçbir alanda yok
    expect(serialized).not.toContain('AA:BB:CC:DD');   // MAC yok
  });

  it('30) ECU/PID/DID listeleri bounded (tavanı aşmaz)', () => {
    const s = makeStore(memIO().io);
    const manyEcus = Array.from({ length: MAX_RECORD_ECUS + 50 }, (_, i) => i.toString(16).padStart(4, '0'));
    const manyPids = Array.from({ length: MAX_RECORD_PIDS + 50 }, (_, i) => (i + 0x10000).toString(16));
    s.saveSnapshot(input(snap(), { ecuAddresses: manyEcus, pidIds: manyPids }));
    const rec = s.load(HASH_A)!;
    expect(rec.discoveredEcus.length).toBe(MAX_RECORD_ECUS);
    expect(rec.discoveredPids.length).toBe(MAX_RECORD_PIDS);
  });

  it('31) storage yazma hatası public API içine sızmaz (throw yok)', () => {
    const throwingIO: DeepScanStoreIO = {
      read: () => null,
      write: () => { throw new Error('quota'); },
      remove: () => { throw new Error('io'); },
    };
    const s = makeStore(throwingIO);
    expect(() => { s.saveSnapshot(input(snap())); s.flush(); }).not.toThrow();
    expect(s.load(HASH_A)).not.toBeNull(); // yazma başarısız olsa da bellek korundu
    expect(() => s.clear()).not.toThrow(); // remove throw etse de sızmaz
    expect(s.load(HASH_A)).toBeNull();     // clear belleği de temizledi
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 32–34 · Yalıtım (import yan etkisi / wiring / runtime)
 * ════════════════════════════════════════════════════════════════════════ */

describe('yalıtım', () => {
  it('32) yapıcı YAN ETKİSİZ — disk yalnız ilk API çağrısında okunur', () => {
    const { io, stats } = memIO();
    const s = makeStore(io);
    expect(stats.reads).toBe(0);   // constructor disk okumadı
    s.load(HASH_A);
    expect(stats.reads).toBe(1);   // ilk API → tek okuma (lazy load)
    s.list(); s.resolveMode(HASH_A);
    expect(stats.reads).toBe(1);   // sonraki çağrılar yeniden okumaz
  });

  it('33) kaynak SystemBoot / runtime servis IMPORT etmez (wiring yok)', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(persistenceSource)).toBe(false);
    expect(/from\s+['"]\.\/deepScanRuntimeService['"]/.test(persistenceSource)).toBe(false);
    // Yalnız model + safeStorage import edilir
    expect(/from\s+['"]\.\/deepScanModel['"]/.test(persistenceSource)).toBe(true);
  });

  it('34) persistence kullanımı runtime servis durumunu DEĞİŞTİRMEZ', () => {
    deepScanRuntimeService.reset();
    const before = deepScanRuntimeService.getSnapshot().status;
    const s = makeStore(memIO().io);
    s.completeScan(input(completedSnap()));
    s.saveSnapshot(input(snap({ vehicleFingerprintHash: HASH_C })));
    expect(deepScanRuntimeService.getSnapshot().status).toBe(before); // idle → değişmedi
  });

  it('lastProgressPercent clamp + reportSummary gizlilik-güvenli klonlanır', () => {
    const s = makeStore(memIO().io);
    const rec = s.completeScan(input(completedSnap({ progressPercent: 250 })))!;
    expect(rec.lastProgressPercent).toBe(100);
    expect(rec.reportSummary).not.toBeNull();
    expect(rec.reportSummary!.ecuCount).toBe(3);
  });
});
