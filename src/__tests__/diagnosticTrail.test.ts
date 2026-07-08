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

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: {
    getState: () => store.state,
    subscribe: (fn: (s: { speed: number | null; reverse: boolean }) => void) => {
      store.listener = fn;
      return () => { store.listener = null; };
    },
  },
}));
vi.mock('../platform/obdService', () => ({ getOBDStatusSnapshot: () => ({ source: obd.source }) }));
vi.mock('../platform/crashLogger', () => ({ getErrorLog: () => errs.list, logError: vi.fn() }));
vi.mock('../platform/uiActivityRecorder', () => ({ getUiActivitySnapshot: () => ({ recent: [] }) }));

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
