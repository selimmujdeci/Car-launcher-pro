/**
 * vehicleHalSourceDisconnect.test.ts — W4B: HAL kaynak-kaybı / fail-closed semantiği.
 *
 * PROBLEM: Veri kaynağı kopunca adapter değeri "atlıyordu" → HAL'deki eski değer sonsuza kadar
 * `supported=true` + `stale=false` kalıyordu (HAL'in stale süpürücüsü üretimde HİÇ çalışmıyor).
 *
 * ÇÖZÜM (timersız, mevcut kanıtla): daha önce aktarılmış bir sinyalin store değeri KAYBOLURSA
 * (worker kaynak-timeout'unda null yayar; `resetCanData()` CAN alanlarını null'lar) → `source:'none'`
 * → `supported=false`. **unknown ≠ disconnected:** hiç aktarılmamış sinyal için sahte disconnect YOK.
 *
 * Kapsam dışı (kilitlenir): zaman-tabanlı stale sweeper · yeni timer · ignition üretimi ·
 * Event Bus/bridge/Capability/Deep Scan/Kernel.
 */

import { describe, it, expect } from 'vitest';
import {
  createVehicleHalProviderAdapter,
  createVehicleHal,
  type NormalizedVehicleSnapshot,
  type VehicleHalSnapshot,
  type VehicleSignalId,
  type VehicleSignalInput,
} from '../platform/vehicleHal';
import adapterSource from '../platform/vehicleHal/vehicleHalProviderAdapter.ts?raw';

const NOW = 8_000_000;

function fakeSource(initial: NormalizedVehicleSnapshot | null = {}) {
  let snap = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      getSnapshot: () => snap,
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    },
    set: (next: NormalizedVehicleSnapshot) => { snap = next; listeners.forEach((l) => l()); },
    subCount: () => listeners.size,
  };
}

function batchHal() {
  const batches: Partial<Record<VehicleSignalId, VehicleSignalInput>>[] = [];
  return {
    hal: { ingest: (s: Partial<Record<VehicleSignalId, VehicleSignalInput>>) => { batches.push(s); } },
    batches,
    last: () => batches[batches.length - 1] ?? {},
    lastKeys: () => Object.keys(batches[batches.length - 1] ?? {}) as VehicleSignalId[],
  };
}

const adapter = (src: ReturnType<typeof fakeSource>, h: ReturnType<typeof batchHal>) =>
  createVehicleHalProviderAdapter({ hal: h.hal, source: src.source, now: () => NOW });

/** Gerçek HAL ile zincir (emit sayacı dahil). */
function realChain(initial: NormalizedVehicleSnapshot) {
  const hal = createVehicleHal({ now: () => NOW });
  const emits: VehicleHalSnapshot[] = [];
  hal.subscribe((s) => emits.push(s));
  const src = fakeSource(initial);
  const a = createVehicleHalProviderAdapter({ hal, source: src.source, now: () => NOW });
  return { hal, emits, src, adapter: a };
}

/* ── Başlangıç / unknown ───────────────────────────────────────────────────── */

describe('W4B — unknown (kaynak hiç gelmemiş) ≠ disconnected', () => {
  it('boot: hiç veri yokken SAHTE disconnect geçişi üretilmez (ingest yok)', () => {
    const h = batchHal();
    adapter(fakeSource({}), h).start();
    expect(h.batches.length).toBe(0);          // ne değer ne de source:'none'
  });

  it('kaynağı hiç gelmemiş sinyal için source:none ingest EDİLMEZ', () => {
    const h = batchHal();
    adapter(fakeSource({ speed: 50 }), h).start();   // yalnız speed var
    expect(h.lastKeys()).toEqual(['vehicle.speed']); // coolant vb. için "none" YOK
  });

  it('ignition hiçbir koşulda üretilmez (kaynak yok → supported=false kalır)', () => {
    const { hal, src, adapter: a } = realChain({ speed: 50, canCoolantTemp: 90 });
    a.start();
    src.set({});                                     // her şey kayboldu
    expect(hal.hasSignal('vehicle.ignition')).toBe(false);
    expect(hal.getSignal('vehicle.ignition')?.source).not.toBe('can');
  });
});

/* ── Kaynak kaybı (fail-closed) ───────────────────────────────────────────── */

describe('W4B — kaynak kaybı → fail-closed unsupported', () => {
  it('CAN sinyali kaybolunca source:none + supported=false (gerçek HAL)', () => {
    const { hal, src, adapter: a } = realChain({ speed: 50, canCoolantTemp: 90 });
    a.start();
    expect(hal.hasSignal('vehicle.coolant_temp')).toBe(true);
    expect(hal.getCoolantTemp()).toBe(90);

    src.set({ speed: 50, canCoolantTemp: null });    // CAN alanı null'landı (resetCanData semantiği)
    const sig = hal.getSignal('vehicle.coolant_temp')!;
    expect(sig.supported).toBe(false);
    expect(sig.source).toBe('none');
    expect(sig.value).toBeNull();                    // eski değer artık "geçerli" görünmüyor
    expect(hal.getCoolantTemp()).toBeNull();
  });

  it('birden fazla sinyal aynı anda düşerse TEK batch / TEK HAL emit', () => {
    const { emits, src, adapter: a } = realChain({
      speed: 50, canCoolantTemp: 90, canOilTemp: 100, canBatteryVolt: 14, canGearPos: 3,
    });
    a.start();
    const afterStart = emits.length;
    src.set({ speed: 50 });                          // 4 CAN sinyali birden kayboldu
    expect(emits.length - afterStart).toBe(1);       // TEK emit
  });

  it('kayıp geçişi batch\'te source:none ile gider (quality uydurulmaz, confidence 0)', () => {
    const s = fakeSource({ speed: 50, canCoolantTemp: 90 });
    const h = batchHal();
    adapter(s, h).start();
    s.set({ speed: 50 });                            // coolant kayboldu
    const input = h.last()['vehicle.coolant_temp']!;
    expect(input.source).toBe('none');
    expect(input.value).toBeNull();
    expect(input.quality).toBe('unknown');
    expect(input.confidence).toBe(0);
    expect(input.timestamp).toBe(NOW);               // GEÇİŞ anı
  });

  it('aynı disconnected durum TEKRAR ingest edilmez (duplicate emit yok)', () => {
    const { emits, src, adapter: a } = realChain({ speed: 50, canCoolantTemp: 90 });
    a.start();
    src.set({ speed: 50 });                          // kayıp → 1 emit
    const afterLoss = emits.length;
    src.set({ speed: 50 });                          // hâlâ kayıp
    src.set({ speed: 50 });
    expect(emits.length).toBe(afterLoss);            // yeni emit YOK
  });

  it('ham eski değer payload olarak TAŞINMAZ (value null)', () => {
    const s = fakeSource({ canCoolantTemp: 90, canRpm: 2000 });
    const h = batchHal();
    adapter(s, h).start();
    s.set({});
    const b = h.last();
    for (const id of Object.keys(b) as VehicleSignalId[]) {
      expect(b[id]!.value).toBeNull();
      expect(b[id]!.source).toBe('none');
    }
  });
});

/* ── Fallback: yalnız kaynaksız kalan sinyal düşer ────────────────────────── */

describe('W4B — fallback (toptan kapatma YOK)', () => {
  it('CAN düşse de GPS/worker füzyon hızı canlıysa speed supported KALIR', () => {
    const { hal, src, adapter: a } = realChain({
      speed: 50, canRpm: 2000, canCoolantTemp: 90,
    });
    a.start();
    src.set({ speed: 55 });                          // CAN gitti, füzyon speed hâlâ var
    expect(hal.hasSignal('vehicle.speed')).toBe(true);
    expect(hal.getSpeed()).toBe(55);
    expect(hal.getSignal('vehicle.speed')!.source).toBe('inferred');
    expect(hal.hasSignal('vehicle.coolant_temp')).toBe(false);   // yalnız CAN sinyali düştü
    expect(hal.hasSignal('vehicle.rpm')).toBe(false);
  });

  it('rpm füzyon fallback: store.rpm yoksa canRpm kullanılır; ikisi de yoksa unsupported', () => {
    const { hal, src, adapter: a } = realChain({ rpm: 1500, canRpm: 900 });
    a.start();
    expect(hal.getRPM()).toBe(1500);
    src.set({ canRpm: 900 });                        // fused rpm gitti → CAN fallback
    expect(hal.getRPM()).toBe(900);
    expect(hal.hasSignal('vehicle.rpm')).toBe(true);
    src.set({});                                      // ikisi de gitti
    expect(hal.hasSignal('vehicle.rpm')).toBe(false);
  });

  it('CAN-özel boolean\'lar CAN canlılığına bağlı (reset artığı `false` veri sayılmaz)', () => {
    // GPS hızı canlı ama CAN yok → door/parking KAYNAKSIZ sayılır (resetCanData false'ları geçmez)
    const h = batchHal();
    adapter(fakeSource({ speed: 40, canDoorOpen: false, canParkingBrake: false }), h).start();
    const keys = h.lastKeys();
    expect(keys).not.toContain('vehicle.door_state');
    expect(keys).not.toContain('vehicle.parking_brake');
  });

  it('CAN canlıyken boolean `false` GEÇERLİ değerdir (unsupported sayılmaz)', () => {
    const { hal, adapter: a } = realChain({ canRpm: 800, canDoorOpen: false, canParkingBrake: false });
    a.start();
    expect(hal.hasSignal('vehicle.door_state')).toBe(true);
    expect(hal.getSignal('vehicle.door_state')!.value).toBe(false);
    expect(hal.hasSignal('vehicle.parking_brake')).toBe(true);
  });

  it('reverse füzyon: CAN gitse de fused hız varken reverse=false GEÇERLİ kalır', () => {
    const { hal, src, adapter: a } = realChain({ speed: 10, canRpm: 900, reverse: true });
    a.start();
    expect(hal.getSignal('vehicle.reverse')!.value).toBe(true);
    src.set({ speed: 10, reverse: false });          // CAN gitti, füzyon canlı
    expect(hal.hasSignal('vehicle.reverse')).toBe(true);
    expect(hal.getSignal('vehicle.reverse')!.value).toBe(false);
  });

  it('CAN reset senaryosu: numerikler null + boolean\'lar false → yalnız CAN sinyalleri düşer', () => {
    const { hal, src, adapter: a } = realChain({
      speed: 30, canRpm: 1200, canCoolantTemp: 88, canDoorOpen: true, canParkingBrake: true,
    });
    a.start();
    expect(hal.hasSignal('vehicle.door_state')).toBe(true);

    // resetCanData(): numerikler null, boolean'lar false
    src.set({
      speed: 30, canRpm: null, canCoolantTemp: null, canDoorOpen: false, canParkingBrake: false,
    });
    expect(hal.hasSignal('vehicle.rpm')).toBe(false);
    expect(hal.hasSignal('vehicle.coolant_temp')).toBe(false);
    expect(hal.hasSignal('vehicle.door_state')).toBe(false);      // reset `false`'u veri sanmadı
    expect(hal.hasSignal('vehicle.parking_brake')).toBe(false);
    expect(hal.hasSignal('vehicle.speed')).toBe(true);            // füzyon canlı → korunur
  });
});

/* ── Reconnect ────────────────────────────────────────────────────────────── */

describe('W4B — reconnect', () => {
  it('kaynak geri gelince supported=true + gerçek source geri döner', () => {
    const { hal, src, adapter: a } = realChain({ speed: 50, canCoolantTemp: 90 });
    a.start();
    src.set({ speed: 50 });                          // kayıp
    expect(hal.hasSignal('vehicle.coolant_temp')).toBe(false);

    src.set({ speed: 50, canCoolantTemp: 95 });      // reconnect
    const sig = hal.getSignal('vehicle.coolant_temp')!;
    expect(sig.supported).toBe(true);
    expect(sig.source).toBe('can');
    expect(sig.value).toBe(95);
    expect(sig.quality).toBe('high');
    expect(sig.confidence).toBe(0.9);
  });

  it('reconnect TEK batch / TEK emit ve tekrar eden veri duplicate emit üretmez', () => {
    const { emits, src, adapter: a } = realChain({ canCoolantTemp: 90, canOilTemp: 100 });
    a.start();
    src.set({});                                     // ikisi de kayıp (1 emit)
    const afterLoss = emits.length;
    src.set({ canCoolantTemp: 90, canOilTemp: 100 }); // ikisi birden geri (1 emit)
    expect(emits.length - afterLoss).toBe(1);
    src.set({ canCoolantTemp: 90, canOilTemp: 100 }); // aynı veri
    expect(emits.length - afterLoss).toBe(1);        // duplicate emit YOK
  });

  it('kopma → geri gelme → kopma döngüsü stabil (her geçiş tek emit)', () => {
    const { emits, src, adapter: a } = realChain({ canRpm: 1000 });
    a.start();
    const base = emits.length;
    src.set({});                        // kayıp
    src.set({ canRpm: 1000 });          // geri
    src.set({});                        // yine kayıp
    expect(emits.length - base).toBe(3);
  });
});

/* ── Lifecycle & fail-soft ────────────────────────────────────────────────── */

describe('W4B — lifecycle & fail-soft', () => {
  it('tek subscription; cleanup sonrası kaynak kaybı HAL\'e AKMAZ', () => {
    const { hal, src, adapter: a } = realChain({ canCoolantTemp: 90 });
    a.start();
    expect(src.subCount()).toBe(1);
    a.dispose();
    src.set({});                                     // kopma dispose SONRASI
    expect(hal.hasSignal('vehicle.coolant_temp')).toBe(true);   // HAL'e akmadı
    expect(src.subCount()).toBe(0);
  });

  it('boot → shutdown → boot: abonelik çoğalmaz, dedupe durumu yeni adapter\'da temiz', () => {
    const src = fakeSource({ canCoolantTemp: 90 });
    const h1 = batchHal();
    const a1 = createVehicleHalProviderAdapter({ hal: h1.hal, source: src.source, now: () => NOW });
    a1.start(); a1.dispose();
    const h2 = batchHal();
    const a2 = createVehicleHalProviderAdapter({ hal: h2.hal, source: src.source, now: () => NOW });
    a2.start();
    expect(src.subCount()).toBe(1);
    expect(h2.lastKeys()).toEqual(['vehicle.coolant_temp']);   // yeni adapter unknown'dan başlar
    a2.dispose();
  });

  it('HAL batch hatası fail-soft: kayıp "işlenmiş" sayılmaz, sonraki refresh yeniden dener', () => {
    let fail = true;
    const batches: Partial<Record<VehicleSignalId, VehicleSignalInput>>[] = [];
    const hal = { ingest: (s: Partial<Record<VehicleSignalId, VehicleSignalInput>>) => {
      if (fail) throw new Error('boom');
      batches.push(s);
    } };
    const src = fakeSource({ canCoolantTemp: 90 });
    const a = createVehicleHalProviderAdapter({ hal, source: src.source, now: () => NOW });
    fail = false;
    a.start();                                   // coolant ingest edildi
    expect(batches.length).toBe(1);

    fail = true;
    expect(() => src.set({})).not.toThrow();     // kayıp batch'i DÜŞTÜ
    fail = false;
    a.refresh();                                  // yeniden dene
    expect(batches[batches.length - 1]!['vehicle.coolant_temp']!.source).toBe('none');
  });

  it('store okunamazsa (throw) kayıp geçişi UYDURULMAZ', () => {
    const hal = { ingest: () => undefined };
    let boom = false;
    const src = {
      getSnapshot: () => { if (boom) throw new Error('store patladı'); return { canCoolantTemp: 90 }; },
      subscribe: () => () => { /* */ },
    };
    const a = createVehicleHalProviderAdapter({ hal, source: src, now: () => NOW });
    a.start();
    boom = true;
    expect(() => a.refresh()).not.toThrow();
    expect(a.getStatus().ingestedSignalCount).toBe(1);   // kayıt DÜŞÜRÜLMEDİ (sahte disconnect yok)
  });
});

/* ── Kapsam sınırı ────────────────────────────────────────────────────────── */

describe('W4B — kapsam sınırı', () => {
  it('yeni timer/polling YOK ve HAL.refresh() (stale sweeper) çağrılmıyor', () => {
    expect(adapterSource).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(adapterSource).not.toMatch(/_hal\s*\.\s*refresh\s*\(/);
  });

  it('per-signal ingestSignal akışına DÖNÜLMEDİ (batch korunuyor)', () => {
    expect(adapterSource).not.toMatch(/_hal\.ingestSignal\s*\(/);
    expect(adapterSource).toMatch(/_hal\.ingest\(batch\)/);
  });

  it('Event Bus / bridge / Capability / Deep Scan / Kernel / halStatusStore import EDİLMEZ', () => {
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*eventBus/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*bridges?/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*capability/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*deepScan/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*kernel/i);
    expect(adapterSource).not.toMatch(/from\s+['"][^'"]*halStatusStore/i);
  });

  it('kalıcı global debug expose YOK', () => {
    expect(adapterSource).not.toMatch(/window\.__|globalThis\./);
  });
});
