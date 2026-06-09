/**
 * perf.notify.test.ts — P2 (Test A): Zustand notify disiplini (render-storm proxy).
 *
 * Amaç: GERÇEK useUnifiedVehicleStore'un (hot-path sensör store'u) dirty-guard'ı
 * gereksiz notify/re-render üretmiyor mu doğrulamak. jsdom'da tam component render
 * testi kırılgan (T7) → render storm KÖK-NEDENİNDEN ölçülür: store `subscribe`
 * notify sayısı + selector `Object.is` kararlılığı (P1 perfHarness `subscribeProbe`).
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; GERÇEK store sürülür
 * (kopya yok); yalnız bağımlılıkları (cameraService/safeStorage) mock'lanır; yalnız
 * src/__tests__ altında.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── UnifiedVehicleStore bağımlılık mock'ları ── */
vi.mock('../platform/cameraService', () => ({ openRearCamera: vi.fn(), closeRearCamera: vi.fn() }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { subscribeProbe } from './sim/perfHarness';

const store = useUnifiedVehicleStore;

beforeEach(() => {
  // Bilinen baseline (sonraki test bağımsız başlasın).
  store.getState().updateVehicleState({ speed: 0, rpm: 0, fuel: 0 });
});

describe('P2 — Zustand notify disiplini (Test A)', () => {
  it('N farklı update → tam N notify (over-notify yok)', () => {
    store.getState().updateVehicleState({ rpm: 1000 }); // baseline
    const probe = subscribeProbe(store);

    for (let i = 1; i <= 50; i++) store.getState().updateVehicleState({ rpm: 1000 + i * 100 });

    expect(probe.count()).toBe(50); // her benzersiz değişim tam 1 notify
    probe.unsub();
  });

  it('settled (aynı değer) → 0 notify (dirty-guard)', () => {
    store.getState().updateVehicleState({ rpm: 3000 });
    const probe = subscribeProbe(store);

    store.getState().updateVehicleState({ rpm: 3000 }); // aynı → notify yok
    store.getState().updateVehicleState({ rpm: 3000 });

    expect(probe.count()).toBe(0); // idle re-render yok
    probe.unsub();
  });

  it('çok-alanlı patch: değişimde tek (batched) notify, tekrarda 0', () => {
    store.getState().updateVehicleState({ speed: 0, rpm: 0, fuel: 0 });
    const probe = subscribeProbe(store);

    store.getState().updateVehicleState({ speed: 60, rpm: 2500, fuel: 80 }); // 3 alan → tek set
    expect(probe.count()).toBe(1);

    store.getState().updateVehicleState({ speed: 60, rpm: 2500, fuel: 80 }); // aynı → 0
    expect(probe.count()).toBe(1);

    probe.unsub();
  });

  it('sanitization guard: imkânsız hız (>300) reddedilir → notify yok, UI bozulmaz', () => {
    store.getState().updateVehicleState({ speed: 50 }); // geçerli baseline
    const probe = subscribeProbe(store);

    store.getState().updateVehicleState({ speed: 999 }); // SafetyGate → cur.speed korunur

    expect(probe.count()).toBe(0);            // bozuk değer dirty yapmaz → notify yok
    expect(store.getState().speed).toBe(50);  // garbage UI'a ulaşmadı
    probe.unsub();
  });

  it('selector kararlılığı: rpm değişimi speed selector\'ını Object.is-bozmaz', () => {
    store.getState().updateVehicleState({ speed: 40, rpm: 1000 });
    const speedSel = (s: { speed: number | null }): number | null => s.speed;

    const before = speedSel(store.getState());
    store.getState().updateVehicleState({ rpm: 5000 }); // yalnız rpm değişir
    const after = speedSel(store.getState());

    // speed selector aynı referans/değer → speed'e abone bileşen re-render OLMAZ
    expect(Object.is(before, after)).toBe(true);
    expect(after).toBe(40);
  });

  it('render-storm budget: 1000 sensör tikinin %90\'ı settled → notify yalnız gerçek değişimlerde', () => {
    store.getState().updateVehicleState({ rpm: 2000 });
    const probe = subscribeProbe(store);

    let changes = 0;
    for (let i = 0; i < 1000; i++) {
      if (i % 10 === 0) {
        changes++;
        store.getState().updateVehicleState({ rpm: 2000 + changes }); // gerçek değişim
      } else {
        store.getState().updateVehicleState({ rpm: 2000 + changes }); // aynı değer → settled
      }
    }

    expect(probe.count()).toBe(changes); // yalnız 100 gerçek değişim notify etti
    expect(probe.count()).toBeLessThan(1000); // 900 gereksiz update bastırıldı (storm yok)
    probe.unsub();
  });
});
