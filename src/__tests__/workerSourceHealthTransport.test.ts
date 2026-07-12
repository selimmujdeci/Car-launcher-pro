/**
 * workerSourceHealthTransport.test.ts — PR-1: Worker Source Health Transport kilitleri.
 *
 * AKIŞ: `VehicleCompute.worker` (mevcut 1 Hz watchdog) → `SOURCE_HEALTH` mesajı →
 * `VehicleSignalResolver` → `halStatusStore.sourceHealth`.
 *
 * AMAÇ: worker'ın ZATEN hesapladığı per-kaynak canlılığı (CAN/OBD/GPS) ana thread'e taşımak.
 * Bu PR **bilgi taşır**: hiçbir sinyali unsupported YAPMAZ, HAL/adapter/Event Bus/bridge
 * davranışını DEĞİŞTİRMEZ, yeni timer/polling AÇMAZ.
 *
 * Worker bir Web Worker modülüdür (jsdom'da çalıştırılamaz) → worker/resolver tarafı YAPISAL
 * kilitlerle (`?raw`), store tarafı DAVRANIŞSAL olarak doğrulanır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useHALStatusStore } from '../platform/vehicleDataLayer/halStatusStore';
import workerSrc from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';
import resolverSrc from '../platform/vehicleDataLayer/VehicleSignalResolver.ts?raw';
import adapterSrc from '../platform/vehicleHal/vehicleHalProviderAdapter.ts?raw';

/** Sağlık bloğu: kaynak kilitleri yalnız PR-1 bölgesinde çalışsın (yorum/başka kod karışmasın). */
const HEALTH_BLOCK = workerSrc.slice(
  workerSrc.indexOf('_prevCanAlive'),
  workerSrc.indexOf('function _postEvent'),
);

const initial = useHALStatusStore.getState();

beforeEach(() => {
  useHALStatusStore.setState({
    sourceHealth: { canAlive: null, obdAlive: null, gpsAlive: null, updatedAt: null },
  });
});

/* ── Store davranışı: unknown / geçiş / bağımsızlık / idempotency ──────────── */

describe('PR-1 — halStatusStore.sourceHealth davranışı', () => {
  it('başlangıç UNKNOWN (null) — "false" (ölü) ile KARIŞMAZ', () => {
    const h = useHALStatusStore.getState().sourceHealth;
    expect(h.canAlive).toBeNull();
    expect(h.obdAlive).toBeNull();
    expect(h.gpsAlive).toBeNull();
    expect(h.updatedAt).toBeNull();
  });

  it('alive → store true; dead → store false (geçişler yansır)', () => {
    const set = useHALStatusStore.getState().setSourceHealth;
    set({ can: true, obd: false, gps: true, ts: 100 });
    let h = useHALStatusStore.getState().sourceHealth;
    expect(h.canAlive).toBe(true);
    expect(h.obdAlive).toBe(false);
    expect(h.gpsAlive).toBe(true);
    expect(h.updatedAt).toBe(100);

    set({ can: false, obd: false, gps: true, ts: 200 });   // CAN öldü
    h = useHALStatusStore.getState().sourceHealth;
    expect(h.canAlive).toBe(false);
    expect(h.updatedAt).toBe(200);
  });

  it('dead → alive (reconnect) yansır', () => {
    const set = useHALStatusStore.getState().setSourceHealth;
    set({ can: false, obd: false, gps: false, ts: 10 });
    set({ can: true, obd: false, gps: false, ts: 20 });
    expect(useHALStatusStore.getState().sourceHealth.canAlive).toBe(true);
  });

  it('CAN / OBD / GPS BAĞIMSIZ (biri düşünce diğerleri etkilenmez)', () => {
    const set = useHALStatusStore.getState().setSourceHealth;
    set({ can: true, obd: true, gps: true, ts: 1 });
    set({ can: false, obd: true, gps: true, ts: 2 });
    const h = useHALStatusStore.getState().sourceHealth;
    expect(h.canAlive).toBe(false);
    expect(h.obdAlive).toBe(true);
    expect(h.gpsAlive).toBe(true);
  });

  it('AYNI durum tekrar gelirse store DEĞİŞMEZ (idempotent — gereksiz abone uyanışı yok)', () => {
    const set = useHALStatusStore.getState().setSourceHealth;
    set({ can: true, obd: false, gps: true, ts: 1 });
    const before = useHALStatusStore.getState().sourceHealth;
    set({ can: true, obd: false, gps: true, ts: 999 });   // aynı durum, farklı ts
    const after = useHALStatusStore.getState().sourceHealth;
    expect(after).toBe(before);                            // REFERANS aynı → set() olmadı
    expect(after.updatedAt).toBe(1);
  });

  it('bozuk mesaj YOK SAYILIR (fail-soft; unknown durumu korunur)', () => {
    const set = useHALStatusStore.getState().setSourceHealth;
    set({ can: 'evet', obd: false, gps: true, ts: 1 } as unknown as { can: boolean; obd: boolean; gps: boolean; ts: number });
    expect(useHALStatusStore.getState().sourceHealth.canAlive).toBeNull();
  });

  it('geçersiz ts → updatedAt null (uydurma zaman yok)', () => {
    useHALStatusStore.getState().setSourceHealth({ can: true, obd: true, gps: true, ts: NaN });
    expect(useHALStatusStore.getState().sourceHealth.updatedAt).toBeNull();
  });

  it('BOUNDED ve PII\'siz: yalnız 3 boolean|null + 1 sayı', () => {
    useHALStatusStore.getState().setSourceHealth({ can: true, obd: false, gps: true, ts: 42 });
    const h = useHALStatusStore.getState().sourceHealth;
    expect(new Set(Object.keys(h))).toEqual(new Set(['canAlive', 'obdAlive', 'gpsAlive', 'updatedAt']));
    for (const [k, v] of Object.entries(h)) {
      expect(k === 'updatedAt' ? ['number', 'object'] : ['boolean', 'object']).toContain(typeof v);
    }
    expect(JSON.stringify(h)).not.toMatch(/speed|rpm|vin|lat|lon|frame|[0-9A-F]{17}/i);
  });

  it('mevcut halStatusStore alanları BOZULMADI (canPhase/activeSource/halConnected)', () => {
    expect(typeof initial.setCanPhase).toBe('function');
    expect(typeof initial.setActiveSource).toBe('function');
    expect(typeof initial.setHALConnected).toBe('function');
    expect(initial.canPhase).toBeDefined();
  });
});

/* ── Worker: kenar-tetikleme, yeni timer yok, payload bounded ──────────────── */

describe('PR-1 — worker SOURCE_HEALTH sözleşmesi (kaynak kilidi)', () => {
  it('mesaj tipi yalnız boolean + ts taşır (araç verisi/PII YOK)', () => {
    expect(workerSrc).toMatch(/\|\s*\{\s*type:\s*'SOURCE_HEALTH';\s*can:\s*boolean;\s*obd:\s*boolean;\s*gps:\s*boolean;\s*ts:\s*number\s*\}/);
  });

  it('YALNIZ DEĞİŞİMDE postlanır (duplicate durum → erken çıkış)', () => {
    expect(HEALTH_BLOCK).toMatch(/if\s*\(can === _prevCanAlive && obd === _prevObdAlive && gps === _prevGpsAlive\)\s*return;/);
  });

  it('önceki durum null ile başlar → unknown ≠ false (ilk tur mutlaka bildirilir)', () => {
    expect(HEALTH_BLOCK).toMatch(/_prevCanAlive:\s*boolean \| null = null/);
    expect(HEALTH_BLOCK).toMatch(/_prevObdAlive:\s*boolean \| null = null/);
    expect(HEALTH_BLOCK).toMatch(/_prevGpsAlive:\s*boolean \| null = null/);
  });

  it('MEVCUT 1 Hz watchdog kullanılır — sağlık bloğunda YENİ timer YOK', () => {
    expect(HEALTH_BLOCK).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(workerSrc).toMatch(/function _watchdog\(\)[\s\S]{0,400}_postSourceHealthIfChanged\(canAlive, obdAlive, gpsAlive\)/);
  });

  it('worker timer sayısı DEĞİŞMEDİ (yalnız mevcut 4 setInterval)', () => {
    const intervals = workerSrc.match(/setInterval\(/g) ?? [];
    expect(intervals.length).toBe(4);   // speed · fuel · coolant · watchdog
  });

  it('pre-allocated envelope (hot-path allocation yok)', () => {
    expect(HEALTH_BLOCK).toMatch(/const _outSourceHealth[\s\S]*self\.postMessage\(_outSourceHealth\)/);
  });
});

/* ── Resolver: doğru store alanı, dispose sonrası yazım yok ───────────────── */

describe('PR-1 — resolver kanalı (kaynak kilidi)', () => {
  it('SOURCE_HEALTH → halStatusStore.setSourceHealth', () => {
    expect(resolverSrc).toMatch(/case 'SOURCE_HEALTH':[\s\S]{0,300}setSourceHealth\(/);
  });

  it('dispose sonrası store yazımı YOK: listener terminate\'ten ÖNCE kaldırılır', () => {
    const stopBlock = resolverSrc.slice(resolverSrc.indexOf('stop(): void {'));
    const iRemove = stopBlock.indexOf('removeEventListener');
    const iTerm = stopBlock.indexOf('terminate()');
    expect(iRemove).toBeGreaterThan(0);
    expect(iTerm).toBeGreaterThan(iRemove);   // önce listener kalkar → geç mesaj store'a yazamaz
  });
});

/* ── Kapsam: HAL / Event Bus / bridge davranışı DEĞİŞMEDİ ─────────────────── */

describe('PR-1 — kapsam sınırı', () => {
  it('worker ve resolver HAL/Event Bus/bridge\'e DOKUNMAZ', () => {
    for (const src of [workerSrc, resolverSrc]) {
      expect(src).not.toMatch(/from\s+['"][^'"]*vehicleHal/i);
      expect(src).not.toMatch(/from\s+['"][^'"]*eventBus/i);
      expect(src).not.toMatch(/from\s+['"][^'"]*bridges?/i);
    }
  });

  it('adapter sağlığı YALNIZ snapshot üzerinden tüketir; halStatusStore DOĞRUDAN import EDİLMEZ', () => {
    // KİLİT GÜNCELLENDİ (PR-2): fail-closed tüketim geldi → adapter artık `sourceHealth`'i
    // provider snapshot'ından okur. DEĞİŞMEYEN invaryant: store'lar yapısal DI ile gelir,
    // adapter/provider halStatusStore'u DOĞRUDAN import ETMEZ (import yan etkisiz kalır).
    expect(adapterSrc).toMatch(/sourceHealth/);
    expect(adapterSrc).not.toMatch(/from\s+['"][^'"]*halStatusStore/);
  });

  it('sağlık bloğu hiçbir sinyali unsupported YAPMAZ (source:none üretmez)', () => {
    expect(HEALTH_BLOCK).not.toMatch(/'none'|supported/);
  });
});
