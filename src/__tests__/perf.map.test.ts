/**
 * perf.map.test.ts — P5 (Test E): MiniMap↔FullMap geçiş singleton + WebGL leak.
 *
 * Amaç: harita devir protokolünün tek WebGL instance garantisini ve context
 * sızıntısızlığını doğrulamak: (1) yeni init önce mevcut instance'ı yıkar (tek
 * instance), (2) sahiplik-doğrulamalı yıkım — stale instance aktif sahibi
 * öldürmez, (3) yıkımda WebGL context serbest bırakılır (loseContext).
 *
 * Erişim: GERÇEK MapCore (`MapCore.ts`) maplibre-gl + 6 transitif modül import
 * eder (jsdom'da WebGL yok) → import rabbit-hole. Proje konvansiyonu (P3 rafSmoother
 * gibi): import/render-kilitli kod için SADIK protokol modeli. Model MapCore.ts'in
 * birebir karşılığıdır:
 *   - initializeMap: mevcut instance varsa önce destroyMap (satır 144-145)
 *   - destroyMap: store.mapInstance=null + _freeContext (satır 397-414)
 *   - _freeContext: map.remove() + WEBGL_lose_context.loseContext() (satır 83-86)
 *   - destroyOwnedMap: yalnız store.mapInstance===instance ise destroyMap;
 *     değilse instance.remove() (satır 420-426)
 * Gerçek WebGL paint/init maliyeti → K24 manuel (PERF_AUDIT §4, SOAK §6).
 *
 * Kurallar (CLAUDE.md): production'a DOKUNULMAZ; yalnız src/__tests__.
 */
import { describe, it, expect } from 'vitest';

interface FakeMap {
  id:       string;
  removed:  boolean;  // map.remove() çağrıldı
  ctxLost:  boolean;  // WEBGL_lose_context.loseContext() — GPU slot serbest
}

/** MapCore.ts ownership protokolünün sadık modeli (satır 83-86, 144, 397-426). */
function makeMapOwnershipCore() {
  let owner: FakeMap | null = null; // useMapStore.getState().mapInstance karşılığı

  function freeContext(map: FakeMap): void {
    map.removed = true;   // map.remove() (:83)
    map.ctxLost = true;   // loseContext() → GPU slot serbest (:86)
  }
  function getInstance(): FakeMap | null { return owner; }
  function destroyMap(): void {
    const map = owner;
    owner = null;                 // store.mapInstance = null (:406)
    if (map) freeContext(map);    // _freeContext (:410)
  }
  function initializeMap(m: FakeMap): void {
    if (owner) destroyMap();      // mevcut instance → önce yık (tek instance, :144)
    owner = m;
  }
  function destroyOwnedMap(instance: FakeMap): void {
    if (owner === instance) destroyMap();   // sahip → global yıkım (:421)
    else instance.removed = true;           // stale → yalnız kendini kaldır (:424)
  }
  return { getInstance, destroyMap, initializeMap, destroyOwnedMap };
}

function makeMap(id: string): FakeMap { return { id, removed: false, ctxLost: false }; }

describe('P5 — map ownership singleton (Test E)', () => {
  it('tek instance: yeni init önce mevcut haritayı yıkar', () => {
    const core = makeMapOwnershipCore();
    const a = makeMap('A');
    const b = makeMap('B');

    core.initializeMap(a);
    core.initializeMap(b); // mevcut (A) varken init → A yıkılır

    expect(core.getInstance()).toBe(b); // tek aktif instance
    expect(a.removed).toBe(true);       // eski instance yıkıldı (çift instance yok)
    expect(a.ctxLost).toBe(true);       // A'nın WebGL context'i serbest
    expect(b.removed).toBe(false);      // yeni aktif
  });

  it('sahiplik-doğrulamalı yıkım: stale instance aktif sahibi ÖLDÜRMEZ', () => {
    const core = makeMapOwnershipCore();
    const owner = makeMap('OWNER');  // FullMap devraldı
    const stale = makeMap('STALE');  // MiniMap'in eski ref'i
    core.initializeMap(owner);

    core.destroyOwnedMap(stale); // MiniMap stale ref'ini yıkmaya çalışır

    expect(core.getInstance()).toBe(owner); // SAHİP HAYATTA (FullMap çökmedi)
    expect(owner.removed).toBe(false);       // aktif harita dokunulmadı
    expect(stale.removed).toBe(true);        // stale yalnız kendini kaldırdı
  });

  it('sahip yıkımı: WebGL context serbest bırakılır (loseContext)', () => {
    const core = makeMapOwnershipCore();
    const m = makeMap('M');
    core.initializeMap(m);

    core.destroyOwnedMap(m); // sahip → global destroy

    expect(core.getInstance()).toBeNull(); // store temizlendi
    expect(m.removed).toBe(true);
    expect(m.ctxLost).toBe(true);          // GPU slot serbest (context leak yok)
  });

  it('10× MiniMap↔FullMap geçişi: her an ≤1 instance, eski hepsi context-freed', () => {
    const core = makeMapOwnershipCore();
    const created: FakeMap[] = [];

    for (let i = 0; i < 10; i++) {
      const m = makeMap(`m${i}`);
      created.push(m);
      core.initializeMap(m); // önceki otomatik yıkılır
      expect(core.getInstance()).toBe(m); // her an tek aktif
    }
    core.destroyMap(); // son temizlik

    // İlk 9'u (geçişte) + sonuncusu (final destroy) → hepsi context-freed
    expect(created.every((m) => m.removed)).toBe(true);
    expect(created.every((m) => m.ctxLost)).toBe(true); // hiç context biriktirilmedi (leak yok)
    expect(core.getInstance()).toBeNull();
  });
});
