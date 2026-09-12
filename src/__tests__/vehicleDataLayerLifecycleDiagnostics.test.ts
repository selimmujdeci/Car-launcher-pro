/**
 * vehicleDataLayerLifecycleDiagnostics.test.ts — B-2 · VehicleDataLayer yaşam
 * döngüsü teşhisi.
 *
 * KAPSAM: `getVehicleDataLayerLifecycleDiagnostics()` salt-okuma API'si + doygun
 * sayaçlar + cleanup idempotency guard'ı. Teşhis SALT GÖZLEMDİR; adapter/resolver
 * başlatma sırası ve cleanup sırası bundan etkilenmez.
 *
 * MOCK POLİTİKASI (en küçük güvenli set):
 *   - `./VehicleSignalResolver` → Worker oluşturmayı ve adapter başlatmayı önler.
 *   - `../remoteCommandService` → ağ/Supabase çağrısını önler (kısmi; re-export korunur).
 *   Diğer TÜM bağımlılıklar GERÇEK kalır — üretim davranışı testi kolaylaştırmak
 *   için ZAYIFLATILMAZ.
 *
 * Sayaçlar modül-özel `let`'lerdir ve sıfırlama API'si YOKTUR (üretimde test-özel
 * yüzey açılmaz) → testler MUTLAK değer değil DELTA ölçer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const res = vi.hoisted(() => ({ starts: 0, stops: 0 }));

// Sahte resolver: gerçek Worker/adapter başlatmasını devre dışı bırakır.
vi.mock('../platform/vehicleDataLayer/VehicleSignalResolver', () => ({
  VehicleSignalResolver: class {
    start(): void { res.starts++; }
    stop():  void { res.stops++; }
    onResolved(_cb: unknown): () => void { return () => { /* no-op */ }; }
    sendGeofence(_z: unknown): void { /* no-op */ }
    restoreOdometer(_km: number): void { /* no-op */ }
    setHandshakeOutcome(_o: unknown): void { /* no-op */ }
    chaosBitflip(): void { /* no-op */ }
  },
}));

// Ağ/Supabase yolunu kes; modülün diğer export'ları (setRemoteCommandContext) GERÇEK.
vi.mock('../platform/remoteCommandService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/remoteCommandService')>();
  return {
    ...actual,
    startRemoteCommands: () => Promise.resolve(),
    stopRemoteCommands:  () => { /* no-op */ },
  };
});

import {
  startVehicleDataLayer,
  getVehicleDataLayerLifecycleDiagnostics as diag,
  VDL_DIAG_COUNTER_MAX,
} from '../platform/vehicleDataLayer';

// Kaynak-metin kilidi: doygunluk davranışı 1e6 çağrı yapılmadan kanıtlanır.
import vdlSource from '../platform/vehicleDataLayer/index.ts?raw';

/** Test sonunda kalan cleanup'ları güvenle kapatmak için. */
let _openCleanups: Array<() => void> = [];

function start(): () => void {
  const c = startVehicleDataLayer();
  _openCleanups.push(c);
  return c;
}

beforeEach(() => { res.starts = 0; res.stops = 0; });

afterEach(() => {
  for (const c of _openCleanups) { try { c(); } catch { /* zaten kapalı */ } }
  _openCleanups = [];
  vi.clearAllTimers();
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('B-2 — sözleşme ve başlangıç durumu', () => {
  it('anlık görüntü beklenen alanları taşır ve tipleri doğrudur', () => {
    const d = diag();
    expect(Object.keys(d).sort()).toEqual(
      ['active', 'counterMax', 'lastStartedAtMs', 'lastStoppedAtMs', 'starts', 'stops'].sort(),
    );
    expect(typeof d.active).toBe('boolean');
    expect(typeof d.starts).toBe('number');
    expect(typeof d.stops).toBe('number');
    expect(d.counterMax).toBe(VDL_DIAG_COUNTER_MAX);
    // Zaman damgaları: sayı VEYA null (başka tip yok)
    for (const t of [d.lastStartedAtMs, d.lastStoppedAtMs]) {
      expect(t === null || typeof t === 'number').toBe(true);
    }
  });

  it('hiç başlatılmamışken active=false (bu dosyada ilk okuma)', () => {
    const d = diag();
    expect(d.active).toBe(false);
    expect(d.starts).toBeGreaterThanOrEqual(0);
    expect(d.stops).toBeGreaterThanOrEqual(0);
  });
});

describe('B-2 — start sayacı ve active', () => {
  it('başarılı start starts\'ı BİR artırır ve active=true yapar', () => {
    const before = diag();
    expect(before.active).toBe(false);

    start();

    const after = diag();
    expect(after.starts).toBe(before.starts + 1);
    expect(after.stops).toBe(before.stops);          // stop sayacı etkilenmez
    expect(after.active).toBe(true);
    expect(typeof after.lastStartedAtMs).toBe('number');
    expect(res.starts).toBe(1);                       // gerçek resolver.start() çağrıldı
  });
});

describe('B-2 — stop sayacı ve idempotency', () => {
  it('cleanup stops\'ı BİR artırır ve active=false yapar', () => {
    const cleanup = start();
    const afterStart = diag();

    cleanup();

    const afterStop = diag();
    expect(afterStop.stops).toBe(afterStart.stops + 1);
    expect(afterStop.starts).toBe(afterStart.starts);
    expect(afterStop.active).toBe(false);
    expect(typeof afterStop.lastStoppedAtMs).toBe('number');
    expect(res.stops).toBe(1);
  });

  it('tekrarlanan cleanup İDEMPOTENT — stops yalnız BİR artar, teardown tekrar koşmaz', () => {
    const cleanup = start();
    const afterStart = diag();

    cleanup();
    cleanup();
    cleanup();
    cleanup();

    const d = diag();
    expect(d.stops).toBe(afterStart.stops + 1);       // 4 çağrı → 1 artış
    expect(res.stops).toBe(1);                        // resolver.stop() da 1 kez
    expect(d.active).toBe(false);
  });
});

describe('B-2 — çok döngülü start/stop dengesi', () => {
  it('3 tam döngü sonrası starts−stops farkı korunur ve active=false', () => {
    const base = diag();

    for (let i = 0; i < 3; i++) {
      const c = startVehicleDataLayer();
      expect(diag().active).toBe(true);
      c();
      expect(diag().active).toBe(false);
    }

    const d = diag();
    expect(d.starts).toBe(base.starts + 3);
    expect(d.stops).toBe(base.stops + 3);
    expect(d.starts - d.stops).toBe(base.starts - base.stops);   // denge korunur
    expect(res.starts).toBe(3);
    expect(res.stops).toBe(3);
  });

  it('açık (dispose edilmemiş) katman starts−stops farkını 1 artırır', () => {
    const base = diag();
    start();                                          // afterEach kapatacak
    const d = diag();
    expect(d.starts - d.stops).toBe(base.starts - base.stops + 1);
    expect(d.active).toBe(true);
  });
});

describe('B-2 — zaman damgaları', () => {
  it('lastStartedAtMs / lastStoppedAtMs azalmaz (monoton olmayan-azalan)', () => {
    const c1 = start();
    const t1 = diag().lastStartedAtMs!;
    c1();
    const s1 = diag().lastStoppedAtMs!;
    expect(s1).toBeGreaterThanOrEqual(t1);

    const c2 = start();
    const t2 = diag().lastStartedAtMs!;
    expect(t2).toBeGreaterThanOrEqual(s1);
    c2();
    const s2 = diag().lastStoppedAtMs!;
    expect(s2).toBeGreaterThanOrEqual(t2);
  });
});

describe('B-2 — yan etkisizlik', () => {
  it('tekrarlanan getter çağrıları SIFIR mutasyon yapar', () => {
    const cleanup = start();
    const a = diag();
    const resolverStartsBefore = res.starts;
    const resolverStopsBefore  = res.stops;

    for (let i = 0; i < 50; i++) diag();

    const b = diag();
    expect(b).toEqual(a);                             // tüm alanlar aynı
    expect(res.starts).toBe(resolverStartsBefore);    // hiçbir şey başlatılmadı
    expect(res.stops).toBe(resolverStopsBefore);      // hiçbir şey durdurulmadı
    cleanup();
  });

  it('dönen anlık görüntü DONDURULMUŞ (tüketici bozamaz)', () => {
    const d = diag();
    expect(Object.isFrozen(d)).toBe(true);
    expect(() => {
      (d as unknown as { starts: number }).starts = 999;
    }).toThrow();                                     // strict mod: frozen yazımı fırlatır
    expect(diag().starts).not.toBe(999);
  });
});

describe('B-2 — doygunluk (bounded)', () => {
  it('counterMax anlık görüntüde açık ve sayaçlar bu sınırı aşmaz', () => {
    const d = diag();
    expect(d.counterMax).toBe(1_000_000);
    expect(d.starts).toBeLessThanOrEqual(d.counterMax);
    expect(d.stops).toBeLessThanOrEqual(d.counterMax);
  });

  it('KAYNAK KİLİDİ: her iki sayaç _satInc üzerinden artar ve _satInc sınırda kelepçeler', () => {
    // Doygunluğu 1e6 çağrı yapmadan kanıtlar (modül-özel let'lere erişim yok).
    expect(vdlSource).toMatch(/_dlStarts\s*=\s*_satInc\(_dlStarts\)/);
    expect(vdlSource).toMatch(/_dlStops\s*=\s*_satInc\(_dlStops\)/);
    expect(vdlSource).toMatch(
      /function _satInc\(n: number\): number \{\s*return n >= VDL_DIAG_COUNTER_MAX \? VDL_DIAG_COUNTER_MAX : n \+ 1;/,
    );
    expect(vdlSource).toMatch(/VDL_DIAG_COUNTER_MAX = 1_000_000/);
    // Cleanup idempotency guard'ı kaynakta MEVCUT olmalı
    expect(vdlSource).toMatch(/let _disposed = false;/);
    expect(vdlSource).toMatch(/if \(_disposed\) return;/);
  });
});

describe('B-2 — gizlilik', () => {
  it('anlık görüntüde hassas-veri şekilli alan veya değer YOK', () => {
    const cleanup = start();
    const d = diag();
    const keys = Object.keys(d).join('|');
    expect(keys).not.toMatch(/vin|lat|lon|coord|gps|speed|rpm|fuel|odo|token|key|secret|user|id$/i);

    // Değerler yalnız boolean · number · null
    for (const v of Object.values(d)) {
      expect(v === null || typeof v === 'number' || typeof v === 'boolean').toBe(true);
    }
    // Serileştirilmiş hâlde VIN/MAC/koordinat deseni yok
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/);                  // VIN
    expect(json).not.toMatch(/[0-9A-F]{2}(:[0-9A-F]{2}){5}/i);        // MAC
    expect(json).not.toMatch(/-?\d{1,3}\.\d{4,}/);                    // koordinat
    cleanup();
  });
});
