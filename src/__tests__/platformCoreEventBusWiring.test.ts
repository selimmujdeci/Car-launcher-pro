/**
 * platformCoreEventBusWiring.test.ts — PR-W3 Platform Event Bus Runtime Ownership kilitleri.
 *
 * Odak: TEK bus invaryantı (iki bus = SESSİZ event kaybı), sahiplik/cleanup, boot→shutdown→boot,
 * runtime started/stopped semantiği, bounded teşhis. Kaynak-regex YALNIZ kapsam sınırı ve
 * SystemBoot sıra invaryantı için (davranış testleri gerçek modül üzerinden koşar).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreEventBusWiring,
  getAppEventBus,
  publishRuntimeStarted,
  publishRuntimeStopped,
  getEventBusStatus,
} from '../platform/system/platformCoreEventBusWiring';

const SRC_DIR = join(process.cwd(), 'src');
const WIRING_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'platformCoreEventBusWiring.ts'), 'utf8');
const SYSTEMBOOT_SRC = readFileSync(join(SRC_DIR, 'platform', 'system', 'SystemBoot.ts'), 'utf8');

/** Modül-düzeyi aktif kayıt testler arası SIZMASIN. */
const _open: Array<() => void> = [];
function start() {
  const c = startPlatformCoreEventBusWiring();
  _open.push(c);
  return c;
}
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
});

/* ── Sahiplik & tek-instance ───────────────────────────────────────────────── */

describe('PR-W3 Event Bus wiring — sahiplik & tek instance', () => {
  it('import yan etkisiz: wiring çağrılmadan bus OLUŞMAZ', () => {
    expect(getAppEventBus()).toBeNull();
    expect(getEventBusStatus().present).toBe(false);
  });

  it('start sonrası TEK aktif bus var', () => {
    start();
    const bus = getAppEventBus();
    expect(bus).not.toBeNull();
    expect(bus!.isDisposed).toBe(false);
    expect(getEventBusStatus().present).toBe(true);
  });

  it('İKİNCİ start YENİ instance YARATMAZ (aynı referans)', () => {
    start();
    const first = getAppEventBus();
    start();                                  // duplicate wiring
    expect(getAppEventBus()).toBe(first);     // referans kimliği: aynı nesne
  });

  it('accessor her çağrıda AYNI bus referansını döndürür (gizlice yeni bus yok)', () => {
    start();
    expect(getAppEventBus()).toBe(getAppEventBus());
  });

  it('ikinci start\'ın cleanup\'ı AKTİF bus\'ı düşürmez (no-op)', () => {
    start();
    const bus = getAppEventBus();
    const secondCleanup = start();
    secondCleanup();                          // ikinci (no-op) cleanup
    expect(getAppEventBus()).toBe(bus);       // aktif bus hâlâ ayakta
    expect(bus!.isDisposed).toBe(false);
  });

  it('cleanup İDEMPOTENT (ikinci çağrı çökmez)', () => {
    const cleanup = start();
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it('cleanup sonrası accessor BOŞ ve eski bus DISPOSED (sahiplik: bus dispose EDİLİR)', () => {
    const cleanup = start();
    const bus = getAppEventBus()!;
    cleanup();
    expect(getAppEventBus()).toBeNull();
    expect(bus.isDisposed).toBe(true);
    expect(getEventBusStatus().present).toBe(false);
  });

  it('boot → shutdown → boot: YENİ ve KULLANILABİLİR bus oluşur', () => {
    const c1 = start();
    const bus1 = getAppEventBus()!;
    c1();
    start();
    const bus2 = getAppEventBus()!;
    expect(bus2).not.toBe(bus1);
    expect(bus1.isDisposed).toBe(true);
    expect(bus2.isDisposed).toBe(false);
    expect(bus2.publishName('platform.runtime.started')).not.toBeNull();  // gerçekten kullanılabilir
  });

  it('ESKİ cleanup YENİ aktif bus kaydını SİLEMEZ', () => {
    const c1 = start();
    c1();
    start();
    const bus2 = getAppEventBus();
    c1();                                     // bayat cleanup tekrar çağrılıyor
    expect(getAppEventBus()).toBe(bus2);      // yeni kayıt korunur
    expect(bus2!.isDisposed).toBe(false);
  });

  it('disposed bus accessor\'dan DÖNMEZ (dışarıdan dispose edilse bile)', () => {
    start();
    getAppEventBus()!.dispose();              // dışarıdan (HMR/bayat senaryosu)
    expect(getAppEventBus()).toBeNull();
  });
});

/* ── Fail-soft & listener izolasyonu ──────────────────────────────────────── */

describe('PR-W3 Event Bus wiring — fail-soft', () => {
  it('public API throw ETMEZ (bus yokken bile)', () => {
    expect(() => publishRuntimeStarted()).not.toThrow();
    expect(() => publishRuntimeStopped()).not.toThrow();
    expect(() => getEventBusStatus()).not.toThrow();
    expect(() => getAppEventBus()).not.toThrow();
  });

  it('subscriber hatası bus\'ı çökertmez; DİĞER listener event alır', () => {
    start();
    const bus = getAppEventBus()!;
    const received: string[] = [];
    bus.subscribe('platform.runtime.started', () => { throw new Error('listener patladı'); });
    bus.subscribe('platform.runtime.started', (e) => { received.push(e.name); });
    expect(() => publishRuntimeStarted()).not.toThrow();
    expect(received).toEqual(['platform.runtime.started']);           // sağlam listener teslim aldı
    expect(getEventBusStatus().listenerErrorCount).toBe(1);           // hata sayacı arttı
    expect(bus.isDisposed).toBe(false);                               // bus ayakta
  });

  it('cleanup sonrası publish sessizce yok sayılır (throw yok)', () => {
    const cleanup = start();
    const bus = getAppEventBus()!;
    cleanup();
    expect(bus.publishName('platform.runtime.stopped')).toBeNull();   // disposed → sessiz null
    expect(() => publishRuntimeStopped()).not.toThrow();
  });
});

/* ── Runtime olayları (yalnız mevcut katalog) ─────────────────────────────── */

describe('PR-W3 — platform.runtime.started / stopped', () => {
  it('started YALNIZ BİR KEZ yayınlanır (tekrar çağrı duplicate üretmez)', () => {
    start();
    const bus = getAppEventBus()!;
    const seen: string[] = [];
    bus.subscribe('platform.runtime.started', (e) => seen.push(e.name));
    publishRuntimeStarted();
    publishRuntimeStarted();                  // tekrar
    expect(seen.length).toBe(1);
    expect(getEventBusStatus().runtimeStartedPublished).toBe(true);
  });

  it('started RETAINED (katalog sözleşmesi) — sonradan abone olan replayLast ile alır', () => {
    start();
    const bus = getAppEventBus()!;
    publishRuntimeStarted();
    const late: string[] = [];
    bus.subscribe('platform.runtime.started', (e) => late.push(e.name), { replayLast: true });
    expect(late).toEqual(['platform.runtime.started']);
    expect(getEventBusStatus().retainedEventCount).toBe(1);
  });

  it('stopped bus DISPOSE EDİLMEDEN ÖNCE ve BİR KEZ yayınlanır', () => {
    const cleanup = start();
    const bus = getAppEventBus()!;
    const seen: string[] = [];
    bus.subscribe('platform.runtime.stopped', (e) => seen.push(e.name));
    publishRuntimeStarted();
    publishRuntimeStopped();
    expect(seen).toEqual(['platform.runtime.stopped']);   // bus hâlâ ayaktayken teslim edildi
    expect(bus.isDisposed).toBe(false);
    cleanup();
    expect(bus.isDisposed).toBe(true);                    // dispose SONRA
  });

  it('tekrar stop DUPLICATE stopped üretmez', () => {
    start();
    const bus = getAppEventBus()!;
    const seen: string[] = [];
    bus.subscribe('platform.runtime.stopped', (e) => seen.push(e.name));
    publishRuntimeStarted();
    publishRuntimeStopped();
    publishRuntimeStopped();
    publishRuntimeStopped();
    expect(seen.length).toBe(1);
  });

  it('HİÇ başlamamış sistem (bus yok) SAHTE stopped yayınlamaz', () => {
    expect(getAppEventBus()).toBeNull();
    expect(() => publishRuntimeStopped()).not.toThrow();
    expect(getEventBusStatus().runtimeStoppedPublished).toBe(false);
  });

  it('YARIM boot (started yayınlanmadı) → stopped yayınlanmaz', () => {
    start();                                   // bus var (Wave 1 kuruldu)
    const bus = getAppEventBus()!;
    const seen: string[] = [];
    bus.subscribe('platform.runtime.stopped', (e) => seen.push(e.name));
    publishRuntimeStopped();                   // dalgalar bitmeden shutdown
    expect(seen.length).toBe(0);
    expect(getEventBusStatus().runtimeStoppedPublished).toBe(false);
  });

  it('boot → shutdown → boot: started YENİ bus\'ta tekrar yayınlanır', () => {
    const c1 = start();
    publishRuntimeStarted();
    publishRuntimeStopped();
    c1();
    start();
    const bus2 = getAppEventBus()!;
    const seen: string[] = [];
    bus2.subscribe('platform.runtime.started', (e) => seen.push(e.name));
    publishRuntimeStarted();
    expect(seen.length).toBe(1);               // yeni bus'ta yeniden yayınlandı
  });

  it('runtime event\'leri katalog sözleşmesine uyar (domain/priority/retained)', () => {
    start();
    const bus = getAppEventBus()!;
    let ev: { domain: string; priority: string; retained: boolean; payload: unknown } | null = null;
    bus.subscribe('platform.runtime.started', (e) => {
      ev = { domain: e.domain, priority: e.priority, retained: e.retained, payload: e.payload };
    });
    publishRuntimeStarted();
    expect(ev).not.toBeNull();
    expect(ev!.domain).toBe('platform');
    expect(ev!.priority).toBe('critical');
    expect(ev!.retained).toBe(true);
    expect(ev!.payload).toBeUndefined();       // payload UYDURULMAZ
  });
});

/* ── Bounded teşhis ───────────────────────────────────────────────────────── */

describe('PR-W3 — bounded teşhis', () => {
  it('status yalnız SAYAÇ/BAYRAK taşır — payload/history içeriği YOK', () => {
    start();
    publishRuntimeStarted();
    const s = getEventBusStatus();
    expect(Object.isFrozen(s)).toBe(true);
    expect(new Set(Object.keys(s))).toEqual(new Set([
      'present', 'disposed', 'publishedCount', 'deliveredCount', 'droppedCount',
      'listenerErrorCount', 'duplicateSubscriptionCount', 'recursionDropCount',
      'activeListenerCount', 'retainedEventCount', 'historyCount', 'lastEventAt',
      'runtimeStartedPublished', 'runtimeStoppedPublished',
    ]));
    for (const v of Object.values(s)) {
      expect(['number', 'boolean', 'object']).toContain(typeof v);   // string/ham veri yok
    }
  });

  it('sayaçlar gerçek bus istatistiğini yansıtır', () => {
    start();
    publishRuntimeStarted();
    const s = getEventBusStatus();
    expect(s.publishedCount).toBe(1);
    expect(s.droppedCount).toBe(0);
    expect(s.activeListenerCount).toBe(0);
    expect(typeof s.lastEventAt).toBe('number');
  });
});

/* ── Kapsam sınırı (kaynak-kilidi) ────────────────────────────────────────── */

describe('PR-W3 — kapsam sınırı', () => {
  it('Platform Kernel import EDİLMEZ (Kernel bus\'ın sahibi değil)', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*kernel/i);
  });

  it('HAL bridge / Vehicle HAL / Capability / Deep Scan import EDİLMEZ (W4 ayrı PR)', () => {
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*bridges?/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*vehicleHal/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(WIRING_SRC).not.toMatch(/from\s+['"][^'"]*deepScan/i);
  });

  it('GLOBAL SINGLETON export EDİLMEZ (import yan etkisizliği)', () => {
    expect(WIRING_SRC).not.toMatch(/export\s+const\s+appEventBus/);
    expect(WIRING_SRC).not.toMatch(/^const\s+\w+\s*=\s*createPlatformEventBus\(/m);  // modül düzeyinde çağrı yok
  });

  it('yeni timer/polling AÇILMAZ', () => {
    expect(WIRING_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('kalıcı global debug expose EKLENMEZ', () => {
    expect(WIRING_SRC).not.toMatch(/window\.__|globalThis\./);
  });

  it('yeni event adı UYDURULMAZ (yalnız mevcut katalog)', () => {
    const names = [...WIRING_SRC.matchAll(/'(platform|vehicle|capability|deep_scan)\.[a-z_]+\.[a-z_]+'/g)].map((m) => m[0]);
    expect(new Set(names)).toEqual(new Set(["'platform.runtime.started'", "'platform.runtime.stopped'"]));
  });
});

/* ── SystemBoot entegrasyon sıra kilidi ───────────────────────────────────── */

describe('PR-W3 — SystemBoot entegrasyonu', () => {
  it('bus wiring Wave 1\'de, diğer Wave 1 servislerinden ÖNCE kaydedilir (LIFO → en son dispose)', () => {
    // Kayıt (cleanup push) noktaları karşılaştırılır — import/restart satırları değil.
    const iBus = SYSTEMBOOT_SRC.indexOf('this._reg(startPlatformCoreEventBusWiring())');
    const iUi = SYSTEMBOOT_SRC.indexOf('this._cleanups.push(startUiActivityRecorder())');
    const iVdl = SYSTEMBOOT_SRC.indexOf("this._regNamed('VehicleDataLayer', startVehicleDataLayer(");
    expect(iBus).toBeGreaterThan(0);
    expect(iUi).toBeGreaterThan(iBus);       // Wave 1'in ilk servisi bile bus'tan SONRA
    expect(iVdl).toBeGreaterThan(iBus);      // Wave 2 (VDL) bus'tan SONRA
  });

  it('bus `_reg` ile kaydedilir — `_regNamed` DEĞİL (restartService adayı olmamalı)', () => {
    expect(SYSTEMBOOT_SRC).toMatch(/this\._reg\(startPlatformCoreEventBusWiring\(\)\)/);
    expect(SYSTEMBOOT_SRC).not.toMatch(/_regNamed\([^)]*EventBus/i);
  });

  it('started YALNIZ tüm dalgalar bittikten sonra (recordBootComplete sonrası) yayınlanır', () => {
    const iComplete = SYSTEMBOOT_SRC.indexOf('recordBootComplete()');
    const iStarted = SYSTEMBOOT_SRC.indexOf('publishRuntimeStarted()');
    const iWave4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(iWave4).toBeGreaterThan(0);
    expect(iStarted).toBeGreaterThan(iWave4);
    expect(iStarted).toBeGreaterThan(iComplete);
  });

  it('stopped LIFO cleanup döngüsünden ÖNCE yayınlanır (bus dispose edilmeden)', () => {
    const iStop = SYSTEMBOOT_SRC.indexOf('stop(): void {');
    const tail = SYSTEMBOOT_SRC.slice(iStop);
    const iPublish = tail.indexOf('publishRuntimeStopped()');
    const iLifo = tail.indexOf('for (let i = this._cleanups.length - 1');
    expect(iPublish).toBeGreaterThan(0);
    expect(iLifo).toBeGreaterThan(iPublish);
  });

  it('mevcut Wave sırası (1→2→3→4) DEĞİŞMEDİ', () => {
    const i1 = SYSTEMBOOT_SRC.indexOf('await this._wave1()');
    const i2 = SYSTEMBOOT_SRC.indexOf('await this._wave2()');
    const i3 = SYSTEMBOOT_SRC.indexOf('await this._wave3()');
    const i4 = SYSTEMBOOT_SRC.indexOf('await this._wave4()');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });

  it('SystemBoot Kernel\'i import ETMEZ (legacy servisler Kernel\'e taşınmadı)', () => {
    expect(SYSTEMBOOT_SRC).not.toMatch(/from\s+['"][^'"]*kernel/i);
  });
});
