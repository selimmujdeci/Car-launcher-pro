/**
 * adasRuntime.test.ts — Sürüş Asistanı çalışma zamanı kilitleri (uçtan uca).
 *
 * Kamera (visionCore), dedektör worker'ı ve kamera listesi sahte; ayarlar,
 * araç deposu, modeller, gözetmen ve ADAS deposu GERÇEK. Şerit kareleri ve
 * öndeki araç kutuları pinhole modelinden fiziksel olarak üretilir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VisionFrame } from '../platform/visionStore';
import type { AdasCalibration, AdasSettings, NormLine, VehicleDetection } from '../platform/adas/adasTypes';

const h = vi.hoisted(() => ({
  owners: new Set<string>(),
  frameFn: null as null | ((f: VisionFrame) => void),
  track: { deviceId: 'dev-back', label: 'camera2 0, facing back', width: 1280, height: 720 },
  /** startVision davranışı: 'ok' | 'denied' | 'missing'. */
  mode: 'ok' as 'ok' | 'denied' | 'missing',
  starts: [] as Array<{ owner: string; deviceId: string | null | undefined }>,
  stops: [] as string[],
  cameras: [] as Array<{ deviceId: string; label: string }>,
  detector: null as null | {
    st: string; opts: { onResult: (r: unknown) => void };
    status: () => string; backend: () => string; setTargetHz: () => void; stop: () => void;
  },
}));

vi.mock('../platform/vision', async () => {
  const vs = await vi.importActual<typeof import('../platform/visionStore')>('../platform/visionStore');
  return {
    useVisionStore: vs.useVisionStore,
    startVision: vi.fn(async (_el: unknown, owner: string, opts?: { deviceId?: string | null }) => {
      h.starts.push({ owner, deviceId: opts?.deviceId });
      if (h.mode === 'denied') {
        vs.useVisionStore.setState({ state: 'disabled', error: 'Kamera izni verilmedi' });
        throw new Error('NotAllowedError');
      }
      if (h.mode === 'missing') {
        vs.useVisionStore.setState({ state: 'error', error: 'Requested device not found' });
        throw new Error('NotFoundError');
      }
      if (opts?.deviceId) {
        const c = h.cameras.find((x) => x.deviceId === opts.deviceId);
        if (c) h.track = { ...h.track, deviceId: c.deviceId, label: c.label };
      }
      h.owners.add(owner);
      vs.useVisionStore.setState({ state: 'active', error: null });
    }),
    stopVision: vi.fn((owner: string) => {
      h.stops.push(owner);
      h.owners.delete(owner);
      if (h.owners.size === 0) vs.useVisionStore.setState({ state: 'idle', error: null });
    }),
    onVisionFrame: (fn: (f: VisionFrame) => void) => { h.frameFn = fn; return () => { h.frameFn = null; }; },
    getVisionOwners: () => [...h.owners],
    getVisionTrackInfo: () => (h.owners.size ? h.track : null),
    getVisionVideoElement: () => null,
  };
});

vi.mock('../platform/adas/vehicleDetector', () => ({
  startVehicleDetector: vi.fn((opts: { onResult: (r: unknown) => void }) => {
    const d = {
      st: 'ready', opts,
      status: () => d.st, backend: () => 'webgl', setTargetHz: () => {},
      stop: () => { d.st = 'off'; },
    };
    h.detector = d;
    return d;
  }),
}));

vi.mock('../platform/adas/adasCamera', async () => {
  const actual = await vi.importActual<typeof import('../platform/adas/adasCamera')>('../platform/adas/adasCamera');
  return {
    ...actual,
    readCameraHardware: vi.fn(async () => null),
    listAdasCameras: vi.fn(async () => h.cameras.map((c) => ({ ...c, kind: actual.classifyCamera(c.label, null) }))),
  };
});

import { startAdasRuntime, stopAdasRuntime, retryAdasCamera } from '../platform/adas/adasRuntime';
import { useAdasStore } from '../platform/adas/adasStore';
import { DEFAULT_ADAS_SETTINGS } from '../platform/adas/adasTypes';
import { LANE_REF_Y, focalNormFromHfov } from '../platform/adas/adasGeometry';
import { useStore } from '../store/useStore';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { useVisionStore } from '../platform/visionStore';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import { createSafetyStateFromVehicleStore } from '../platform/safety/safetyStateMapper';

/* ── Sahne ─────────────────────────────────────────────────────────────── */

const KEY = 'label:camera2 0, facing back';
const CAL: AdasCalibration = {
  horizonY: 0.4, vanishX: 0.5, centerX: 0.5, laneWidthAtRef: 0.6,
  samples: 200, learnedAtMs: 1, cameraKey: KEY, source: 'auto',
};

function normLine(xAtRef: number): NormLine {
  const yTop = 0.6;
  const t = (LANE_REF_Y - yTop) / (LANE_REF_Y - 0.4);
  return { x1: xAtRef, y1: LANE_REF_Y, x2: xAtRef + (0.5 - xAtRef) * t, y2: yTop, confidence: 0.9 };
}

/** Araç şerit ortasına göre `offsetM` (+ sağ) konumdayken şerit worker'ının karesi (320×180 px). */
function frameAt(offsetM: number): VisionFrame {
  const mid = 0.5 - offsetM * (0.6 / 3.5);
  const px = (n: NormLine, side: 'left' | 'right') =>
    ({ x1: n.x1 * 320, y1: n.y1 * 180, x2: n.x2 * 320, y2: n.y2 * 180, side, confidence: 0.9 });
  return {
    lanes: [px(normLine(mid - 0.3), 'left'), px(normLine(mid + 0.3), 'right')],
    signs: [], lateralOffsetM: null, processingMs: 5, timestamp: 0,
  };
}

const FN = focalNormFromHfov(70);
function carAt(Z: number): VehicleDetection {
  const yb = 0.4 + (FN * (16 / 9) * 1.3) / Z;
  const w = (FN * 1.8) / Z;
  return { box: { x: 0.5 - w / 2, y: yb - w * 0.8, w, h: w * 0.8 }, score: 0.8, cls: 'car' };
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function setAdas(p: Partial<AdasSettings>): void {
  useStore.getState().updateSettings({ adas: { ...DEFAULT_ADAS_SETTINGS, enabled: true, consentAtMs: 1, ...p } });
}
const adas = () => useStore.getState().settings.adas;
const st = () => useAdasStore.getState();
const feature = (f: string) => st().features.find((x) => x.feature === f);

async function drive(
  ms: number,
  scene: (t: number) => { frame?: VisionFrame | null; det?: VehicleDetection[] | null } = () => ({}),
): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    const s = scene(t);
    if (s.frame && h.frameFn) h.frameFn(s.frame);
    if (s.det && h.detector && h.detector.st === 'ready') {
      h.detector.opts.onResult({ detections: s.det, latencyMs: 80, capturedAtMs: performance.now(), aspect: 16 / 9 });
    }
    await vi.advanceTimersByTimeAsync(100);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  vi.spyOn(runtimeManager, 'getMode').mockReturnValue(RuntimeMode.BALANCED);
  h.owners.clear(); h.frameFn = null; h.mode = 'ok'; h.starts = []; h.stops = []; h.cameras = []; h.detector = null;
  h.track = { deviceId: 'dev-back', label: 'camera2 0, facing back', width: 1280, height: 720 };
  useVisionStore.setState({ state: 'idle', error: null });
  useUnifiedVehicleStore.setState({ speed: 90, reverse: false });
  setAdas({});
});

afterEach(() => {
  stopAdasRuntime();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ── Senaryolar ────────────────────────────────────────────────────────── */

describe('ADAS çalışma zamanı', () => {
  it('R1. 🔒 kapalıyken ve onay yokken kamera AÇILMAZ', async () => {
    setAdas({ enabled: false });
    startAdasRuntime();
    await drive(500);
    expect(h.starts).toHaveLength(0);
    expect(st().overall).toBe('OFF');
    stopAdasRuntime();

    setAdas({ consentAtMs: null });
    startAdasRuntime();
    await drive(500);
    expect(h.starts).toHaveLength(0);
    expect(st()).toMatchObject({ overall: 'OFF', overallReason: 'NO_CONSENT' });
  });

  it('R2. kalibrasyonsuz başlangıç: şeritlerden öğrenir, ayara yazar, sonra uyarı verebilir', async () => {
    startAdasRuntime();
    await drive(300);
    expect(h.starts[0]).toEqual({ owner: 'adas', deviceId: null });
    expect(st().overall).toBe('CALIBRATING');
    expect(st().camera).toMatchObject({ hfovDeg: 70, cameraHeightM: 1.3, calibration: null });

    await drive(50_000, () => ({ frame: frameAt(0) }));
    const cal = adas().calibration!;
    expect(cal).toMatchObject({ cameraKey: KEY, source: 'auto' });
    expect(cal.horizonY).toBeCloseTo(0.4, 2);
    expect(cal.laneWidthAtRef).toBeCloseTo(0.6, 2);
    expect(feature('ldw')?.state).toBe('READY');
    expect(st().camera?.calibration).toBe(cal);
  });

  it('R3. sola kayma → şerit uyarısı güvenlik asistanına ulaşır (sesli + bant)', async () => {
    setAdas({ calibration: CAL });
    startAdasRuntime();
    await drive(1000, () => ({ frame: frameAt(0) }));
    await drive(4000, (t) => ({ frame: frameAt(-0.4 * (t / 1000)) }));
    expect(st().warning.lane).toBe('left');

    const v = useUnifiedVehicleStore.getState();
    const { state, updatedAt } = createSafetyStateFromVehicleStore(v, { adas: st().warning });
    const alerts = evaluateSafetyRules(state, performance.now(), updatedAt);
    expect(alerts[0]).toMatchObject({ ruleId: 'adas.ldw', icon: 'laneLeft' });
  });

  it('R4. 🔒 kamera donarsa (kare gelmez) şerit uyarısı DÜŞER, neden CAMERA_STALLED', async () => {
    setAdas({ calibration: CAL });
    startAdasRuntime();
    await drive(1000, () => ({ frame: frameAt(0) }));
    await drive(4000, (t) => ({ frame: frameAt(-0.4 * (t / 1000)) }));
    expect(st().warning.lane).toBe('left');
    const beat = st().warning.atPerfMs;
    await drive(2000);
    expect(st().warning.lane).toBeNull();
    expect(feature('ldw')).toMatchObject({ state: 'UNAVAILABLE', reason: 'CAMERA_STALLED' });
    expect(st().warning.atPerfMs).toBeGreaterThan(beat);   // süreç canlı: "uyarı yok" taze
  });

  it('R5. 🔒 başka kameranın kalibrasyonu UYGULANMAZ', async () => {
    setAdas({ calibration: { ...CAL, cameraKey: 'label:USB Camera' } });
    startAdasRuntime();
    await drive(500, () => ({ frame: frameAt(0) }));
    expect(st().overall).toBe('CALIBRATING');
    expect(feature('ldw')?.state).toBe('CALIBRATING');
  });

  it('R6. 🔒 geri vites: kamera bırakılır (native geri görüş önceliği), 3 sn sonra geri alınır', async () => {
    setAdas({ calibration: CAL });
    startAdasRuntime();
    await drive(500, () => ({ frame: frameAt(0) }));
    expect(h.owners.has('adas')).toBe(true);

    useUnifiedVehicleStore.setState({ reverse: true });
    await drive(300);
    expect(h.owners.has('adas')).toBe(false);
    expect(st()).toMatchObject({ overall: 'DEGRADED', overallReason: 'REVERSE' });
    expect(st().warning.lane).toBeNull();
    expect(st().camera).toBeNull();

    const before = h.starts.length;
    useUnifiedVehicleStore.setState({ reverse: false });
    await drive(2_800);
    expect(h.starts.length).toBe(before);
    await drive(400);
    expect(h.starts.length).toBe(before + 1);
    expect(h.owners.has('adas')).toBe(true);
  });

  it('R7. 🔒 izin reddi: izin penceresi döngüsü YOK; yalnız kullanıcı isteğiyle yeniden', async () => {
    h.mode = 'denied';
    startAdasRuntime();
    await drive(20_000);
    expect(h.starts).toHaveLength(1);
    expect(st()).toMatchObject({ overall: 'UNAVAILABLE', overallReason: 'CAMERA_DENIED' });

    h.mode = 'ok';
    retryAdasCamera();
    await drive(300);
    expect(h.starts).toHaveLength(2);
    expect(st().overall).toBe('CALIBRATING');   // kamera açıldı; kalibrasyon yok → öğreniyor
  });

  it('R8. kamera yok (USB takılı değil) → NO_CAMERA, 5 sn aralıkla yeniden dener', async () => {
    h.mode = 'missing';
    setAdas({ cameraDeviceId: 'usb-1', calibration: CAL });
    startAdasRuntime();
    await drive(300);
    expect(st().overallReason).toBe('NO_CAMERA');
    await drive(4_000);
    expect(h.starts).toHaveLength(1);
    await drive(1_500);
    expect(h.starts).toHaveLength(2);
    expect(h.starts[1]).toEqual({ owner: 'adas', deviceId: 'usb-1' });
  });

  it('R9. akış dışarıdan kesilirse (USB çekildi) 2 sn sonra yeniden kiralanır', async () => {
    setAdas({ calibration: CAL });
    startAdasRuntime();
    await drive(500, () => ({ frame: frameAt(0) }));
    h.owners.clear();
    useVisionStore.setState({ state: 'error', error: 'Kamera akışı kesildi' });
    await drive(300);
    expect(st().overallReason).toBe('CAMERA_ERROR');
    const before = h.starts.length;
    await drive(2_200);
    expect(h.starts.length).toBe(before + 1);
    expect(h.owners.has('adas')).toBe(true);
  });

  it('R10. otomatik mod USB kamerayı arka kameraya tercih eder; yalnız ön kamera varsa çalışmaz', async () => {
    h.cameras = [
      { deviceId: 'dev-back', label: 'camera2 0, facing back' },
      { deviceId: 'dev-usb', label: 'USB Camera (0c45:6366)' },
    ];
    startAdasRuntime();
    await drive(300);
    expect(h.starts.map((s) => s.deviceId)).toEqual([null, 'dev-usb']);
    expect(st().debug.cameraIsUsb).toBe(true);
    stopAdasRuntime();

    h.starts = [];
    h.cameras = [{ deviceId: 'dev-front', label: 'camera2 1, facing front' }];
    h.track = { deviceId: 'dev-front', label: 'camera2 1, facing front', width: 1280, height: 720 };
    startAdasRuntime();
    await drive(300);
    expect(h.owners.has('adas')).toBe(false);
    expect(st().overallReason).toBe('NO_CAMERA');
  });

  it('R11. öndeki duran araca 60 km/h yaklaşma → çarpışma uyarısı; FCW kapalıyken YOK', async () => {
    const run = async (): Promise<boolean> => {
      useUnifiedVehicleStore.setState({ speed: 60 });
      startAdasRuntime();
      await drive(300);
      const v = 60 / 3.6;
      const Z = (t: number) => (t < 3500 ? 70 : 70 - v * ((t - 3500) / 1000));
      let collision = false;
      await drive(7000, (t) => {
        if (st().warning.forward === 'collision') collision = true;
        return { frame: frameAt(0), det: Z(t) > 4 ? [carAt(Z(t))] : [] };
      });
      return collision;
    };
    setAdas({ calibration: CAL });
    expect(await run()).toBe(true);
    stopAdasRuntime();
    setAdas({ calibration: CAL, fcw: false });
    expect(await run()).toBe(false);
  });

  it('R12. 🔒 sistem koruması (SAFE_MODE) kamerayı bırakır; durdurma depoyu KAPALI yapar', async () => {
    setAdas({ calibration: CAL });
    startAdasRuntime();
    await drive(300, () => ({ frame: frameAt(0) }));
    vi.mocked(runtimeManager.getMode).mockReturnValue(RuntimeMode.SAFE_MODE);
    await drive(200);
    expect(h.owners.has('adas')).toBe(false);
    expect(st()).toMatchObject({ overall: 'UNAVAILABLE', overallReason: 'SYSTEM_PROTECTION' });

    stopAdasRuntime();
    expect(st()).toMatchObject({ overall: 'OFF', overallReason: 'DISABLED', camera: null, features: [] });
    expect(st().warning.lane).toBeNull();
  });
});
