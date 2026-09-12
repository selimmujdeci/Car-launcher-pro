/**
 * eventBusDemandGate.test.ts — PR-E1: talep-kapılı transient publish kilitleri.
 *
 * KANIT (saha raporu 8edd61a6, 2026-07-15): `publishedCount 127 · activeListenerCount 0 ·
 * deliveredCount 0 · droppedCount 0 · historyCount 22 · retainedEventCount 3`.
 * Bus mekanik olarak sağlam ama TÜKETİCİSİZ: her `vehicle.signal.changed` publish'i
 * `Object.freeze` + 4-seviye `_deepFreeze` + metin sanitize + kuyruk + drain ödüyor ve
 * sonunda BOŞ listener listesine varıyor (`platformEventBus.ts:470`). CLAUDE.md:
 * "hot-path'e ASLA girmez" + "bütçesiz özellik ekleme yasak" → bu aktif ihlal.
 *
 * SÖZLEŞME:
 *  · transient + abone YOK  → publish HİÇ çağrılmaz (maliyet sıfır, sayaç kirlenmez)
 *  · transient + abone VAR  → publish edilir, teslim edilir
 *  · retained  + abone YOK  → HER ZAMAN publish edilir (geç gelen tüketici replayLast ile
 *                             doğru başlangıç durumunu alsın — `_retain` dispatch'ten önce)
 *  · dedupe imzası YALNIZ gerçek publish sonrası güncellenir (yoksa: skip → imza set →
 *    abone gelir → aynı değer → dedupe yutar → ilk gerçek event KAYBOLUR)
 *  · fail-safe: `hasSubscribers` yoksa/patlarsa → PUBLISH ET (eski davranış; event kaybetme)
 */

import { describe, it, expect, vi } from 'vitest';
import { VehicleHalEventBridge, type EventBusPublishTarget, type VehicleHalEventBridgeDeps } from '../platform/eventBus/bridges/vehicleHalEventBridge';
import type { PlatformEvent } from '../platform/eventBus/platformEventBus';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const SIG = (over: Record<string, unknown> = {}) => ({
  id: 'vehicle.speed', supported: true, value: 42, quality: 'good',
  confidence: 0.9, source: 'obd', stale: false, timestamp: 1000, ...over,
});

/** Sahte HAL — snapshot'ı testin kontrolünde. */
function makeHal(signals: unknown[], identity: Record<string, unknown> = {}) {
  let cb: ((snap: unknown) => void) | null = null;
  const snap = () => ({ signals, connected: true });
  const hal = {
    subscribe: (fn: (snap: unknown) => void) => { cb = fn; return () => { cb = null; }; },
    getSnapshot: snap,
    getVehicleIdentity: () => ({ supported: false, protocol: null, fingerprintHash: null, ...identity }),
  };
  /** HAL yeniden yayın yapmış gibi tetikle (bridge start()'ta subscribe olur). */
  const emit = () => cb?.(snap());
  return { hal: hal as unknown as VehicleHalEventBridgeDeps['hal'], emit };
}

/** Sahte bus — publish çağrılarını sayar; hasSubscribers testin kontrolünde. */
function makeBus(opts: { subscribed?: boolean | ((name: string) => boolean); omitHasSubscribers?: boolean; throwOnHas?: boolean } = {}) {
  const publish = vi.fn((input: { name: string }) => ({ id: 'e1', name: input.name } as unknown as PlatformEvent));
  const bus: Record<string, unknown> = { publish };
  if (!opts.omitHasSubscribers) {
    bus.hasSubscribers = vi.fn((name: string) => {
      if (opts.throwOnHas) throw new Error('bus patladı');
      if (typeof opts.subscribed === 'function') return opts.subscribed(name);
      return opts.subscribed ?? false;
    });
  }
  return { bus: bus as unknown as EventBusPublishTarget, publish, hasSubscribers: bus.hasSubscribers as ReturnType<typeof vi.fn> | undefined };
}

const names = (publish: ReturnType<typeof vi.fn>): string[] =>
  publish.mock.calls.map((c) => (c[0] as { name: string }).name);

/* ── 1. Abone yok — transient ─────────────────────────────────────────────── */

describe('PR-E1 · transient + abone YOK', () => {
  it('vehicle.signal.changed publish HİÇ çağrılmaz (hot-path maliyeti sıfır)', () => {
    const { bus, publish } = makeBus({ subscribed: false });
    const b = new VehicleHalEventBridge({ hal: makeHal([SIG()]).hal, bus });

    b.start();

    expect(names(publish)).not.toContain('vehicle.signal.changed');
    // Bounded telemetri: atlanan yayın gözlemlenebilir olmalı (drop DEĞİL — bus'a hiç girmedi)
    const st = b.getStatus() as unknown as { skippedCount?: number; droppedCount: number; publishedCount: number };
    expect(st.droppedCount).toBe(0);          // atlama ≠ drop; sayaç kirlenmez
    expect(st.skippedCount ?? 0).toBeGreaterThan(0);
    b.dispose();
  });
});

/* ── 2. Abone var — transient ─────────────────────────────────────────────── */

describe('PR-E1 · transient + abone VAR', () => {
  it('publish edilir ve sayaç artar', () => {
    const { bus, publish } = makeBus({ subscribed: true });
    const b = new VehicleHalEventBridge({ hal: makeHal([SIG()]).hal, bus });

    b.start();

    expect(names(publish)).toContain('vehicle.signal.changed');
    expect((b.getStatus() as unknown as { publishedCount: number }).publishedCount).toBeGreaterThan(0);
    b.dispose();
  });
});

/* ── 3. Retained — abone olmasa BİLE yayınlanır ───────────────────────────── */

describe('PR-E1 · retained + abone YOK', () => {
  it('connection/ignition/identity retained event’leri HER ZAMAN yayınlanır', () => {
    const { bus, publish } = makeBus({ subscribed: false });   // hiç abone yok
    const b = new VehicleHalEventBridge({
      hal: makeHal([SIG({ id: 'vehicle.ignition', value: true })], { supported: true, protocol: '6' }).hal,
      bus,
    });

    b.start();

    const published = names(publish);
    // Retained yaşam-döngüsü event'leri kapıya TABİ DEĞİL (geç gelen tüketici replayLast ile
    // doğru başlangıç durumunu almalı — `_retain` dispatch'ten ÖNCE çalışır).
    expect(published).toContain('vehicle.connection.changed');
    expect(published.some((n) => n === 'vehicle.ignition.changed' || n === 'vehicle.identity.changed')).toBe(true);
    // Transient olan yine atlanır:
    expect(published).not.toContain('vehicle.signal.changed');
    b.dispose();
  });
});

/* ── 4/5. Dedupe: skip edilen event imzayı KİRLETMEZ (R-1) ───────────────── */

describe('PR-E1 · dedupe imzası yalnız gerçek publish sonrası güncellenir', () => {
  it('abone yokken atlanan değer, abone gelince İLK EVENT olarak teslim edilir', () => {
    let subscribed = false;
    const { bus, publish } = makeBus({ subscribed: () => subscribed });
    const { hal, emit } = makeHal([SIG({ value: 42 })]);
    const b = new VehicleHalEventBridge({ hal, bus });

    // 1) Abone yokken aynı değer iki kez akar → publish yok, imza KİRLENMEMELİ.
    b.start();
    expect(names(publish)).not.toContain('vehicle.signal.changed');

    // 2) Abone geldi; DEĞER DEĞİŞMEDİ (aynı 42) → yine de ilk gerçek event gelmeli.
    subscribed = true;
    emit();                 // HAL aynı değeri yeniden yayınladı

    expect(names(publish).filter((n) => n === 'vehicle.signal.changed').length).toBe(1);
    b.dispose();
  });

  it('abone varken aynı değer tekrar publish EDİLMEZ (dedupe korunur)', () => {
    const { bus, publish } = makeBus({ subscribed: true });
    const { hal, emit } = makeHal([SIG({ value: 42 })]);
    const b = new VehicleHalEventBridge({ hal, bus });

    b.start();
    emit();               // aynı değer → dedupe yutmalı

    expect(names(publish).filter((n) => n === 'vehicle.signal.changed').length).toBe(1);
    b.dispose();
  });
});

/* ── 6. Kapı event-adı bazlı ──────────────────────────────────────────────── */

describe('PR-E1 · kapı event-adı bazlı', () => {
  it('başka event’e abone olmak vehicle.signal.changed’i açmaz', () => {
    const { bus, publish } = makeBus({ subscribed: (name) => name === 'vehicle.connection.changed' });
    const b = new VehicleHalEventBridge({ hal: makeHal([SIG()]).hal, bus });

    b.start();

    expect(names(publish)).not.toContain('vehicle.signal.changed');
    expect(names(publish)).toContain('vehicle.connection.changed');
    b.dispose();
  });
});

/* ── 7. FAIL-SAFE ─────────────────────────────────────────────────────────── */

describe('PR-E1 · fail-safe: belirsizlikte YAYINLA (event kaybetme)', () => {
  it('bus hasSubscribers SAĞLAMIYORSA eski davranış korunur (publish edilir)', () => {
    const { bus, publish } = makeBus({ omitHasSubscribers: true });   // eski/fake bus
    const b = new VehicleHalEventBridge({ hal: makeHal([SIG()]).hal, bus });

    b.start();

    expect(names(publish)).toContain('vehicle.signal.changed');   // geriye dönük uyum
    b.dispose();
  });

  it('hasSubscribers PATLARSA event sessizce kaybedilmez → publish edilir', () => {
    const { bus, publish } = makeBus({ throwOnHas: true });
    const b = new VehicleHalEventBridge({ hal: makeHal([SIG()]).hal, bus });

    b.start();

    expect(names(publish)).toContain('vehicle.signal.changed');
    b.dispose();
  });
});
