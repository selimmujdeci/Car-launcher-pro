/**
 * realtimeVehiclePairingLifecycle.test.ts — YENİ ARAÇ REALTIME ABONELİĞİ (P1).
 *
 * ── ONARILAN KUSUR (bağımsız denetim, P1) ───────────────────────────────────
 * `useRealtime` yalnız MOUNT anındaki araç ID listesiyle kanal kuruyordu.
 * `AddVehicleModal` ile sonradan bağlanan araç yalnız Zustand store'a giriyor,
 * realtime motoru yeni ID'yi HİÇ görmüyordu → `vehicle_telemetry` ve
 * `vehicle_locations` olayları filtreye takılıyor, araç `offline` + `lat=0` +
 * `lng=0` kalıyordu. Sayfa yenilenince düzelmesi kusurun imzasıydı.
 *
 * ── KİLİTLENEN SÖZLEŞME ─────────────────────────────────────────────────────
 *  · Araç ID kümesinin TEK kaynağı store'dur (gölge liste YOK).
 *  · Küme değişince eski kanallar kapanır, güncel filtreyle YENİDEN kurulur.
 *  · Aynı kümede reconnect YOK (no-op) → StrictMode çift efekt güvenli.
 *  · Eski kuşaktan gelen geç olay UYGULANMAZ; disconnect sonrası olay işlenmez.
 *  · Bilinmeyen araç olayı fail-closed (araç OLUŞTURULMAZ).
 *
 * Bu dosya saf helper testi DEĞİLDİR: gerçek `useRealtime` (React 18 ile
 * render edilir), gerçek `SupabaseRealtimeEngine` ve gerçek `vehicleStore`
 * kullanılır; yalnız `@/lib/supabase` kanal katmanı taklit edilir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';

/* ── Supabase kanal taklidi (tek taklit noktası) ──────────────────────────── */

interface FakeChannel {
  name:      string;
  filters:   Array<Record<string, unknown>>;
  handlers:  Array<(payload: { new: Record<string, unknown> }) => void>;
  statusCb:  ((s: string) => void) | null;
  removed:   boolean;
  on:        (...a: unknown[]) => FakeChannel;
  subscribe: (cb?: (s: string) => void) => FakeChannel;
}

const H = vi.hoisted(() => ({
  channels:  [] as unknown[],
  removed:   [] as unknown[],
  /** removeChannel'ı yavaşlatmak için (yarış senaryoları). */
  removeDelayMs: 0,
}));

vi.mock('@/lib/supabase', () => {
  const makeChannel = (name: string): FakeChannel => {
    const ch: FakeChannel = {
      name, filters: [], handlers: [], statusCb: null, removed: false,
      on(_event: unknown, filter: unknown, handler: unknown) {
        ch.filters.push(filter as Record<string, unknown>);
        ch.handlers.push(handler as (p: { new: Record<string, unknown> }) => void);
        return ch;
      },
      subscribe(cb?: (s: string) => void) {
        ch.statusCb = cb ?? null;
        cb?.('SUBSCRIBED');
        return ch;
      },
    };
    H.channels.push(ch);
    return ch;
  };
  return {
    supabaseBrowser: {
      channel: (name: string) => makeChannel(name),
      removeChannel: (ch: FakeChannel) => {
        if (H.removeDelayMs > 0) {
          setTimeout(() => { ch.removed = true; H.removed.push(ch); }, H.removeDelayMs);
        } else {
          ch.removed = true; H.removed.push(ch);
        }
      },
    },
    isSupabaseConfigured: true,
  };
});

/* Supabase'ten araç çekmeyi devre dışı bırak — store'un TEK gerçeği testin
   kendi kurduğu araç kümesidir (ağ yok, auth yok). */
vi.mock('@/lib/vehicles.service', () => ({ fetchVehicles: async () => [] }));

const RT = vi.hoisted(() => ({
  allowed: true,
  generation: 0,
  listeners: new Set<() => void>(),
}));

vi.mock('@/security/accountCleanup/accountCleanupRuntime', () => ({
  evaluateAccountScopedCapability: () => RT.allowed
    ? { allowed: true, generation: RT.generation }
    : { allowed: false, code: 'LOCKDOWN_ACTIVE' },
  getAccountCleanupRuntime: () => ({
    evaluateCapability: () => RT.allowed
      ? { allowed: true, generation: RT.generation }
      : { allowed: false, code: 'LOCKDOWN_ACTIVE' },
    subscribe: (listener: () => void) => {
      RT.listeners.add(listener);
      return () => RT.listeners.delete(listener);
    },
  }),
}));

import { useRealtime } from '@/hooks/useRealtime';
import { useVehicleStore } from '@/store/vehicleStore';
import { SupabaseRealtimeEngine, normalizeVehicleIds } from '@/lib/realtimeEngine';
import { TIMING } from '@/lib/constants';
import type { LiveVehicle } from '@/types/realtime';

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

const channels = (): FakeChannel[] => H.channels as FakeChannel[];
const liveChannels = (): FakeChannel[] => channels().filter((c) => !c.removed);
const filterOf = (ch: FakeChannel): string => String(ch.filters[0]?.filter ?? '');

function vehicle(id: string, over: Partial<LiveVehicle> = {}): LiveVehicle {
  return {
    id, plate: `PLATE-${id}`, name: `Araç ${id}`, driver: '—', status: 'offline',
    lat: 0, lng: 0, speed: 0, fuel: 0, engineTemp: 0, rpm: 0, odometer: 0,
    location: '—', lastSeen: '—', lastTimestamp: 0, ...over,
  } as LiveVehicle;
}

/** Kanal adına göre en son kurulmuş CANLI kanalı bulur. */
function liveChannel(name: string): FakeChannel | undefined {
  return [...liveChannels()].reverse().find((c) => c.name === name);
}

function emit(name: string, row: Record<string, unknown>): void {
  const ch = liveChannel(name);
  ch?.handlers.forEach((h) => h({ new: row }));
}

/** Render throttle (50 ms) aynı araca art arda gelen olayları düşürür. */
const pastThrottle = (): Promise<void> =>
  new Promise((r) => setTimeout(r, TIMING.RENDER_THROTTLE_MS + 10));

let container: HTMLDivElement;
let root: Root | null = null;

function Probe(): null { useRealtime(); return null; }

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function unmount(): Promise<void> {
  await act(async () => { root?.unmount(); root = null; });
}

/** Dinamik import zincirinin (connect/disconnect) çözülmesini bekler. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/** Store'a araç ekle → hook'un yeniden render + resubscribe etmesini bekle. */
async function addVehicleAndSettle(v: LiveVehicle): Promise<void> {
  await act(async () => { useVehicleStore.getState().addVehicle(v); });
  await settle();
}

beforeEach(async () => {
  RT.allowed = true;
  RT.generation = 0;
  RT.listeners.clear();
  /* ⚠️ FLAKE ONARIMI: `vehicleStore._lastRenderMs` MODÜL SEVİYESİNDE bir
     Map'tir ve testler arasında YAŞAR. Önceki testte B için uygulanan güncelleme
     50 ms'lik render throttle'ını "sıcak" bırakıyor → sonraki testin ilk olayı
     sessizce DÜŞÜYOR (ölçüldü: 3 koşudan 2'sinde "9-11" kırıldı). Throttle
     penceresini burada geçirmek her testi deterministik yapar; üretim kodu
     DEĞİŞTİRİLMEZ (throttle gerçek ve istenen bir davranıştır). */
  await new Promise((r) => setTimeout(r, TIMING.RENDER_THROTTLE_MS + 10));
  H.channels.length = 0;
  H.removed.length = 0;
  H.removeDelayMs = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useVehicleStore.setState({ vehicles: {}, connectionStatus: 'disconnected', loading: false, error: null });
  localStorage.clear();
});

afterEach(async () => {
  await unmount();
  container.remove();
  useVehicleStore.setState({ vehicles: {} });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('P1 · pairing sonrası realtime aboneliği (uçtan uca)', () => {
  it('1-2. başlangıçta yalnız A varken motor A filtresiyle bağlanır', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    const tel = liveChannel('vehicle-telemetry');
    expect(tel).toBeDefined();
    expect(filterOf(tel!)).toBe('vehicle_id=in.(A)');
    expect(liveChannels().length).toBe(2);   // locations + telemetry
  });

  it('3-6. B eklenince A+B ile yeniden abone olunur; eski kanallar kapanır, mükerrer YOK', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    const firstGeneration = [...liveChannels()];

    await addVehicleAndSettle(vehicle('B'));

    // Eski A-only kanalları unsubscribe edildi
    for (const ch of firstGeneration) expect(ch.removed).toBe(true);
    // Güncel kanallar tam olarak 2 (locations + telemetry) ve A+B filtreli
    expect(liveChannels().length).toBe(2);
    for (const ch of liveChannels()) expect(filterOf(ch)).toBe('vehicle_id=in.(A,B)');
    // Aynı filtreli mükerrer kanal yok
    const telemetryChannels = liveChannels().filter((c) => c.name === 'vehicle-telemetry');
    expect(telemetryChannels.length).toBe(1);
  });

  it('7-8. B için telemetry olayı alınır ve araç SAYFA YENİLEMEDEN online olur', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    await addVehicleAndSettle(vehicle('B'));

    expect(useVehicleStore.getState().vehicles.B.status).toBe('offline');

    await act(async () => {
      emit('vehicle-telemetry', {
        vehicle_id: 'B', speed: 42, fuel: 70, temp: 88, rpm: 1800,
        updated_at: new Date().toISOString(),
      });
    });

    const b = useVehicleStore.getState().vehicles.B;
    expect(b.status).toBe('online');
    expect(b.speed).toBe(42);
    expect(b.lastTimestamp).toBeGreaterThan(0);
  });

  it('9-11. B için location olayı alınır; lat/lng güncellenir (harita verisi oluşur)', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    await addVehicleAndSettle(vehicle('B'));

    await act(async () => {
      emit('vehicle-locations', {
        vehicle_id: 'B', lat: 41.0151, lng: 28.9795, created_at: new Date().toISOString(),
      });
    });

    const b = useVehicleStore.getState().vehicles.B;
    expect(b.lat).toBeCloseTo(41.0151, 4);
    expect(b.lng).toBeCloseTo(28.9795, 4);
    // Marker için gerekli store verisi: getList içinde ve 0,0 DEĞİL
    const listed = useVehicleStore.getState().getList().find((v) => v.id === 'B');
    expect(listed?.lat).not.toBe(0);
    expect(listed?.lng).not.toBe(0);
  });

  it('12. aynı araç tekrar eklenirse GEREKSİZ reconnect olmaz', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    const before = channels().length;

    await addVehicleAndSettle(vehicle('A'));   // aynı ID — upsert
    expect(channels().length).toBe(before);
    expect(liveChannels().length).toBe(2);
  });

  it('13. araç silinince filtre güncellenir', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    useVehicleStore.getState().addVehicle(vehicle('B'));
    await mount();
    expect(filterOf(liveChannel('vehicle-telemetry')!)).toBe('vehicle_id=in.(A,B)');

    await act(async () => { useVehicleStore.getState().removeVehicle('B'); });
    await settle();

    expect(filterOf(liveChannel('vehicle-telemetry')!)).toBe('vehicle_id=in.(A)');
    expect(liveChannels().length).toBe(2);
  });

  it('14. StrictMode benzeri mount → unmount → mount MÜKERRER abonelik üretmez', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    await unmount();
    await mount();

    expect(liveChannels().length).toBe(2);
    for (const ch of liveChannels()) expect(filterOf(ch)).toBe('vehicle_id=in.(A)');
  });

  it('15. hızlı A → A+B → A+B+C değişiminde FİNAL kanal yalnız A+B+C olur', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();

    await act(async () => {
      useVehicleStore.getState().addVehicle(vehicle('B'));
      useVehicleStore.getState().addVehicle(vehicle('C'));
    });
    await settle();

    expect(liveChannels().length).toBe(2);
    for (const ch of liveChannels()) expect(filterOf(ch)).toBe('vehicle_id=in.(A,B,C)');
  });

  it('16. ESKİ kuşak callback\'i final store\'u BOZMAZ', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    const staleTelemetry = liveChannel('vehicle-telemetry')!;   // A-only kuşağı

    await addVehicleAndSettle(vehicle('B'));

    await act(async () => {
      emit('vehicle-telemetry', {
        vehicle_id: 'A', speed: 30, fuel: 50, temp: 80, rpm: 1200,
        updated_at: new Date().toISOString(),
      });
    });
    const afterFresh = useVehicleStore.getState().vehicles.A.speed;
    expect(afterFresh).toBe(30);

    // Eski kuşağın kanalı geç bir olay yollarsa UYGULANMAMALI
    await act(async () => {
      staleTelemetry.handlers.forEach((h) => h({
        new: { vehicle_id: 'A', speed: 111, fuel: 10, temp: 120, rpm: 5000,
               updated_at: new Date().toISOString() },
      }));
    });
    expect(useVehicleStore.getState().vehicles.A.speed).toBe(30);
  });

  it('17. BİLİNMEYEN araç olayı reddedilir (fail-closed, araç oluşturulmaz)', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();

    await act(async () => {
      emit('vehicle-telemetry', {
        vehicle_id: 'ZZZ', speed: 99, fuel: 10, temp: 100, rpm: 4000,
        updated_at: new Date().toISOString(),
      });
    });

    expect(useVehicleStore.getState().vehicles.ZZZ).toBeUndefined();
    expect(Object.keys(useVehicleStore.getState().vehicles)).toEqual(['A']);
  });

  it('18. disconnect (unmount) sonrası olay İŞLENMEZ', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    const tel = liveChannel('vehicle-telemetry')!;
    await unmount();

    await act(async () => {
      tel.handlers.forEach((h) => h({
        new: { vehicle_id: 'A', speed: 77, fuel: 10, temp: 90, rpm: 3000,
               updated_at: new Date().toISOString() },
      }));
    });

    expect(useVehicleStore.getState().vehicles.A.speed).toBe(0);
    expect(useVehicleStore.getState().vehicles.A.status).toBe('offline');
  });
});

describe('P1 · motor sözleşmesi (engine seviyesi)', () => {
  function engineWith(ids: string[]) {
    const updates: unknown[] = [];
    const statuses: string[] = [];
    const engine = new SupabaseRealtimeEngine({
      onUpdate: (u) => updates.push(u),
      onConnectionChange: (s) => statuses.push(s),
    });
    engine.syncVehicleIds(ids);
    return { engine, updates, statuses };
  }

  it('19. ağ yeniden bağlanması mevcut ID setini KORUR', async () => {
    const { engine } = engineWith(['A', 'B']);
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.getSubscriptionDiagnostics().vehicleIdCount).toBe(2);

    engine.disconnect();
    engine.connect();               // ağ geri geldi — ID seti korunmalı
    await new Promise((r) => setTimeout(r, 0));
    expect(filterOf(liveChannel('vehicle-telemetry')!)).toBe('vehicle_id=in.(A,B)');
    engine.disconnect();
  });

  it('E1. aynı küme (farklı SIRA) reconnect ÜRETMEZ; küme değişimi üretir', async () => {
    const { engine } = engineWith(['B', 'A']);
    await new Promise((r) => setTimeout(r, 0));
    const gen = engine.getSubscriptionDiagnostics().generation;

    expect(engine.syncVehicleIds(['A', 'B'])).toBe(false);        // sıra farkı
    expect(engine.syncVehicleIds(['A', 'B', 'A'])).toBe(false);   // tekrar
    expect(engine.getSubscriptionDiagnostics().generation).toBe(gen);

    expect(engine.syncVehicleIds(['A', 'B', 'C'])).toBe(true);
    expect(engine.getSubscriptionDiagnostics().generation).toBeGreaterThan(gen);
    engine.disconnect();
  });

  it('E2. boş/geçersiz ID\'ler filtrelenir; boş küme kanalları KAPATIR', async () => {
    expect(normalizeVehicleIds(['B', '', '  ', 'A', 'A', null as unknown as string])).toEqual(['A', 'B']);

    const { engine } = engineWith(['A']);
    await new Promise((r) => setTimeout(r, 0));
    expect(liveChannels().length).toBe(2);

    expect(engine.syncVehicleIds([])).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(liveChannels().length).toBe(0);
    expect(engine.getSubscriptionDiagnostics().lastReconnectReason).toBe('ids_cleared');
  });

  it('E3. gözlem alanları dürüst (sayı/kuşak/durum — kişisel veri YOK)', async () => {
    const { engine } = engineWith(['A']);
    await new Promise((r) => setTimeout(r, 0));
    let d = engine.getSubscriptionDiagnostics();
    expect(d.lastReconnectReason).toBe('initial');
    expect(d.vehicleIdCount).toBe(1);
    expect(d.activeChannelCount).toBe(2);
    expect(d.lastSubscribeStatus).toBe('SUBSCRIBED');

    engine.syncVehicleIds(['A', 'B']);
    await new Promise((r) => setTimeout(r, 0));
    d = engine.getSubscriptionDiagnostics();
    expect(d.lastReconnectReason).toBe('ids_changed');
    expect(d.previousVehicleIdCount).toBe(1);
    expect(d.vehicleIdCount).toBe(2);
    expect(d.lastUnsubscribeCount).toBe(2);
    expect(JSON.stringify(d)).not.toContain('PLATE');
    engine.disconnect();
  });
});

describe('P1 · yarış senaryoları', () => {
  it('R1. eski unsubscribe YAVAŞ, yeni connect hızlı → final yalnız güncel küme', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    H.removeDelayMs = 40;                       // kapatma gecikmeli
    await addVehicleAndSettle(vehicle('B'));

    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(liveChannels().length).toBe(2);
    for (const ch of liveChannels()) expect(filterOf(ch)).toBe('vehicle_id=in.(A,B)');
  });

  it('R2. modal submit İKİ KEZ tetiklenirse mükerrer kanal oluşmaz', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();

    await addVehicleAndSettle(vehicle('B'));
    const afterFirst = channels().length;
    await addVehicleAndSettle(vehicle('B'));    // aynı araç ikinci kez

    expect(channels().length).toBe(afterFirst);
    expect(liveChannels().length).toBe(2);
  });

  it('R3. resubscribe SIRASINDA unmount olursa sahipsiz kanal KALMAZ', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();

    await act(async () => { useVehicleStore.getState().addVehicle(vehicle('B')); });
    await unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(liveChannels().length).toBe(0);
  });
});

describe('P1 · watchdog regresyonu', () => {
  /**
   * KİLİT GÜNCELLENDİ (FLEET-CONNECTIVITY-P0):
   * Önceki sürüm `speed === 0 && rpm === 0` bekliyordu; bu, bekçinin
   * çevrimdışına düşen araca UYDURMA `0` ölçümü yazmasını sabitliyordu.
   * 90 km/h giderken bağlantı koparsa hız `0` DEĞİL, BİLİNMİYOR'dur.
   * Yeni doğru davranış: son ölçüm KORUNUR, gerçek katmanı `OFFLINE`
   * olarak etiketler; konum yine silinmez. Kilit kaldırılmadı, güçlendirildi.
   */
  it('20. 11 dakika sonra araç OFFLINE olur, SON KONUM ve SON ÖLÇÜM silinmez', async () => {
    vi.useFakeTimers();
    try {
      useVehicleStore.setState({
        vehicles: {
          A: vehicle('A', {
            status: 'online', lat: 41.0151, lng: 28.9795, speed: 60, rpm: 2000,
            lastTimestamp: Date.now() - (TIMING.OFFLINE_TIMEOUT_MS + 1_000),
          }),
        },
      });
      const stop = useVehicleStore.getState().startWatchdog();
      vi.advanceTimersByTime(TIMING.WATCHDOG_INTERVAL_MS + 10);
      stop();

      const a = useVehicleStore.getState().vehicles.A;
      expect(a.status).toBe('offline');
      // 🔒 UYDURMA 0 YAZILMAZ — son ölçüm korunur.
      expect(a.speed).toBe(60);
      expect(a.rpm).toBe(2000);
      expect(a.lat).toBeCloseTo(41.0151, 4);   // SON KONUM korunur
      expect(a.lng).toBeCloseTo(28.9795, 4);
      // 🔒 Gerçek katmanı varsa "canlı" İDDİA ETMEZ.
      if (a.telemetry) {
        expect(a.telemetry.device).toBe('OFFLINE');
        expect(a.telemetry.locationIsLive).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('P1 · throttle altında telemetry + location birlikte uygulanır', () => {
  it('B hem online olur hem konum alır (20Hz throttle aşıldıktan sonra)', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    await addVehicleAndSettle(vehicle('B'));

    await act(async () => {
      emit('vehicle-telemetry', {
        vehicle_id: 'B', speed: 55, fuel: 60, temp: 85, rpm: 1600,
        updated_at: new Date().toISOString(),
      });
    });
    await act(async () => { await pastThrottle(); });
    await act(async () => {
      emit('vehicle-locations', {
        vehicle_id: 'B', lat: 40.99, lng: 29.02, created_at: new Date().toISOString(),
      });
    });

    const b = useVehicleStore.getState().vehicles.B;
    expect(b.status).toBe('online');
    expect(b.speed).toBe(55);            // telemetri korunur (location NaN gönderir)
    expect(b.lat).toBeCloseTo(40.99, 3);
    expect(b.lng).toBeCloseTo(29.02, 3);
  });
});

describe('PWA-P1-006 · realtime lockdown', () => {
  it('lockdown aktifken subscription başlatmaz', async () => {
    RT.allowed = false;
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    expect(liveChannels()).toHaveLength(0);
  });

  it('aktif subscription lockdown başlayınca kapanır', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    expect(liveChannels()).toHaveLength(2);

    RT.allowed = false;
    RT.generation += 1;
    await act(async () => {
      RT.listeners.forEach((listener) => listener());
      await Promise.resolve();
    });

    expect(liveChannels()).toHaveLength(0);
  });

  it('lockdown kalkması tek başına eski hesaba resubscribe etmez', async () => {
    useVehicleStore.getState().addVehicle(vehicle('A'));
    await mount();
    RT.allowed = false;
    RT.generation += 1;
    await act(async () => {
      RT.listeners.forEach((listener) => listener());
      await Promise.resolve();
    });
    RT.allowed = true;
    RT.listeners.forEach((listener) => listener());
    await act(async () => { await Promise.resolve(); });
    expect(liveChannels()).toHaveLength(0);
  });
});
