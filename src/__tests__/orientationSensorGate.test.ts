/**
 * orientationSensorGate — Foundation birim testleri (PR 1).
 *
 * Kapsam: ref-count multiplexer, tek fiziksel listener/dedup, visibility gate,
 * deterministik fan-out, exception izolasyonu, bounded/fail-soft, zero-leak,
 * import yan etkisizliği, timer/rAF yokluğu ve bağımsızlık (GPS/MapLibre/Kernel).
 *
 * Not: Bu kapı NATIVE sampling rate'i değiştirmez ve böyle bir iddia taşımaz;
 * testler yalnız JS-tarafı abonelik yönetimini doğrular.
 */

import rawSrc from '../platform/sensors/orientationSensorGate.ts?raw';
import * as gate from '../platform/sensors/orientationSensorGate';
import {
  subscribeOrientationAbsolute,
  subscribeOrientation,
  subscribeMotion,
  getSubscriberCounts,
  getStatus,
  reset,
  dispose,
} from '../platform/sensors/orientationSensorGate';

/* ── Test yardımcıları ─────────────────────────────────────────── */

let _vis: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => _vis });
function setVisibility(v: DocumentVisibilityState): void {
  _vis = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

const fireMotion = (): void => { window.dispatchEvent(new Event('devicemotion')); };
const fireAbs    = (): void => { window.dispatchEvent(new Event('deviceorientationabsolute')); };
const fireRel    = (): void => { window.dispatchEvent(new Event('deviceorientation')); };

/** Belirli bir event adı için window.addEventListener çağrı sayısı. */
function addCount(spy: ReturnType<typeof vi.spyOn>, name: string): number {
  return spy.mock.calls.filter((c) => c[0] === name).length;
}

describe('orientationSensorGate (PR 1 foundation)', () => {
  beforeEach(() => {
    _vis = 'visible';
    reset();
  });
  afterEach(() => {
    reset();
    vi.restoreAllMocks();
  });

  /* 1. import yan etkisiz */
  it('1: import yan etkisiz — dinlenmeyen taze durumda hiç listener yok', () => {
    // Kaynak tamamen bağımsız (hiç import yok) → modül seviyesinde yan etki olamaz.
    expect(rawSrc).not.toMatch(/^\s*import\s/m);
    // Taze durumda (abonelik yok) fiziksel/visibility listener bağlı değil.
    const s = getStatus();
    expect(s.channels.motion.listenerAttached).toBe(false);
    expect(s.channels.orientation.listenerAttached).toBe(false);
    expect(s.channels.orientationAbsolute.listenerAttached).toBe(false);
    expect(s.visibilityListenerAttached).toBe(false);
    expect(getSubscriberCounts().total).toBe(0);
  });

  /* 2. ilk consumer listener bağlar */
  it('2: ilk consumer fiziksel listener bağlar', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    subscribeMotion(() => {});
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
    expect(addCount(addSpy, 'devicemotion')).toBe(1);
  });

  /* 3. ikinci consumer yeni fiziksel listener oluşturmaz */
  it('3: ikinci consumer yeni fiziksel listener oluşturmaz (dedup)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    subscribeMotion(() => {});
    subscribeMotion(() => {});
    expect(addCount(addSpy, 'devicemotion')).toBe(1);
    expect(getSubscriberCounts().motion).toBe(2);
  });

  /* 4. tüm callback'lere fan-out */
  it('4: event tüm callback\'lere fan-out edilir', () => {
    const calls: number[] = [];
    subscribeMotion(() => calls.push(1));
    subscribeMotion(() => calls.push(2));
    subscribeMotion(() => calls.push(3));
    fireMotion();
    expect(calls.sort()).toEqual([1, 2, 3]);
  });

  /* 5. callback sırası deterministik */
  it('5: fan-out sırası deterministik (insertion order)', () => {
    const order: number[] = [];
    subscribeMotion(() => order.push(1));
    subscribeMotion(() => order.push(2));
    subscribeMotion(() => order.push(3));
    fireMotion();
    expect(order).toEqual([1, 2, 3]);
  });

  /* 6. duplicate callback engellenir */
  it('6: aynı callback iki kez → tek kayıt, tek çağrı', () => {
    let n = 0;
    const cb = (): void => { n++; };
    subscribeMotion(cb);
    subscribeMotion(cb);
    expect(getSubscriberCounts().motion).toBe(1);
    fireMotion();
    expect(n).toBe(1);
  });

  /* 7. release idempotent */
  it('7: release idempotent — çift çağrı güvenli', () => {
    const release = subscribeMotion(() => {});
    expect(getSubscriberCounts().motion).toBe(1);
    release();
    release();
    release();
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 8. son release fiziksel listener söker */
  it('8: son release fiziksel listener\'ı söker', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const release = subscribeMotion(() => {});
    release();
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
    expect(removeSpy.mock.calls.some((c) => c[0] === 'devicemotion')).toBe(true);
  });

  /* 9. hidden fiziksel listener söker */
  it('9: visibility hidden → fiziksel listener sökülür', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    subscribeMotion(() => {});
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
    setVisibility('hidden');
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
    expect(removeSpy.mock.calls.some((c) => c[0] === 'devicemotion')).toBe(true);
  });

  /* 10. hidden sırasında consumer kaydı korunur */
  it('10: hidden sırasında consumer kaydı korunur', () => {
    subscribeMotion(() => {});
    setVisibility('hidden');
    expect(getSubscriberCounts().motion).toBe(1);
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
  });

  /* 11. visible dönüşünde aktif consumer varsa geri bağlanır */
  it('11: visible dönüşünde aktif consumer varsa yeniden bağlanır', () => {
    subscribeMotion(() => {});
    setVisibility('hidden');
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
    setVisibility('visible');
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
  });

  /* 12. consumer yoksa visible dönüşünde bağlanmaz */
  it('12: consumer yokken görünürlük değişimi listener bağlamaz', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    setVisibility('hidden');
    setVisibility('visible');
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
    expect(addCount(addSpy, 'devicemotion')).toBe(0);
  });

  /* 13. callback exception izolasyonu */
  it('13: bir callback fırlatırsa diğerleri etkilenmez', () => {
    let reached = false;
    subscribeMotion(() => { throw new Error('boom'); });
    subscribeMotion(() => { reached = true; });
    const before = getStatus().callbackErrors;
    expect(() => fireMotion()).not.toThrow();
    expect(reached).toBe(true);
    expect(getStatus().callbackErrors).toBeGreaterThan(before);
  });

  /* 14. event mutate edilmez */
  it('14: dağıtılan event mutate/sarma edilmez (aynı referans)', () => {
    const ev = new Event('devicemotion');
    let received: Event | null = null;
    subscribeMotion((e) => { received = e as unknown as Event; });
    const keysBefore = Object.keys(ev).length;
    window.dispatchEvent(ev);
    expect(received).toBe(ev);                     // sarmalanmadı
    expect(Object.keys(ev).length).toBe(keysBefore); // yeni prop eklenmedi
  });

  /* 15. input callback yapısı mutate edilmez */
  it('15: callback fonksiyonuna gate tarafından prop eklenmez', () => {
    const cb = (): void => {};
    (cb as unknown as { tag: string }).tag = 'consumer';
    const keysBefore = Object.keys(cb).sort();
    subscribeMotion(cb);
    fireMotion();
    expect(Object.keys(cb).sort()).toEqual(keysBefore);
    expect((cb as unknown as { tag: string }).tag).toBe('consumer');
  });

  /* 16. orientation türleri birbirinden bağımsız */
  it('16: absolute ve relative orientation kanalları bağımsız', () => {
    let abs = 0;
    let rel = 0;
    subscribeOrientationAbsolute(() => abs++);
    subscribeOrientation(() => rel++);
    fireAbs();
    expect(abs).toBe(1);
    expect(rel).toBe(0);
    fireRel();
    expect(abs).toBe(1);
    expect(rel).toBe(1);
    const s = getStatus();
    expect(s.channels.orientationAbsolute.listenerAttached).toBe(true);
    expect(s.channels.orientation.listenerAttached).toBe(true);
  });

  /* 17. motion türü bağımsız */
  it('17: motion kanalı orientation event\'lerinden etkilenmez', () => {
    let motion = 0;
    subscribeMotion(() => motion++);
    fireAbs();
    fireRel();
    expect(motion).toBe(0);
    fireMotion();
    expect(motion).toBe(1);
  });

  /* 18. reset */
  it('18: reset tüm consumer\'ları temizler ve modül yeniden kullanılabilir', () => {
    subscribeMotion(() => {});
    subscribeOrientation(() => {});
    subscribeOrientationAbsolute(() => {});
    reset();
    const s = getStatus();
    expect(getSubscriberCounts().total).toBe(0);
    expect(s.disposed).toBe(false);
    expect(s.visibilityListenerAttached).toBe(false);
    expect(s.channels.motion.listenerAttached).toBe(false);
    // Yeniden kullanılabilir:
    let n = 0;
    subscribeMotion(() => n++);
    fireMotion();
    expect(n).toBe(1);
  });

  /* 19. dispose zero-leak */
  it('19: dispose tüm fiziksel + visibility listener\'ları söker (zero-leak)', () => {
    const removeWin = vi.spyOn(window, 'removeEventListener');
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    subscribeMotion(() => {});
    subscribeOrientation(() => {});
    dispose();
    const s = getStatus();
    expect(s.disposed).toBe(true);
    expect(s.channels.motion.listenerAttached).toBe(false);
    expect(s.channels.orientation.listenerAttached).toBe(false);
    expect(s.visibilityListenerAttached).toBe(false);
    expect(removeWin.mock.calls.some((c) => c[0] === 'devicemotion')).toBe(true);
    expect(removeDoc.mock.calls.some((c) => c[0] === 'visibilitychange')).toBe(true);
  });

  /* 20. dispose sonrası API güvenli no-op */
  it('20: dispose sonrası API güvenli no-op (throw yok)', () => {
    dispose();
    let called = false;
    const release = subscribeMotion(() => { called = true; });
    expect(typeof release).toBe('function');
    expect(() => release()).not.toThrow();
    expect(getSubscriberCounts().total).toBe(0);
    fireMotion();
    expect(called).toBe(false);
    expect(getStatus().disposed).toBe(true);
  });

  /* 21. yeni timer yok */
  it('21: abonelik/dağıtım yeni timer kurmaz', () => {
    const si = vi.spyOn(globalThis, 'setInterval');
    const st = vi.spyOn(globalThis, 'setTimeout');
    subscribeMotion(() => {});
    fireMotion();
    setVisibility('hidden');
    setVisibility('visible');
    expect(si).not.toHaveBeenCalled();
    expect(st).not.toHaveBeenCalled();
  });

  /* 22. yeni requestAnimationFrame yok */
  it('22: yeni requestAnimationFrame döngüsü kurmaz', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    subscribeMotion(() => {});
    fireMotion();
    expect(raf).not.toHaveBeenCalled();
  });

  /* 23. bounded consumer sayısı */
  it('23: kanal başına consumer bounded (tavan 64)', () => {
    for (let i = 0; i < 70; i++) subscribeMotion(() => {});
    expect(getSubscriberCounts().motion).toBe(64);
    expect(getStatus().droppedSubscriptions).toBeGreaterThanOrEqual(6);
  });

  /* 24. consumer limiti fail-soft */
  it('24: tavan aşımı fail-soft — throw yok, mevcut consumer\'lar çalışır', () => {
    let hits = 0;
    for (let i = 0; i < 64; i++) subscribeMotion(() => hits++);
    let overflowRelease: gate.Release = () => {};
    expect(() => { overflowRelease = subscribeMotion(() => hits++); }).not.toThrow();
    expect(typeof overflowRelease).toBe('function');
    fireMotion();
    expect(hits).toBe(64); // 65. abonelik reddedildi
  });

  /* 25. visibility listener yalnız bir tane */
  it('25: birden çok abonelik tek visibilitychange listener kurar', () => {
    const docAdd = vi.spyOn(document, 'addEventListener');
    subscribeMotion(() => {});
    subscribeOrientation(() => {});
    subscribeOrientationAbsolute(() => {});
    subscribeMotion(() => {});
    expect(docAdd.mock.calls.filter((c) => c[0] === 'visibilitychange').length).toBe(1);
    expect(getStatus().visibilityListenerAttached).toBe(true);
  });

  /* 26. visibility listener dispose'ta sökülüyor */
  it('26: dispose visibilitychange listener\'ını söker', () => {
    const docRemove = vi.spyOn(document, 'removeEventListener');
    subscribeMotion(() => {});
    expect(getStatus().visibilityListenerAttached).toBe(true);
    dispose();
    expect(docRemove.mock.calls.filter((c) => c[0] === 'visibilitychange').length).toBe(1);
    expect(getStatus().visibilityListenerAttached).toBe(false);
  });

  /* 27. permission akışı değişmiyor (izin tüketicide kalır) */
  it('27: kapı hiçbir permission API\'si içermez (izin tüketicide)', () => {
    const keys = Object.keys(gate);
    expect(keys.some((k) => /permission/i.test(k))).toBe(false);
    expect(rawSrc).not.toMatch(/requestPermission/);
    expect(rawSrc).not.toMatch(/\.permissions?\b/);
  });

  // Not: aşağıdaki bağımsızlık kilitleri IMPORT-regex kullanır (docstring
  // mention'a TAKILMAZ). Kapı tamamen bağımsızdır (hiç import yok) → hiçbir
  // tüketici/motoru import edip etkileyemez.

  /* 28. GPS davranışı değişmiyor */
  it('28: gate gpsService\'i import etmez (bağımsız)', () => {
    expect(rawSrc).not.toMatch(/^\s*import\s/m);        // hiç import yok
    expect(rawSrc).not.toMatch(/from\s+['"][^'"]*gps/i); // gps import yolu yok
  });

  /* 29. MapLibre davranışı değişmiyor */
  it('29: gate MapLibre/harita motorunu import etmez', () => {
    expect(rawSrc).not.toMatch(/from\s+['"][^'"]*maplibre/i);
    expect(rawSrc).not.toMatch(/from\s+['"][^'"]*(mapService|MapCore|\/map)/i);
  });

  /* 30. Platform Kernel PR #55 değişmiyor */
  it('30: gate Platform Kernel\'i import etmez', () => {
    expect(rawSrc).not.toMatch(/from\s+['"][^'"]*(kernel|serviceLifecycle)/i);
  });
});
