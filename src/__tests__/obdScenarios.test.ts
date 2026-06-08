/**
 * obdScenarios.test.ts — T1: OBD veri simülatörü senaryo testleri.
 *
 * obdSimulator senaryolarını obdService.updateOBDData üzerinden besler ve
 * obdService state + onOBDData yayınının doğru tepki verdiğini doğrular.
 *
 * MOCK_ENABLED=false: obdService'in kendi web-mock'u devre dışı → yalnız
 * simülatör verisi işlenir (deterministik, çakışma yok). obdService'e dokunulmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── MOCK_ENABLED=false: simülatör tek veri kaynağı ── */
vi.hoisted(() => {
  process.env['VITE_ENABLE_OBD_MOCK'] = 'false';
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:                vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:             vi.fn().mockResolvedValue(undefined),
    disconnectOBD:          vi.fn().mockResolvedValue(undefined),
    addListener:            vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({
    obdPollInterval:       50,
    obdListenerDebounce:   0,
    enableRecommendations: false,
    recCooldownMs:         999_999,
  })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot:     vi.fn(),
  flushCanSnapshotNow:     vi.fn(),
  stopCanSnapshot:         vi.fn(),
}));

vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame:    vi.fn(() => null),
  hasBinaryFrame:         vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));

vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode:   vi.fn(() => 'BALANCED'),
    getConfig: vi.fn(() => ({
      obdPollingMs:     50,
      gpsUpdateMs:      200,
      uiFpsTarget:      60,
      enableBlur:       false,
      enableAnimations: false,
      loggingLevel:     'silent',
    })),
    subscribe:     vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

/* ── Imports (mock'lardan sonra) ── */
import { stopOBD, onOBDData, updateOBDData, type OBDData } from '../platform/obdService';
import { SCENARIOS, playScenario } from './sim/obdSimulator';

/** onOBDData yayınlarını toplayan dinleyici; son anlık görüntüyü ve seriyi tutar. */
function collect(): { last: () => OBDData | null; series: OBDData[]; stop: () => void } {
  const series: OBDData[] = [];
  const unsub = onOBDData((d) => series.push({ ...d }));
  return {
    last: () => (series.length ? series[series.length - 1] : null),
    series,
    stop: unsub,
  };
}

describe('T1 — OBD veri simülatörü senaryoları', () => {
  beforeEach(() => { stopOBD(); });
  afterEach(() => { stopOBD(); vi.clearAllMocks(); });

  it('CRUISE: sabit hız/rpm/sıcaklık/yakıt store\'a yansır', () => {
    const c = collect();
    playScenario(SCENARIOS.CRUISE, updateOBDData);
    const d = c.last();
    expect(d).not.toBeNull();
    expect(d!.speed).toBe(110);
    expect(d!.rpm).toBe(2200);
    expect(d!.engineTemp).toBe(92);
    expect(d!.fuelLevel).toBe(60);
    expect(d!.connectionState).toBe('connected');
    c.stop();
  });

  it('RPM_RAMP: RPM monotonik artar ve son değer 4000', () => {
    const c = collect();
    playScenario(SCENARIOS.RPM_RAMP, updateOBDData);
    const rpms = c.series.map((d) => d.rpm).filter((r) => r >= 0);
    expect(rpms[rpms.length - 1]).toBe(4000);
    for (let i = 1; i < rpms.length; i++) expect(rpms[i]).toBeGreaterThanOrEqual(rpms[i - 1]);
    c.stop();
  });

  it('SPEED_RAMP: hız 0→120 km/h, son değer 120', () => {
    const c = collect();
    playScenario(SCENARIOS.SPEED_RAMP, updateOBDData);
    expect(c.last()!.speed).toBe(120);
    c.stop();
  });

  it('OVERHEAT: motor sıcaklığı 120°C\'ye tırmanır', () => {
    const c = collect();
    playScenario(SCENARIOS.OVERHEAT, updateOBDData);
    expect(c.last()!.engineTemp).toBe(120);
    c.stop();
  });

  it('FUEL_DRAIN: yakıt 15%\'e düşer (monotonik azalış)', () => {
    const c = collect();
    playScenario(SCENARIOS.FUEL_DRAIN, updateOBDData);
    const fuels = c.series.map((d) => d.fuelLevel).filter((f) => f >= 0);
    expect(fuels[fuels.length - 1]).toBe(15);
    for (let i = 1; i < fuels.length; i++) expect(fuels[i]).toBeLessThanOrEqual(fuels[i - 1]);
    c.stop();
  });

  it('DISCONNECT: veri sonrası stopOBD → connectionState idle', () => {
    const c = collect();
    playScenario(SCENARIOS.DISCONNECT, updateOBDData);
    expect(c.last()!.connectionState).toBe('connected');
    stopOBD();
    expect(c.last()!.connectionState).toBe('idle');
    c.stop();
  });

  it('NO_DATA: hiç veri kareği gelmezse yayın olmaz', () => {
    const c = collect();
    playScenario(SCENARIOS.NO_DATA, updateOBDData); // boş frames
    expect(c.series.length).toBe(0);
    c.stop();
  });
});
