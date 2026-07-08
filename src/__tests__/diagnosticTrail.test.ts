/**
 * diagnosticTrail.test.ts — merkezi olay izi (breadcrumb) kilidi.
 *
 * Garanti: iz, kendi olaylarını (boot/mod/ekran) + crashLogger hatalarını +
 * modal olaylarını TEK kronolojik zaman çizgisinde harmanlar; mod/OBD geçişleri
 * store aboneliğiyle kaydedilir. Bu, "soruna ne yol açtı" hikâyesini kilitler.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const store = vi.hoisted(() => ({
  state: { speed: 0 as number | null, reverse: false },
  listener: null as ((s: { speed: number | null; reverse: boolean }) => void) | null,
}));
const obd = vi.hoisted(() => ({ source: 'none' }));
const errs = vi.hoisted(() => ({ list: [] as Array<{ ts: number; ctx: string; msg: string; severity: string }> }));
const net = vi.hoisted(() => ({ connected: true, cb: null as ((s: { connected: boolean }) => void) | null }));

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: {
    getState: () => store.state,
    subscribe: (fn: (s: { speed: number | null; reverse: boolean }) => void) => {
      store.listener = fn;
      return () => { store.listener = null; };
    },
  },
}));
// Partial mock: GERÇEK obdService (bağlantı milestone mantığı) korunur; yalnız
// getOBDStatusSnapshot diagnosticTrail'in OBD-kaynak gözlemi için override edilir.
vi.mock('../platform/obdService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/obdService')>();
  return { ...actual, getOBDStatusSnapshot: () => ({ source: obd.source }) };
});
vi.mock('../platform/crashLogger', () => ({ getErrorLog: () => errs.list, logError: vi.fn() }));
vi.mock('../platform/uiActivityRecorder', () => ({ getUiActivitySnapshot: () => ({ recent: [] }) }));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus:   vi.fn(async () => ({ connected: net.connected })),
    addListener: vi.fn(async (_evt: string, cb: (s: { connected: boolean }) => void) => {
      net.cb = cb;
      return { remove: vi.fn() };
    }),
  },
}));

import {
  startDiagnosticTrail,
  pushTrail,
  getDiagnosticTrail,
  _resetDiagnosticTrailForTest,
} from '../platform/diagnosticTrail';
import { getOwnTrail, resetOwnTrail } from '../platform/diagnosticTrailCore';
import { startVehicleDetection, stopVehicleDetection } from '../platform/vehicleProfileService';
import {
  startVehicleIntelligenceService,
  stopVehicleIntelligenceService,
} from '../platform/vehicleIntelligenceService';
import { connectivityService } from '../platform/connectivityService';
import { _setConnStateForTest, _runHandshakeForTest } from '../platform/obdService';

/* ── Minimal in-memory IndexedDB shim (connectivityService drain'i jsdom'da IDB
      ister; yalnız kullandığı yüzey — soak.telemetry-connectivity.test.ts deseni). */
type IdbHandler = (() => void) | null;
interface FakeReq { result: unknown; error: unknown; onsuccess: IdbHandler; onerror: IdbHandler; onupgradeneeded: IdbHandler }
function installFakeIDB(): { clear: () => void } {
  const data = new Map<string, { id: string }>();
  let created = false;
  const makeStore = () => ({
    createIndex: () => {},
    getAll: () => {
      const req: FakeReq = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => { req.result = [...data.values()]; req.onsuccess?.(); });
      return req;
    },
    put:    (e: { id: string }) => { data.set(e.id, e); },
    delete: (id: string) => { data.delete(id); },
  });
  const makeDb = () => ({
    createObjectStore: () => makeStore(),
    transaction: () => {
      const tx = { objectStore: () => makeStore(), oncomplete: null as IdbHandler, onerror: null as IdbHandler, error: null };
      queueMicrotask(() => { tx.oncomplete?.(); });
      return tx;
    },
  });
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req: FakeReq = { result: makeDb(), error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => { if (!created) { created = true; req.onupgradeneeded?.(); } req.onsuccess?.(); });
      return req;
    },
  };
  return { clear: () => data.clear() };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  if (cleanup) { cleanup(); cleanup = null; }
  _resetDiagnosticTrailForTest();
  store.state = { speed: 0, reverse: false };
  store.listener = null;
  obd.source = 'none';
  errs.list = [];
});

describe('diagnosticTrail — olay izi', () => {
  it('manuel pushTrail iz olarak görünür', () => {
    pushTrail('action', 'test aksiyonu');
    const trail = getDiagnosticTrail();
    expect(trail.some((e) => e.kind === 'action' && e.label === 'test aksiyonu')).toBe(true);
  });

  it('crashLogger hataları ize harmanlanır', () => {
    errs.list = [{ ts: Date.now(), ctx: 'OBD', msg: 'broken pipe', severity: 'error' }];
    const trail = getDiagnosticTrail();
    expect(trail.some((e) => e.kind === 'error' && e.detail?.includes('broken pipe'))).toBe(true);
  });

  it('start → boot olayı + mod geçişleri store aboneliğiyle kaydedilir', () => {
    cleanup = startDiagnosticTrail();
    expect(getDiagnosticTrail().some((e) => e.kind === 'boot')).toBe(true);
    expect(store.listener).toBeTypeOf('function');

    // Sürüşe geçiş
    store.listener?.({ speed: 60, reverse: false });
    expect(getDiagnosticTrail().some((e) => e.kind === 'mode' && e.label.includes('sürüş'))).toBe(true);

    // Geri vitese geçiş
    store.listener?.({ speed: 0, reverse: true });
    expect(getDiagnosticTrail().some((e) => e.kind === 'mode' && e.label.includes('geri vites'))).toBe(true);
  });

  it('HİSTEREZİS+DWELL: hız titremesi izi BOĞMAZ (flapping tek satıra iner)', () => {
    // SAHA 2026-07-06: tek eşikle hız 5 civarı titreyince ~1-2sn'de bir sürüş/park
    // satırı üretiliyordu. Bant (ON≥8/OFF≤3) + 4sn dwell titremeyi yutar.
    cleanup = startDiagnosticTrail();
    // Bir kez sürüşe geç (commit), sonra hızlı 0↔60 titret (hepsi dwell içinde)
    store.listener?.({ speed: 60, reverse: false });
    store.listener?.({ speed: 0,  reverse: false });
    store.listener?.({ speed: 60, reverse: false });
    store.listener?.({ speed: 0,  reverse: false });
    store.listener?.({ speed: 60, reverse: false });
    const modeEvents = getDiagnosticTrail().filter((e) => e.kind === 'mode');
    // Titreme yutulmalı → yalnız TEK "sürüşe geçildi" satırı (park spam yok)
    expect(modeEvents.length).toBe(1);
    expect(modeEvents[0].label).toContain('sürüş');
  });

  it('OBD kaynak değişimi ize kaydedilir', () => {
    cleanup = startDiagnosticTrail();
    obd.source = 'bt';
    store.listener?.({ speed: 0, reverse: false });   // abonelik tetikle
    expect(getDiagnosticTrail().some((e) => e.kind === 'obd' && e.label.includes('bt'))).toBe(true);
  });

  it('iz kronolojik sıralı döner', () => {
    pushTrail('action', 'ilk');
    pushTrail('action', 'ikinci');
    const trail = getDiagnosticTrail();
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i].ts).toBeGreaterThanOrEqual(trail[i - 1].ts);
    }
  });

  it('cleanup aboneliği söker (zero-leak)', () => {
    cleanup = startDiagnosticTrail();
    expect(store.listener).not.toBeNull();
    cleanup();
    cleanup = null;
    expect(store.listener).toBeNull();
  });
});

/* ── Black Box v2 — Service Lifecycle eventleri (Patch 1) ────────── */

describe('Service Lifecycle boot eventleri', () => {
  afterEach(() => {
    // Servis _running durumunu ve iz halkasını tazele (testler arası sızma yok).
    stopVehicleDetection();
    stopVehicleIntelligenceService();
    resetOwnTrail();
  });

  const ownLabels = (): string[] => getOwnTrail().map((e) => e.label);
  const countBoot = (label: string): number =>
    getOwnTrail().filter((e) => e.kind === 'boot' && e.label === label).length;

  it('startVehicleDetection/stop → vehicle-profile-service boot eventleri izde', () => {
    resetOwnTrail();
    startVehicleDetection();
    expect(ownLabels()).toContain('vehicle-profile-service:start');

    stopVehicleDetection();
    expect(ownLabels()).toContain('vehicle-profile-service:stop');
  });

  it('startVehicleIntelligenceService/stop → vehicle-intelligence-service boot eventleri izde', () => {
    resetOwnTrail();
    const stop = startVehicleIntelligenceService();
    expect(ownLabels()).toContain('vehicle-intelligence-service:start');

    stop();
    expect(ownLabels()).toContain('vehicle-intelligence-service:stop');
  });

  it('mükerrer start duplicate event ÜRETMEZ (idempotent guard)', () => {
    resetOwnTrail();
    startVehicleDetection();
    startVehicleDetection();   // erken döner
    startVehicleDetection();
    expect(countBoot('vehicle-profile-service:start')).toBe(1);

    const stop = startVehicleIntelligenceService();
    startVehicleIntelligenceService(); // erken döner
    expect(countBoot('vehicle-intelligence-service:start')).toBe(1);
    stop();
  });

  it('stop cleanup bozulmuyor (çift stop hata vermez)', () => {
    startVehicleDetection();
    const stop = startVehicleIntelligenceService();
    expect(() => {
      stopVehicleDetection();
      stopVehicleDetection();      // ikinci stop — idempotent
      stop();
      stopVehicleIntelligenceService();
    }).not.toThrow();
  });

  it('boot eventleri statik + PII\'siz (VIN/MAC/GPS/SSID yok)', () => {
    resetOwnTrail();
    startVehicleDetection();
    const stop = startVehicleIntelligenceService();
    stop();
    stopVehicleDetection();

    for (const e of getOwnTrail()) {
      if (e.kind !== 'boot') continue;
      // statik etiket kalıbı: yalnız "<servis>:start|stop"
      expect(e.label).toMatch(/^vehicle-(profile|intelligence)-service:(start|stop)$/);
      expect(e.detail).toBeUndefined();        // detail kullanılmadı
    }
  });
});

/* ── Black Box v2 — Network online/offline eventleri (Patch 2) ───── */

describe('Network online/offline eventleri', () => {
  let idb: { clear: () => void };
  beforeEach(() => { idb = installFakeIDB(); });
  afterEach(() => {
    connectivityService.destroy();
    idb.clear();
    resetOwnTrail();
    net.cb = null;
  });

  /** Servisi belirli başlangıç durumuyla başlat, izi temizle (yalnız geçişleri izole gör). */
  async function initAt(connected: boolean): Promise<void> {
    net.connected = connected;
    await connectivityService.init();
    resetOwnTrail();
  }

  it('offline geçişi network:offline eventi üretir', async () => {
    await initAt(true);            // _online = true
    net.cb!({ connected: false }); // true → false
    expect(getOwnTrail().some((e) => e.kind === 'action' && e.label === 'network:offline')).toBe(true);
  });

  it('online geçişi network:online eventi üretir', async () => {
    await initAt(false);          // _online = false
    net.cb!({ connected: true }); // false → true
    expect(getOwnTrail().some((e) => e.kind === 'action' && e.label === 'network:online')).toBe(true);
  });

  it('aynı state tekrarı gereksiz event ÜRETMEZ (yalnız değişimde push)', async () => {
    await initAt(true);            // _online = true
    net.cb!({ connected: false }); // true → false → 1 offline
    net.cb!({ connected: false }); // değişim yok → event yok
    net.cb!({ connected: false });
    expect(getOwnTrail().filter((e) => e.label === 'network:offline')).toHaveLength(1);

    net.cb!({ connected: true });  // false → true → 1 online
    net.cb!({ connected: true });  // değişim yok
    expect(getOwnTrail().filter((e) => e.label === 'network:online')).toHaveLength(1);
  });

  it('boot init tek başına network eventi ÜRETMEZ (yalnız gerçek değişim)', async () => {
    net.connected = true;
    resetOwnTrail();
    await connectivityService.init();
    expect(getOwnTrail().filter((e) => e.label.startsWith('network:'))).toHaveLength(0);
  });

  it('network eventleri statik + PII\'siz (SSID/IP yok)', async () => {
    await initAt(false);
    net.cb!({ connected: true });
    net.cb!({ connected: false });
    for (const e of getOwnTrail()) {
      if (!e.label.startsWith('network:')) continue;
      expect(e.label).toMatch(/^network:(online|offline)$/);
      expect(e.kind).toBe('action');
      expect(e.detail).toBeUndefined();
    }
  });
});

/* ── Black Box v2 — OBD bağlantı yaşam döngüsü eventleri (Patch 3) ── */

describe('OBD bağlantı yaşam döngüsü eventleri', () => {
  beforeEach(() => {
    // Normalize: bilinen bir geçişle 'idle'a in → _trailInReconnect sıfırlanır;
    // sonra izi temizle (yalnız test senaryosunun eventlerini izole gör).
    _setConnStateForTest('connecting');
    _setConnStateForTest('idle');
    resetOwnTrail();
  });

  const obdLabels = (): string[] =>
    getOwnTrail().filter((e) => e.kind === 'obd').map((e) => e.label);
  const count = (label: string): number => obdLabels().filter((l) => l === label).length;

  it('connect başlangıcı → obd:connect:start', () => {
    _setConnStateForTest('scanning'); // idle → scanning
    expect(obdLabels()).toContain('obd:connect:start');
  });

  it('connect success → obd:connect:success (reconnect değil)', () => {
    _setConnStateForTest('scanning');    // idle → scanning (connect:start)
    _setConnStateForTest('connecting');  // ara geçiş
    _setConnStateForTest('connected');   // → connect:success
    expect(obdLabels()).toContain('obd:connect:success');
    expect(obdLabels()).not.toContain('obd:reconnect:success');
  });

  it('disconnect → obd:disconnect', () => {
    _setConnStateForTest('connected'); // idle → connected
    _setConnStateForTest('idle');      // connected → idle (disconnect)
    expect(obdLabels()).toContain('obd:disconnect');
  });

  it('reconnect start → obd:reconnect:start', () => {
    _setConnStateForTest('connected');     // canlı
    _setConnStateForTest('reconnecting');  // kopma → reconnect:start
    expect(obdLabels()).toContain('obd:reconnect:start');
  });

  it('reconnect success → obd:reconnect:success (connect:success DEĞİL)', () => {
    _setConnStateForTest('connected');    // baseline canlı bağlantı (connect:success)
    resetOwnTrail();                      // kurulum eventini temizle → yalnız reconnect turunu gör
    _setConnStateForTest('reconnecting'); // reconnect:start
    _setConnStateForTest('connecting');   // ara geçiş (reconnect turu sürüyor)
    _setConnStateForTest('connected');    // → reconnect:success
    expect(obdLabels()).toContain('obd:reconnect:success');
    expect(count('obd:connect:success')).toBe(0); // reconnect turu connect:success üretmez
  });

  it('reconnect failed → obd:reconnect:failed', () => {
    _setConnStateForTest('connected');
    _setConnStateForTest('reconnecting'); // reconnect:start
    _setConnStateForTest('error');        // tur tükendi → reconnect:failed
    expect(obdLabels()).toContain('obd:reconnect:failed');
  });

  it('aynı state tekrarı gereksiz event ÜRETMEZ (yalnız gerçek geçişte)', () => {
    _setConnStateForTest('scanning');    // connect:start (1)
    _setConnStateForTest('scanning');    // aynı state → _merge dedup, event yok
    _setConnStateForTest('scanning');
    expect(count('obd:connect:start')).toBe(1);

    _setConnStateForTest('connected');   // connect:success (1)
    _setConnStateForTest('connected');   // aynı state → event yok
    expect(count('obd:connect:success')).toBe(1);
  });

  it('milestone etiketleri statik + PII\'siz (VIN/MAC/cihaz adı/adres yok)', () => {
    _setConnStateForTest('scanning');
    _setConnStateForTest('connected');
    _setConnStateForTest('reconnecting');
    _setConnStateForTest('error');
    for (const e of getOwnTrail()) {
      if (e.kind !== 'obd') continue;
      expect(e.label).toMatch(/^obd:(connect:start|connect:success|disconnect|reconnect:start|reconnect:success|reconnect:failed)$/);
      expect(e.detail).toBeUndefined();
    }
  });
});

/* ── Black Box v2 — OBD handshake milestone eventleri (Patch 4A) ──── */

describe('OBD handshake milestone eventleri', () => {
  beforeEach(() => { resetOwnTrail(); });

  const notStale = (): boolean => false;
  const isStale  = (): boolean => true;

  it('handshake start → obd:handshake:start', async () => {
    await _runHandshakeForTest(() => Promise.resolve({}), notStale);
    expect(getOwnTrail().some((e) => e.kind === 'obd' && e.label === 'obd:handshake:start')).toBe(true);
  });

  it('handshake success → obd:handshake:success (stale değil)', async () => {
    await _runHandshakeForTest(() => Promise.resolve({}), notStale);
    const labels = getOwnTrail().filter((e) => e.kind === 'obd').map((e) => e.label);
    expect(labels).toContain('obd:handshake:start');
    expect(labels).toContain('obd:handshake:success');
    expect(labels).not.toContain('obd:handshake:failed');
  });

  it('handshake failed → obd:handshake:failed (stale değil)', async () => {
    await _runHandshakeForTest(() => Promise.reject(new Error('elm327 yanıt yok')), notStale);
    const labels = getOwnTrail().filter((e) => e.kind === 'obd').map((e) => e.label);
    expect(labels).toContain('obd:handshake:start');
    expect(labels).toContain('obd:handshake:failed');
    expect(labels).not.toContain('obd:handshake:success');
  });

  it('stale callback geç gelirse success/failed YAZILMAZ (yalnız start)', async () => {
    await _runHandshakeForTest(() => Promise.resolve({}), isStale);   // stale success
    await _runHandshakeForTest(() => Promise.reject(new Error('x')), isStale); // stale failure
    const labels = getOwnTrail().filter((e) => e.kind === 'obd').map((e) => e.label);
    // start koşulsuz (2 kez) ama stale → ne success ne failed
    expect(labels.filter((l) => l === 'obd:handshake:start')).toHaveLength(2);
    expect(labels).not.toContain('obd:handshake:success');
    expect(labels).not.toContain('obd:handshake:failed');
  });

  it('handshake etiketleri statik + PII\'siz + detail undefined', async () => {
    await _runHandshakeForTest(() => Promise.resolve({}), notStale);
    await _runHandshakeForTest(() => Promise.reject(new Error('vin WVWZZZ1JZXW000001 mac AA:BB:CC:DD:EE:FF')), notStale);
    const obdEvents = getOwnTrail().filter((e) => e.kind === 'obd');
    expect(obdEvents.length).toBeGreaterThan(0);
    for (const e of obdEvents) {
      expect(e.label).toMatch(/^obd:handshake:(start|success|failed)$/);
      expect(e.detail).toBeUndefined();
    }
    // Reject error'ı içindeki VIN/MAC hiçbir event'e sızmadı (statik etiket → değer taşımaz)
    expect(JSON.stringify(getOwnTrail())).not.toContain('WVWZZZ1JZXW000001');
    expect(JSON.stringify(getOwnTrail())).not.toContain('AA:BB:CC:DD:EE:FF');
  });
});
