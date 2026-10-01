/**
 * adasRuntime.test.ts — ADAS çalışma zamanı: kapı kararı, kamera keşif hükmü, kare
 * işleyici uçtan uca ve kamera kirası yaşam döngüsü (görü motoru sahte).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Görü motoru sahtesi ─────────────────────────────────────────────────────
const vision = vi.hoisted(() => ({
  frameListeners: new Set<(f: unknown) => void>(),
  startVision: vi.fn(async () => {}),
  stopVision: vi.fn(),
  setVisionCameraPreference: vi.fn(async () => {}),
  setVisionDetectorConfig: vi.fn(),
  getActiveVisionCamera: vi.fn(() => ({ deviceId: 'cam-back', label: 'camera2 0, facing back' })),
}));
vi.mock('../platform/vision/visionCore', () => ({
  startVision: vision.startVision,
  stopVision: vision.stopVision,
  setVisionCameraPreference: vision.setVisionCameraPreference,
  setVisionDetectorConfig: vision.setVisionDetectorConfig,
  getActiveVisionCamera: vision.getActiveVisionCamera,
  onVisionFrame: (fn: (f: unknown) => void) => { vision.frameListeners.add(fn); return () => vision.frameListeners.delete(fn); },
}));
vi.mock('../platform/vision/visionImageProcess', () => ({ PROC_W: 320, PROC_H: 180 }));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'BALANCED'),
    getConfig: vi.fn(() => ({ obdPollingMs: 50, gpsUpdateMs: 200, uiFpsTarget: 60, enableBlur: false, enableAnimations: false, loggingLevel: 'silent' })),
    subscribe: vi.fn(() => () => {}),
    registerWorker: vi.fn(), unregisterWorker: vi.fn(), reportFailure: vi.fn(), reportRecovery: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/canBus/ProfileSignalGate', () => ({
  isGateSafeMode: () => false,
  getActiveProfileSignalNames: () => new Set<string>(),
}));
const camChange = vi.hoisted(() => ({ cb: null as null | (() => void) }));
vi.mock('../platform/adas/adasCameraDiscovery', async (orig) => ({
  ...(await orig<typeof import('../platform/adas/adasCameraDiscovery')>()),
  subscribeCameraChanges: (cb: () => void) => { camChange.cb = cb; return () => { camChange.cb = null; }; },
}));

import {
  evaluateAdasGate, canonicalSpeedKmh, startAdasRuntime, stopAdasRuntime, ADAS_RUNTIME_CFG,
} from '../platform/adas/adasRuntime';
import { classifyCameraLabel, computeUsbCameraVerdict } from '../platform/adas/adasCameraDiscovery';
import { AdasFrameProcessor } from '../platform/adas/adasFrameProcessor';
import { useAdasStore, setAdasSettings, DEFAULT_ADAS_SETTINGS, emptyAdasSignals, saveAdasCalibration } from '../platform/adas/adasStore';
import { DEFAULT_ADAS_CALIBRATION } from '../platform/adas/adasCalibration';
import { buildCameraModel } from '../platform/adas/adasGeometry';
import { useVisionStore } from '../platform/visionStore';
import type { VisionFrame } from '../platform/visionStore';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { NativeCameraDiagnostics } from '../platform/nativePlugin';

const NEG = Number.NEGATIVE_INFINITY;

// ═══════════════════════════ SAF KARARLAR ══════════════════════════════════
describe('ADAS kapı kararı', () => {
  const base = { enabled: true, reverse: false, safeMode: false, speedKmh: 50, lastMovingTs: 1000, now: 2000 };
  it('kapalı → off', () => expect(evaluateAdasGate({ ...base, enabled: false })).toEqual({ run: false, status: 'off', reason: null }));
  it('geri vites → standby/reverse', () => expect(evaluateAdasGate({ ...base, reverse: true })).toMatchObject({ run: false, reason: 'reverse' }));
  it('SAFE_MODE → standby', () => expect(evaluateAdasGate({ ...base, safeMode: true })).toMatchObject({ reason: 'safe_mode' }));
  it('sürüşte → çalışır', () => expect(evaluateAdasGate(base)).toEqual({ run: true }));
  it('trafik ışığında (3 dk içinde hareket) → çalışmaya devam', () => {
    expect(evaluateAdasGate({ ...base, speedKmh: 0, now: 1000 + ADAS_RUNTIME_CFG.PARK_RELEASE_MS - 1 })).toEqual({ run: true });
  });
  it('uzun park → kamera bırakılır', () => {
    expect(evaluateAdasGate({ ...base, speedKmh: 0, now: 1000 + ADAS_RUNTIME_CFG.PARK_RELEASE_MS })).toMatchObject({ reason: 'parked' });
  });
  it('hiç hareket yok + hız bilinmiyor → no_speed', () => {
    expect(evaluateAdasGate({ ...base, speedKmh: null, lastMovingTs: NEG })).toMatchObject({ reason: 'no_speed' });
  });
  it('hız kanonik sahibinden okunur: null = bilinmiyor (sahte 0 yok)', () => {
    expect(canonicalSpeedKmh({ speed: null })).toBeNull();
    expect(canonicalSpeedKmh({ speed: Number.NaN })).toBeNull();
    expect(canonicalSpeedKmh({ speed: 0 })).toBe(0);
    expect(canonicalSpeedKmh({ speed: 90 })).toBe(90);
  });
});

describe('Yol kamerası keşfi', () => {
  it('Android WebView etiketleri sınıflandırılır', () => {
    expect(classifyCameraLabel('camera2 0, facing back')).toBe('builtin_back');
    expect(classifyCameraLabel('camera2 1, facing front')).toBe('builtin_front');
    expect(classifyCameraLabel('camera2 5, facing external')).toBe('external');
    expect(classifyCameraLabel('USB 2.0 Camera')).toBe('usb');
    expect(classifyCameraLabel('HD Pro Webcam C920')).toBe('usb');
    expect(classifyCameraLabel('Kamera 1')).toBe('unknown');
  });

  const diag = (p: Partial<NativeCameraDiagnostics>): NativeCameraDiagnostics => ({
    featureCameraAny: true, featureExternalCamera: false, featureUsbHost: true, sdkInt: 30,
    cameras: [{ id: '0', facing: 'back', hardwareLevel: 'limited' }], usbVideoDevices: [], ...p,
  });
  const uvc = { vendorId: 0x046d, productId: 0x082d, name: 'HD Pro Webcam C920', manufacturer: 'Logitech', hasPermission: false };

  it('UVC takılı ama sistem kamerası değil → cihaz yazılımı hükmü', () => {
    expect(computeUsbCameraVerdict(diag({ usbVideoDevices: [uvc] }), [{ deviceId: 'a', label: 'camera2 0, facing back', kind: 'builtin_back' }]))
      .toBe('usb_not_exposed');
  });
  it('UVC takılı ve Camera2 harici gösteriyor → hazır', () => {
    expect(computeUsbCameraVerdict(diag({ usbVideoDevices: [uvc], cameras: [{ id: '5', facing: 'external', hardwareLevel: 'external' }] }), []))
      .toBe('usb_ready');
  });
  it('USB yok → yalnız dahili / hiç kamera', () => {
    expect(computeUsbCameraVerdict(diag({}), [{ deviceId: 'a', label: '', kind: 'unknown' }])).toBe('builtin_only');
    expect(computeUsbCameraVerdict(diag({ cameras: [] }), [])).toBe('no_camera');
  });
  it('native tanı yok (web/eski APK) → bilinmiyor, uydurma yok', () => {
    expect(computeUsbCameraVerdict(null, [{ deviceId: 'a', label: '', kind: 'unknown' }])).toBe('unknown');
  });
});

// ═══════════════════════════ KARE İŞLEYİCİ ═════════════════════════════════
describe('ADAS kare işleyici (uçtan uca)', () => {
  const CAL = { ...DEFAULT_ADAS_CALIBRATION, source: 'auto' as const };
  const cam = buildCameraModel(CAL, 16 / 9);
  const W = 320, H = 180;
  const proj = (x: number, z: number) => ({ u: cam.forwardU + (x * cam.fN) / z, v: cam.horizonV + (cam.fN * cam.aspect * cam.cameraHeightM) / z });
  const frameAt = (zLead: number | null, off = 0): VisionFrame => {
    const lane = (side: 'left' | 'right', x: number) => {
      const n = proj(x - off, 6), f = proj(x - off, 30);
      return { side, x1: f.u * W, y1: f.v * H, x2: n.u * W, y2: n.v * H, confidence: 0.9 };
    };
    const lead = zLead === null ? null : (() => {
      const l = proj(-0.9, zLead), r = proj(0.9, zLead);
      return { u0: l.u, u1: r.u, vBottom: l.v, vTop: l.v - 0.1, confidence: 0.8 };
    })();
    return {
      lanes: [lane('left', -1.75), lane('right', 1.75)], signs: [], lateralOffsetM: null, processingMs: 5, timestamp: 0,
      adas: { lead, lowLight: false, roadLuma: 120, aspect: 16 / 9 },
    };
  };
  const ctx = (now: number, speed: number | null) => ({
    now, speedKmh: speed, turnSignal: 'none' as const, calibration: CAL, sensitivity: 'normal' as const, procW: W, procH: H,
  });

  it('piksel şeritleri normalize edilir, merkezde ofset ≈ 0', () => {
    const p = new AdasFrameProcessor();
    let r = p.process(frameAt(null), ctx(0, 80));
    for (let t = 100; t <= 500; t += 100) r = p.process(frameAt(null), ctx(t, 80));
    expect(r.lane.leftTracked && r.lane.rightTracked).toBe(true);
    expect(Math.abs(r.lane.offsetM!)).toBeLessThan(0.05);
  });

  it('hızla yaklaşılan araç → FCW', () => {
    const p = new AdasFrameProcessor();
    let fired = false;
    for (let t = 0; t <= 1500; t += 100) {
      if (p.process(frameAt(22 - 12 * (t / 1000)), ctx(t, 50)).forwardCollision) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('düşük ışıkta öncü araç izlenmez, 2 sn sonra lowLight bildirilir', () => {
    const p = new AdasFrameProcessor();
    const dark = (): VisionFrame => ({ ...frameAt(15), adas: { lead: null, lowLight: true, roadLuma: 20, aspect: 16 / 9 } });
    expect(p.process(dark(), ctx(0, 50)).lowLight).toBe(false);
    const r = p.process(dark(), ctx(2100, 50));
    expect(r.lowLight).toBe(true);
    expect(r.lead).toBeNull();
  });
});

// ═══════════════════════════ ÇALIŞMA ZAMANI ════════════════════════════════
describe('ADAS çalışma zamanı — kamera kirası yaşam döngüsü', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    vi.clearAllMocks();
    vision.frameListeners.clear();
    vision.startVision.mockImplementation(async () => { useVisionStore.setState({ state: 'active', error: null }); });
    useVisionStore.setState({ state: 'idle', error: null });
    useAdasStore.setState({
      settings: { ...DEFAULT_ADAS_SETTINGS }, calibrations: {}, status: 'off', reason: null,
      signals: emptyAdasSignals(), lead: null, lane: null, lastFrameTs: null,
    });
    useUnifiedVehicleStore.setState({ speed: null, reverse: false, _vehicleSpeedTs: 0 });
  });
  afterEach(() => {
    stopAdasRuntime();
    vi.useRealTimers();
  });

  const drive = (kmh: number) => useUnifiedVehicleStore.setState({ speed: kmh, _vehicleSpeedTs: performance.now() });
  const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

  it('varsayılan KAPALI: sürüşte bile kamera istenmez', async () => {
    startAdasRuntime();
    drive(60);
    await vi.advanceTimersByTimeAsync(2000);
    expect(vision.startVision).not.toHaveBeenCalled();
    expect(useAdasStore.getState().status).toBe('off');
  });

  it('açık + sürüş → ADAS kirası; geri vites → bırakılır', async () => {
    startAdasRuntime();
    setAdasSettings({ enabled: true });
    drive(60);
    await vi.advanceTimersByTimeAsync(1100);
    expect(vision.startVision).toHaveBeenCalledWith(null, { owner: 'adas' });
    expect(useAdasStore.getState().status).toBe('calibrating'); // varsayılan kalibrasyon → metrik değil

    useUnifiedVehicleStore.setState({ reverse: true });
    await flush();
    expect(vision.stopVision).toHaveBeenCalledWith('adas');
    expect(useAdasStore.getState()).toMatchObject({ status: 'standby', reason: 'reverse' });
  });

  it('kare akışı durursa (donma) sinyaller ~600 ms içinde düşer', async () => {
    saveAdasCalibration(null, { ...DEFAULT_ADAS_CALIBRATION, source: 'manual' });
    startAdasRuntime();
    setAdasSettings({ enabled: true });
    drive(60);
    await vi.advanceTimersByTimeAsync(1100);
    expect(useAdasStore.getState().status).toBe('active');

    // Tek kare yayımla, sonra FCW'yi elle aktif yaz (model değil, kapıyı ölçüyoruz)
    const frame: VisionFrame = { lanes: [], signs: [], lateralOffsetM: null, processingMs: 1, timestamp: 0,
      adas: { lead: null, lowLight: false, roadLuma: 120, aspect: 16 / 9 }, captureMonoMs: performance.now() };
    vision.frameListeners.forEach((fn) => fn(frame));
    const s = useAdasStore.getState();
    useAdasStore.setState({ signals: { ...s.signals, forwardCollision: { value: true, ts: performance.now(), epoch: s.epoch } } });

    await vi.advanceTimersByTimeAsync(ADAS_RUNTIME_CFG.FROZEN_MS + ADAS_RUNTIME_CFG.WATCHDOG_MS);
    expect(useAdasStore.getState().signals.forwardCollision.value).toBe(false);
    expect(useAdasStore.getState()).toMatchObject({ status: 'degraded', reason: 'frozen' });
  });

  it('seçili USB kamera yok → unavailable; takılınca kendiliğinden bağlanır', async () => {
    setAdasSettings({ enabled: true, cameraDeviceId: 'usb-1' });
    vision.startVision.mockImplementationOnce(async () => {
      useVisionStore.setState({ state: 'error', error: 'Seçili kamera bulunamadı' });
      throw new Error('NotFoundError');
    });
    startAdasRuntime();
    drive(60);
    await vi.advanceTimersByTimeAsync(1100);
    expect(useAdasStore.getState()).toMatchObject({ status: 'unavailable', reason: 'camera_missing' });

    camChange.cb?.(); // USB kamera takıldı
    await flush();
    expect(vision.startVision).toHaveBeenCalledTimes(2);
    expect(vision.setVisionCameraPreference).toHaveBeenLastCalledWith('usb-1');
    expect(useAdasStore.getState().status).toBe('calibrating');
  });

  it('USB çekildi (akış hatası) → camera_lost, sinyaller düşer', async () => {
    startAdasRuntime();
    setAdasSettings({ enabled: true });
    drive(60);
    await vi.advanceTimersByTimeAsync(1100);
    useVisionStore.setState({ state: 'error', error: 'Kamera akışı kesildi' });
    expect(useAdasStore.getState()).toMatchObject({ status: 'unavailable', reason: 'camera_lost' });
  });

  it('sabit hızda (damga tazelenmese de) ADAS kamerayı tutar ve hız bilinir kalır', async () => {
    startAdasRuntime();
    setAdasSettings({ enabled: true });
    drive(90); // tek yayın; sonra değer hiç değişmiyor (OBD sabit hız / ~4 sn kadans)
    await vi.advanceTimersByTimeAsync(ADAS_RUNTIME_CFG.PARK_RELEASE_MS + 5000);
    expect(vision.stopVision).not.toHaveBeenCalled();
    // (Kare beslenmediği için bekçi 'frozen' der — burada ölçülen: park SANILMADI.)
    expect(useAdasStore.getState().reason).not.toBe('parked');
    expect(useAdasStore.getState().reason).not.toBe('no_speed');
  });

  it('izin reddi → her saniye yeniden DENENMEZ; kullanıcı yeniden açınca denenir', async () => {
    vision.startVision.mockImplementation(async () => { useVisionStore.setState({ state: 'disabled', error: 'Kamera izni verilmedi' }); });
    startAdasRuntime();
    setAdasSettings({ enabled: true });
    drive(60);
    await vi.advanceTimersByTimeAsync(1100);
    drive(60);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vision.startVision).toHaveBeenCalledTimes(1);
    expect(useAdasStore.getState()).toMatchObject({ status: 'unavailable', reason: 'permission_denied' });

    setAdasSettings({ enabled: false });
    setAdasSettings({ enabled: true });
    drive(60);
    await flush();
    expect(vision.startVision).toHaveBeenCalledTimes(2);
  });
});
