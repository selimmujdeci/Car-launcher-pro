/**
 * arch06PerformanceMeasurement.test.ts — ARCH-06/F1 ÖLÇÜM DÜZLEMİ KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR: F1'in tek çıktısı ÖLÇÜMDÜR. Bir ölçüm katmanının en tehlikeli
 * arızası "yanlış ölçmek" değil, **ölçmediğini ölçmüş gibi göstermektir**:
 * ölçülmemiş bir FPS'i 0 yazmak "ekran donuyor" demektir; bilinmeyen bir
 * cache boyutunu 0 yazmak "yer açmaz" demektir.
 *
 * Bu dosya o yalanları YAPISAL OLARAK imkânsız kılar ve enstrümantasyonun
 * kendi bütçesini (T0/T1/T2) kilitler.
 *
 * Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  measured, derived, unmeasured, section, ratePerSec,
} from '../platform/perf/perfContract';
import {
  bumpPerf, getPerfCounters, perfCounterIds, baselinePerfCounters, deltaSince,
  _resetPerfCountersForTest,
} from '../platform/perf/perfCounters';
import {
  markBootMilestone, hasBootMilestone, measureBootService, recordBootServiceOutcome,
  getBootMilestoneSnapshot, bootMilestoneIds, _resetBootMilestonesForTest,
} from '../platform/bootTimingRecorder';
import { getTimerInventory, timerDescriptors, armWheelOwners } from '../platform/perf/timerInventory';
import {
  getMemoryInventory, memoryDescriptors, bindMemoryEntryReader, _resetMemoryReadersForTest,
} from '../platform/perf/memoryInventory';
import { getPerformanceDiagnosticsSnapshot } from '../platform/perf/performanceAggregator';
import { getPerformanceProfilerLabModel } from '../platform/devtools/performanceProfilerModel';
import { getHotPathLogAudit, hotPathSurfaces } from '../platform/perf/hotPathLogAudit';
import {
  buildPerfBaselineExport, serializePerfBaseline, PERF_BASELINE_SCHEMA_VERSION,
} from '../platform/perf/perfBaselineExport';

/**
 * Yapısal kilitler KODA bakar, YORUMA değil.
 *
 * Bu dosyadaki guard'lar "bu modül şunu YAPMAZ" iddiasını sınar. Modüllerin
 * başlıkları tam olarak o yasakları ANLATTIĞI için (ör. "GLOBAL MONKEYPATCH
 * YOK", "cache BOŞALTMAZ", "VIN TAŞINMAZ") ham metin araması kendi
 * dokümantasyonumuzu ihlal sanardı. Bu yardımcı blok/satır yorumlarını ve
 * dize sabitlerini söker; geriye YALNIZ çalışan kod kalır.
 *
 * ⚠️ Bu bir gevşetme DEĞİLDİR: aksine kilidi GÜÇLENDİRİR — artık bir yasağı
 * yorum yazarak "geçmek" imkânsızdır, gerçek kod denetlenir.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // blok yorum
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')      // satır yorumu (URL'leri korur)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")      // tek tırnak dize
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')      // çift tırnak dize
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');       // şablon dize
}

beforeEach(() => {
  _resetPerfCountersForTest();
  _resetBootMilestonesForTest();
  _resetMemoryReadersForTest();
});
afterEach(() => { _resetMemoryReadersForTest(); });

/* ═══════════════════════════════════════════════════════════════════════════
   A) SÖZLEŞME — "null ≠ 0" YAPISAL GARANTİSİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/A · metrik sözleşmesi', () => {
  it('A1 — ölçülmemiş değer null KALIR ve UNMEASURED işaretlenir', () => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
      const m = measured({ name: 'x', owner: 'o', value: bad as number, unit: 'ms' });
      expect(m.value, String(bad)).toBeNull();
      expect(m.kind).toBe('UNMEASURED');
      /* Ölçüm yoksa TAZELİK İDDİASI da yoktur. */
      expect(m.freshness).toBe('UNAVAILABLE');
    }
  });

  it('A2 — 0 GEÇERLİ bir ölçümdür ve null’a düşmez', () => {
    const m = measured({ name: 'x', owner: 'o', value: 0, unit: 'count' });
    expect(m.value).toBe(0);
    expect(m.kind).toBe('MEASURED');
    expect(m.freshness).toBe('CURRENT');
  });

  it('A3 — türetilmiş metrik ölçülemezse UNMEASURED’a düşer', () => {
    expect(derived({ name: 'r', owner: 'o', value: 5, unit: 'ratio' }).kind).toBe('DERIVED');
    expect(derived({ name: 'r', owner: 'o', value: null, unit: 'ratio' }).kind).toBe('UNMEASURED');
  });

  it('A4 — `unmeasured` DAİMA gerekçe taşır (sessiz boşluk YOK)', () => {
    const m = unmeasured('x', 'o', 'ms', 'API yok');
    expect(m.value).toBeNull();
    expect(m.kind).toBe('UNMEASURED');
    expect(m.provenance).toContain('API yok');
  });

  it('A5 — sıfıra bölme 0 veya Infinity ÜRETMEZ, null döner', () => {
    expect(ratePerSec(10, 0)).toBeNull();
    expect(ratePerSec(10, null)).toBeNull();
    expect(ratePerSec(null, 1000)).toBeNull();
    expect(ratePerSec(10, -5)).toBeNull();
    expect(ratePerSec(10, 1000)).toBe(10);
  });

  it('A6 — metrik ve bölüm DONDURULMUŞTUR (tüketici bozamaz)', () => {
    const m = measured({ name: 'x', owner: 'o', value: 1, unit: 'ms' });
    expect(Object.isFrozen(m)).toBe(true);
    const s = section('s', [m]);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.metrics)).toBe(true);
  });

  it('A7 — ARCH-01/F8 tazelik sözlüğü yeniden TANIMLANMADI', () => {
    const src = readFileSync('src/platform/perf/perfContract.ts', 'utf8');
    /* Yeni bir freshness enum’u kurulmuş olsaydı `CURRENT | STALE` gibi bir
       birleşim tanımı görünürdü. Sözlük runtimeObservability’den GELMELİ. */
    expect(src).toContain("from '../runtime/runtimeObservability'");
    expect(src).not.toMatch(/type\s+EvidenceFreshness\s*=/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) T0 SAYAÇLAR — UCUZLUK VE MONOTONLUK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/B · T0 sayaçlar', () => {
  it('B1 — sayaç artar ve okuma SIFIRLAMAZ (monotonik)', () => {
    bumpPerf('gps.fixAccepted');
    bumpPerf('gps.fixAccepted');
    expect(getPerfCounters()['gps.fixAccepted']).toBe(2);
    getPerfCounters();
    expect(getPerfCounters()['gps.fixAccepted']).toBe(2);
  });

  it('B2 — taban farkı okuyucular arasında pencere ÇALMAZ', () => {
    bumpPerf('bridge.canData.received');
    const a = baselinePerfCounters();
    bumpPerf('bridge.canData.received');
    bumpPerf('bridge.canData.received');
    const b = baselinePerfCounters();
    bumpPerf('bridge.canData.received');
    /* İki okuyucu KENDİ tabanından ölçer; biri diğerinin sayacını sıfırlamaz. */
    expect(deltaSince(a, 'bridge.canData.received')).toBe(3);
    expect(deltaSince(b, 'bridge.canData.received')).toBe(1);
  });

  it('B3 — sayaç kabı SABİT şekillidir (çalışma zamanında alan eklenmez)', () => {
    const before = Object.keys(getPerfCounters()).length;
    bumpPerf('storage.flush');
    // @ts-expect-error — bilinmeyen id bilinçli olarak reddedilir
    bumpPerf('kesinlikle.olmayan.sayac');
    const after = getPerfCounters();
    expect(Object.keys(after).length).toBe(before);
    expect(before).toBe(perfCounterIds().length);
  });

  it('B4 — bilinmeyen id THROW ETMEZ (ölçüm hatası ürünü düşürmez)', () => {
    // @ts-expect-error — kasıtlı geçersiz id
    expect(() => bumpPerf('yok.boyle.bir.sey')).not.toThrow();
  });

  it('B5 — SICAK YOL UCUZ: sayaç fonksiyonunda tahsis/zaman/log YOK', () => {
    const code = codeOnly(readFileSync('src/platform/perf/perfCounters.ts', 'utf8'));
    const start = code.indexOf('export function bumpPerf');
    const body = code.slice(start, code.indexOf('\n}', start));
    /* T0’ın tek işi bir tamsayı artırımıdır. Aşağıdakilerden HERHANGİ BİRİ
       hot-path’e girerse ölçüm, ölçmek istediği maliyeti ÜRETİR (§39). */
    expect(body).not.toMatch(/JSON\.stringify/);
    expect(body).not.toMatch(/Date\.now|performance\.now/);
    expect(body).not.toMatch(/console\./);
    expect(body).not.toMatch(/\.push\(|new Map|new Set|\{\s*\.\.\./);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) BOOT KİLOMETRE TAŞLARI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/C · boot kilometre taşları', () => {
  it('C1 — İLK damga kazanır (yeniden giriş tabanı İLERİ ATMAZ)', () => {
    markBootMilestone('PROCESS_STARTED', 'ilk');
    const first = getBootMilestoneSnapshot().milestones.find((m) => m.milestone === 'PROCESS_STARTED');
    markBootMilestone('PROCESS_STARTED', 'ikinci');
    const second = getBootMilestoneSnapshot().milestones.find((m) => m.milestone === 'PROCESS_STARTED');
    expect(second?.observedAt).toBe(first?.observedAt);
    expect(second?.provenance).toBe('ilk');
  });

  it('C2 — damgalanmamış taş null KALIR, 0 GÖSTERİLMEZ', () => {
    markBootMilestone('PROCESS_STARTED', 'test');
    const snap = getBootMilestoneSnapshot();
    const ff = snap.milestones.find((m) => m.milestone === 'FIRST_FRAME');
    expect(ff?.observedAt).toBeNull();
    expect(ff?.elapsedMs).toBeNull();
    expect(ff?.status).toBe('NOT_OBSERVED');
  });

  it('C3 — elapsed TABANA göredir; taban yoksa null', () => {
    markBootMilestone('FIRST_FRAME', 'tabansız');
    const ff = getBootMilestoneSnapshot().milestones.find((m) => m.milestone === 'FIRST_FRAME');
    /* PROCESS_STARTED damgalanmadı → geçen süre HESAPLANAMAZ. */
    expect(ff?.observedAt).not.toBeNull();
    expect(ff?.elapsedMs).toBeNull();
  });

  it('C4 — INITIALIZED ve AVAILABLE AYRI taşlardır (biri diğerini üretmez)', () => {
    const ids = bootMilestoneIds();
    expect(ids).toContain('VEHICLE_CORE_INITIALIZED');
    expect(ids).toContain('VEHICLE_DATA_FIRST_OBSERVATION');
    expect(ids).toContain('MEDIA_AUTHORITY_INITIALIZED');
    expect(ids).toContain('MEDIA_AUTHORITY_AVAILABLE');
    expect(ids).toContain('NAV_RUNTIME_INITIALIZED');
    expect(ids).toContain('NAV_LOCATION_AVAILABLE');
    /* INITIALIZED damgalamak AVAILABLE’ı ASLA düşürmez. */
    markBootMilestone('VEHICLE_CORE_INITIALIZED', 'test');
    expect(hasBootMilestone('VEHICLE_DATA_FIRST_OBSERVATION')).toBe(false);
    markBootMilestone('MEDIA_AUTHORITY_INITIALIZED', 'test');
    expect(hasBootMilestone('MEDIA_AUTHORITY_AVAILABLE')).toBe(false);
  });

  it('C5 — F1 çıkış kapısının istediği 12 taş TANIMLI', () => {
    expect(bootMilestoneIds().length).toBe(12);
    expect(getBootMilestoneSnapshot().totalCount).toBe(12);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) SERVİS SEVİYESİNDE BOOT ÖLÇÜMÜ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/D · servis ölçümü', () => {
  it('D1 — senkron servis ölçülür ve DEĞERİ AYNEN geri döner', () => {
    const out = measureBootService('svc.sync', 1, true, () => 42);
    expect(out).toBe(42);
    const row = getBootMilestoneSnapshot().services.find((s) => s.serviceId === 'svc.sync');
    expect(row?.outcome).toBe('STARTED');
    expect(row?.durationMs).not.toBeNull();
    expect(row?.blocking).toBe(true);
  });

  it('D2 — asenkron servis start→resolve ölçülür, ZİNCİR bozulmaz', async () => {
    const p = measureBootService('svc.async', 2, true, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'ok';
    });
    await expect(p).resolves.toBe('ok');
    await Promise.resolve();
    const row = getBootMilestoneSnapshot().services.find((s) => s.serviceId === 'svc.async');
    expect(row?.outcome).toBe('STARTED');
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('D3 — hata AYNEN yukarı taşınır (ölçüm katmanı hata YUTMAZ)', () => {
    expect(() => measureBootService('svc.throws', 1, true, () => {
      throw new Error('boot arızası');
    })).toThrow('boot arızası');
    const row = getBootMilestoneSnapshot().services.find((s) => s.serviceId === 'svc.throws');
    expect(row?.outcome).toBe('FAILED');
  });

  it('D4 — reddedilen promise FAILED kaydedilir ve red YUKARI taşınır', async () => {
    const p = measureBootService('svc.rejects', 3, true, () => Promise.reject(new Error('red')));
    await expect(p).rejects.toThrow('red');
    await Promise.resolve(); await Promise.resolve();
    const row = getBootMilestoneSnapshot().services.find((s) => s.serviceId === 'svc.rejects');
    expect(row?.outcome).toBe('FAILED');
  });

  it('D5 — satır tavanı SINIRSIZ büyümeyi imkânsız kılar (zero-leak)', () => {
    for (let i = 0; i < 200; i += 1) recordBootServiceOutcome(`svc-${i}`, 1, 'SKIPPED');
    expect(getBootMilestoneSnapshot().services.length).toBeLessThanOrEqual(96);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) TIMER ENVANTERİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/E · timer envanteri', () => {
  it('E1 — envanter salt-okunur ve dondurulmuş', () => {
    const inv = getTimerInventory();
    expect(Object.isFrozen(inv)).toBe(true);
    expect(inv.declaredCount).toBe(timerDescriptors().length);
    expect(inv.declaredCount).toBeGreaterThan(0);
  });

  it('E2 — GLOBAL TIMER SARMALAMASI YOK (ölçüm sistemi değiştirmez)', () => {
    const code = codeOnly(readFileSync('src/platform/perf/timerInventory.ts', 'utf8'));
    expect(code).not.toMatch(/globalThis\.setInterval\s*=|window\.setInterval\s*=/);
    expect(code).not.toMatch(/const\s+_origSetInterval/);
    /* Envanter hiçbir timer KURMAZ ve hiçbir global'i sarmalamaz. */
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|clearInterval\(/);
  });

  it('E3 — protokol/watchdog timer’ları ARM’e taşınmaya ADAY DEĞİL', () => {
    for (const t of timerDescriptors()) {
      if (t.timerClass === 'DOMAIN_HARD_CADENCE' || t.timerClass === 'WATCHDOG') {
        expect(t.decision, t.timerId).not.toBe('MIGRATE_TO_ARM');
      }
    }
  });

  it('E4 — her descriptor kanıt (dosya:satır) ve gerekçe taşır', () => {
    for (const t of timerDescriptors()) {
      expect(t.sourceRef.length, t.timerId).toBeGreaterThan(0);
      expect(t.rationale.length, t.timerId).toBeGreaterThan(0);
      expect(t.cleanupOwner.length, t.timerId).toBeGreaterThan(0);
    }
  });

  it('E5 — envanter BİLDİRİM olduğunu AÇIKÇA söyler (uyanma sayısı iddia etmez)', () => {
    const inv = getTimerInventory();
    expect(inv.notes.join(' ')).toMatch(/UYANDIĞINI SÖYLEMEZ/);
    const perf = getPerformanceDiagnosticsSnapshot();
    const timers = perf.sections.find((s) => s.sectionId === 'timers');
    const wake = timers?.metrics.find((m) => m.name === 'timers.wakeRate');
    expect(wake?.kind).toBe('UNMEASURED');
  });

  it('E6 — ARM wheel sahipleri F0 ölçümüyle tutarlı (12 alan)', () => {
    expect(armWheelOwners().length).toBe(12);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) BELLEK / CACHE ENVANTERİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/F · bellek envanteri', () => {
  it('F1 — targetBytes F1’de DAİMA null (baseline öncesi hedef YASAK)', () => {
    for (const r of memoryDescriptors()) {
      expect(r.targetBytes, r.resourceId).toBeNull();
    }
  });

  it('F2 — ölçülmemiş bayt null KALIR, 0 YAZILMAZ', () => {
    for (const r of memoryDescriptors()) {
      expect(r.estimatedBytes === null || typeof r.estimatedBytes === 'number').toBe(true);
      if (r.estimatedBytes !== null) expect(r.estimatedBytes).toBeGreaterThanOrEqual(0);
    }
    const inv = getMemoryInventory();
    /* Hiçbir kaynak "0 bayt" diye raporlanmıyor olmalı — ya ölçüldü ya null. */
    expect(inv.resources.every((r) => r.estimatedBytes !== 0)).toBe(true);
  });

  it('F3 — truth sınıfı SİLİNEBİLİR işaretlenemez', () => {
    for (const r of memoryDescriptors()) {
      if (r.memoryClass === 'NON_EVICTABLE_TRUTH') {
        expect(r.evictable, r.resourceId).toBe(false);
      }
    }
  });

  it('F4 — kullanıcı kazanımı olan geçmiş silinebilir işaretlenmez', () => {
    const byId = new Map(memoryDescriptors().map((r) => [r.resourceId, r]));
    expect(byId.get('trip.log')?.evictable).toBe(false);
    expect(byId.get('can.learnedInventory')?.evictable).toBe(false);
  });

  it('F5 — bağlı ucuz okuyucu giriş adedini besler; bağlı değilse null', () => {
    const before = getMemoryInventory().resources.find((r) => r.resourceId === 'perf.series');
    expect(before?.entries).toBeNull();
    bindMemoryEntryReader('perf.series', () => 7);
    const after = getMemoryInventory().resources.find((r) => r.resourceId === 'perf.series');
    expect(after?.entries).toBe(7);
  });

  it('F6 — okuyucu düşerse null’a düşer, toplama BOZULMAZ', () => {
    bindMemoryEntryReader('perf.series', () => { throw new Error('kaynak yok'); });
    const inv = getMemoryInventory();
    expect(inv.resources.find((r) => r.resourceId === 'perf.series')?.entries).toBeNull();
    expect(inv.resources.length).toBeGreaterThan(0);
  });

  it('F7 — envanter HİÇBİR CACHE’İ SİLMEZ', () => {
    const code = codeOnly(readFileSync('src/platform/perf/memoryInventory.ts', 'utf8'));
    /* Tek istisna, TEST kancasının kendi okuyucu haritasını temizlemesidir —
       bu bir CACHE değil, ölçüm sağlayıcı kaydıdır. Kanca zaten üretimden
       çağrılamaz (H3 kilidi). Onu ayırıp geri kalanı denetliyoruz. */
    const withoutTestHook = code.replace(/export function _resetMemoryReadersForTest[\s\S]*?\n/, '');
    expect(withoutTestHook).not.toMatch(/\.clear\(\)/);
    expect(withoutTestHook).not.toMatch(/\.delete\(/);
    expect(withoutTestHook).not.toMatch(/purge\(|evict\(|dispose\(|destroy\(/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) TOPLAYICI — SALT-OKUNUR VE YAN ETKİSİZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/G · toplayıcı', () => {
  it('G1 — toplama sayaçları SIFIRLAMAZ ve durum DEĞİŞTİRMEZ', () => {
    bumpPerf('gps.fixAccepted', 5);
    const before = getPerfCounters()['gps.fixAccepted'];
    getPerformanceDiagnosticsSnapshot();
    getPerformanceDiagnosticsSnapshot();
    expect(getPerfCounters()['gps.fixAccepted']).toBe(before);
  });

  it('G2 — toplayıcıda YÜRÜTME YOK (timer/abonelik/benchmark/mod değişimi)', () => {
    const code = codeOnly(readFileSync('src/platform/perf/performanceAggregator.ts', 'utf8'));
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame\(/);
    expect(code).not.toMatch(/addEventListener|subscribe\(/);
    expect(code).not.toMatch(/setMode\(|purge\(|evict\(/i);
    expect(code).not.toMatch(/_reset[A-Za-z]*ForTest/);
  });

  it('G3 — bölümler dondurulmuş ve ölçüm kapsamı DÜRÜSTÇE raporlanır', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap.totalMetricCount).toBeGreaterThan(0);
    expect(snap.measuredMetricCount).toBeLessThanOrEqual(snap.totalMetricCount);
    /* Ölçülemeyenler GİZLENMEZ — listede UNMEASURED olarak durur. */
    expect(snap.totalMetricCount).toBeGreaterThan(snap.measuredMetricCount);
  });

  it('G4 — F1 çıkış kapısının istediği bölümler MEVCUT', () => {
    const ids = getPerformanceDiagnosticsSnapshot().sections.map((s) => s.sectionId);
    for (const need of ['boot', 'boot_services', 'render', 'bridge', 'gps',
      'map', 'storage', 'timers', 'memory', 'instrumentation']) {
      expect(ids, need).toContain(need);
    }
  });

  it('G5 — bir kaynak düşerse toplama DÜŞMEZ (fail-soft)', () => {
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('saat yok'); });
    expect(() => getPerformanceDiagnosticsSnapshot()).not.toThrow();
    spy.mockRestore();
  });

  it('G6 — tarayıcının vermediği metrik UYDURULMAZ', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const all = snap.sections.flatMap((s) => s.metrics);
    const gpu = all.find((m) => m.name === 'render.gpuDroppedFrames');
    expect(gpu?.kind).toBe('UNMEASURED');
    const owner = all.find((m) => m.name === 'jsthread.longTaskOwner');
    expect(owner?.kind).toBe('UNMEASURED');
    const native = all.find((m) => m.name === 'memory.nativeTotalMb');
    expect(native?.kind).toBe('UNMEASURED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H) ENSTRÜMANTASYON BÜTÇESİ (T0 / T1 / T2)
   ═══════════════════════════════════════════════════════════════════════════ */

const PROD_NON_LAB_FILES = [
  'src/platform/gpsService.ts',
  'src/platform/obdService.ts',
  'src/platform/mediaService.ts',
  'src/platform/vehicleDataLayer/CanAdapter.ts',
  'src/utils/safeStorage.ts',
  'src/platform/map/MapLayerManager.ts',
  'src/platform/map/MapInteractionManager.ts',
  'src/platform/map/MapCore.ts',
  'src/platform/system/SystemBoot.ts',
  'src/main.tsx',
];

describe('ARCH-06/F1/H · enstrümantasyon bütçesi', () => {
  it('H1 — T2 (pahalı toplama) ÜRETİM yollarından ÇAĞRILMAZ', () => {
    for (const f of PROD_NON_LAB_FILES) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('getPerformanceDiagnosticsSnapshot');
      expect(src, f).not.toContain('getPerformanceProfilerLabModel');
    }
  });

  it('H2 — sıcak yollar YALNIZ T0 (bumpPerf) kullanır', () => {
    for (const f of ['src/platform/gpsService.ts', 'src/platform/vehicleDataLayer/CanAdapter.ts',
      'src/platform/obdService.ts', 'src/utils/safeStorage.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('getTimerInventory');
      expect(src, f).not.toContain('getMemoryInventory');
    }
  });

  it('H3 — test-only kancalar ÜRETİM kodundan çağrılmaz', () => {
    const hooks = ['_resetPerfCountersForTest', '_resetBootMilestonesForTest',
      '_resetMemoryReadersForTest', '_resetCanBridgeMetricsForTest'];
    for (const f of [...PROD_NON_LAB_FILES,
      'src/platform/perf/performanceAggregator.ts',
      'src/platform/devtools/performanceProfilerModel.ts',
      'src/components/devtools/screens/PerformanceProfilerScreen.tsx']) {
      const src = readFileSync(f, 'utf8');
      for (const h of hooks) expect(src, `${f} → ${h}`).not.toContain(h);
    }
  });

  it('H4 — T0 iş yükü ÖLÇÜLÜR (enstrümantasyonun kendi maliyeti görünür)', () => {
    bumpPerf('gps.providerCallback', 3);
    const inst = getPerformanceDiagnosticsSnapshot().sections
      .find((s) => s.sectionId === 'instrumentation');
    const total = inst?.metrics.find((m) => m.name === 'instrumentation.t0.totalBumps');
    expect(total?.value).toBeGreaterThanOrEqual(3);
    /* Overhead karşılaştırması AYRI bir baseline koşumudur — burada iddia edilmez. */
    const overhead = inst?.metrics.find((m) => m.name === 'instrumentation.overheadMs');
    expect(overhead?.kind).toBe('UNMEASURED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   I) LAB — SALT-OKUNUR VE GİZLİLİK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/I · LAB yüzeyi', () => {
  it('I1 — LAB modeli salt-okunur ve yürütmez', () => {
    const model = getPerformanceProfilerLabModel();
    expect(model.readOnly).toBe(true);
    expect(Object.isFrozen(model)).toBe(true);
    const code = codeOnly(readFileSync('src/platform/devtools/performanceProfilerModel.ts', 'utf8'));
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|bumpPerf\(/);
    expect(code).not.toMatch(/setMode\(|purge\(|evict\(|clear\(\)/i);
  });

  it('I2 — LAB ekranı komut/benchmark ÇALIŞTIRMAZ', () => {
    const raw = readFileSync('src/components/devtools/screens/PerformanceProfilerScreen.tsx', 'utf8');
    const code = codeOnly(raw);
    expect(code).not.toMatch(/CarLauncher\./);
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|fetch\(/);
    expect(code).not.toMatch(/_reset[A-Za-z]*ForTest|runScenario|runBenchmark/i);
    /* Yenileme ELLEDİR: otomatik timer YOK — düğme ZORUNLU. */
    expect(raw).toContain('data-testid="perf-refresh"');
  });

  it('I3 — TEK yeni LAB yüzeyi eklendi (85 ekranlık enflasyon YOK)', () => {
    const catalog = readFileSync('src/platform/devtools/carosLabCatalog.ts', 'utf8');
    const map = readFileSync('src/components/devtools/carosLabScreenMap.tsx', 'utf8');
    expect(catalog).toContain("id: 'performance-profiler'");
    expect(map).toContain("case 'performance-profiler'");
  });

  it('I4 — GİZLİLİK: hassas alan adları ölçüm katmanına GİRMEZ', () => {
    const files = [
      'src/platform/perf/perfContract.ts', 'src/platform/perf/perfCounters.ts',
      'src/platform/perf/performanceAggregator.ts', 'src/platform/perf/timerInventory.ts',
      'src/platform/perf/memoryInventory.ts', 'src/platform/perf/canBridgeMetrics.ts',
      'src/platform/devtools/performanceProfilerModel.ts',
    ];
    for (const f of files) {
      /* Kod denetlenir: bir alanı OKUMAK yasaktır, adını YASAK olarak
         YAZMAK değil. Aksi hâlde gizlilik kuralını belgeleyen satır,
         gizlilik ihlali sanılırdı. */
      const code = codeOnly(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/latitude|longitude|\bvin\b|transcript|apiKey|token/i);
    }
  });

  it('I5 — CAN köprüsü ölçülemezse NOT_SUPPORTED olur, 0 GÖSTERMEZ', () => {
    const model = getPerformanceProfilerLabModel();
    expect(['OBSERVED', 'NOT_SUPPORTED', 'UNAVAILABLE', 'NOT_READ']).toContain(model.canBridge.state);
    if (model.canBridge.state !== 'OBSERVED') expect(model.canBridge.metrics).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   J) ÜRETİM YOLU BAĞLARI — ÖLÇÜM GERÇEKTEN TAKILI MI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/J · üretim bağları', () => {
  it('J1 — boot kilometre taşları GERÇEK üretim yollarında damgalanıyor', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain("markBootMilestone('PROCESS_STARTED'");
    expect(main).toContain("markBootMilestone('FIRST_FRAME'");
    expect(main).toContain('SHELL_INTERACTIVE');
    /* FIRST_FRAME ÇİFT rAF ile boyama sınırına bağlanmalı — render() dönüşü
       boyama DEĞİLDİR. */
    expect(main).toMatch(/requestAnimationFrame\([\s\S]{0,120}requestAnimationFrame\(/);

    const boot = readFileSync('src/platform/system/SystemBoot.ts', 'utf8');
    expect(boot).toContain("markBootMilestone('VEHICLE_CORE_INITIALIZED'");
    expect(boot).toContain("markBootMilestone('MEDIA_AUTHORITY_INITIALIZED'");
    expect(boot).toContain("markBootMilestone('NAV_RUNTIME_INITIALIZED'");
    expect(boot).toContain("markBootMilestone('BACKGROUND_COMPLETE'");
    /* İKİNCİ boot-complete bayrağı KURULMADI — mevcut __APP_READY__ kullanıldı. */
    expect(boot).toContain('window.__APP_READY__ = true');

    expect(readFileSync('src/platform/gpsService.ts', 'utf8'))
      .toContain("markBootMilestone('NAV_LOCATION_AVAILABLE'");
    expect(readFileSync('src/platform/vehicleDataLayer/CanAdapter.ts', 'utf8'))
      .toContain("markBootMilestone('VEHICLE_DATA_FIRST_OBSERVATION'");
    expect(readFileSync('src/platform/mediaService.ts', 'utf8'))
      .toContain("markBootMilestone('MEDIA_AUTHORITY_AVAILABLE'");
  });

  it('J2 — servis süreleri SystemBoot sırasını DEĞİŞTİRMEDEN ölçülüyor', () => {
    const boot = readFileSync('src/platform/system/SystemBoot.ts', 'utf8');
    expect(boot).toContain('measureBootService(');
    /* Dalga sırası ve abort kontrolleri AYNEN duruyor. */
    expect(boot).toMatch(/await this\._wave1\(\); if \(this\._aborted\)/);
    expect(boot).toMatch(/await this\._wave4\(\); if \(this\._aborted\)/);
  });

  it('J3 — köprü sayaçları gerçek dinleyicilere takılı', () => {
    expect(readFileSync('src/platform/vehicleDataLayer/CanAdapter.ts', 'utf8'))
      .toContain("bumpPerf('bridge.canData.received')");
    expect(readFileSync('src/platform/obdService.ts', 'utf8'))
      .toContain("bumpPerf('bridge.obdData.received')");
    expect(readFileSync('src/platform/memoryWatchdog.ts', 'utf8'))
      .toContain("bumpPerf('bridge.memoryPressure.received')");
    expect(readFileSync('src/platform/gpsService.ts', 'utf8'))
      .toContain("bumpPerf('gps.providerCallback')");
    expect(readFileSync('src/utils/safeStorage.ts', 'utf8'))
      .toContain("bumpPerf('storage.setRequest')");
  });

  it('J4 — CAN’e İKİNCİ JS throttle EKLENMEDİ (F0 kararı korunuyor)', () => {
    const can = readFileSync('src/platform/vehicleDataLayer/CanAdapter.ts', 'utf8');
    expect(can).not.toMatch(/COALESCE_MS|_emitThrottle|_lastEmitAt|debounce/i);
    expect(can).not.toMatch(/setTimeout\([\s\S]{0,80}emit/i);
  });

  it('J5 — native CAN sayaçları eklendi ve getter YAN ETKİSİZ', () => {
    const java = readFileSync('android/app/src/main/java/com/cockpitos/pro/obd/../CarLauncherPlugin.java', 'utf8');
    expect(java).toContain('_canCoalescedCount');
    expect(java).toContain('_canDedupSkipCount');
    expect(java).toContain('_canSafetyBypassCount');
    expect(java).toContain('getCanBridgeMetrics');
    /* Getter sayaçları SIFIRLAMAZ — monotonik kalır. */
    const start = java.indexOf('public void getCanBridgeMetrics');
    const body = java.slice(start, java.indexOf('\n    }', start));
    expect(body).not.toMatch(/=\s*0L|\+\+|reset/i);
    /* Mevcut coalescing sabiti DEĞİŞMEDİ. */
    expect(java).toContain('CAN_EMIT_MIN_INTERVAL_MS = 80L');
  });

  it('J6 — mevcut otoriteler DEĞİŞMEDİ (F0 kilitli kararları)', () => {
    /* ARM tek kaynak otoritesi · OBD native planlayıcı · GPS taban garantisi. */
    expect(readFileSync('src/core/runtime/AdaptiveRuntimeManager.ts', 'utf8'))
      .toContain('MASTER_TICK_MS = 333');
    expect(readFileSync('src/platform/gpsService.ts', 'utf8'))
      .toContain('GPS_NAV_MAX_INTERVAL_MS = 500');
    expect(readFileSync('src/platform/obd/writeGate.ts', 'utf8'))
      .toContain('WRITE_GATE_STOPPED_SPEED_KMH');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   K) SICAK YOL LOG ENVANTERİ — F2 BACKLOG (bu turda DEĞİŞTİRİLMEDİ)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/K · sıcak yol log envanteri', () => {
  it('K1 — envanter bildirimdir ve hiçbir log’u DEĞİŞTİRMEZ', () => {
    const code = codeOnly(readFileSync('src/platform/perf/hotPathLogAudit.ts', 'utf8'));
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/readFileSync|require\(/);
    expect(getHotPathLogAudit().notes.join(' ')).toMatch(/F1 hiçbir log’u DEĞİŞTİRMEDİ/);
  });

  it('K2 — bildirilen her sıcak yol GERÇEKTEN var ve gerekçe taşır', () => {
    for (const h of hotPathSurfaces()) {
      expect(() => readFileSync(h.file, 'utf8'), h.file).not.toThrow();
      expect(h.cadenceSource.length, h.file).toBeGreaterThan(0);
      expect(h.f2Action.length, h.file).toBeGreaterThan(0);
    }
  });

  it('K3 — SICAK BÖLGEDE pahalı console argümanı YOK (gerçek tarama)', () => {
    /* `logGate` çıktıyı bastırır ama ARGÜMANI değerlendirir. Sıcak bölgede
       bir `console.x(...)` çağrısının argümanında JSON.stringify/keys/entries
       geçerse, gate kapalı olsa bile iş yapılır.

       DOSYA DEĞİL BÖLGE taranır: `obdService.ts` içindeki ECU kurtarma ve
       durum geçişi log’ları OLAY-TETİKLİDİR ve pahalı argüman kullanmaları
       meşrudur. Dosyanın tamamını taramak, yanlış yerde alarm üretip GERÇEK
       riski gizlerdi. */
    const consoleCall = /console\.(?:log|warn|info|debug|error)\(([^;]*)\)/g;
    for (const h of hotPathSurfaces()) {
      /* İmza HAM kaynakta aranır: `codeOnly` dize sabitlerini söktüğü için
         `addListener('canData'` gibi bir imza kod-only metinde KAYBOLURDU.
         Bölge ham kaynaktan kesilir, YORUM/DİZE temizliği SONRA uygulanır. */
      const raw = readFileSync(h.file, 'utf8');
      const start = raw.indexOf(h.hotRegionMarker);
      /* İmza bulunamazsa sıcak bölge KAYMIŞTIR — kilit kör kalmasın diye
         AÇIKÇA düşer (CLAUDE.md "kör guard = düşen guard"). */
      expect(start, `${h.file} → sıcak bölge imzası bulunamadı: ${h.hotRegionMarker}`)
        .toBeGreaterThan(-1);
      const NL = String.fromCharCode(10);
      const region = codeOnly(raw.slice(start).split(NL).slice(0, h.hotRegionLines).join(NL));
      let m: RegExpExecArray | null;
      consoleCall.lastIndex = 0;
      while ((m = consoleCall.exec(region)) !== null) {
        const args = m[1] ?? '';
        for (const bad of ['JSON.stringify', 'Object.keys', 'Object.entries']) {
          expect(args, `${h.file} sıcak bölge → ${bad}`).not.toContain(bad);
        }
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   L) TABAN DIŞA AKTARIMI — GİZLİLİK VE DÜRÜSTLÜK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F1/L · taban dışa aktarımı', () => {
  it('L1 — paket ağa ÇIKMAZ, dosya YAZMAZ, ölçüm TETİKLEMEZ', () => {
    const code = codeOnly(readFileSync('src/platform/perf/perfBaselineExport.ts', 'utf8'));
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
    expect(code).not.toMatch(/Filesystem|writeFile|localStorage|safeSetRaw/);
    expect(code).not.toMatch(/setInterval\(|setTimeout\(|bumpPerf\(/);
  });

  it('L2 — BENCH ≠ FIELD ayrımı pakette TAŞINIR', () => {
    const pkg = buildPerfBaselineExport({ scenario: 'COLD_START', environment: 'BENCH_BROWSER' });
    expect(pkg.environment.kind).toBe('BENCH_BROWSER');
    expect(pkg.notes.join(' ')).toMatch(/BENCH ≠ FIELD/);
    expect(pkg.schemaVersion).toBe(PERF_BASELINE_SCHEMA_VERSION);
  });

  it('L3 — pakette HEDEF/PASS-FAIL YOK (F1 taban ölçümüdür)', () => {
    const pkg = buildPerfBaselineExport({ scenario: 'IDLE', environment: 'UNKNOWN' });
    const json = serializePerfBaseline(pkg) ?? '';
    expect(json).not.toMatch(/"pass"|"fail"|"target"|"threshold"|"budget"/i);
  });

  it('L4 — GİZLİLİK: pakette kimlik/konum/ham veri YOK', () => {
    const pkg = buildPerfBaselineExport({ scenario: 'AD_HOC', environment: 'UNKNOWN' });
    const json = serializePerfBaseline(pkg) ?? '';
    expect(json.length).toBeGreaterThan(0);
    /* Yasak olan VERİDİR, alan ADI değil: `userAgentFamily` bir SINIF taşır
       ("Chromium"), ham UA dizesi DEĞİL. Bu yüzden ham UA imzalarını ve
       kimlik verilerini arıyoruz. */
    for (const forbidden of ['latitude', 'longitude', 'transcript',
      'apikey', 'deviceid', 'mozilla/', 'applewebkit', 'android ']) {
      expect(json.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    /* VIN deseni YALNIZ METİN değerlerinde aranır. Ham JSON üzerinde arama
       yapmak yanıltıcıdır: bir kayan nokta sayısı (`0.30000000000000004`)
       17 haneli bir dizi üretir ve VIN sanılır. Bu yüzden paket AYRIŞTIRILIR
       ve yalnız string değerler gezilir — sayısal metrik gürültüsü elenir. */
    const stringValues: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') { stringValues.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v !== null && typeof v === 'object') { Object.values(v).forEach(walk); }
    };
    walk(JSON.parse(json));
    expect(stringValues.length).toBeGreaterThan(0);
    for (const sv of stringValues) {
      expect(sv, 'VIN deseni').not.toMatch(new RegExp(String.raw`[A-HJ-NPR-Z0-9]{17}`));
    }
    /* Cihaz SINIFI taşınabilir, cihaz KİMLİĞİ taşınamaz. */
    expect(pkg.environment.userAgentFamily === null
      || ['Chromium', 'Firefox', 'WebKit', 'Other'].includes(pkg.environment.userAgentFamily)).toBe(true);
  });

  it('L5 — ölçülmemiş metrikler pakette KALIR (listeden düşürülmez)', () => {
    const pkg = buildPerfBaselineExport({ scenario: 'AD_HOC', environment: 'UNKNOWN' });
    expect(pkg.totalMetricCount).toBeGreaterThan(pkg.measuredMetricCount);
  });
});
