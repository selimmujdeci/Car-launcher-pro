/**
 * platformRuntimeDiagnostics.test.ts — W4E: kalıcı bounded platform teşhis yüzeyi kilitleri.
 *
 * AMAÇ: Event Bus + Vehicle HAL wiring sayaçları, cihazda ADB/CDP veya geçici `window.__`
 * instrumentation OLMADAN mevcut "Tanı Gönder" (support_snapshot) raporundan okunabilsin.
 *
 * Odak: (1) teşhis üretimi runtime wiring BAŞLATMAZ; (2) yalnız whitelist sayaç/durum çıkar —
 * payload/history/telemetri/PII ASLA; (3) wiring yokken fail-soft ("ölçülemiyor" = null, 0 DEĞİL);
 * (4) accessor throw ederse raporun diğer bölümleri üretilmeye devam eder.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlatformRuntimeSnapshot } from '../platform/diagnosticSections';
import {
  startPlatformCoreEventBusWiring,
  getAppEventBus,
  publishRuntimeStarted,
} from '../platform/system/platformCoreEventBusWiring';
import { startPlatformCoreVehicleHalWiring } from '../platform/system/platformCoreVehicleHalWiring';
import type { UnifiedVehicleStoreLike, UnifiedVehicleStateReadable } from '../platform/vehicleHal/providers';
import type { VehicleHalIngestTarget } from '../platform/vehicleHal';

const SRC = join(process.cwd(), 'src', 'platform');
const SECTIONS_SRC = readFileSync(join(SRC, 'diagnosticSections.ts'), 'utf8');
const REMOTE_SRC = readFileSync(join(SRC, 'remoteLogService.ts'), 'utf8');

/* ── Fake'ler ──────────────────────────────────────────────────────────────── */

function fakeStore(state: UnifiedVehicleStateReadable): UnifiedVehicleStoreLike {
  return { getState: () => state, subscribe: () => () => { /* */ } };
}
const fakeHal: VehicleHalIngestTarget = { ingest: () => undefined };

const _open: Array<() => void> = [];
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
  vi.restoreAllMocks();
});

/* ── Yan etki / instance sahipliği ─────────────────────────────────────────── */

describe('W4E — teşhis üretimi runtime wiring BAŞLATMAZ', () => {
  it('wiring yokken teşhis çağrısı bus/adapter YARATMAZ', () => {
    expect(getAppEventBus()).toBeNull();
    const snap = buildPlatformRuntimeSnapshot();
    expect(snap.eventBus.present).toBe(false);
    expect(getAppEventBus()).toBeNull();     // teşhis okuma instance oluşturmadı
  });

  it('teşhis çağrısı mevcut bus instance\'ını DEĞİŞTİRMEZ (sahiplik teşhiste değil)', () => {
    _open.push(startPlatformCoreEventBusWiring());
    const bus = getAppEventBus();
    buildPlatformRuntimeSnapshot();
    buildPlatformRuntimeSnapshot();
    expect(getAppEventBus()).toBe(bus);
    expect(bus!.isDisposed).toBe(false);
  });

  it('teşhis kaynağı yeni timer/polling AÇMAZ ve global debug expose ETMEZ', () => {
    // NOT: kilit YALNIZ W4E bloğuna uygulanır — dosyanın kalanında (mevcut bölümler)
    // `window.__APP_READY__` gibi ÖNCEDEN VAR OLAN okumalar mevcut, onlar kapsam dışı.
    const platformBlock = SECTIONS_SRC.slice(SECTIONS_SRC.indexOf('PLATFORM RUNTIME'));
    expect(platformBlock).not.toMatch(/window\.__|globalThis\./);
    expect(platformBlock).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('teşhis bridge/consumer wiring EKLEMEZ (bridge bölümü yok — W4C)', () => {
    const snap = buildPlatformRuntimeSnapshot();
    expect(Object.keys(snap)).toEqual(['eventBus', 'halWiring']);   // bridge bölümü YOK
    const platformBlock = SECTIONS_SRC.slice(SECTIONS_SRC.indexOf('PLATFORM RUNTIME'));
    expect(platformBlock).not.toMatch(/createVehicleHalEventBridge|\.subscribe\(|\.publish\(/);
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */

describe('W4E — fail-soft ve "ölçülemiyor ≠ 0"', () => {
  it('Event Bus yokken: present=false ve sayaçlar NULL (0 DEĞİL)', () => {
    const { eventBus } = buildPlatformRuntimeSnapshot();
    expect(eventBus.present).toBe(false);
    expect(eventBus.publishedCount).toBeNull();
    expect(eventBus.droppedCount).toBeNull();
    expect(eventBus.activeListenerCount).toBeNull();
    expect(eventBus.lastEventAt).toBeNull();
  });

  it('HAL wiring yokken: started=false ve sayaçlar NULL', () => {
    const { halWiring } = buildPlatformRuntimeSnapshot();
    expect(halWiring.started).toBe(false);
    expect(halWiring.refreshCount).toBeNull();
    expect(halWiring.ingestedSignalCount).toBeNull();
    expect(halWiring.activeSubscriptionCount).toBeNull();
    expect(halWiring.lastErrorCode).toBeNull();
  });

  it('accessor throw ederse bölüm fail-soft döner, DİĞER bölüm üretilmeye devam eder', async () => {
    const mod = await import('../platform/system/platformCoreEventBusWiring');
    vi.spyOn(mod, 'getEventBusStatus').mockImplementation(() => { throw new Error('boom'); });

    _open.push(startPlatformCoreVehicleHalWiring({ store: fakeStore({ speed: 50 }), hal: fakeHal }));

    let snap: ReturnType<typeof buildPlatformRuntimeSnapshot> | null = null;
    expect(() => { snap = buildPlatformRuntimeSnapshot(); }).not.toThrow();
    expect(snap!.eventBus.present).toBe(false);      // patlayan bölüm güvenli boş
    expect(snap!.halWiring.started).toBe(true);      // diğer bölüm ÜRETİLDİ
  });

  it('sayaçlar bozuk (NaN/Infinity) gelirse NULL\'a normalize edilir', async () => {
    const mod = await import('../platform/system/platformCoreEventBusWiring');
    vi.spyOn(mod, 'getEventBusStatus').mockReturnValue({
      present: true, disposed: false,
      publishedCount: NaN, deliveredCount: Infinity, droppedCount: 0,
      listenerErrorCount: 0, duplicateSubscriptionCount: 0, recursionDropCount: 0,
      activeListenerCount: 1, retainedEventCount: 1, historyCount: 1, lastEventAt: NaN,
      runtimeStartedPublished: true, runtimeStoppedPublished: false,
    });
    const { eventBus } = buildPlatformRuntimeSnapshot();
    expect(eventBus.publishedCount).toBeNull();
    expect(eventBus.deliveredCount).toBeNull();
    expect(eventBus.lastEventAt).toBeNull();
    expect(eventBus.droppedCount).toBe(0);           // gerçek 0 korunur
    expect(eventBus.activeListenerCount).toBe(1);
  });

  it('lastErrorCode yalnız SABİT kod kümesinden gelir (serbest metin/stack reddedilir)', async () => {
    const mod = await import('../platform/system/platformCoreVehicleHalWiring');
    vi.spyOn(mod, 'getVehicleHalWiringStatus').mockReturnValue({
      started: true, lastRefreshAt: 1, ingestedSignalCount: 2, refreshCount: 3,
      activeSubscriptionCount: 1,
      lastErrorCode: 'Error: VIN 1HGBH41JXMN109186 at foo.ts:12' as unknown as 'init_failed',
    });
    const { halWiring } = buildPlatformRuntimeSnapshot();
    expect(halWiring.lastErrorCode).toBeNull();      // serbest metin/stack GEÇMEZ
  });
});

/* ── Whitelist / privacy ──────────────────────────────────────────────────── */

describe('W4E — whitelist ve privacy sınırı', () => {
  it('Event Bus varken YALNIZ whitelist alanları çıkar', () => {
    _open.push(startPlatformCoreEventBusWiring());
    publishRuntimeStarted();
    const { eventBus } = buildPlatformRuntimeSnapshot();
    expect(new Set(Object.keys(eventBus))).toEqual(new Set([
      'present', 'disposed', 'publishedCount', 'deliveredCount', 'droppedCount',
      'listenerErrorCount', 'duplicateSubscriptionCount', 'recursionDropCount',
      'activeListenerCount', 'retainedEventCount', 'historyCount', 'lastEventAt',
      'runtimeStartedPublished', 'runtimeStoppedPublished',
    ]));
    expect(eventBus.present).toBe(true);
    expect(eventBus.publishedCount).toBe(1);         // runtime.started
    expect(eventBus.retainedEventCount).toBe(1);
  });

  it('HAL wiring varken YALNIZ whitelist alanları çıkar', () => {
    _open.push(startPlatformCoreVehicleHalWiring({
      store: fakeStore({ speed: 50, canCoolantTemp: 90 }), hal: fakeHal,
    }));
    const { halWiring } = buildPlatformRuntimeSnapshot();
    expect(new Set(Object.keys(halWiring))).toEqual(new Set([
      'started', 'lastRefreshAt', 'refreshCount', 'ingestedSignalCount',
      'activeSubscriptionCount', 'lastErrorCode',
    ]));
    expect(halWiring.started).toBe(true);
    expect(halWiring.activeSubscriptionCount).toBe(1);   // TEK abonelik cihazda okunabilir
    expect(halWiring.ingestedSignalCount).toBeGreaterThan(0);
  });

  it('araç sinyal DEĞERLERİ (hız/RPM/koordinat) teşhis çıktısına GİRMEZ', () => {
    _open.push(startPlatformCoreEventBusWiring());
    _open.push(startPlatformCoreVehicleHalWiring({
      store: fakeStore({ speed: 137, canCoolantTemp: 91, canBatteryVolt: 14.4 }), hal: fakeHal,
    }));
    publishRuntimeStarted();
    const json = JSON.stringify(buildPlatformRuntimeSnapshot());
    expect(json).not.toMatch(/137|91|14\.4/);      // sinyal değerleri yok (yalnız sayaçlar)
    expect(json).not.toMatch(/speed|rpm|coolant|voltage|lat|lon/i);
  });

  it('event payload / history içeriği / correlation teşhise GİRMEZ', () => {
    _open.push(startPlatformCoreEventBusWiring());
    const bus = getAppEventBus()!;
    bus.publishName('vehicle.signal.changed', { signalId: 'vehicle.speed', value: 199 },
      { correlationId: 'corr-secret-42' });
    const json = JSON.stringify(buildPlatformRuntimeSnapshot());
    expect(json).not.toMatch(/signalId|corr-secret|199|vehicle\.speed/);
    // Yalnız SAYIM görünür:
    expect(buildPlatformRuntimeSnapshot().eventBus.publishedCount).toBe(1);
  });

  it('runtime status nesnesi doğrudan SPREAD edilmez (whitelist mapping)', () => {
    const platformBlock = SECTIONS_SRC.slice(SECTIONS_SRC.indexOf('PLATFORM RUNTIME'));
    expect(platformBlock).not.toMatch(/\.\.\.s\b|\.\.\.status|\.\.\.getEventBusStatus|\.\.\.getVehicleHalWiringStatus/);
  });

  it('çıktı yalnız primitif (sayı/bool/null) alanlardan oluşur — iç içe payload yok', () => {
    _open.push(startPlatformCoreEventBusWiring());
    const snap = buildPlatformRuntimeSnapshot();
    for (const section of [snap.eventBus, snap.halWiring] as Array<Record<string, unknown>>) {
      for (const v of Object.values(section)) {
        expect(['number', 'boolean', 'object']).toContain(typeof v);
        if (typeof v === 'object') expect(v).toBeNull();      // yalnız null olabilir
      }
    }
  });
});

/* ── Gerçek rapor akışına dahil olma ──────────────────────────────────────── */

describe('W4E — support_snapshot akışına dahil', () => {
  it('remoteLogService platform bölümünü fail-soft biçimde payload\'a ekler', () => {
    expect(REMOTE_SRC).toMatch(/buildPlatformRuntimeSnapshot/);
    expect(REMOTE_SRC).toMatch(/platform:\s*_safeSection\(buildPlatformRuntimeSnapshot\)/);
  });

  it('teşhis yeni otomatik/yüksek frekanslı gönderim EKLEMEZ (kullanıcı tetikli akış korunur)', () => {
    const platformBlock = SECTIONS_SRC.slice(SECTIONS_SRC.indexOf('PLATFORM RUNTIME'));
    expect(platformBlock).not.toMatch(/pushVehicleEvent|reportSupportSnapshot|fetch\(/);
  });
});
