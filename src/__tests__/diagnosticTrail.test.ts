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
vi.mock('../platform/crashLogger', () => ({ getErrorLog: () => errs.list }));
vi.mock('../platform/uiActivityRecorder', () => ({ getUiActivitySnapshot: () => ({ recent: [] }) }));

import {
  startDiagnosticTrail,
  pushTrail,
  getDiagnosticTrail,
  _resetDiagnosticTrailForTest,
} from '../platform/diagnosticTrail';

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
