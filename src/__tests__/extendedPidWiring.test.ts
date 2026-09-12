/**
 * extendedPidWiring.test.ts — P1-1 sertleştirme paketi: `obdService → extendedPidService`
 * bağlaması ve değer dolumu (`docs/P1-1_KOK_NEDEN_TESHISI.md` §4'te "❌ yok" işaretli testler).
 *
 * NEDEN BU TESTLER: `obdDeep.extended.samples: []` teşhisinde zincirin hiçbir halkası
 * testle kapsanmıyordu — `signalHub.test.ts` yalnız `seedSupportedPids`'i DOĞRUDAN
 * çağırıyordu, yani "handshake kanıtı native izleme listesine dönüşüyor mu" sorusu
 * cevapsızdı. Kapsanan iki halka:
 *
 *   1. Adım 1-11 (bağlama): sahte handshake sonucu → `_watchAllSupportedPids` →
 *      `watchPid` → `_buildNativeList()` çıktısı BOŞ OLMAMALI ve tam olarak beklenen
 *      core-olmayan destekli PID'leri içermeli.
 *   2. Adım 16-19 (dolum): sahte `obdExtendedData` olayı → `_values` → `getPidValue` →
 *      `buildObdDeepSnapshot().extended.samples` BOŞ OLMAMALI.
 *
 * MOCK YOK (bilinçli): `diagnosticWidth.test.ts` `buildObdDeepSnapshot()`i mock'suz
 * çağırıyor ve `Capacitor.isNativePlatform()` test ortamında `false` — `_pushToNative`
 * ile `_ensureListener` no-op olur, `_buildNativeList()` ise saf hesaptır. Yani gerçek
 * üretim yolu, sahte native olmadan ölçülür.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _internals as extInternals,
  seedSupportedPids,
  getPidValue,
  getSupportedPids,
  getExtendedJsCounters,
  ELM_WATCH_CAP,
} from '../platform/obd/extendedPidService';
import { _obdInternals } from '../platform/obdService';
import { buildObdDeepSnapshot } from '../platform/diagnosticSections';
// Kaynak-metin kilidi TRANSFORM anında gömülür (`?raw`) — dinamik import YOK (#484 dersi).
import obdServiceSrc from '../platform/obdService.ts?raw';

/**
 * Sahte handshake kanıtı — gerçek bir bitmap'in taşıyacağı karışım:
 *  · core PID'ler (0x05 0x0B 0x0C 0x0D 0x0F 0x11 0x2F) → extended'de İZLENMEMELİ
 *  · blok bayrakları (0x20 0x40) → veri değil, sonraki blok bayrağı → İZLENMEMELİ
 *  · gerçek core-olmayan adaylar (0x04 0x10 0x33 0x42 0x49 0x5C) → İZLENMELİ
 */
const HANDSHAKE_SUPPORTED = new Set<number>([
  0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11, 0x20, 0x2f, 0x33, 0x40, 0x42, 0x49, 0x5c,
]);
/** Yukarıdaki kümeden native EXTENDED listesine girmesi BEKLENEN tam küme. */
const EXPECTED_WATCHED = ['04', '10', '33', '42', '49', '5C'];

function seedAndWatch(supported: ReadonlySet<number> = HANDSHAKE_SUPPORTED): void {
  // obdService'in handshake `.then` dalındaki iki satırın BİREBİR aynısı (adım 3-6).
  seedSupportedPids(supported);
  _obdInternals.watchAllSupportedPids(supported);
}

describe('P1-1 · adım 1-11 — obdService → extendedPidService bağlaması', () => {
  beforeEach(() => {
    _obdInternals.clearExtraPidWatches();
    extInternals.reset();
  });
  afterEach(() => {
    _obdInternals.clearExtraPidWatches();
    extInternals.reset();
  });

  it('handshake kanıtı native izleme listesine DÖNÜŞÜR (liste boş DEĞİL)', () => {
    seedAndWatch();
    const list = extInternals.buildNativeList();
    expect(list.length, 'bağlama kopuk: handshake kanıtı native listeye hiç ulaşmıyor').toBeGreaterThan(0);
    expect(_obdInternals.extraPidWatchCount()).toBeGreaterThan(0);
  });

  it('liste TAM OLARAK beklenen core-olmayan destekli PID\'leri içerir', () => {
    seedAndWatch();
    // Keşif kuyruğu tohumlanmış destekle boştur → liste yalnız izlenenlerden oluşur.
    expect(extInternals.getDiscoveryQueue()).toEqual([]);
    expect([...extInternals.buildNativeList()].sort()).toEqual([...EXPECTED_WATCHED].sort());
  });

  it('core PID\'ler extended kanala SIZMAZ (FAST poll zaten okuyor)', () => {
    seedAndWatch();
    const list = extInternals.buildNativeList();
    for (const core of _obdInternals.corePollPids()) {
      const hex = core.toString(16).toUpperCase().padStart(2, '0');
      expect(list, `core PID ${hex} extended listeye sızdı — çift sorgu`).not.toContain(hex);
    }
  });

  it('blok bayrakları (0x20/0x40) veri PID\'i sayılmaz', () => {
    seedAndWatch();
    const list = extInternals.buildNativeList();
    expect(list).not.toContain('20');
    expect(list).not.toContain('40');
  });

  it('izleme tavanı ELM_WATCH_CAP aşılmaz (rotasyon gecikmesi sınırlı kalır)', () => {
    // 1..0x9E arası tüm PID'ler destekli gibi davran → cap devreye girmeli.
    const wide = new Set<number>();
    for (let n = 1; n <= 0x9e; n++) wide.add(n);
    seedAndWatch(wide);
    expect(extInternals.buildNativeList().length).toBeLessThanOrEqual(ELM_WATCH_CAP);
    expect(_obdInternals.extraPidWatchCount()).toBeLessThanOrEqual(ELM_WATCH_CAP);
  });

  it('handshake kanıtı YOKKEN (boş küme) native listeye hiçbir şey gitmez', () => {
    seedAndWatch(new Set<number>());
    expect(extInternals.buildNativeList()).toEqual([]);
  });
});

describe('P1-1 · adım 16-19 — değer dolumu (_values → samples)', () => {
  beforeEach(() => {
    _obdInternals.clearExtraPidWatches();
    extInternals.reset();
  });
  afterEach(() => {
    _obdInternals.clearExtraPidWatches();
    extInternals.reset();
  });

  it('sahte extended olay → _values dolar ve JS sayaçları artar', () => {
    seedAndWatch();
    // 0x04 = hesaplanan motor yükü, tek bayt: 0x80 → %50.2
    extInternals.onExtendedData({ pid: '04', data: '80' });
    const v = getPidValue('04');
    expect(v, 'olay geldi ama değer saklanmadı — decode/registry hattı').toBeDefined();
    expect(Number.isNaN(v!.value)).toBe(false);
    expect(v!.raw).toBe('80');

    const c = getExtendedJsCounters();
    expect(c.eventsReceived).toBe(1);
    expect(c.decodeFailures).toBe(0);
    expect(c.valuesStored).toBe(1);
    expect(c.valuesCached).toBe(1);
  });

  it('obdDeep.extended.samples BOŞ OLMAZ (raporun asıl gözlem yüzeyi)', () => {
    seedAndWatch();
    extInternals.onExtendedData({ pid: '04', data: '80' });
    extInternals.onExtendedData({ pid: '33', data: '65' });

    const deep = buildObdDeepSnapshot();
    expect(deep.extended.discovered).toBe(true);
    expect(deep.extended.supportedCount).toBe(getSupportedPids()!.size);
    expect(deep.extended.samples.length, 'samples: [] — dolum zinciri kopuk').toBeGreaterThan(0);

    const pids = deep.extended.samples.map((s) => s.pid);
    expect(pids).toContain('04');
    expect(pids).toContain('33');
    for (const s of deep.extended.samples) {
      expect(Number.isFinite(s.value)).toBe(true);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.ageMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('çözülemeyen veri değer SAKLAMAZ ama decodeFailures ile DÜRÜSTÇE sayılır', () => {
    seedAndWatch();
    extInternals.onExtendedData({ pid: '04', data: '' }); // eksik yük → NaN
    expect(getPidValue('04')).toBeUndefined();
    const c = getExtendedJsCounters();
    expect(c.eventsReceived).toBe(1);
    expect(c.decodeFailures).toBe(1);
    expect(c.valuesStored).toBe(0);
  });
});

describe('P1-1 · S3 — arka plan izleyicisi için sınırlı yeniden deneme yolu', () => {
  /* Davranış testi cihaz/timer bağımlı olduğu için burada YAPISAL kilit tutulur:
     yeniden deneme yolunun VARLIĞI ve SINIRLI olması. Sonsuz deneme Mali-400
     sözleşmesini ihlal eder (hat meşgul) — bütçe dizisi kaldırılırsa test düşer. */
  it('handshake fail/boş-bitmap dallarında yeniden deneme planlanır ve bütçe sonludur', () => {
    const src = obdServiceSrc;
    expect(src, 'S3 yeniden deneme yolu kaldırılmış — handshake düşerse izleyici HİÇ kurulmaz')
      .toContain('_scheduleExtendedWatchRetry');
    expect(src, 'deneme bütçesi kaldırılmış — sonsuz handshake denemesi hattı meşgul eder')
      .toContain('_EXT_WATCH_RETRY_DELAYS_MS');
    expect(src, 'bütçe kontrolü kaldırılmış')
      .toMatch(/_extWatchRetries\s*>=\s*_EXT_WATCH_RETRY_DELAYS_MS\.length/);
    expect(src, 'stopOBD retry timer\'ını temizlemiyor — zero-leak ihlali')
      .toContain('_clearExtendedWatchRetry()');
  });
});
