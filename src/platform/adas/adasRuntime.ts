/**
 * adasRuntime.ts — Sürüş Asistanı çalışma zamanı. `useAdasStore`'un TEK YAZARI.
 *
 * Akış:
 *   ayarlar + araç (hız · vites · sinyal) + sistem modu
 *        │
 *        ▼
 *   kamera kirası ('adas') ──► şerit kareleri (VisionCompute) ──► kalibrasyon ──► LDW
 *        │                                                                     │
 *        └──► araç dedektörü (VehicleDetect) ──► FCW · takip mesafesi · kalkış ─┤
 *                                                                              ▼
 *                       adasSupervisor (kapılar + hüküm) ──► useAdasStore ──► güvenlik asistanı / AR
 *
 * Yetki: YALNIZ UYARI. Araç aktüatörüne yol yok; uyarının sunumu (öncelik,
 * ses, bant) mevcut güvenlik asistanındadır.
 *
 * Sistem kapıları (fail-closed):
 *   · Geri vites → kamera BIRAKILIR (native geri görüş kamerası önceliklidir),
 *     vites çıkınca 3 sn sonra yeniden alınır.
 *   · SAFE_MODE (sistem koruması) → kamera bırakılır.
 *   · Uygulama arka planda → kamera bırakılır (Android arka plan kamera kısıtı).
 *   · İzin reddi → yalnız kullanıcı isteğiyle yeniden denenir (izin penceresi
 *     döngüsü yok); kamera yok/hata → 5 sn'de bir ve USB tak-çıkarda denenir.
 *
 * Kalp atışı: süreç canlıyken uyarı sinyali ≤100 ms'de bir yeniden damgalanır;
 * süreç takılırsa güvenlik asistanının 600 ms bayatlık kapısı uyarıyı düşürür.
 */
import { useStore } from '../../store/useStore';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { getActiveProfileSignalNames, isGateSafeMode } from '../canBus/ProfileSignalGate';
import {
  startVision, stopVision, onVisionFrame, getVisionOwners, getVisionTrackInfo, getVisionVideoElement,
  useVisionStore, type VisionFrame,
} from '../vision';
import type { NativeCameraHardware } from '../nativePlugin';
import { useAdasStore, EMPTY_ADAS_DEBUG, type AdasCameraModel, type AdasDebug } from './adasStore';
import {
  DEFAULT_ADAS_SETTINGS, NO_ADAS_WARNING,
  type AdasCalibration, type AdasReason, type AdasSettings, type LaneObservation, type TurnSignal,
} from './adasTypes';
import { LANE_REF_Y } from './adasGeometry';
import {
  EMPTY_LEARNER, calibrationProgress, detectCalibrationDrift, finalizeCalibration, learnCalibrationSample,
  type CalibrationLearner,
} from './adasCalibration';
import { INITIAL_LDW_STATE, stepLdw, type LdwOutput, type LdwState } from './laneDepartureModel';
import { INITIAL_FORWARD_STATE, TRACK_LOST_MS, stepForward, type ForwardOutput, type ForwardState } from './forwardCollisionModel';
import {
  LANE_STALL_MS, anyFeatureEnabled, calibrationFor, cameraKeyOf, cameraPhase, composeFeatures,
  composeOverall, composeWarning, laneObservationFromFrame, sameFeatures, turnSignalFrom,
} from './adasSupervisor';
import { classifyCamera, listAdasCameras, pickAutoCamera, readCameraHardware } from './adasCamera';
import { startVehicleDetector, type DetectionResult, type VehicleDetectorHandle } from './vehicleDetector';

const TICK_MS = 100;
const RETRY_MS = 5_000;
/** USB çekilip takılınca yeniden sayım için kısa bekleme (ms). */
const LEASE_LOST_RETRY_MS = 2_000;
/** Geri vites bittikten sonra kamerayı yeniden almadan önce (native kamera kapanışı + 2 sn histerezis). */
const REVERSE_REACQUIRE_MS = 3_000;
/** Dedektör sonucu bu süre gelmezse ileri modelin zamanlayıcıları sonuçsuz adımla ilerletilir. */
const FORWARD_IDLE_STEP_MS = 300;
const FPS_WINDOW_MS = 2_000;

// ── Durum ────────────────────────────────────────────────────────────────────

let _started = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsubs: Array<() => void> = [];

/** Kira kuşağı — eski async sonucu yeni kirayı değiştiremez. */
let _gen = 0;
let _leased = false;
let _acquiring = false;
/** Kira alınırken geçerli `settings.adas.cameraDeviceId` (null = otomatik). */
let _leaseSetting: string | null = null;
let _blocked: AdasReason | null = null;
let _nextAcquireAt = 0;
/** İzin reddedildi → yalnız kullanıcı isteğiyle yeniden dene. */
let _manualRetryOnly = false;
let _autoRecheck = false;
let _runningSince: number | null = null;

let _hw: NativeCameraHardware | null = null;
let _cameraKey = 'auto';
let _cameraLabel: string | null = null;
let _cameraIsUsb = false;
let _aspect = 16 / 9;

let _ldw: LdwState = INITIAL_LDW_STATE;
let _ldwOut: LdwOutput | null = null;
let _fwd: ForwardState = INITIAL_FORWARD_STATE;
let _fwdOut: ForwardOutput | null = null;
let _lastFwdStepAt = -Infinity;
let _lastDetectAt = -Infinity;
let _learner: CalibrationLearner = EMPTY_LEARNER;
let _recent: CalibrationLearner = EMPTY_LEARNER;
let _lanes: LaneObservation | null = null;
let _lastLaneAt: number | null = null;
let _laneTimes: number[] = [];
let _detector: VehicleDetectorHandle | null = null;

let _wasReverse = false;
let _reverseEndedAt = -Infinity;

// ── Girdiler ─────────────────────────────────────────────────────────────────

function settings(): AdasSettings {
  return useStore.getState().settings.adas ?? DEFAULT_ADAS_SETTINGS;
}

function writeAdas(patch: Partial<AdasSettings>): void {
  useStore.getState().updateSettings({ adas: { ...settings(), ...patch } });
}

function speedKmh(): number | null {
  const v = useUnifiedVehicleStore.getState().speed;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function turnSignal(): TurnSignal {
  const names = getActiveProfileSignalNames();
  const v = useUnifiedVehicleStore.getState();
  return turnSignalFrom({
    known: !isGateSafeMode() && names.has('turnLeft') && names.has('turnRight'),
    left: v.canTurnLeft, right: v.canTurnRight, hazard: v.canHazard,
  });
}

function systemBlock(): AdasReason | null {
  if (runtimeManager.getMode() === RuntimeMode.SAFE_MODE) return 'SYSTEM_PROTECTION';
  if (useUnifiedVehicleStore.getState().reverse) return 'REVERSE';
  return null;
}

const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function currentCalibration(): AdasCalibration | null {
  return calibrationFor(settings().calibration, _cameraKey);
}

// ── Algı durumu ──────────────────────────────────────────────────────────────

function resetPerception(): void {
  _ldw = INITIAL_LDW_STATE; _ldwOut = null;
  _fwd = INITIAL_FORWARD_STATE; _fwdOut = null;
  _lastFwdStepAt = -Infinity; _lastDetectAt = -Infinity;
  _lanes = null; _lastLaneAt = null; _laneTimes = [];
}

function stopDetector(): void {
  _detector?.stop();
  _detector = null;
  _fwd = INITIAL_FORWARD_STATE; _fwdOut = null;
  _lastFwdStepAt = -Infinity; _lastDetectAt = -Infinity;
}

async function refreshCameraIdentity(): Promise<void> {
  const t = getVisionTrackInfo();
  const key = cameraKeyOf(t);
  if (key !== _cameraKey) { _learner = EMPTY_LEARNER; _recent = EMPTY_LEARNER; }
  _cameraKey = key;
  _cameraLabel = t?.label || null;
  _cameraIsUsb = t ? classifyCamera(t.label, _hw) === 'usb' : false;
  if (t && t.width > 0 && t.height > 0) _aspect = t.width / t.height;
}

// ── Kamera kirası ────────────────────────────────────────────────────────────

function blockedFromVision(): AdasReason {
  const vs = useVisionStore.getState();
  const ph = cameraPhase(vs.state, vs.error);
  return ph.phase === 'blocked' ? ph.reason : 'CAMERA_ERROR';
}

function releaseCamera(): void {
  ++_gen;
  stopDetector();
  if (_leased) {
    _leased = false;
    stopVision('adas');
  }
  _runningSince = null;
  resetPerception();
}

/**
 * Otomatik modda en uygun yol kamerası: USB → arka → bilinmeyen. Açık kamera
 * ön (sürücü) kamerasıysa ADAS onu KULLANMAZ → NO_CAMERA.
 */
async function applyAutoPick(gen: number): Promise<void> {
  const options = await listAdasCameras(_hw);
  if (gen !== _gen) return;
  const pick = pickAutoCamera(options);
  const cur = getVisionTrackInfo();
  if (pick && cur && pick.deviceId !== cur.deviceId) {
    await startVision(null, 'adas', { deviceId: pick.deviceId });
    if (gen !== _gen) return;
    resetPerception();
    _runningSince = performance.now();
    await refreshCameraIdentity();
  } else if (!pick && cur && classifyCamera(cur.label, _hw) === 'front') {
    releaseCamera();
    _blocked = 'NO_CAMERA';
    _nextAcquireAt = performance.now() + RETRY_MS;
  }
}

async function acquire(deviceSetting: string | null): Promise<void> {
  const gen = ++_gen;
  _acquiring = true;
  _leased = true;
  _leaseSetting = deviceSetting;
  stopDetector();
  resetPerception();
  try {
    _hw = await readCameraHardware();
    if (gen !== _gen) return;
    await startVision(null, 'adas', { deviceId: deviceSetting });
    if (gen !== _gen) return;
    _blocked = null;
    _manualRetryOnly = false;
    _runningSince = performance.now();
    await refreshCameraIdentity();
    if (deviceSetting === null) await applyAutoPick(gen);
  } catch {
    if (gen !== _gen) return;
    _leased = false;
    _runningSince = null;
    _blocked = blockedFromVision();
    _manualRetryOnly = _blocked === 'CAMERA_DENIED';
    _nextAcquireAt = performance.now() + RETRY_MS;
  } finally {
    _acquiring = false;
    /* Bekleme sırasında bırakıldıysak (durdurma) geç açılan akışı kapat. */
    if (gen !== _gen && !_leased) stopVision('adas');
  }
}

async function recheckAuto(): Promise<void> {
  const gen = _gen;
  _acquiring = true;
  try {
    _hw = await readCameraHardware();
    if (gen === _gen) await applyAutoPick(gen);
  } catch {
    /* kira kaybı bir sonraki tick'te ele alınır */
  } finally {
    _acquiring = false;
    if (gen !== _gen && !_leased) stopVision('adas');
  }
}

function wantsCamera(s: AdasSettings, now: number): boolean {
  return s.enabled && s.consentAtMs !== null && anyFeatureEnabled(s)
    && systemBlock() === null && !hidden()
    && now - _reverseEndedAt >= REVERSE_REACQUIRE_MS;
}

function reconcile(now: number): void {
  if (_acquiring) return;
  const s = settings();
  if (!wantsCamera(s, now)) {
    if (_leased) releaseCamera();
    return;
  }
  if (_leased && !getVisionOwners().includes('adas')) {
    /* Akış dışarıdan kesildi (USB çekildi, sistem kamerayı aldı). */
    _leased = false;
    _runningSince = null;
    stopDetector();
    resetPerception();
    _blocked = blockedFromVision();
    _nextAcquireAt = now + LEASE_LOST_RETRY_MS;
    return;
  }
  if (_leased && s.cameraDeviceId !== _leaseSetting) { void acquire(s.cameraDeviceId); return; }
  if (_leased && _autoRecheck && s.cameraDeviceId === null) { _autoRecheck = false; void recheckAuto(); return; }
  if (!_leased && !_manualRetryOnly && now >= _nextAcquireAt) void acquire(s.cameraDeviceId);
}

// ── Algı adımları ────────────────────────────────────────────────────────────

const processing = (): boolean => _leased && !_acquiring && _runningSince !== null;

function onFrame(f: VisionFrame): void {
  if (!processing()) return;
  const now = performance.now();
  const lanes = laneObservationFromFrame(f.lanes);
  _lanes = lanes;
  _lastLaneAt = now;
  _laneTimes.push(now);
  while (_laneTimes.length && now - _laneTimes[0] > FPS_WINDOW_MS) _laneTimes.shift();

  const s = settings();
  const speed = speedKmh();
  const stored = calibrationFor(s.calibration, _cameraKey);
  if (!stored) {
    _learner = learnCalibrationSample(_learner, lanes, speed, now);
    const cal = finalizeCalibration(_learner, _cameraKey, Date.now());
    if (cal) {
      _learner = EMPTY_LEARNER;
      _recent = EMPTY_LEARNER;
      writeAdas({ calibration: cal });
    }
  } else {
    _recent = learnCalibrationSample(_recent, lanes, speed, now);
    if (detectCalibrationDrift(stored, _recent)) {
      /* Kamera yerinden oynadı → kayıtlı kalibrasyon artık YANLIŞ; yeniden öğren. */
      _recent = EMPTY_LEARNER;
      writeAdas({ calibration: null });
    }
  }

  const r = stepLdw(_ldw, {
    tMs: now, lanes, speedKmh: speed, turnSignal: turnSignal(),
    calibration: currentCalibration(), sensitivity: s.sensitivity,
  });
  _ldw = r.state;
  _ldwOut = r.out;
  publish(now);
}

function stepForwardAt(tMs: number, r: DetectionResult | null): void {
  const s = settings();
  const t = Math.max(tMs, _lastFwdStepAt + 1);
  const out = stepForward(_fwd, {
    tMs: t,
    detections: r ? r.detections : null,
    latencyMs: r ? r.latencyMs : null,
    speedKmh: speedKmh(),
    calibration: currentCalibration(),
    sensitivity: s.sensitivity,
    cameraHeightM: s.cameraHeightM,
    hfovDeg: s.hfovDeg,
    aspect: r ? r.aspect : _aspect,
  });
  _fwd = out.state;
  _fwdOut = out.out;
  _lastFwdStepAt = t;
}

function onDetection(r: DetectionResult): void {
  if (!_detector || !processing()) return;
  _lastDetectAt = performance.now();
  stepForwardAt(r.capturedAtMs, r);
  publish(performance.now());
}

function detectHzForMode(): number {
  const m = runtimeManager.getMode();
  return m === RuntimeMode.PERFORMANCE || m === RuntimeMode.BALANCED ? 8 : 5;
}

function manageDetector(s: AdasSettings, now: number): void {
  const want = processing() && currentCalibration() !== null && (s.fcw || s.headway || s.leadDeparture);
  if (want && !_detector) {
    _fwd = INITIAL_FORWARD_STATE;
    _fwdOut = null;
    _detector = startVehicleDetector({
      getVideo: getVisionVideoElement, onResult: onDetection, targetHz: detectHzForMode(),
    });
  } else if (!want && _detector) {
    stopDetector();
  }
  if (!_detector) return;
  _detector.setTargetHz(detectHzForMode());
  if (now - _lastDetectAt > FORWARD_IDLE_STEP_MS && now - _lastFwdStepAt > FORWARD_IDLE_STEP_MS) {
    stepForwardAt(now, null);
  }
}

// ── Yayım ────────────────────────────────────────────────────────────────────

function sameCamera(a: AdasCameraModel | null, b: AdasCameraModel | null): boolean {
  if (a === b) return true;
  return !!a && !!b && a.hfovDeg === b.hfovDeg && a.cameraHeightM === b.cameraHeightM && a.calibration === b.calibration;
}

function publish(now: number): void {
  const s = settings();
  let block = systemBlock();
  let starting = false;
  if (!block) {
    if (!_leased) {
      block = _blocked;
      starting = block === null;
    } else if (!processing()) {
      starting = true;
    } else {
      const vs = useVisionStore.getState();
      const ph = cameraPhase(vs.state, vs.error);
      if (ph.phase === 'blocked') block = ph.reason;
      else if (ph.phase === 'starting') starting = true;
    }
  }

  const cal = currentCalibration();
  const live = processing() && !block && !starting;
  const laneStale = live && now - (_lastLaneAt ?? (_runningSince as number)) > LANE_STALL_MS;
  const features = composeFeatures({
    settings: s, block, starting, calibration: cal, laneStale,
    ldw: _ldwOut, forward: _fwdOut, detector: _detector ? _detector.status() : 'off',
  });
  const { overall, reason } = composeOverall({ settings: s, features, block, starting });
  const warning = live ? composeWarning(s, features, _ldwOut, _fwdOut, now) : NO_ADAS_WARNING;

  const leadFresh = _fwdOut?.lead && now - _lastDetectAt <= TRACK_LOST_MS ? _fwdOut.lead : null;
  const debug: AdasDebug = live
    ? {
      lanes: _lanes,
      lead: leadFresh
        ? { box: leadFresh.box, distanceM: leadFresh.distanceM, ttcS: leadFresh.ttcS, headwayS: leadFresh.headwayS }
        : null,
      offsetM: _ldwOut?.offsetM ?? null,
      laneFps: _laneTimes.length / (FPS_WINDOW_MS / 1000),
      detectHz: _fwdOut?.detectHz ?? 0,
      detectLatencyMs: _fwdOut?.latencyMs ?? null,
      calibrationProgress: cal ? 1 : calibrationProgress(_learner),
      turnSignalKnown: turnSignal() !== 'unknown',
      detectorBackend: _detector?.backend() ?? null,
      cameraLabel: _cameraLabel,
      cameraIsUsb: _cameraIsUsb,
      referenceLine: cal ? { x1: cal.vanishX, y1: cal.horizonY, x2: cal.centerX, y2: LANE_REF_Y, confidence: 1 } : null,
    }
    : {
      ...EMPTY_ADAS_DEBUG,
      calibrationProgress: cal ? 1 : calibrationProgress(_learner),
      cameraLabel: _cameraLabel, cameraIsUsb: _cameraIsUsb,
    };

  const prev = useAdasStore.getState();
  const camera: AdasCameraModel | null = live
    ? { hfovDeg: s.hfovDeg, cameraHeightM: s.cameraHeightM, calibration: cal }
    : null;

  /* Değişmeyen dilimler aynı referansla kalır — seçici kullanan React
     bileşenleri 10 Hz'de boşuna render olmaz. */
  useAdasStore.setState({
    overall,
    overallReason: reason,
    features: sameFeatures(prev.features, features) ? prev.features : features,
    warning,
    debug,
    camera: sameCamera(prev.camera, camera) ? prev.camera : camera,
  });
}

function tick(): void {
  const now = performance.now();
  if (useUnifiedVehicleStore.getState().reverse) {
    _wasReverse = true;
  } else if (_wasReverse) {
    _wasReverse = false;
    _reverseEndedAt = now;
  }
  reconcile(now);
  manageDetector(settings(), now);
  publish(now);
}

// ── Genel API ────────────────────────────────────────────────────────────────

/** Çalışma zamanını başlatır (AdasRuntimeHost, ADAS açıkken). Durdurma thunk'ı döner. */
export function startAdasRuntime(): () => void {
  if (_started) return stopAdasRuntime;
  _started = true;
  _nextAcquireAt = 0;
  _manualRetryOnly = false;
  _blocked = null;
  /* Vites geçmişi oturuma aittir; geri vites sürüyorsa ilk tick zaten kapatır. */
  _wasReverse = false;
  _reverseEndedAt = -Infinity;

  _unsubs.push(onVisionFrame(onFrame));
  _unsubs.push(useStore.subscribe((state, prev) => {
    const a = state.settings.adas;
    const b = prev.settings.adas;
    if (a === b) return;
    if (b?.calibration && !a?.calibration) { _learner = EMPTY_LEARNER; _recent = EMPTY_LEARNER; }
    if (a?.cameraDeviceId !== b?.cameraDeviceId) { _manualRetryOnly = false; _nextAcquireAt = 0; _blocked = null; }
  }));
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (md?.addEventListener) {
    const onDeviceChange = (): void => {
      _autoRecheck = true;
      if (!_manualRetryOnly) _nextAcquireAt = 0;
    };
    md.addEventListener('devicechange', onDeviceChange);
    _unsubs.push(() => md.removeEventListener('devicechange', onDeviceChange));
  }

  _timer = setInterval(tick, TICK_MS);
  tick();
  return stopAdasRuntime;
}

/** Kamerayı bırakır, depoyu KAPALI'ya çeker. */
export function stopAdasRuntime(): void {
  if (!_started) return;
  _started = false;
  if (_timer) { clearInterval(_timer); _timer = null; }
  _unsubs.forEach((u) => u());
  _unsubs = [];
  releaseCamera();
  _learner = EMPTY_LEARNER;
  _recent = EMPTY_LEARNER;
  _autoRecheck = false;
  useAdasStore.setState({
    overall: 'OFF', overallReason: 'DISABLED', features: [], warning: NO_ADAS_WARNING,
    debug: EMPTY_ADAS_DEBUG, camera: null,
  });
}

/** Kullanıcı isteğiyle kamerayı yeniden dener (izin reddi sonrası dahil). */
export function retryAdasCamera(): void {
  _manualRetryOnly = false;
  _blocked = null;
  _nextAcquireAt = 0;
}

/** Elle hizalama için açık kameranın kimliği ve en-boy oranı; kamera yoksa `null`. */
export function getAdasCameraIdentity(): { readonly key: string; readonly aspect: number } | null {
  return processing() ? { key: _cameraKey, aspect: _aspect } : null;
}
