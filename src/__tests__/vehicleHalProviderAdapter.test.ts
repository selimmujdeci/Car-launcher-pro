/**
 * vehicleHalProviderAdapter.test.ts — Vehicle HAL Provider Adapter Foundation testleri.
 *
 * Kapsam: kaynaksız · start/stop idempotent · signal aktarımı (speed/rpm/coolant/fuel/
 * battery/gear/reverse) · duplicate ingest yok · değişen ingest · tek-sinyal bozuk izole ·
 * store/HAL fail-soft · source/quality/confidence eşleme · ignition & TPMS kaynaksız→
 * supported=false · stale · input mutate yok · unsubscribe/dispose zero-leak · HAL
 * dispose edilmiyor · privacy · import yan etkisi · Event Bus/Capability/SystemBoot wiring yok.
 */

import { describe, it, expect } from 'vitest';
import {
  createVehicleHalProviderAdapter,
  createVehicleHal,
  type NormalizedVehicleSnapshot,
  type VehicleHalIngestTarget,
  type VehicleSignalId,
  type VehicleSignalInput,
} from '../platform/vehicleHal';
import adapterSource from '../platform/vehicleHal/vehicleHalProviderAdapter.ts?raw';

const NOW = 6_000_000;

function fakeSource(initial: NormalizedVehicleSnapshot | null = {}) {
  let snap = initial;
  let throwOnGet = false;
  const listeners = new Set<() => void>();
  return {
    source: {
      getSnapshot: () => { if (throwOnGet) throw new Error('store patladı'); return snap; },
      subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    },
    set: (next: NormalizedVehicleSnapshot | null) => { snap = next; listeners.forEach((l) => l()); },
    subCount: () => listeners.size,
    setThrow: (v: boolean) => { throwOnGet = v; },
  };
}

/**
 * W4A: HAL artık TOPLU beslenir (`ingest(batch)`). Fake, batch'i düz listeye açar ki
 * mevcut sinyal-bazlı beklentiler (countFor/lastFor) aynı sözleşmeyi doğrulamaya devam etsin;
 * ek olarak batch çağrı sayısını (emit sayısının birebir karşılığı) sayar.
 */
function fakeHal() {
  const ingests: { id: VehicleSignalId; input: VehicleSignalInput }[] = [];
  const batches: Partial<Record<VehicleSignalId, VehicleSignalInput>>[] = [];
  let throwAll = false;
  const hal: VehicleHalIngestTarget = {
    ingest: (signals) => {
      if (throwAll) throw new Error('hal boom');   // batch TÜMDEN düşer (HAL'de sinyal-bazlı catch YOK)
      batches.push(signals);
      for (const [id, input] of Object.entries(signals)) {
        if (input) ingests.push({ id: id as VehicleSignalId, input });
      }
    },
  };
  return {
    hal, ingests, batches,
    batchCount: () => batches.length,
    countFor: (id: VehicleSignalId) => ingests.filter((x) => x.id === id).length,
    lastFor: (id: VehicleSignalId) => [...ingests].reverse().find((x) => x.id === id),
    setThrowAll: (v: boolean) => { throwAll = v; },
  };
}

function adapter(src: ReturnType<typeof fakeSource>, h: ReturnType<typeof fakeHal>, now = () => NOW) {
  return createVehicleHalProviderAdapter({ hal: h.hal, source: src.source, now });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1–9 · Temel aktarım
 * ════════════════════════════════════════════════════════════════════════ */

describe('temel aktarım', () => {
  it('1) kaynaksız adapter — boş snapshot → ingest yok', () => {
    const s = fakeSource({}); const h = fakeHal();
    const a = adapter(s, h); a.start();
    expect(h.ingests.length).toBe(0);
    expect(a.getStatus().ingestedSignalCount).toBe(0);
  });

  it('2) start idempotent — çift start duplicate abonelik yaratmaz', () => {
    const s = fakeSource(); const h = fakeHal();
    const a = adapter(s, h); a.start(); a.start();
    expect(s.subCount()).toBe(1);
  });

  it('3) stop idempotent', () => {
    const s = fakeSource(); const h = fakeHal();
    const a = adapter(s, h); a.start();
    expect(() => { a.stop(); a.stop(); }).not.toThrow();
    expect(s.subCount()).toBe(0);
  });

  it('4) speed aktarımı', () => {
    const s = fakeSource({ speed: 54 }); const h = fakeHal();
    adapter(s, h).start();
    expect(h.lastFor('vehicle.speed')?.input.value).toBe(54);
  });

  it('5) rpm aktarımı (fused + canRpm fallback)', () => {
    const h1 = fakeHal(); adapter(fakeSource({ rpm: 1800 }), h1).start();
    expect(h1.lastFor('vehicle.rpm')?.input.value).toBe(1800);
    const h2 = fakeHal(); adapter(fakeSource({ canRpm: 900 }), h2).start();
    expect(h2.lastFor('vehicle.rpm')?.input.value).toBe(900);
  });

  it('6) coolant aktarımı (source=can)', () => {
    const h = fakeHal(); adapter(fakeSource({ canCoolantTemp: 90 }), h).start();
    expect(h.lastFor('vehicle.coolant_temp')?.input.value).toBe(90);
    expect(h.lastFor('vehicle.coolant_temp')?.input.source).toBe('can');
  });

  it('7) fuel aktarımı', () => {
    const h = fakeHal(); adapter(fakeSource({ fuel: 60 }), h).start();
    expect(h.lastFor('vehicle.fuel_level')?.input.value).toBe(60);
  });

  it('8) battery aktarımı (source=can)', () => {
    const h = fakeHal(); adapter(fakeSource({ canBatteryVolt: 13.8 }), h).start();
    expect(h.lastFor('vehicle.battery_voltage')?.input.value).toBe(13.8);
  });

  it('9) gear/reverse aktarımı (aktif araç varken)', () => {
    const h = fakeHal(); adapter(fakeSource({ speed: 10, canGearPos: 3, reverse: true, canDoorOpen: false }), h).start();
    expect(h.lastFor('vehicle.gear')?.input.value).toBe(3);
    expect(h.lastFor('vehicle.reverse')?.input.value).toBe(true);
    expect(h.lastFor('vehicle.door_state')?.input.value).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10–14 · Değişiklik / fail-soft
 * ════════════════════════════════════════════════════════════════════════ */

describe('değişiklik ve fail-soft', () => {
  it('10) aynı değer duplicate ingest üretmiyor', () => {
    const s = fakeSource({ speed: 54 }); const h = fakeHal();
    adapter(s, h).start();
    s.set({ speed: 54 });   // aynı değer
    expect(h.countFor('vehicle.speed')).toBe(1);
  });

  it('11) değişen değer ingest ediliyor', () => {
    const s = fakeSource({ speed: 54 }); const h = fakeHal();
    adapter(s, h).start();
    s.set({ speed: 60 });
    expect(h.countFor('vehicle.speed')).toBe(2);
    expect(h.lastFor('vehicle.speed')?.input.value).toBe(60);
  });

  it('12) tek sinyal bozuksa diğerleri aktarılıyor', () => {
    const h = fakeHal();
    adapter(fakeSource({ speed: NaN as unknown as number, rpm: 1000 }), h).start();
    expect(h.countFor('vehicle.speed')).toBe(0); // NaN → geçersiz, atlanır
    expect(h.lastFor('vehicle.rpm')?.input.value).toBe(1000);
  });

  it('13) store hatası fail-soft', () => {
    const s = fakeSource({ speed: 10 }); const h = fakeHal();
    s.setThrow(true);
    const a = adapter(s, h);
    expect(() => a.start()).not.toThrow();
    expect(h.ingests.length).toBe(0);
  });

  it('14) HAL batch ingest hatası fail-soft — adapter throw etmez, dedupe KİRLENMEZ (W4A)', () => {
    // W4A: HAL toplu beslenir ve `ingest()` sinyal-bazlı catch içermez → batch TÜMDEN düşer.
    // Doğru sözleşme: adapter çökmez VE sinyalleri "aktarılmış" saymaz → sonraki refresh yeniden dener.
    const s = fakeSource({ speed: 54, rpm: 1000 }); const h = fakeHal();
    h.setThrowAll(true);
    const a = adapter(s, h);
    expect(() => a.start()).not.toThrow();
    expect(h.ingests.length).toBe(0);
    expect(a.getStatus().ingestedSignalCount).toBe(0);   // dedupe kaydı YOK

    h.setThrowAll(false);
    a.refresh();                                          // aynı değerlerle yeniden dene
    expect(h.batchCount()).toBe(1);
    expect(h.lastFor('vehicle.speed')?.input.value).toBe(54);
    expect(h.lastFor('vehicle.rpm')?.input.value).toBe(1000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15–19 · Metadata / supported / stale
 * ════════════════════════════════════════════════════════════════════════ */

describe('metadata, supported, stale', () => {
  it('15) source metadata — can vs inferred', () => {
    const h = fakeHal(); adapter(fakeSource({ speed: 54, canCoolantTemp: 90 }), h).start();
    expect(h.lastFor('vehicle.speed')?.input.source).toBe('inferred');
    expect(h.lastFor('vehicle.coolant_temp')?.input.source).toBe('can');
  });

  it('16) quality/confidence korunuyor', () => {
    const h = fakeHal(); adapter(fakeSource({ speed: 54, canCoolantTemp: 90 }), h).start();
    expect(h.lastFor('vehicle.coolant_temp')?.input.quality).toBe('high');
    expect(h.lastFor('vehicle.coolant_temp')?.input.confidence).toBe(0.9);
    expect(h.lastFor('vehicle.speed')?.input.quality).toBe('medium');
    expect(h.lastFor('vehicle.speed')?.input.confidence).toBe(0.6);
  });

  it('17) kaynağı olmayan ignition → supported=false (gerçek HAL)', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const s = fakeSource({ speed: 54, rpm: 1200, canCoolantTemp: 90 });
    createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW }).start();
    expect(hal.getIgnition()).toBeNull();
    expect(hal.hasSignal('vehicle.ignition')).toBe(false);
    expect(hal.getSpeed()).toBe(54); // gerçek köprü çalışıyor
  });

  it('18) kaynağı olmayan TPMS → supported=false; kaynak varsa aktarılır', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const s = fakeSource({ speed: 10 }); // tpms yok
    const a = createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW }); a.start();
    expect(hal.hasSignal('vehicle.tpms')).toBe(false);
    s.set({ speed: 10, canTpmsKpa: [220, 225, 218, 230] });
    expect(hal.getTpms()).toEqual([220, 225, 218, 230]);
  });

  it('19) stale işaretleme — eski ingest zamanı HAL\'de stale', () => {
    const hal = createVehicleHal({ now: () => NOW, staleMs: 5000 });
    const s = fakeSource({ speed: 54 });
    // adapter zamanı geçmişte → HAL şimdi'ye göre stale
    createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW - 6000 }).start();
    expect(hal.getSignal('vehicle.speed')?.stale).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 20–25 · Immutability / yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('immutability ve yaşam döngüsü', () => {
  it('20) girdi snapshot / tpms mutate edilmiyor', () => {
    const tpms: [number, number, number, number] = [220, 225, 218, 230];
    const snap = { speed: 54, canTpmsKpa: tpms };
    const h = fakeHal(); adapter(fakeSource(snap), h).start();
    expect(snap.speed).toBe(54);
    expect(tpms).toEqual([220, 225, 218, 230]); // dokunulmadı
  });

  it('21) duplicate subscription yok', () => {
    const s = fakeSource(); const a = adapter(s, fakeHal());
    a.start(); a.start(); a.start();
    expect(s.subCount()).toBe(1);
  });

  it('22) unsubscribe — stop aboneliği bırakır', () => {
    const s = fakeSource(); const a = adapter(s, fakeHal());
    a.start(); a.stop();
    expect(s.subCount()).toBe(0);
  });

  it('23) dispose zero-leak', () => {
    const s = fakeSource(); const a = adapter(s, fakeHal());
    a.start(); a.dispose();
    expect(s.subCount()).toBe(0);
    expect(a.isDisposed).toBe(true);
  });

  it('24) dispose sonrası callback no-op', () => {
    const s = fakeSource({ speed: 10 }); const h = fakeHal();
    const a = adapter(s, h); a.start();
    const before = h.ingests.length;
    a.dispose();
    s.set({ speed: 99 }); // dispose sonrası tetikleme
    expect(h.ingests.length).toBe(before);
    expect(a.refresh === undefined).toBe(false);
    a.refresh(); // dispose sonrası refresh no-op
    expect(h.ingests.length).toBe(before);
  });

  it('25) HAL adapter tarafından dispose EDİLMİYOR', () => {
    const hal = createVehicleHal({ now: () => NOW });
    const s = fakeSource({ speed: 10 });
    const a = createVehicleHalProviderAdapter({ hal, source: s.source, now: () => NOW }); a.start();
    a.dispose();
    expect(hal.isDisposed).toBe(false); // HAL çağıranındır
    expect(hal.getSpeed()).toBe(10);    // HAL hâlâ kullanılabilir
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 26–32 · Performans / privacy / yalıtım
 * ════════════════════════════════════════════════════════════════════════ */

describe('performans, privacy, yalıtım', () => {
  it('26) hot-path — değişmeyen snapshot yeniden ingest üretmez', () => {
    const s = fakeSource({ speed: 54, rpm: 1200 }); const h = fakeHal();
    const a = adapter(s, h); a.start();
    const after = h.ingests.length;
    a.refresh(); a.refresh(); a.refresh(); // aynı değerler
    expect(h.ingests.length).toBe(after); // ek ingest yok
  });

  it('27) privacy — yalnız numerik/boolean/array değer aktarılır (metin/kimlik yok)', () => {
    const h = fakeHal();
    adapter(fakeSource({ speed: 54, canGearPos: 3, reverse: true, canTpmsKpa: [1, 2, 3, 4] }), h).start();
    for (const { input } of h.ingests) {
      const t = typeof input.value;
      expect(t === 'number' || t === 'boolean' || Array.isArray(input.value)).toBe(true);
    }
  });

  it('28) import yan etkisiz — timer/native YOK, yalnız type import', () => {
    expect(/setInterval|setTimeout/.test(adapterSource)).toBe(false);
    expect(/\bnavigator\.|Capacitor/.test(adapterSource)).toBe(false);
    // Yalnız TYPE import (değer importu yok → store/native çekilmez)
    expect(/^\s*import\s+type\s/m.test(adapterSource)).toBe(true);
    expect(/^\s*import\s+(?!type)[\w{]/m.test(adapterSource)).toBe(false);
  });

  it('29) SystemBoot wiring yok (import edilmiyor)', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(adapterSource)).toBe(false);
  });

  it('30) Event Bus wiring yok (import edilmiyor)', () => {
    expect(/from\s+['"][^'"]*eventBus[^'"]*['"]/.test(adapterSource)).toBe(false);
  });

  it('31) Capability Registry wiring yok (import edilmiyor)', () => {
    expect(/from\s+['"][^'"]*capabilit[^'"]*['"]/i.test(adapterSource)).toBe(false);
  });

  it('32) UnifiedVehicleStore doğrudan import edilmiyor (DI)', () => {
    expect(/from\s+['"][^'"]*[Uu]nifiedVehicleStore[^'"]*['"]/.test(adapterSource)).toBe(false);
    expect(/getStatus/.test(adapterSource)).toBe(true); // API mevcut (sanity)
  });
});
