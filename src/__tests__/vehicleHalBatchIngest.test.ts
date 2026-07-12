/**
 * vehicleHalBatchIngest.test.ts — W4A: Vehicle HAL Provider Adapter BATCH INGEST kilitleri.
 *
 * KÖK PROBLEM (düzeltilen): adapter sinyal başına `hal.ingestSignal()` çağırıyordu; HAL her
 * değişimde revision artırıp 15 sinyallik tam snapshot'ı kopyalayıp/sıralayıp/dondurup emit
 * ediyordu → tek store tick'inde **N değişim = N emit (+ N snapshot)**.
 * YENİ SÖZLEŞME: N değişim = **1 `hal.ingest(batch)` = 1 emit**.
 *
 * Ölçüm ZAMAN eşiğiyle değil, DETERMİNİSTİK SAYAÇLA yapılır (emit/batch sayısı) —
 * CI'da milisaniye bazlı benchmark YOK.
 *
 * BİLİNÇLİ DAVRANIŞ FARKLARI (burada kilitlenir):
 *  1. HAL `revision` sinyal başına değil, batch başına 1 artar.
 *  2. HAL aboneleri ara (kısmi) snapshot görmez; yalnız nihai tutarlı snapshot'ı görür.
 *  3. Nihai sinyal kümesi + değerler + metadata (source/quality/confidence/timestamp) AYNI.
 */

import { describe, it, expect } from 'vitest';
import {
  createVehicleHalProviderAdapter,
  createVehicleHal,
  type NormalizedVehicleSnapshot,
  type VehicleHalIngestTarget,
  type VehicleHalSnapshot,
  type VehicleSignalId,
  type VehicleSignalInput,
} from '../platform/vehicleHal';
import adapterSource from '../platform/vehicleHal/vehicleHalProviderAdapter.ts?raw';

const NOW = 7_000_000;

/** SIGNAL_MAP'in kaynaktaki sırası (batch anahtar sırası bununla kilitlenir). */
const SIGNAL_MAP_ORDER: readonly VehicleSignalId[] = [
  'vehicle.speed', 'vehicle.rpm', 'vehicle.fuel_level', 'vehicle.odometer',
  'vehicle.coolant_temp', 'vehicle.oil_temp', 'vehicle.throttle', 'vehicle.battery_voltage',
  'vehicle.gear', 'vehicle.ambient_temp', 'vehicle.tpms',
  'vehicle.reverse', 'vehicle.door_state', 'vehicle.parking_brake',
];

function fakeSource(initial: NormalizedVehicleSnapshot | null = {}) {
  let snap = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      getSnapshot: () => snap,
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    },
    set: (next: NormalizedVehicleSnapshot | null) => { snap = next; listeners.forEach((l) => l()); },
  };
}

/** Batch çağrılarını kaydeden fake HAL (ingestSignal'i BİLEREK sunmaz). */
function batchHal(opts: { throwAll?: boolean } = {}) {
  const batches: Partial<Record<VehicleSignalId, VehicleSignalInput>>[] = [];
  let throwAll = opts.throwAll === true;
  const hal = {
    ingest: (signals: Partial<Record<VehicleSignalId, VehicleSignalInput>>) => {
      if (throwAll) throw new Error('hal batch boom');
      batches.push(signals);
    },
  } satisfies VehicleHalIngestTarget;
  return {
    hal,
    batches,
    setThrowAll: (v: boolean) => { throwAll = v; },
    /** Son batch'in anahtarları (SIGNAL_MAP ekleme sırasında). */
    lastKeys: () => Object.keys(batches[batches.length - 1] ?? {}) as VehicleSignalId[],
    last: () => batches[batches.length - 1] ?? {},
  };
}

const adapter = (src: ReturnType<typeof fakeSource>, h: ReturnType<typeof batchHal>) =>
  createVehicleHalProviderAdapter({ hal: h.hal, source: src.source, now: () => NOW });

/* ══════════════════════════════════════════════════════════════════════════
 * Batch sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('W4A — batch ingest sözleşmesi', () => {
  it('tek değişen sinyal → hal.ingest() TAM BİR KEZ', () => {
    const h = batchHal();
    adapter(fakeSource({ speed: 54 }), h).start();
    expect(h.batches.length).toBe(1);
    expect(h.lastKeys()).toEqual(['vehicle.speed']);
  });

  it('çok sayıda değişen sinyal → hal.ingest() YİNE TEK ÇAĞRI (N emit değil)', () => {
    const h = batchHal();
    adapter(fakeSource({
      speed: 54, rpm: 1800, fuel: 60, odometer: 1200,
      canCoolantTemp: 90, canOilTemp: 105, canThrottle: 30, canBatteryVolt: 13.8,
      canGearPos: 3, canAmbientTemp: 21, canTpmsKpa: [220, 225, 230, 228],
      reverse: false, canDoorOpen: true, canParkingBrake: false,
    }), h).start();
    expect(h.batches.length).toBe(1);                 // 14 değişim → TEK batch
    expect(h.lastKeys().length).toBe(14);
  });

  it('adapter ingestSignal API\'sini HİÇ kullanmaz (yalnız ingest)', () => {
    // HAL fake'i yalnız `ingest` sunuyor; adapter ingestSignal çağırsaydı TypeError alırdık.
    const h = batchHal();
    expect(() => adapter(fakeSource({ speed: 10, rpm: 900 }), h).start()).not.toThrow();
    expect(h.batches.length).toBe(1);
    expect(adapterSource).not.toMatch(/_hal\.ingestSignal\s*\(/);
  });

  it('değişiklik yoksa hal.ingest() HİÇ çağrılmaz', () => {
    const s = fakeSource({ speed: 54 });
    const h = batchHal();
    adapter(s, h).start();
    expect(h.batches.length).toBe(1);
    s.set({ speed: 54 });          // aynı değer
    s.set({ speed: 54 });
    expect(h.batches.length).toBe(1);   // yeni batch YOK
  });

  it('boş snapshot → ingest çağrısı yok', () => {
    const h = batchHal();
    adapter(fakeSource({}), h).start();
    expect(h.batches.length).toBe(0);
  });

  it('batch içindeki sinyal sayısı GERÇEK değişen sinyal sayısına eşit', () => {
    const s = fakeSource({ speed: 54, canCoolantTemp: 90 });
    const h = batchHal();
    adapter(s, h).start();
    expect(h.lastKeys().length).toBe(2);
    s.set({ speed: 60, canCoolantTemp: 90 });   // yalnız speed değişti
    expect(h.batches.length).toBe(2);
    expect(h.lastKeys()).toEqual(['vehicle.speed']);   // değişen tek sinyal
  });

  it('batch anahtar sırası SIGNAL_MAP sırasını korur', () => {
    const h = batchHal();
    adapter(fakeSource({
      speed: 54, rpm: 1800, fuel: 60, odometer: 1200,
      canCoolantTemp: 90, canOilTemp: 105, canThrottle: 30, canBatteryVolt: 13.8,
      canGearPos: 3, canAmbientTemp: 21, canTpmsKpa: [220, 225, 230, 228],
      reverse: false, canDoorOpen: true, canParkingBrake: false,
    }), h).start();
    expect(h.lastKeys()).toEqual(SIGNAL_MAP_ORDER);   // 14 eşleme, aynı sıra
  });

  it('ignition batch\'e HİÇ girmez (kaynak yok)', () => {
    const h = batchHal();
    adapter(fakeSource({ speed: 54, rpm: 1200, canCoolantTemp: 90 }), h).start();
    expect(h.lastKeys()).not.toContain('vehicle.ignition');
  });

  it('TPMS: geçersiz veri batch\'e girmez, geçerli 4-tuple doğru girer', () => {
    const h1 = batchHal();
    adapter(fakeSource({ speed: 10, canTpmsKpa: [1, 2] as unknown as [number, number, number, number] }), h1).start();
    expect(h1.lastKeys()).not.toContain('vehicle.tpms');

    const h2 = batchHal();
    adapter(fakeSource({ speed: 10, canTpmsKpa: [220, 225, 230, 228] }), h2).start();
    expect(h2.last()['vehicle.tpms']?.value).toEqual([220, 225, 230, 228]);
  });

  it('metadata korunur: source/quality/confidence eşlemesi değişmedi', () => {
    const h = batchHal();
    adapter(fakeSource({ speed: 54, canCoolantTemp: 90 }), h).start();
    const b = h.last();
    expect(b['vehicle.speed']?.source).toBe('inferred');
    expect(b['vehicle.speed']?.quality).toBe('medium');
    expect(b['vehicle.speed']?.confidence).toBe(0.6);
    expect(b['vehicle.coolant_temp']?.source).toBe('can');
    expect(b['vehicle.coolant_temp']?.quality).toBe('high');
    expect(b['vehicle.coolant_temp']?.confidence).toBe(0.9);
  });

  it('batch\'teki TÜM girdiler refresh\'e ait ORTAK timestamp taşır', () => {
    const h = batchHal();
    adapter(fakeSource({ speed: 54, rpm: 1800, canCoolantTemp: 90 }), h).start();
    const b = h.last();
    const stamps = Object.values(b).map((i) => i!.timestamp);
    expect(stamps.length).toBe(3);
    expect(new Set(stamps)).toEqual(new Set([NOW]));
  });

  it('provider güncellemesi doğru batch üretir (yalnız değişenler)', () => {
    const s = fakeSource({ speed: 54, rpm: 1800 });
    const h = batchHal();
    adapter(s, h).start();
    s.set({ speed: 54, rpm: 2000, canCoolantTemp: 91 });   // rpm + coolant değişti
    expect(h.batches.length).toBe(2);
    expect(h.lastKeys()).toEqual(['vehicle.rpm', 'vehicle.coolant_temp']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Hata / dedupe atomikliği
 * ════════════════════════════════════════════════════════════════════════ */

describe('W4A — batch hata ve dedupe atomikliği', () => {
  it('HAL batch throw ederse adapter fail-soft (throw etmez)', () => {
    const h = batchHal({ throwAll: true });
    const a = adapter(fakeSource({ speed: 54, rpm: 1800 }), h);
    expect(() => a.start()).not.toThrow();
    expect(a.getStatus().ingestedSignalCount).toBe(0);
  });

  it('BAŞARISIZ batch dedupe kaydını KİRLETMEZ — sonraki refresh yeniden dener', () => {
    const s = fakeSource({ speed: 54, rpm: 1800 });
    const h = batchHal({ throwAll: true });
    const a = adapter(s, h);
    a.start();                       // batch düştü
    expect(h.batches.length).toBe(0);

    h.setThrowAll(false);
    a.refresh();                     // DEĞERLER AYNI — yine de yeniden denenmeli
    expect(h.batches.length).toBe(1);
    expect(h.lastKeys()).toEqual(['vehicle.speed', 'vehicle.rpm']);
    expect(a.getStatus().ingestedSignalCount).toBe(2);
  });

  it('BAŞARILI batch sonrası aynı değerler tekrar ingest EDİLMEZ', () => {
    const s = fakeSource({ speed: 54 });
    const h = batchHal();
    const a = adapter(s, h);
    a.start();
    a.refresh();
    a.refresh();
    expect(h.batches.length).toBe(1);
  });

  it('tek extract hatası diğer sinyalleri engellemez (batch yine oluşur)', () => {
    const h = batchHal();
    // speed NaN → geçersiz (atlanır); rpm sağlam → batch'e girer
    adapter(fakeSource({ speed: NaN as unknown as number, rpm: 1000 }), h).start();
    expect(h.batches.length).toBe(1);
    expect(h.lastKeys()).toEqual(['vehicle.rpm']);
  });

  it('cleanup (dispose) sonrası ingest YOK', () => {
    const s = fakeSource({ speed: 54 });
    const h = batchHal();
    const a = adapter(s, h);
    a.start();
    a.dispose();
    s.set({ speed: 99 });
    expect(h.batches.length).toBe(1);   // dispose öncesi tek batch; sonrası yok
  });

  it('start/stop/dispose idempotency korunur', () => {
    const s = fakeSource({ speed: 54 });
    const h = batchHal();
    const a = adapter(s, h);
    a.start(); a.start();
    expect(h.batches.length).toBe(1);
    expect(() => { a.stop(); a.stop(); a.dispose(); a.dispose(); }).not.toThrow();
  });

  it('stop → start (boot→shutdown→boot) davranışı bozulmuyor', () => {
    const s = fakeSource({ speed: 54 });
    const h = batchHal();
    const a = adapter(s, h);
    a.start();
    a.stop();
    s.set({ speed: 70 });               // durdurulmuşken akış yok
    expect(h.batches.length).toBe(1);
    a.start();                          // yeniden başla → yeni değer aktarılır
    expect(h.batches.length).toBe(2);
    expect(h.lastKeys()).toEqual(['vehicle.speed']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GERÇEK HAL entegrasyonu — emit/revision deterministik sayacı
 * ════════════════════════════════════════════════════════════════════════ */

describe('W4A — gerçek VehicleHal ile emit amplifikasyonu', () => {
  it('N değişen sinyal → GERÇEK HAL yalnız 1 emit üretir (eskiden N emit)', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const emits: VehicleHalSnapshot[] = [];
    hal.subscribe((s) => emits.push(s));

    const s = fakeSource({
      speed: 54, rpm: 1800, fuel: 60, odometer: 1200,
      canCoolantTemp: 90, canOilTemp: 105, canThrottle: 30, canBatteryVolt: 13.8,
      canGearPos: 3, canAmbientTemp: 21, canTpmsKpa: [220, 225, 230, 228],
      reverse: false, canDoorOpen: true, canParkingBrake: false,
    });
    createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW }).start();

    expect(emits.length).toBe(1);   // ← W4A: 14 değişim, TEK emit (önceki davranış: 14 emit)
  });

  it('nihai snapshot TÜM değişen sinyalleri içerir (ara snapshot yok)', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const emits: VehicleHalSnapshot[] = [];
    hal.subscribe((s) => emits.push(s));

    const s = fakeSource({ speed: 54, rpm: 1800, canCoolantTemp: 90, canBatteryVolt: 13.8 });
    createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW }).start();

    expect(emits.length).toBe(1);
    const supported = emits[0]!.signals.filter((x) => x.supported).map((x) => x.id).sort();
    expect(supported).toEqual([
      'vehicle.battery_voltage', 'vehicle.coolant_temp', 'vehicle.rpm', 'vehicle.speed',
    ]);
    // Nihai değerler HAL'de doğru (ara/kısmi durum sızmadı)
    expect(hal.getSpeed()).toBe(54);
    expect(hal.getRPM()).toBe(1800);
    expect(hal.getCoolantTemp()).toBe(90);
    expect(hal.getBatteryVoltage()).toBe(13.8);
  });

  it('revision batch başına 1 artar (bilinçli fark: sinyal başına DEĞİL)', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const s = fakeSource({ speed: 54, rpm: 1800, canCoolantTemp: 90 });   // 3 sinyal
    const a = createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW });

    const rev0 = hal.getSnapshot().revision;
    a.start();
    const rev1 = hal.getSnapshot().revision;
    expect(rev1 - rev0).toBe(1);            // 3 değişim → revision +1 (eskiden +3)

    s.set({ speed: 60, rpm: 2000, canCoolantTemp: 95 });   // yine 3 değişim
    expect(hal.getSnapshot().revision - rev1).toBe(1);
  });

  it('ignition gerçek HAL\'de supported=false kalır; stale/metadata semantiği bozulmadı', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const s = fakeSource({ speed: 54, canCoolantTemp: 90 });
    createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW }).start();

    expect(hal.hasSignal('vehicle.ignition')).toBe(false);
    const speed = hal.getSignal('vehicle.speed')!;
    expect(speed.source).toBe('inferred');
    expect(speed.quality).toBe('medium');
    expect(speed.confidence).toBe(0.6);
    expect(speed.stale).toBe(false);
    expect(speed.timestamp).toBe(NOW);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Kapsam sınırı (W4A yalnız adapter'dır)
 * ════════════════════════════════════════════════════════════════════════ */

describe('W4A — kapsam sınırı', () => {
  it('adapter yeni timer/polling AÇMAZ', () => {
    expect(adapterSource).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it('Event Bus / bridge / Capability / Deep Scan / Kernel import EDİLMEZ', () => {
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*eventBus/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*bridges?/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*deepScan/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*kernel/i);
  });

  it('throttle/coalescing/stale-sweeper EKLENMEDİ (W4B/W4D kapsamı)', () => {
    // NOT: bare "throttle" kelimesi KULLANILAMAZ — `vehicle.throttle` sinyal adına takılır.
    // Bu yüzden yalnız throttle/coalescing YAPILARI aranır.
    expect(adapterSource).not.toMatch(/THROTTLE_MS|DEBOUNCE|debounce|coalesce|queueMicrotask/i);
    expect(adapterSource).not.toMatch(/Promise\s*\.\s*resolve\s*\(\s*\)\s*\.\s*then/);
    // Stale sweeper: adapter HAL'in kendi refresh()'ini çağırmaz (stale semantiği W4B).
    expect(adapterSource).not.toMatch(/_hal\s*\.\s*refresh\s*\(/);
  });

  it('kalıcı global debug expose YOK', () => {
    expect(adapterSource).not.toMatch(/window\.__|globalThis\./);
  });
});
